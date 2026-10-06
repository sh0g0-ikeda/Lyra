import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import { ConflictError } from '../domain/errors/index.js';
import { OPENAI_INPUT_IMAGE_MAX_BYTES } from '../domain/constants/imageInput.js';
import { buildFencedStateReferenceKey, STATE_REFERENCE_COPY_V2_PROTOCOL } from '../domain/state/FencedStateReferenceKey.js';
import type { ConfirmedEntityStateReference, ConfirmEntityStateReferenceInput } from '../domain/types/entityStateReference.js';
import type {
  FencedErasureReceipt, FencedImageReceipt, FencedSourceRevision, FencedStateReferenceIntent, LoadedFencedSource,
} from '../infrastructure/aws/FencedStateReferenceStorage.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import { lockAndValidateConfirmation, parseStateReferenceDescriptor, toPersistedDescriptor } from './EntityStateReferenceRepository.js';

export type FencedStateReferenceState = 'unresolved' | 'confirmed' | 'fencing' | 'effects_fenced';
export type FencedStateReferenceReason = 'unconfirmed_recovery' | 'account_deletion';
export interface FencedStateReferenceFencingClaim {
  reason: FencedStateReferenceReason;
  processingToken?: string;
  /** Current authorized editor; the admitted actor/owner is never rebound. */
  recoveryUserId?: string;
}
export type PreparedFencedSource = Omit<LoadedFencedSource, 'imageData'>;
export type FencedStateReferenceRecoveryScope = Pick<ConfirmEntityStateReferenceInput,
  'userId' | 'organizationId' | 'entityId' | 'stateId'>;
export interface FencedStateReferenceAttempt {
  input: ConfirmEntityStateReferenceInput;
  intent: FencedStateReferenceIntent;
  state: FencedStateReferenceState;
  dispatchStartedAt: string | null;
  imageReceipt: FencedImageReceipt | null;
  erasureReceipt: FencedErasureReceipt | null;
  fencingReason: FencedStateReferenceReason | null;
  deletionProcessingToken: string | null;
}
export interface FencedStateReferenceAdmission {
  confirmed: ConfirmedEntityStateReference | null;
  attempt: FencedStateReferenceAttempt | null;
  newlyAdmitted: boolean;
}
export interface FencedStateReferenceRepository {
  admit(input: ConfirmEntityStateReferenceInput, source: PreparedFencedSource): Promise<FencedStateReferenceAdmission>;
  authorizeDispatch(attempt: FencedStateReferenceAttempt): Promise<boolean>;
  confirmObservedImage(attempt: FencedStateReferenceAttempt, receipt: FencedImageReceipt): Promise<ConfirmedEntityStateReference>;
  claimFencing(attempt: FencedStateReferenceAttempt, claim: FencedStateReferenceFencingClaim): Promise<FencedStateReferenceAttempt>;
  completeFencing(attempt: FencedStateReferenceAttempt, receipt: FencedErasureReceipt): Promise<FencedStateReferenceAttempt>;
  findActiveAttempt(input: ConfirmEntityStateReferenceInput): Promise<FencedStateReferenceAttempt | null>;
  findPendingAttemptForRecovery(scope: FencedStateReferenceRecoveryScope): Promise<FencedStateReferenceAttempt | null>;
  findByKeyAndScope(scope: { s3Key: string; ownerUserId: string; entityId: string; organizationId: string | null }): Promise<FencedStateReferenceAttempt | null>;
  listPersonalPendingFences(userId: string, processingToken: string, limit?: number): Promise<FencedStateReferenceAttempt[]>;
}

interface AttemptRow extends QueryResultRow {
  attempt_token: string; protocol: string; s3_key: string; state: string;
  actor_user_id: string | null; owner_user_id: string | null; organization_id: string | null;
  entity_id: string | null; state_id: string | null; job_id: string | null;
  candidate_ref_id: string | null; candidate_s3_key: string | null; expected_state_revision: string | null;
  descriptor: unknown; digest: string | null; mime_type: string | null; size_bytes: number | null; source_revision: unknown;
  image_receipt: unknown; marker_receipt: unknown; dispatch_started_at: Date | string | null;
  fencing_reason: string | null; deletion_processing_token: string | null; scrubbed_at: Date | string | null;
}

