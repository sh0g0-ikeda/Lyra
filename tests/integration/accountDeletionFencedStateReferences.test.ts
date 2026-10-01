import { createHash, randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, ListObjectVersionsCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { computeStateReferenceFingerprint } from '../../src/domain/state/StateReferenceFingerprint.js';
import type { ConfirmEntityStateReferenceInput } from '../../src/domain/types/entityStateReference.js';
import { FencedStateReferenceStorage, type FencedStorageClient, type FencedStateReferenceIntent } from '../../src/infrastructure/aws/FencedStateReferenceStorage.js';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresAccountDeletionRepository } from '../../src/repositories/AccountDeletionRepository.js';
import { PostgresFencedStateReferenceRepository, type FencedStateReferenceAttempt } from '../../src/repositories/FencedStateReferenceRepository.js';
import { AccountDeletionService } from '../../src/services/account/AccountDeletionService.js';
import { FencedStateReferenceConfirmationService } from '../../src/services/entity/FencedStateReferenceConfirmationService.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#746ba3' } }).png().toBuffer();
const source = { mimeType: 'image/png' as const, sizeBytes: png.length, digest: createHash('sha256').update(png).digest('hex'), sourceRevision: { eTag: '"source-etag"' } };

// Real DB transactions and SDK command objects, with independently delayed remote
// writes. The in-memory storage model never opens sockets or uses credentials.
describePostgres('account deletion of fenced state references', () => {
  let admin: Pool; let pool: Pool; let database: TestDatabase;
  let journal: PostgresFencedStateReferenceRepository; let accounts: PostgresAccountDeletionRepository;
  const schema = `account_fenced_${process.pid}_${Date.now()}`;
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8, options: `-c search_path=${schema},public` });
    database = new TestDatabase(pool); journal = new PostgresFencedStateReferenceRepository(database);
    accounts = new PostgresAccountDeletionRepository(database, database);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database));
  }, 120_000);
  afterAll(async () => { await pool?.end(); if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); } });

  async function admit(input: ConfirmEntityStateReferenceInput): Promise<FencedStateReferenceAttempt> {
    const attempt = (await journal.admit(input, source)).attempt;
    if (!attempt) throw new Error('No attempt'); return attempt;
  }
  function service(storage?: FencedStateReferenceStorage) {
    const legacy: string[] = [];
    const coordinator = storage ? new FencedStateReferenceConfirmationService({ repository: journal, recovery: storage }) : undefined;
    const deletion = new AccountDeletionService(accounts,
      { cancelPersonalSubscription: async (id) => { legacy.push(`subscription:${id}`); } },
      { disableIdentity: async () => { legacy.push('disable'); }, deleteIdentity: async () => { legacy.push('identity'); } },
      { deleteExactObject: async (key) => { expect(key.startsWith('state-reference-v2/')).toBe(false); legacy.push(key); } },
      'account-deletion-local-test-secret-only', { stateReferenceFencing: coordinator });
    return { deletion, legacy };
  }
  async function row(attempt: FencedStateReferenceAttempt) {
    return (await pool.query('SELECT * FROM state_reference_copy_attempts WHERE attempt_token=$1', [attempt.intent.attemptToken])).rows[0]!;
  }
  async function claimAndCheckpoint(input: ConfirmEntityStateReferenceInput) {
    const token = randomUUID(); const claim = await accounts.claimRequest({ ...request(input), processingToken: token, identityKey: randomUUID().replaceAll('-', '') + 'x'.repeat(11) });
    expect(claim.kind).toBe('claimed');
    for (const key of (await accounts.getFlight(input.userId)).personalAssetKeys) await accounts.markAssetDeleted(input.userId, token, key);
    return token;
  }

  it('counts v2 as acknowledged assets while allowing a claim and preserving legacy unknown-copy holds', async () => {
    const input = await seed(pool); const attempt = await admit(input); const { deletion } = service();
    const flight = await accounts.getFlight(input.userId);
    expect(flight).toMatchObject({ personalStateReferenceCount: 1, activePersonalGenerationJobCount: 0 });
    expect((await deletion.getDeletionPreview(input.userId)).personalAssetCount).toBe(flight.personalAssetKeys.length + 1);
    expect(await deletion.requestDeletion({ ...request(input), acknowledgePersonalAssets: false })).toMatchObject({ status: 'blocked', blockers: [{ code: 'PERSONAL_ASSETS' }] });
    expect(await deletion.requestDeletion(request(input))).toMatchObject({ status: 'pending_external_action' });
    expect((await accounts.getRequest(input.userId))?.status).toBe('pending_external_action');
    expect((await row(attempt)).scrubbed_at).toBeNull();

    const legacyInput = await seed(pool); await admit(legacyInput);
    await pool.query("UPDATE generation_jobs SET result=result||jsonb_build_object('state_reference_copies',$2::jsonb) WHERE id=$1", [legacyInput.jobId,
      JSON.stringify([{ attempt_id: randomUUID(), state: 'unresolved', s3_key: legacyInput.descriptor.s3Key, entity_id: legacyInput.entityId, state_id: legacyInput.stateId, ref_id: legacyInput.descriptor.refId }])]);
    expect(await deletion.requestDeletion(request(legacyInput))).toMatchObject({ status: 'blocked', blockers: [{ code: 'ACTIVE_PERSONAL_JOB' }] });
  });

  it('fences before completion when an already-dispatched image arrives after account deletion', async () => {
    const input = await seed(pool); const attempt = await admit(input); await journal.authorizeDispatch(attempt);
    const model = new StorageModel(attempt.intent); const storage = model.storage();
    const dispatched = deferred(); const release = deferred();
    model.delayImage = async () => { dispatched.resolve(); await release.promise; };
    const lateImage = storage.createImage({ intent: attempt.intent, imageData: png }).then(() => 'unexpected-success', () => 'fenced');
    await dispatched.promise;
    const { deletion, legacy } = service(storage);
    expect(await deletion.requestDeletion(request(input))).toEqual({ status: 'completed', blockers: [] });
    expect(legacy).toContain('identity'); expect(model.versions.at(-1)?.body.length).toBe(0);
    const scrubbed = await row(attempt);
    expect(scrubbed).toMatchObject({ state: 'effects_fenced', actor_user_id: null, owner_user_id: null, descriptor: null, image_receipt: null, deletion_processing_token: null });
    expect(scrubbed.marker_receipt.historyErased).toBe(true); expect(scrubbed.scrubbed_at).not.toBeNull();
    release.resolve(); expect(await lateImage).toBe('fenced'); expect(model.versions.at(-1)?.body.length).toBe(0);
    await expect(pool.query('UPDATE state_reference_copy_attempts SET scrubbed_at=NULL WHERE attempt_token=$1', [attempt.intent.attemptToken])).rejects.toMatchObject({ code: '23514' });
  });

  it('retains and deletes the original source after its job and work disappear', async () => {
    const input = await seed(pool); const attempt = await admit(input);
    await pool.query('DELETE FROM generation_jobs WHERE id=$1', [input.jobId]);
    await pool.query('DELETE FROM works WHERE user_id=$1', [input.userId]);
    expect((await accounts.getFlight(input.userId)).personalAssetKeys).toEqual([input.candidateS3Key]);
    const { deletion, legacy } = service(new StorageModel(attempt.intent).storage());
    expect(await deletion.requestDeletion(request(input))).toEqual({ status: 'completed', blockers: [] });
    expect(legacy.filter((key) => key === input.candidateS3Key)).toEqual([input.candidateS3Key]);
    expect((await row(attempt)).candidate_s3_key).toBeNull();
  });

  it('holds malformed or foreign journal sources instead of deleting or scrubbing them', async () => {
    const input = await seed(pool); const attempt = await admit(input);
    const invalidSources = [null, `session/${randomUUID()}/entities/${input.entityId}/image.png`,
      `session/${input.userId}/entities/${randomUUID()}/image.png`,
      `session/${input.userId}/entities/${input.entityId}/../other.png`,
      `session/${input.userId}/entities/${input.entityId}/bad\\key.png`,
      attempt.intent.s3Key];
    for (const invalid of invalidSources) {
      const projected: DatabaseClient = { query: <R extends QueryResultRow>(sql: string, values?: readonly unknown[]) => {
        if (sql.includes('FROM state_reference_copy_attempts source_attempt')) {
          const projection = `(SELECT actor_user_id,owner_user_id,organization_id,entity_id,scrubbed_at,
            $2::text AS candidate_s3_key FROM state_reference_copy_attempts) source_attempt`;
          return database.query<R>(sql.replaceAll('state_reference_copy_attempts source_attempt', projection), [...(values ?? []),invalid]);
        }
        return database.query<R>(sql,values);
      } };
      await expect(new PostgresAccountDeletionRepository(projected,database).getFlight(input.userId)).rejects.toMatchObject({ code: 'CONFLICT' });
    }
    expect((await row(attempt)).candidate_s3_key).toBe(input.candidateS3Key);
    expect((await row(attempt)).scrubbed_at).toBeNull();
  });

  it('fences a confirmed image, purges exact historical versions, and ignores an old key checkpoint', async () => {
    const input = await seed(pool); const attempt = await admit(input); await journal.authorizeDispatch(attempt);
    const model = new StorageModel(attempt.intent, true); const storage = model.storage();
    const receipt = await storage.createImage({ intent: attempt.intent, imageData: png });
    await journal.confirmObservedImage(attempt, receipt);
    const token = await claimAndCheckpoint(input);
    await accounts.markAssetDeleted(input.userId, token, attempt.intent.s3Key);
    await accounts.releaseForContinuation(input.userId, token);
    const { deletion } = service(storage);
    expect(await deletion.recoverPendingRequests(1)).toEqual({ attemptedCount: 1, completedCount: 1 });
    expect(model.versions).toHaveLength(1); expect(model.versions[0].body).toHaveLength(0);
    const deletes = model.commands.filter((command) => command instanceof DeleteObjectCommand);
    expect(deletes).toHaveLength(1); expect((deletes[0] as DeleteObjectCommand).input.VersionId).toBe(receipt.versionId);
    expect((await row(attempt)).image_receipt).toBeNull();
    expect((await pool.query('SELECT result FROM generation_jobs WHERE id=$1', [input.jobId])).rows[0]?.result).toBeNull();
  });

  it('partial version purge remains pending and resumes from the retained marker', async () => {
    const input = await seed(pool); const attempt = await admit(input); await journal.authorizeDispatch(attempt);
    const model = new StorageModel(attempt.intent, true); const storage = model.storage();
    await storage.createImage({ intent: attempt.intent, imageData: png }); model.duplicateImage(); model.failDeleteNumber = 2;
    const { deletion, legacy } = service(storage);
    expect(await deletion.requestDeletion(request(input))).toMatchObject({ status: 'pending_external_action' });
    expect(legacy).toEqual([]); expect(model.versions.filter((item) => item.body.length > 0)).toHaveLength(1);
    expect(await row(attempt)).toMatchObject({ state: 'fencing', marker_receipt: null, history_erased_at: null, scrubbed_at: null });
    expect((await accounts.getFlight(input.userId)).personalStateReferenceCount).toBe(1);
    model.failDeleteNumber = undefined;
    await pool.query('UPDATE account_deletion_requests SET next_retry_at=NOW() WHERE user_id=$1', [input.userId]);
    expect(await deletion.recoverPendingRequests(1)).toEqual({ attemptedCount: 1, completedCount: 1 });
    expect(model.versions.every((item) => item.body.length === 0)).toBe(true);
  });

  it('unknown remote metadata stays durably pending with a sanitized failure and no legacy actions', async () => {
    const input = await seed(pool); const attempt = await admit(input); await journal.authorizeDispatch(attempt);
    const model = new StorageModel(attempt.intent); const storage = model.storage();
    await storage.createImage({ intent: attempt.intent, imageData: png });
    model.versions[0].metadata['lyra-attempt'] = randomUUID();
    const { deletion, legacy } = service(storage);
    expect(await deletion.requestDeletion(request(input))).toMatchObject({ status: 'pending_external_action' });
    expect(legacy).toEqual([]); expect((await row(attempt)).history_erased_at).toBeNull();
    expect((await pool.query('SELECT status,last_failure_code FROM account_deletion_requests WHERE user_id=$1', [input.userId])).rows[0])
      .toEqual({ status: 'pending_external_action', last_failure_code: 'FENCE_PERSONAL_STATE_REFERENCES_FAILED' });
  });

  it('counts every nested SDK send against 25 requests and continues without increasing failure backoff', async () => {
    const input = await seed(pool); const attempt = await admit(input); await journal.authorizeDispatch(attempt);
    const model = new StorageModel(attempt.intent, true); const storage = model.storage();
    await storage.createImage({ intent: attempt.intent, imageData: png });
    for (let index = 0; index < 19; index++) model.duplicateImage();
    model.commands = [];
    const { deletion, legacy } = service(storage);
    expect(await deletion.requestDeletion(request(input))).toMatchObject({ status: 'pending_external_action' });
    expect(model.commands).toHaveLength(25); expect(legacy).toEqual([]);
    expect((await pool.query('SELECT status,retry_count,last_failure_code FROM account_deletion_requests WHERE user_id=$1', [input.userId])).rows[0])
      .toEqual({ status: 'pending_external_action', retry_count: 0, last_failure_code: null });
    // Each retry can erase another bounded portion without ever deleting the marker.
    for (let index = 0; index < 30 && (await accounts.getRequest(input.userId))?.status !== 'completed'; index++) {
      const before = model.commands.length; await deletion.recoverPendingRequests(1);
      expect(model.commands.length - before).toBeLessThanOrEqual(25);
    }
    expect((await accounts.getRequest(input.userId))?.status).toBe('completed');
  });

  it('the final transaction rolls journal scrubbing back if work deletion fails', async () => {
    const input = await seed(pool); const attempt = await admit(input); const token = await claimAndCheckpoint(input);
    const storage = new StorageModel(attempt.intent).storage();
    const coordinator = new FencedStateReferenceConfirmationService({ repository: journal, recovery: storage });
    expect(await coordinator.fencePersonalReferences(input.userId, token, { beforeRequest() {}, remainingTimeMs: () => 15_000 })).toBe(true);
    const failing: TransactionRunner = { transaction: (work) => database.transaction((client) => work({
      query: async <R extends QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<QueryResult<R>> => {
        if (sql.includes('DELETE FROM works')) throw new Error('injected work cleanup failure');
        return client.query<R>(sql, values);
      },
    })) };
    const failingAccounts = new PostgresAccountDeletionRepository(database, failing);
    await expect(failingAccounts.finalizePersonalData(input.userId, token)).rejects.toThrow('injected');
    expect(await row(attempt)).toMatchObject({ state: 'effects_fenced', actor_user_id: input.userId, owner_user_id: input.userId, scrubbed_at: null });
    expect((await pool.query('SELECT result FROM generation_jobs WHERE id=$1', [input.jobId])).rows[0]?.result).not.toBeNull();
    expect(await accounts.finalizePersonalData(input.userId, token)).toEqual({ kind: 'completed' });
    expect((await row(attempt)).scrubbed_at).not.toBeNull();
  });

  it('revalidates malformed erasure evidence through actual SQL without weakening journal constraints', async () => {
    const input = await seed(pool); const attempt = await admit(input);
    const fence = await journal.claimFencing(attempt, { reason: 'unconfirmed_recovery' });
    const receipt = await new StorageModel(attempt.intent).storage().fenceAndErase(attempt.intent);
    await journal.completeFencing(fence, receipt);
    expect((await accounts.getFlight(input.userId)).personalStateReferenceCount).toBe(0);
    for (const invalid of [null, [], 'garbage', 123, true, {}, { ...receipt, kind: 'image' }, { ...receipt, attemptToken: randomUUID() },
      { ...receipt, s3Key: 'state-reference-v2/other' }, { ...receipt, historyErased: false },
      { ...receipt, historyErased: 'true' }, { ...receipt, eTag: 'invalid' }, { ...receipt, extra: 'unknown' },
      { ...receipt, versionId: 'bad version' }, { ...receipt, protocol: 'unknown' }]) {
      const projected: DatabaseClient = {
        query: <R extends QueryResultRow>(sql: string, values?: readonly unknown[]) => {
          if (sql.includes('FROM state_reference_copy_attempts') && sql.includes('SELECT COUNT(*)::text AS count')) {
            // A read-only projection models corrupt/old evidence while the actual
            // stored journal and its CHECK/immutability guards remain untouched.
            return database.query<R>(sql.replace('FROM state_reference_copy_attempts', `FROM (
              SELECT attempt_token,protocol,s3_key,state,actor_user_id,owner_user_id,organization_id,
                history_erased_at,$2::jsonb AS marker_receipt FROM state_reference_copy_attempts
            ) AS evidence`), [...(values ?? []), JSON.stringify(invalid)]);
          }
          return database.query<R>(sql, values);
        },
      };
      expect((await new PostgresAccountDeletionRepository(projected, database).getFlight(input.userId)).personalStateReferenceCount).toBe(1);
    }
    expect((await row(attempt)).marker_receipt).toEqual(receipt);
  });

  it('a prior anonymized checkpoint still rechecks and scrubs personal terminal journal evidence', async () => {
    const input = await seed(pool); const attempt = await admit(input); const token = await claimAndCheckpoint(input);
    await pool.query('UPDATE account_deletion_requests SET data_anonymized_at=NOW() WHERE user_id=$1', [input.userId]);
    expect(await accounts.finalizePersonalData(input.userId, token)).toMatchObject({ kind: 'blocked' });
    const coordinator = new FencedStateReferenceConfirmationService({ repository: journal, recovery: new StorageModel(attempt.intent).storage() });
    await coordinator.fencePersonalReferences(input.userId, token, { beforeRequest() {}, remainingTimeMs: () => 15_000 });
    expect(await accounts.finalizePersonalData(input.userId, token)).toEqual({ kind: 'completed' });
    expect((await row(attempt)).scrubbed_at).not.toBeNull();
  });

  it('organization journal, source and confirmed image survive creator personal deletion', async () => {
    const input = await seed(pool, true); const attempt = await admit(input); await journal.authorizeDispatch(attempt);
    const model = new StorageModel(attempt.intent); const storage = model.storage();
    await journal.confirmObservedImage(attempt, await storage.createImage({ intent: attempt.intent, imageData: png }));
    const before = await row(attempt); model.commands = [];
    const { deletion, legacy } = service(storage);
    expect((await accounts.getFlight(input.userId)).personalStateReferenceCount).toBe(0);
    expect(await deletion.requestDeletion(request(input))).toEqual({ status: 'completed', blockers: [] });
    expect(model.commands).toEqual([]); expect(legacy).toEqual(['disable', 'identity']);
    expect(await row(attempt)).toEqual(before); expect(model.versions[0].body.length).toBeGreaterThan(0);
    expect((await pool.query('SELECT result FROM generation_jobs WHERE id=$1', [input.jobId])).rows[0]?.result).not.toBeNull();
    expect((await pool.query('SELECT reference_image FROM entity_states WHERE id=$1', [input.stateId])).rows[0]?.reference_image).not.toBeNull();
  });
});

