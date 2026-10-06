import { readImageProvenance, toImageProvenanceRecord } from '../domain/generation/ImageAccessPolicy.js';
import type { QueryResultRow } from 'pg';
import { randomUUID } from 'node:crypto';
import { ConflictError, ConfigurationError } from '../domain/errors/index.js';
import { computeStateReferenceFingerprint } from '../domain/state/StateReferenceFingerprint.js';
import type { EntityStatus, EntityType } from '../domain/types/entity.js';
import type {
  ConfirmedEntityStateReference,
  ConfirmEntityStateReferenceInput,
  EntityStateReferenceContextCandidate,
  EntityStateReferenceDescriptor,
} from '../domain/types/entityStateReference.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import { buildEntityStateReferenceImageKey } from '../domain/state/StateReferenceImageKey.js';
import { readStateReferenceCopyHistory, type StateReferenceCopyAttempt } from './StateReferenceCopyHistory.js';
import { readableStateReferenceSql } from './FencedStateReferenceReadGuard.js';

export interface EntityStateReferenceRepository {
  findContextByIdAndUserId(
    entityId: string,
    stateId: string,
    userId: string,
    organizationId?: string | null,
  ): Promise<EntityStateReferenceContextCandidate | null>;
  confirmReference(
    input: ConfirmEntityStateReferenceInput,
    copyImage: () => Promise<void>,
  ): Promise<ConfirmedEntityStateReference>;
}

interface StateContextRow extends QueryResultRow {
  entity_id: string;
  work_id: string;
  entity_owner_user_id: string;
  entity_type: string;
  entity_name: string;
  entity_free_description: string | null;
  entity_structured_fields: unknown;
  entity_prompt_supplement: string | null;
  entity_status: string;
  state_id: string;
  state_name: string | null;
  state_description: string | null;
  state_revision: Date | string;
  state_reference_image: unknown;
  base_ref_id: string | null;
  base_s3_key: string | null;
  base_reference_image: unknown;
}

interface LockedReferenceSetRow extends QueryResultRow {
  primary_ref_id: string | null;
  base_s3_key: string | null;
}

interface LockedStateRow extends QueryResultRow {
  name: string | null;
  description: string | null;
  reference_image: unknown;
  state_revision: Date | string;
}

interface CandidateJobRow extends QueryResultRow {
  user_id: string;
  organization_id: string | null;
  status: string;
  params: unknown;
  result: unknown;
}

interface UpdatedStateRow extends QueryResultRow {
  state_revision: Date | string;
}

export class PostgresEntityStateReferenceRepository implements EntityStateReferenceRepository {
  public constructor(private readonly client: DatabaseClient & TransactionRunner) {}