/**
 * Design (Spec §5–6 and state-copy recovery review §3): the database journal is
 * independent of generation-job retention. No method performs external I/O.
 * Admission and adoption reuse the original user → reference → state → job locks.
 * A committed one-shot dispatch flag prevents request replay after lost COMMIT
 * acknowledgements. A committed fencing state blocks adoption before a marker
 * writer acts. Only exact v2 receipts can settle; legacy history remains blocking.
 */
export class PostgresFencedStateReferenceRepository implements FencedStateReferenceRepository {
  public constructor(private readonly client: DatabaseClient & TransactionRunner) {}

  public async admit(input: ConfirmEntityStateReferenceInput, source: PreparedFencedSource): Promise<FencedStateReferenceAdmission> {
    assertPreparedSource(source);
    if (input.descriptor.storageOwnerUserId !== input.userId) throw conflict();
    return this.client.transaction(async (client) => {
      await lockUser(client, input.userId);
      const existingRows = await client.query<AttemptRow>(
        `SELECT * FROM state_reference_copy_attempts WHERE job_id=$1::uuid AND candidate_ref_id=$2 AND state<>'effects_fenced'`,
        [input.jobId, input.descriptor.refId],
      );
      const existing = existingRows.rows[0] === undefined ? null : mapAttempt(existingRows.rows[0]);
      const attemptToken = existing?.intent.attemptToken ?? randomUUID();
      const intent: FencedStateReferenceIntent = {
        protocol: STATE_REFERENCE_COPY_V2_PROTOCOL, attemptToken, ownerUserId: input.userId, entityId: input.entityId,
        s3Key: buildFencedStateReferenceKey({ ownerUserId: input.userId, entityId: input.entityId, attemptToken, mimeType: source.mimeType }),
        mimeType: source.mimeType, digest: source.digest, sizeBytes: source.sizeBytes, sourceRevision: source.sourceRevision,
      };
      const effectiveInput = { ...input, descriptor: { ...input.descriptor, s3Key: intent.s3Key } };
      if (existing !== null) assertSameAttempt(existing, { input: effectiveInput, intent });
      const { confirmed } = await lockAndValidateConfirmation(client, effectiveInput);
      await requireOrganizationEditor(client, input);
      const blocker = await client.query(
        `SELECT attempt_token FROM state_reference_copy_attempts
         WHERE entity_id=$1::uuid AND state_id=$2::uuid AND state IN ('unresolved','fencing') AND attempt_token<>$3::uuid LIMIT 1`,
        [input.entityId, input.stateId, attemptToken],
      );
      if (blocker.rows.length !== 0) throw conflict();
      if (existing !== null) {
        if (existing.state === 'confirmed' && confirmed === null) throw conflict();
        return { confirmed: existing.state === 'confirmed' ? confirmed : null, attempt: existing, newlyAdmitted: false };
      }
      // A descriptor alone cannot manufacture a v2 receipt/admission.
      if (confirmed !== null) throw conflict();
      const inserted = await client.query<AttemptRow>(
        `INSERT INTO state_reference_copy_attempts (
           attempt_token,protocol,s3_key,state,actor_user_id,owner_user_id,organization_id,entity_id,state_id,job_id,
           candidate_ref_id,candidate_s3_key,expected_state_revision,descriptor,digest,mime_type,size_bytes,source_revision
         ) VALUES ($1::uuid,$2,$3,'unresolved',$4::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::uuid,
           $9,$10,$11,$12::jsonb,$13,$14,$15,$16::jsonb) RETURNING *`,
        [attemptToken,intent.protocol,intent.s3Key,input.userId,input.organizationId,input.entityId,input.stateId,input.jobId,
          input.descriptor.refId,input.candidateS3Key,input.expectedStateRevision,JSON.stringify(toPersistedDescriptor(effectiveInput.descriptor)),
          source.digest,source.mimeType,source.sizeBytes,JSON.stringify(source.sourceRevision)],
      );
      return { confirmed: null, attempt: mapAttempt(requiredRow(inserted.rows[0])), newlyAdmitted: true };
    });
  }