function request(input: ConfirmEntityStateReferenceInput) {
  return { userId: input.userId, identityId: `fenced-${input.userId}`, confirmation: 'DELETE' as const,
    acknowledgePersonalSubscriptions: true, acknowledgeStoreBilling: true, acknowledgePersonalAssets: true };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
interface StoredVersion { id: string; body: Buffer; metadata: Record<string, string>; contentType: string; eTag: string }
class StorageModel {
  public versions: StoredVersion[] = [];
  public commands: Array<GetObjectCommand | PutObjectCommand | ListObjectVersionsCommand | DeleteObjectCommand> = [];
  public delayImage?: () => Promise<void>;
  public failDeleteNumber?: number;
  private deletes = 0; private serial = 0;
  public constructor(private readonly intent: FencedStateReferenceIntent, private readonly versioned = false) {}
  public duplicateImage(): void { const image = this.versions.find((item) => item.body.length > 0)!; this.store(image.body, image.metadata, image.contentType); }
  public storage(): FencedStateReferenceStorage {
    return new FencedStateReferenceStorage({ sourceReader: this.client(), imageCreator: this.client(), recovery: this.client() }, {
      bucketName: 'local-only', maxRequests: 100,
      environmentAssumptions: { versioning: this.versioned ? 'versioned' : 'never-versioned', exclusiveConditionalImageWriters: true,
        ordinaryMarkersRetained: true, noUnmanagedReplicationOrRestore: true },
    });
  }
  private client(): FencedStorageClient {
    return { config: { maxAttempts: 1 }, send: async (command) => {
      this.commands.push(command);
      if (command instanceof GetObjectCommand) {
        const item = command.input.VersionId === undefined ? this.versions.at(-1) : this.versions.find((entry) => entry.id === command.input.VersionId);
        if (!item) throw httpError(404);
        return { $metadata: { httpStatusCode: 200, attempts: 1 }, ETag: item.eTag, ...(this.versioned ? { VersionId: item.id } : {}),
          Body: item.body, ContentLength: item.body.length, ContentType: item.contentType, Metadata: item.metadata };
      }
      if (command instanceof PutObjectCommand) {
        if (command.input.ContentLength !== 0) await this.delayImage?.();
        const current = this.versions.at(-1);
        if ((command.input.IfNoneMatch === '*' && current) || (command.input.IfMatch !== undefined && command.input.IfMatch !== current?.eTag)) throw httpError(412);
        const item = this.store(command.input.Body as Buffer, command.input.Metadata ?? {}, command.input.ContentType ?? '');
        return { $metadata: { httpStatusCode: 200, attempts: 1 }, ETag: item.eTag, ...(this.versioned ? { VersionId: item.id } : {}) };
      }
      if (command instanceof ListObjectVersionsCommand) {
        return { $metadata: { httpStatusCode: 200, attempts: 1 }, IsTruncated: false, Versions: this.versions.map((entry) => ({
          Key: this.intent.s3Key, VersionId: entry.id, ETag: entry.eTag, IsLatest: entry === this.versions.at(-1),
        })) };
      }
      if (!command.input.VersionId) throw new Error('Plain deletion is forbidden');
      this.deletes++;
      if (this.deletes === this.failDeleteNumber) throw httpError(403);
      this.versions = this.versions.filter((item) => item.id !== command.input.VersionId);
      return { $metadata: { httpStatusCode: 204, attempts: 1 } };
    } };
  }
  private store(body: Buffer, metadata: Record<string, string>, contentType: string): StoredVersion {
    const item = { id: `version-${++this.serial}`, body: Buffer.from(body), metadata: { ...metadata }, contentType, eTag: `"etag-${this.serial}"` };
    if (!this.versioned) this.versions = []; this.versions.push(item); return item;
  }
}
function httpError(status: number) { return Object.assign(new Error('synthetic private provider failure'), { $metadata: { httpStatusCode: status } }); }
async function seed(pool: Pool, organization = false): Promise<ConfirmEntityStateReferenceInput> {
  const userId = randomUUID(); const workId = randomUUID(); const entityId = randomUUID(); const stateId = randomUUID(); const jobId = randomUUID();
  await pool.query('INSERT INTO users (id,supabase_id,email) VALUES ($1,$2,$3)', [userId, `fenced-${userId}`, `${userId}@example.invalid`]);
  const organizationId = organization ? randomUUID() : null;
  if (organizationId) {
    await pool.query("INSERT INTO organizations (id,name,created_by_user_id,status) VALUES ($1,'Fenced local organization',$2,'active')", [organizationId,userId]);
    await pool.query("INSERT INTO organization_members (organization_id,user_id,role,status,joined_at) VALUES ($1,$2,'editor','active',NOW())", [organizationId,userId]);
  }
  await pool.query("INSERT INTO works (id,user_id,organization_id,title) VALUES ($1,$2,$3,'Fenced local test')", [workId,userId,organizationId]);
  await pool.query("INSERT INTO entities (id,work_id,user_id,name) VALUES ($1,$2,$3,'Character')", [entityId, workId, userId]);
  await pool.query("INSERT INTO reference_sets (entity_id,primary_ref_id,reference_images,status) VALUES ($1,'base-ref',$2::jsonb,'ready')", [entityId, JSON.stringify([{ ref_id: 'base-ref', s3_key: `saved/${userId}/entities/${entityId}/base.png` }])]);
  await pool.query("INSERT INTO entity_states (id,entity_id,name,description,created_at,updated_at) VALUES ($1,$2,'injured','A cheek scar','2026-09-30T00:00:00Z','2026-09-30T00:00:00Z')", [stateId, entityId]);
  const input: ConfirmEntityStateReferenceInput = {
    userId, organizationId, entityId, stateId, jobId, candidateS3Key: `session/${userId}/entities/${entityId}/${jobId}-1.png`, expectedStateRevision: '2026-09-30T00:00:00.000Z',
    descriptor: { refId: `${jobId}-1`, s3Key: `saved/${userId}/entities/${entityId}/states/${stateId}/${jobId}-1.png`, storageOwnerUserId: userId,
      imageModel: 'gpt-image-2', baseRefId: 'base-ref', createdAt: '2026-09-30T00:00:01.000Z', inputFingerprint: computeStateReferenceFingerprint({ entityId, stateId, name: 'injured', description: 'A cheek scar', baseRefId: 'base-ref' }) },
  };
  await pool.query(`INSERT INTO generation_jobs (id,user_id,organization_id,job_type,status,credit_cost,params,result,completed_at)
    VALUES ($1,$2,$5,'entity_generate','completed',1,$3::jsonb,$4::jsonb,'2026-09-30T00:00:01Z')`,
  [jobId, userId, JSON.stringify({ target: 'entity_state', entity_id: entityId, entity_state_id: stateId, base_primary_ref_id: 'base-ref', state_revision: input.expectedStateRevision,
    state_input_fingerprint: input.descriptor.inputFingerprint, image_model: 'gpt-image-2' }), JSON.stringify({ candidates: [{ ref_id: input.descriptor.refId, s3_key: input.candidateS3Key }] }), organizationId]);
  return input;
}
class TestDatabase implements DatabaseClient, TransactionRunner {
  public constructor(private readonly pool: Pool) {}
  public query<T extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values === undefined ? undefined : [...values]);
  }
  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work({ query: <R extends QueryResultRow>(text: string, values?: readonly unknown[]) => client.query<R>(text, values === undefined ? undefined : [...values]) });
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