  public async findContextByIdAndUserId(
    entityId: string,
    stateId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<EntityStateReferenceContextCandidate | null> {
    const result = await this.client.query<StateContextRow>(
      `
      SELECT entities.id AS entity_id,
             entities.work_id,
             entities.user_id AS entity_owner_user_id,
             entities.entity_type,
             entities.name AS entity_name,
             entities.free_description AS entity_free_description,
             entities.structured_fields AS entity_structured_fields,
             entities.prompt_supplement AS entity_prompt_supplement,
             entities.status AS entity_status,
             entity_states.id AS state_id,
             entity_states.name AS state_name,
             entity_states.description AS state_description,
             COALESCE(entity_states.updated_at, entity_states.created_at) AS state_revision,
             ${readableStateReferenceSql({ descriptor: 'entity_states.reference_image', entityId: 'entities.id', stateId: 'entity_states.id', organizationId: 'works.organization_id' })} AS state_reference_image,
             reference_sets.primary_ref_id AS base_ref_id,
             primary_image.value->>'s3_key' AS base_s3_key,
             primary_image.value AS base_reference_image
      FROM entity_states
      INNER JOIN entities ON entities.id = entity_states.entity_id
      INNER JOIN works ON works.id = entities.work_id
      LEFT JOIN reference_sets ON reference_sets.entity_id = entities.id
      LEFT JOIN LATERAL (
        SELECT value
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(reference_sets.reference_images) = 'array' THEN reference_sets.reference_images
            ELSE '[]'::jsonb
          END
        ) AS value
        WHERE value->>'ref_id' = reference_sets.primary_ref_id
        LIMIT 1
      ) AS primary_image ON TRUE
      WHERE entities.id = $1::uuid
        AND entity_states.id = $2::uuid
        AND (
          ($4::uuid IS NULL
            AND works.organization_id IS NULL
            AND entities.user_id = $3::uuid)
          OR (
            $4::uuid IS NOT NULL
            AND works.organization_id = $4::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $3::uuid
                AND organization_members.status = 'active'
            )
          )
        )
      `,
      [entityId, stateId, userId, organizationId],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapStateContext(row);
  }

  public async confirmReference(
    input: ConfirmEntityStateReferenceInput,
    copyImage: () => Promise<void>,
  ): Promise<ConfirmedEntityStateReference> {
    assertCopyDestination(input);
    // A durable unresolved attempt survives loss of either database or storage
    // acknowledgement. Neither elapsed time nor a retry can settle that attempt.
    // Deletion checks this fence even after this transaction's row locks vanish.
    const attemptId = randomUUID();
    const admission = await this.client.transaction(async (client) => {
      const { confirmed, history } = await lockAndValidateConfirmation(client, input);
      await assertNoLiveFencedAttempt(client, input);
      if (confirmed !== null) return { confirmed, attemptId: null, copyRequired: false };
      const succeeded = history.find((entry) => entry.state === 'succeeded'
        && entry.s3_key === input.descriptor.s3Key && entry.ref_id === input.descriptor.refId);
      if (succeeded !== undefined) return { confirmed: null, attemptId: succeeded.attempt_id, copyRequired: false };
      const attempt: StateReferenceCopyAttempt = {
        s3_key: input.descriptor.s3Key,
        entity_id: input.entityId,
        state_id: input.stateId,
        ref_id: input.descriptor.refId,
        attempt_id: attemptId,
        state: 'unresolved',
      };
      await client.query(
        `UPDATE generation_jobs SET result = jsonb_set(result, '{state_reference_copies}', $2::jsonb)
         WHERE id = $1::uuid`,
        [input.jobId, JSON.stringify([...history, attempt])],
      );
      return { confirmed: null, attemptId, copyRequired: true };
    }).catch(async (error: unknown) => {
      // A lost admission COMMIT acknowledgement cannot have dispatched copyImage:
      // execution has not entered phase two. Recover only our freshly minted token.
      try {
        await this.recordCopySettlement(input, attemptId, 'not_dispatched');
      } catch {
        // If its admission did not commit, or recovery is unavailable, no other
        // attempt is changed. A committed unresolved entry remains fail-closed.
      }
      throw error;
    });
    if (admission.confirmed !== null) return admission.confirmed;
    if (admission.attemptId === null) throw new ConfigurationError('State reference copy admission is missing');
    const admittedAttemptId = admission.attemptId;
    let copyStarted = false;
    let copySucceeded = false;
    try {
      return await this.client.transaction(async (client) => {
        const { confirmed, history } = await lockAndValidateConfirmation(client, input,
          admission.copyRequired ? admittedAttemptId : undefined);
        await assertNoLiveFencedAttempt(client, input);
        const attempt = history.find((entry) => entry.attempt_id === admittedAttemptId);
        if (attempt === undefined || attempt.s3_key !== input.descriptor.s3Key
          || attempt.ref_id !== input.descriptor.refId
          || attempt.state !== (admission.copyRequired ? 'unresolved' : 'succeeded')) {
          throw new ConflictError('State reference copy admission is stale');
        }
        if (confirmed !== null) {
          if (admission.copyRequired) await settleCopyAttempt(client, input, admittedAttemptId, 'not_dispatched');
          return confirmed;
        }
        if (admission.copyRequired) {
          // The port must perform one external attempt and resolve only after
          // a complete successful response. Rejection is always ambiguous.
          copyStarted = true;
          await copyImage();
          copySucceeded = true;
          await settleCopyAttempt(client, input, admittedAttemptId, 'succeeded');
        }
        const updateResult = await client.query<UpdatedStateRow>(
          `
          UPDATE entity_states
          SET reference_image = $3::jsonb,
              updated_at = GREATEST(
                date_trunc('milliseconds', clock_timestamp()),
                date_trunc('milliseconds', COALESCE(updated_at, created_at)) + INTERVAL '1 millisecond'
              )
          WHERE id = $1::uuid AND entity_id = $2::uuid
          RETURNING COALESCE(updated_at, created_at) AS state_revision
          `,
          [input.stateId, input.entityId, JSON.stringify(toPersistedDescriptor(input.descriptor))],
        );
        const updated = updateResult.rows[0];
        if (updated === undefined) throw new ConflictError('Entity state reference could not be confirmed');
        return {
          entityId: input.entityId, stateId: input.stateId,
          stateRevision: toIsoString(updated.state_revision), referenceImage: input.descriptor,
        };
      });
    } catch (error) {
      if (admission.copyRequired && (copySucceeded || !copyStarted)) {
        // Only this invocation knows whether its own attempt was dispatched or
        // positively completed. Never clear a different/legacy attempt's fence.
        // If this recovery write fails, unresolved history intentionally remains.
        try {
          await this.recordCopySettlement(input, admittedAttemptId,
            copySucceeded ? 'succeeded' : 'not_dispatched');
        } catch {
          // Fail closed: no retry, timeout, or unsuccessful cleanup is settlement.
        }
      }
      throw error;
    }
  }

  private async recordCopySettlement(
    input: ConfirmEntityStateReferenceInput,
    attemptId: string,
    state: 'succeeded' | 'not_dispatched',
  ): Promise<void> {
    await this.client.transaction(async (client) => {
      await client.query('SELECT id FROM users WHERE id = $1::uuid FOR UPDATE', [input.userId]);
      const job = await lockCandidateJob(client, input.jobId);
      assertConfirmCandidate(job, input);
      await settleCopyAttempt(client, input, attemptId, state);
    });
  }
}

async function assertNoLiveFencedAttempt(client: DatabaseClient, input: ConfirmEntityStateReferenceInput): Promise<void> {
  const result = await client.query(
    `SELECT attempt_token FROM state_reference_copy_attempts
     WHERE (job_id=$1::uuid AND state<>'effects_fenced')
       OR (entity_id=$2::uuid AND state_id=$3::uuid AND state IN ('unresolved','fencing')) LIMIT 1`,
    [input.jobId, input.entityId, input.stateId],
  );
  if (result.rows.length !== 0) throw new ConflictError('State reference copy must continue through its admitted recovery protocol');
}

function assertCopyDestination(input: ConfirmEntityStateReferenceInput): void {
  const expectedKey = buildEntityStateReferenceImageKey({
    userId: input.userId,
    entityId: input.entityId,
    stateId: input.stateId,
    refId: input.descriptor.refId,
    sourceS3Key: input.candidateS3Key,
  });
  if (input.descriptor.s3Key !== expectedKey || input.descriptor.storageOwnerUserId !== input.userId) {
    throw new ConflictError('State reference destination is invalid');
  }
}

export async function lockAndValidateConfirmation(
  client: DatabaseClient,
  input: ConfirmEntityStateReferenceInput,
  ownedAttemptId?: string,
): Promise<{ confirmed: ConfirmedEntityStateReference | null; history: StateReferenceCopyAttempt[] }> {
  const user = await client.query<{
    account_deletion_started_at: Date | null;
    account_deleted_at: Date | null;
  }>(
    `SELECT account_deletion_started_at, account_deleted_at FROM users WHERE id = $1::uuid FOR UPDATE`,
    [input.userId],
  );
  if (user.rows[0] === undefined || user.rows[0].account_deletion_started_at !== null
    || user.rows[0].account_deleted_at !== null) {
    throw new ConflictError('Account deletion has started or account is unavailable');
  }
  const referenceSet = await lockReferenceSet(client, input);
  const state = await lockEntityState(client, input);
  const job = await lockCandidateJob(client, input.jobId);
  assertConfirmCandidate(job, input);
  const history = readStateReferenceCopyHistory(toRecord(job.result)?.state_reference_copies, input);
  if (history.some((entry) => entry.state === 'unresolved' && entry.attempt_id !== ownedAttemptId)) {
    throw new ConflictError('State reference copy outcome requires reconciliation');
  }
  assertFreshStateAndBase(state, referenceSet, input);
  const currentDescriptor = parseStateReferenceDescriptor(state.reference_image);
  if (currentDescriptor !== null && descriptorsEqual(currentDescriptor, input.descriptor)) {
    return { history, confirmed: {
      entityId: input.entityId,
      stateId: input.stateId,
      stateRevision: toIsoString(state.state_revision),
      referenceImage: currentDescriptor,
    } };
  }
  if (toIsoString(state.state_revision) !== input.expectedStateRevision) {
    throw new ConflictError('Entity state changed after the preview was generated');
  }
  return { confirmed: null, history };
}

async function settleCopyAttempt(
  client: DatabaseClient,
  input: ConfirmEntityStateReferenceInput,
  attemptId: string,
  state: 'succeeded' | 'not_dispatched',
): Promise<void> {
  const result = await client.query(
    `UPDATE generation_jobs SET result = jsonb_set(result, '{state_reference_copies}', (
       SELECT jsonb_agg(CASE
         WHEN entry->>'attempt_id' = $2 AND entry->>'state' = 'unresolved'
           AND entry->>'s3_key' = $3 AND entry->>'entity_id' = $4
           AND entry->>'state_id' = $5 AND entry->>'ref_id' = $6
         THEN entry || jsonb_build_object('state', $7::text) ELSE entry END ORDER BY ordinal)
       FROM jsonb_array_elements(result->'state_reference_copies') WITH ORDINALITY AS entries(entry, ordinal)
     ))
     WHERE id = $1::uuid AND user_id = $8::uuid
       AND organization_id IS NOT DISTINCT FROM $9::uuid
       AND jsonb_typeof(result->'state_reference_copies') = 'array'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(result->'state_reference_copies') = 'array'
             THEN result->'state_reference_copies' ELSE '[]'::jsonb END
         ) AS attempt
         WHERE attempt->>'attempt_id' = $2 AND attempt->>'s3_key' = $3
           AND attempt->>'entity_id' = $4 AND attempt->>'state_id' = $5 AND attempt->>'ref_id' = $6
           AND attempt->>'state' IN ('unresolved', $7::text)
       )
     RETURNING id`,
    [input.jobId, attemptId, input.descriptor.s3Key, input.entityId,
      input.stateId, input.descriptor.refId, state, input.userId, input.organizationId],
  );
  if (result.rowCount !== 1) throw new ConflictError('State reference copy settlement could not be recorded');
}

async function lockReferenceSet(
  client: DatabaseClient,
  input: ConfirmEntityStateReferenceInput,
): Promise<LockedReferenceSetRow> {
  const result = await client.query<LockedReferenceSetRow>(
    `
    SELECT reference_sets.primary_ref_id,
           primary_image.value->>'s3_key' AS base_s3_key
    FROM reference_sets
    INNER JOIN entities ON entities.id = reference_sets.entity_id
    INNER JOIN works ON works.id = entities.work_id
    LEFT JOIN LATERAL (
      SELECT value
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(reference_sets.reference_images) = 'array' THEN reference_sets.reference_images
          ELSE '[]'::jsonb
        END
      ) AS value
      WHERE value->>'ref_id' = reference_sets.primary_ref_id
      LIMIT 1
    ) AS primary_image ON TRUE
    WHERE entities.id = $1::uuid
      AND (
        ($3::uuid IS NULL
          AND works.organization_id IS NULL
          AND entities.user_id = $2::uuid)
        OR (
          $3::uuid IS NOT NULL
          AND works.organization_id = $3::uuid
          AND EXISTS (
            SELECT 1
            FROM organization_members
            WHERE organization_members.organization_id = works.organization_id
              AND organization_members.user_id = $2::uuid
              AND organization_members.status = 'active'
          )
        )
      )
    FOR UPDATE OF reference_sets
    `,
    [input.entityId, input.userId, input.organizationId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ConflictError('Base entity reference is not available');
  }
  return row;
}

async function lockEntityState(
  client: DatabaseClient,
  input: ConfirmEntityStateReferenceInput,
): Promise<LockedStateRow> {
  const result = await client.query<LockedStateRow>(
    `
    SELECT entity_states.name,
           entity_states.description,
           entity_states.reference_image,
           COALESCE(entity_states.updated_at, entity_states.created_at) AS state_revision
    FROM entity_states
    INNER JOIN entities ON entities.id = entity_states.entity_id
    INNER JOIN works ON works.id = entities.work_id
    WHERE entity_states.id = $1::uuid
      AND entity_states.entity_id = $2::uuid
      AND (
        ($4::uuid IS NULL
          AND works.organization_id IS NULL
          AND entities.user_id = $3::uuid)
        OR (
          $4::uuid IS NOT NULL
          AND works.organization_id = $4::uuid
          AND EXISTS (
            SELECT 1
            FROM organization_members
            WHERE organization_members.organization_id = works.organization_id
              AND organization_members.user_id = $3::uuid
              AND organization_members.status = 'active'
          )
        )
      )
    FOR UPDATE OF entity_states
    `,
    [input.stateId, input.entityId, input.userId, input.organizationId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ConflictError('Entity state is no longer available');
  }
  return row;
}

async function lockCandidateJob(client: DatabaseClient, jobId: string): Promise<CandidateJobRow> {
  const result = await client.query<CandidateJobRow>(
    `
    SELECT user_id, organization_id, status, params, result
    FROM generation_jobs
    WHERE id = $1::uuid
      AND job_type = 'entity_generate'
    FOR UPDATE
    `,
    [jobId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ConflictError('State reference preview job is not available');
  }
  return row;
}

function assertConfirmCandidate(
  job: CandidateJobRow,
  input: ConfirmEntityStateReferenceInput,
): void {
  const params = toRecord(job.params);
  const result = toRecord(job.result);
  if (result?.state_reference_copies !== undefined && result.state_reference_copies !== null
    && !Array.isArray(result.state_reference_copies)) {
    throw new ConflictError('State reference copy history is invalid');
  }
  const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
  const candidateExists = candidates.some((candidate) => {
    const record = toRecord(candidate);
    return record?.s3_key === input.candidateS3Key
      && record.ref_id === input.descriptor.refId;
  });

  if (
    job.status !== 'completed'
    || job.user_id !== input.userId
    || job.organization_id !== input.organizationId
    || params?.target !== 'entity_state'
    || params.entity_id !== input.entityId
    || params.entity_state_id !== input.stateId
    || params.base_primary_ref_id !== input.descriptor.baseRefId
    || params.state_input_fingerprint !== input.descriptor.inputFingerprint
    || params.state_revision !== input.expectedStateRevision
    || params.image_model !== input.descriptor.imageModel
    || !candidateExists
  ) {
    throw new ConflictError('State reference preview is stale or does not match this state');
  }
}

function assertFreshStateAndBase(
  state: LockedStateRow,
  referenceSet: LockedReferenceSetRow,
  input: ConfirmEntityStateReferenceInput,
): void {
  if (
    state.name === null
    || state.description === null
    || referenceSet.primary_ref_id === null
    || referenceSet.base_s3_key === null
  ) {
    throw new ConflictError('State reference inputs are no longer available');
  }

  const fingerprint = computeStateReferenceFingerprint({
    entityId: input.entityId,
    stateId: input.stateId,
    name: state.name,
    description: state.description,
    baseRefId: referenceSet.primary_ref_id,
  });
  if (
    referenceSet.primary_ref_id !== input.descriptor.baseRefId
    || fingerprint !== input.descriptor.inputFingerprint
  ) {
    throw new ConflictError('Entity state or base reference changed after the preview was generated');
  }
}

function mapStateContext(row: StateContextRow): EntityStateReferenceContextCandidate {
  return {
    entityId: row.entity_id,
    workId: row.work_id,
    entityOwnerUserId: row.entity_owner_user_id,
    entityType: toEntityType(row.entity_type),
    entityName: row.entity_name,
    entityFreeDescription: row.entity_free_description,
    entityStructuredFields: toRecord(row.entity_structured_fields) ?? {},
    entityPromptSupplement: row.entity_prompt_supplement,
    entityStatus: toEntityStatus(row.entity_status),
    stateId: row.state_id,
    stateName: row.state_name,
    stateDescription: row.state_description,
    stateRevision: toIsoString(row.state_revision),
    baseReference: row.base_ref_id === null || row.base_s3_key === null
      ? null
      : {
          ...readImageProvenance(row.base_reference_image),
          refId: row.base_ref_id,
          s3Key: row.base_s3_key,
          storageOwnerUserId: row.entity_owner_user_id,
        },
    referenceImage: parseStateReferenceDescriptor(row.state_reference_image),
  };
}

export function parseStateReferenceDescriptor(value: unknown): EntityStateReferenceDescriptor | null {
  const descriptor = toRecord(value);
  if (descriptor === null) {
    return null;
  }
  const values = [
    descriptor.ref_id,
    descriptor.s3_key,
    descriptor.storage_owner_user_id,
    descriptor.image_model,
    descriptor.base_ref_id,
    descriptor.created_at,
    descriptor.input_fingerprint,
  ];
  if (!values.every((entry) => typeof entry === 'string' && entry.length > 0)) {
    return null;
  }
  return {
    refId: descriptor.ref_id as string,
    s3Key: descriptor.s3_key as string,
    storageOwnerUserId: descriptor.storage_owner_user_id as string,
    ...readImageProvenance(descriptor),
    imageModel: descriptor.image_model as string,
    baseRefId: descriptor.base_ref_id as string,
    createdAt: descriptor.created_at as string,
    inputFingerprint: descriptor.input_fingerprint as string,
  };
}

export function toPersistedDescriptor(descriptor: EntityStateReferenceDescriptor): Record<string, string> {
  return {
    ref_id: descriptor.refId,
    s3_key: descriptor.s3Key,
    storage_owner_user_id: descriptor.storageOwnerUserId,
    ...toImageProvenanceRecord(descriptor),
    image_model: descriptor.imageModel,
    base_ref_id: descriptor.baseRefId,
    created_at: descriptor.createdAt,
    input_fingerprint: descriptor.inputFingerprint,
  };
}

function descriptorsEqual(
  left: EntityStateReferenceDescriptor,
  right: EntityStateReferenceDescriptor,
): boolean {
  return left.refId === right.refId
    && left.s3Key === right.s3Key
    && left.storageOwnerUserId === right.storageOwnerUserId
    && left.imageModel === right.imageModel
    && left.baseRefId === right.baseRefId
    && left.createdAt === right.createdAt
    && left.inputFingerprint === right.inputFingerprint;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toEntityType(value: string): EntityType {
  if (value === 'character' || value === 'nonhuman' || value === 'object') {
    return value;
  }
  throw new ConfigurationError('Entity state reference entity type is invalid');
}

function toEntityStatus(value: string): EntityStatus {
  if (value === 'draft' || value === 'ready') {
    return value;
  }
  throw new ConfigurationError('Entity state reference entity status is invalid');
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ConfigurationError('Entity state reference revision is invalid');
  }
  return date.toISOString();
}