  public async authorizeDispatch(attempt: FencedStateReferenceAttempt): Promise<boolean> {
    assertAttempt(attempt);
    return this.client.transaction(async (client) => {
      const { confirmed } = await lockAndValidateConfirmation(client, attempt.input);
      await requireOrganizationEditor(client, attempt.input);
      const current = await lockAttempt(client, attempt);
      if (current.state !== 'unresolved' || current.dispatchStartedAt !== null || confirmed !== null) return false;
      const result = await client.query(
        `UPDATE state_reference_copy_attempts SET dispatch_started_at=clock_timestamp(),updated_at=NOW()
         WHERE attempt_token=$1::uuid AND s3_key=$2 AND state='unresolved' AND dispatch_started_at IS NULL RETURNING attempt_token`,
        [attempt.intent.attemptToken, attempt.intent.s3Key],
      );
      return result.rowCount === 1;
    });
  }

  public async confirmObservedImage(attempt: FencedStateReferenceAttempt, receipt: FencedImageReceipt): Promise<ConfirmedEntityStateReference> {
    assertAttempt(attempt);
    assertImageReceipt(attempt.intent, receipt);
    return this.client.transaction(async (client) => {
      const validation = await lockAndValidateConfirmation(client, attempt.input);
      await requireOrganizationEditor(client, attempt.input);
      const current = await lockAttempt(client, attempt);
      if (current.state === 'confirmed') {
        if (validation.confirmed === null || !sameJson(current.imageReceipt, receipt)) throw conflict();
        return validation.confirmed;
      }
      if (current.state !== 'unresolved' || current.dispatchStartedAt === null) throw conflict();
      const settled = await client.query(
        `UPDATE state_reference_copy_attempts SET state='confirmed',image_receipt=$3::jsonb,updated_at=NOW()
         WHERE attempt_token=$1::uuid AND s3_key=$2 AND state='unresolved' AND dispatch_started_at IS NOT NULL RETURNING attempt_token`,
        [attempt.intent.attemptToken, attempt.intent.s3Key, JSON.stringify(receipt)],
      );
      if (settled.rowCount !== 1) throw conflict();
      const updated = await client.query<{ state_revision: Date | string }>(
        `UPDATE entity_states SET reference_image=$3::jsonb, updated_at=GREATEST(
           date_trunc('milliseconds',clock_timestamp()),
           date_trunc('milliseconds',COALESCE(updated_at,created_at))+INTERVAL '1 millisecond')
         WHERE id=$1::uuid AND entity_id=$2::uuid RETURNING COALESCE(updated_at,created_at) AS state_revision`,
        [attempt.input.stateId, attempt.input.entityId, JSON.stringify(toPersistedDescriptor(attempt.input.descriptor))],
      );
      const row = updated.rows[0];
      if (row === undefined) throw conflict();
      return { entityId: attempt.input.entityId, stateId: attempt.input.stateId,
        stateRevision: iso(row.state_revision), referenceImage: attempt.input.descriptor };
    });
  }

  public async claimFencing(attempt: FencedStateReferenceAttempt, claim: FencedStateReferenceFencingClaim): Promise<FencedStateReferenceAttempt> {
    assertAttempt(attempt);
    if (!['unconfirmed_recovery', 'account_deletion'].includes(claim.reason)) throw conflict();
    return this.client.transaction(async (client) => {
      if (claim.reason === 'account_deletion') {
        await lockUser(client, attempt.input.userId);
        if (attempt.input.organizationId !== null || claim.processingToken === undefined) throw conflict();
        await requireDeletionClaim(client, attempt.input.userId, claim.processingToken);
      } else {
        const recoveryUserId = claim.recoveryUserId ?? attempt.input.userId;
        if (attempt.input.organizationId === null && recoveryUserId !== attempt.input.userId) throw conflict();
        await requireLiveRecoveryScope(client, { ...attempt.input, userId: recoveryUserId });
      }
      const current = await lockAttempt(client, attempt);
      if (current.state === 'effects_fenced') return current;
      if (current.state === 'confirmed' && claim.reason !== 'account_deletion') throw conflict();
      if (current.state === 'fencing' && current.fencingReason === 'account_deletion' && claim.reason !== 'account_deletion') throw conflict();
      const result = await client.query<AttemptRow>(
        `UPDATE state_reference_copy_attempts SET state='fencing',fencing_reason=$3,
           deletion_processing_token=$4::uuid,updated_at=NOW()
         WHERE attempt_token=$1::uuid AND s3_key=$2 AND state IN ('unresolved','confirmed','fencing') RETURNING *`,
        [attempt.intent.attemptToken,attempt.intent.s3Key,claim.reason,claim.reason === 'account_deletion' ? claim.processingToken : null],
      );
      return mapAttempt(requiredRow(result.rows[0]));
    });
  }

  public async completeFencing(attempt: FencedStateReferenceAttempt, receipt: FencedErasureReceipt): Promise<FencedStateReferenceAttempt> {
    assertAttempt(attempt);
    assertErasureReceipt(attempt.intent, receipt);
    if (attempt.state !== 'fencing' && attempt.state !== 'effects_fenced') throw conflict();
    return this.client.transaction(async (client) => {
      await lockUser(client, attempt.input.userId);
      if (attempt.fencingReason === 'account_deletion') {
        if (attempt.deletionProcessingToken === null) throw conflict();
        await requireDeletionClaim(client, attempt.input.userId, attempt.deletionProcessingToken);
      }
      const current = await lockAttempt(client, attempt);
      if (current.state === 'effects_fenced') {
        if (!sameJson(current.erasureReceipt, receipt)) throw conflict();
        return current;
      }
      if (current.state !== 'fencing' || current.fencingReason !== attempt.fencingReason
        || current.deletionProcessingToken !== attempt.deletionProcessingToken) throw conflict();
      const updated = await client.query<AttemptRow>(
        `UPDATE state_reference_copy_attempts SET state='effects_fenced',marker_receipt=$3::jsonb,
           history_erased_at=clock_timestamp(),updated_at=NOW()
         WHERE attempt_token=$1::uuid AND s3_key=$2 AND state='fencing'
           AND fencing_reason=$4 AND deletion_processing_token IS NOT DISTINCT FROM $5::uuid RETURNING *`,
        [attempt.intent.attemptToken,attempt.intent.s3Key,JSON.stringify(receipt),attempt.fencingReason,attempt.deletionProcessingToken],
      );
      return mapAttempt(requiredRow(updated.rows[0]));
    });
  }

  public async findActiveAttempt(input: ConfirmEntityStateReferenceInput): Promise<FencedStateReferenceAttempt | null> {
    const rows = await this.client.query<AttemptRow>(
      `SELECT * FROM state_reference_copy_attempts WHERE actor_user_id=$1::uuid AND organization_id IS NOT DISTINCT FROM $2::uuid
       AND entity_id=$3::uuid AND state_id=$4::uuid AND job_id=$5::uuid AND candidate_ref_id=$6
       AND candidate_s3_key=$7 AND state<>'effects_fenced' AND scrubbed_at IS NULL`,
      [input.userId,input.organizationId,input.entityId,input.stateId,input.jobId,input.descriptor.refId,input.candidateS3Key],
    );
    if (rows.rows[0] === undefined) return null;
    const attempt = mapAttempt(rows.rows[0]);
    assertSameInput(attempt.input, { ...input, descriptor: { ...input.descriptor, s3Key: attempt.intent.s3Key } });
    return attempt;
  }

  public async findPendingAttemptForRecovery(scope: FencedStateReferenceRecoveryScope): Promise<FencedStateReferenceAttempt | null> {
    return this.client.transaction(async (client) => {
      await requireLiveRecoveryScope(client, scope);
      const result = await client.query<AttemptRow>(
        `SELECT * FROM state_reference_copy_attempts
         WHERE ($2::uuid IS NOT NULL OR (actor_user_id=$1::uuid AND owner_user_id=$1::uuid))
           AND organization_id IS NOT DISTINCT FROM $2::uuid
           AND entity_id=$3::uuid AND state_id=$4::uuid AND state IN ('unresolved','fencing') AND scrubbed_at IS NULL
         ORDER BY created_at,attempt_token LIMIT 1`,
        [scope.userId,scope.organizationId,scope.entityId,scope.stateId],
      );
      return result.rows[0] === undefined ? null : mapAttempt(result.rows[0]);
    });
  }

  /** This exact-key lookup is evidence only; callers still authorize the resource. */
  public async findByKeyAndScope(scope: { s3Key: string; ownerUserId: string; entityId: string; organizationId: string | null }): Promise<FencedStateReferenceAttempt | null> {
    const result = await this.client.query<AttemptRow>(
      `SELECT * FROM state_reference_copy_attempts WHERE s3_key=$1 AND owner_user_id=$2::uuid AND entity_id=$3::uuid
       AND organization_id IS NOT DISTINCT FROM $4::uuid AND scrubbed_at IS NULL`,
      [scope.s3Key,scope.ownerUserId,scope.entityId,scope.organizationId],
    );
    return result.rows[0] === undefined ? null : mapAttempt(result.rows[0]);
  }

  public async listPersonalPendingFences(userId: string, processingToken: string, limit = 100): Promise<FencedStateReferenceAttempt[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw conflict();
    return this.client.transaction(async (client) => {
      await lockUser(client, userId);
      await requireDeletionClaim(client, userId, processingToken);
      const result = await client.query<AttemptRow>(
        `SELECT * FROM state_reference_copy_attempts WHERE actor_user_id=$1::uuid AND owner_user_id=$1::uuid
         AND organization_id IS NULL AND state<>'effects_fenced' AND scrubbed_at IS NULL
         ORDER BY created_at,attempt_token LIMIT $2`,
        [userId,limit],
      );
      return result.rows.map(mapAttempt);
    });
  }
}

async function lockUser(client: DatabaseClient, userId: string): Promise<void> {
  const result = await client.query('SELECT id FROM users WHERE id=$1::uuid FOR UPDATE', [userId]);
  if (result.rows.length !== 1) throw conflict();
}
async function requireLiveRecoveryScope(client: DatabaseClient, scope: FencedStateReferenceRecoveryScope): Promise<void> {
  const user = await client.query(
    `SELECT id FROM users WHERE id=$1::uuid AND account_deletion_started_at IS NULL AND account_deleted_at IS NULL FOR UPDATE`,
    [scope.userId],
  );
  if (user.rows.length !== 1) throw conflict();
  await requireOrganizationEditor(client, scope);
  const resource = await client.query(
    `SELECT entity_states.id FROM entity_states
     INNER JOIN entities ON entities.id=entity_states.entity_id
     INNER JOIN works ON works.id=entities.work_id
     WHERE entity_states.id=$1::uuid AND entities.id=$2::uuid
       AND works.organization_id IS NOT DISTINCT FROM $4::uuid
       AND ($4::uuid IS NOT NULL OR entities.user_id=$3::uuid)
     FOR SHARE OF works,entities,entity_states`,
    [scope.stateId,scope.entityId,scope.userId,scope.organizationId],
  );
  if (resource.rows.length !== 1) throw conflict();
}
async function requireOrganizationEditor(client: DatabaseClient, scope: FencedStateReferenceRecoveryScope): Promise<void> {
  if (scope.organizationId === null) return;
  // Recheck capability after every remote boundary. Callers that also validate
  // freshness retain the existing user → reference → state → job lock order.
  const member = await client.query(
    `SELECT user_id FROM organization_members WHERE organization_id=$1::uuid AND user_id=$2::uuid
     AND status='active' AND role IN ('owner','admin','editor') FOR SHARE`,
    [scope.organizationId,scope.userId],
  );
  if (member.rows.length !== 1) throw conflict();
}
async function requireDeletionClaim(client: DatabaseClient, userId: string, processingToken: string): Promise<void> {
  const result = await client.query(
    `SELECT requests.user_id FROM account_deletion_requests requests INNER JOIN users ON users.id=requests.user_id
     WHERE requests.user_id=$1::uuid AND requests.processing_token=$2::uuid AND requests.status='processing'
       AND users.account_deletion_started_at IS NOT NULL FOR UPDATE OF requests`,
    [userId,processingToken],
  );
  if (result.rows.length !== 1) throw conflict();
}
async function lockAttempt(client: DatabaseClient, expected: FencedStateReferenceAttempt): Promise<FencedStateReferenceAttempt> {
  const rows = await client.query<AttemptRow>(
    `SELECT * FROM state_reference_copy_attempts WHERE attempt_token=$1::uuid AND s3_key=$2
     AND actor_user_id=$3::uuid AND organization_id IS NOT DISTINCT FROM $4::uuid AND scrubbed_at IS NULL FOR UPDATE`,
    [expected.intent.attemptToken,expected.intent.s3Key,expected.input.userId,expected.input.organizationId],
  );
  const current = mapAttempt(requiredRow(rows.rows[0]));
  assertSameAttempt(current, expected);
  return current;
}
function mapAttempt(row: AttemptRow): FencedStateReferenceAttempt {
  if (row.scrubbed_at !== null || row.protocol !== STATE_REFERENCE_COPY_V2_PROTOCOL
    || !['unresolved','confirmed','fencing','effects_fenced'].includes(row.state)) throw conflict();
  const descriptor = parseStateReferenceDescriptor(row.descriptor);
  if (descriptor === null || row.size_bytes === null) throw conflict();
  const source: PreparedFencedSource = {
    mimeType: requiredString(row.mime_type) as PreparedFencedSource['mimeType'], sizeBytes: row.size_bytes,
    digest: requiredString(row.digest), sourceRevision: row.source_revision as FencedSourceRevision,
  };
  assertPreparedSource(source);
  const attempt: FencedStateReferenceAttempt = {
    input: { userId: requiredString(row.actor_user_id),organizationId: row.organization_id,
      entityId: requiredString(row.entity_id),stateId: requiredString(row.state_id),jobId: requiredString(row.job_id),
      candidateS3Key: requiredString(row.candidate_s3_key),expectedStateRevision: requiredString(row.expected_state_revision),descriptor },
    intent: { protocol: STATE_REFERENCE_COPY_V2_PROTOCOL,attemptToken: row.attempt_token,s3Key: row.s3_key,
      ownerUserId: requiredString(row.owner_user_id),entityId: requiredString(row.entity_id),...source },
    state: row.state as FencedStateReferenceState,dispatchStartedAt: row.dispatch_started_at === null ? null : iso(row.dispatch_started_at),
    imageReceipt: row.image_receipt as FencedImageReceipt | null,erasureReceipt: row.marker_receipt as FencedErasureReceipt | null,
    fencingReason: row.fencing_reason as FencedStateReferenceReason | null,deletionProcessingToken: row.deletion_processing_token,
  };
  if (descriptor.refId !== row.candidate_ref_id) throw conflict();
  assertAttempt(attempt);
  if (attempt.imageReceipt !== null) assertImageReceipt(attempt.intent, attempt.imageReceipt);
  if (attempt.erasureReceipt !== null) assertErasureReceipt(attempt.intent, attempt.erasureReceipt);
  return attempt;
}
function assertAttempt(attempt: Pick<FencedStateReferenceAttempt, 'input' | 'intent'>): void {
  assertPreparedSource(attempt.intent);
  if (attempt.intent.protocol !== STATE_REFERENCE_COPY_V2_PROTOCOL || attempt.intent.ownerUserId !== attempt.input.userId
    || attempt.intent.entityId !== attempt.input.entityId || attempt.input.descriptor.storageOwnerUserId !== attempt.intent.ownerUserId
    || attempt.input.descriptor.s3Key !== attempt.intent.s3Key
    || buildFencedStateReferenceKey(attempt.intent) !== attempt.intent.s3Key) throw conflict();
}
function assertSameAttempt(current: FencedStateReferenceAttempt, expected: Pick<FencedStateReferenceAttempt, 'input' | 'intent'>): void {
  assertSameInput(current.input, expected.input);
  if (!sameJson(current.intent, expected.intent)) throw conflict();
}
function assertSameInput(current: ConfirmEntityStateReferenceInput, expected: ConfirmEntityStateReferenceInput): void {
  if (!sameJson(current, expected)) throw conflict();
}
function assertPreparedSource(source: PreparedFencedSource): void {
  if (!['image/png','image/jpeg','image/webp'].includes(source.mimeType)
    || !Number.isSafeInteger(source.sizeBytes) || source.sizeBytes < 1 || source.sizeBytes > OPENAI_INPUT_IMAGE_MAX_BYTES
    || typeof source.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(source.digest)
    || source.sourceRevision === null || typeof source.sourceRevision !== 'object' || Array.isArray(source.sourceRevision)
    || !validETag(source.sourceRevision.eTag) || !validVersion(source.sourceRevision.versionId)
    || Object.keys(source.sourceRevision).some((key) => !['eTag','versionId'].includes(key))) throw conflict();
}
function assertReceiptIdentity(intent: FencedStateReferenceIntent, receipt: FencedImageReceipt | FencedErasureReceipt): void {
  if (receipt === null || typeof receipt !== 'object' || receipt.protocol !== intent.protocol
    || receipt.attemptToken !== intent.attemptToken || receipt.s3Key !== intent.s3Key
    || !validETag(receipt.eTag) || !validVersion(receipt.versionId)) throw conflict();
}
function assertImageReceipt(intent: FencedStateReferenceIntent, receipt: FencedImageReceipt): void {
  assertReceiptIdentity(intent, receipt);
  if (receipt.kind !== 'image' || receipt.digest !== intent.digest || receipt.mimeType !== intent.mimeType
    || receipt.sizeBytes !== intent.sizeBytes
    || Object.keys(receipt).some((key) => !['kind','protocol','attemptToken','s3Key','eTag','versionId','digest','mimeType','sizeBytes'].includes(key))) throw conflict();
}
function assertErasureReceipt(intent: FencedStateReferenceIntent, receipt: FencedErasureReceipt): void {
  assertReceiptIdentity(intent, receipt);
  if (receipt.kind !== 'marker' || receipt.historyErased !== true
    || Object.keys(receipt).some((key) => !['kind','protocol','attemptToken','s3Key','eTag','versionId','historyErased'].includes(key))) throw conflict();
}
function validETag(value: unknown): boolean { return typeof value === 'string' && /^"[\x21\x23-\x7e]{1,254}"$/u.test(value); }
function validVersion(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\x00-\x20\x7f]/u.test(value));
}
function requiredString(value: string | null): string { if (value === null || value.length === 0) throw conflict(); return value; }
function requiredRow(row: AttemptRow | undefined): AttemptRow { if (row === undefined) throw conflict(); return row; }
function iso(value: Date | string): string { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw conflict(); return date.toISOString(); }
function sameJson(left: unknown, right: unknown): boolean { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}
function conflict(): ConflictError { return new ConflictError('State reference durable evidence is stale or incomplete'); }
