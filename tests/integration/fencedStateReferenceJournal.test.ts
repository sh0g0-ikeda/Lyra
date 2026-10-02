import { FENCED_STATE_REFERENCE_INVARIANT_QUERIES } from '../../scripts/checkDeploymentDataInvariants.js';
import { randomUUID } from 'node:crypto';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeStateReferenceFingerprint } from '../../src/domain/state/StateReferenceFingerprint.js';
import type { ConfirmEntityStateReferenceInput } from '../../src/domain/types/entityStateReference.js';
import type { FencedErasureReceipt, FencedImageReceipt } from '../../src/infrastructure/aws/FencedStateReferenceStorage.js';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresFencedStateReferenceRepository, type FencedStateReferenceAttempt } from '../../src/repositories/FencedStateReferenceRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';
import { rejectionOf, throwingRejectionOf } from './asyncPostgresAssertions.js';

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.APP_ENV === 'test' && databaseUrl !== undefined ? describe : describe.skip;
const source = { mimeType: 'image/png' as const, sizeBytes: 100, digest: 'a'.repeat(64), sourceRevision: { eTag: '"source-etag"' } };

// Design: no provider is used. The journal commits before the simulated remote
// effect; independent transactions force adoption/fencing and lost-ack races.
describePostgres('fenced state reference durable journal', () => {
  let admin: Pool;
  let pool: Pool;
  let database: TestDatabase;
  let repository: PostgresFencedStateReferenceRepository;
  let schema: string;
  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl });
    schema = `fenced_journal_${process.pid}_${Date.now()}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, max: 8, options: `-c search_path=${schema},public` });
    database = new TestDatabase(pool);
    repository = new PostgresFencedStateReferenceRepository(database);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database));
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
    if (admin !== undefined) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  async function invariantIds(name: string): Promise<string[]> {
    const query = FENCED_STATE_REFERENCE_INVARIANT_QUERIES.find((item) => item.name === name);
    if (!query) throw new Error('Missing invariant');
    return (await pool.query(query.sql, [10000])).rows.map((row) => row.id as string);
  }

  it('empty migrated journal passes all v2 deployment SQL checks', async () => {
    for (const query of FENCED_STATE_REFERENCE_INVARIANT_QUERIES) expect(await invariantIds(query.name)).toEqual([]);
  });

  it('deployment gate holds unresolved and fencing attempts until proven terminal', async () => {
    const attempt = requiredAttempt((await repository.admit(await seed(pool), source)).attempt);
    const name = 'state_reference_copy_attempts.unresolved';
    expect(await invariantIds(name)).toContain(attempt.intent.attemptToken);
    const claimed = await repository.claimFencing(attempt, { reason: 'unconfirmed_recovery' });
    expect(await invariantIds(name)).toContain(attempt.intent.attemptToken);
    await repository.completeFencing(claimed, markerReceipt(claimed));
    expect(await invariantIds(name)).not.toContain(attempt.intent.attemptToken);
  });

  it('deployment gate detects a shape-valid key with the wrong canonical scope digest', async () => {
    const attempt = requiredAttempt((await repository.admit(await seed(pool), source)).attempt);
    expect(await invariantIds('state_reference_copy_attempts.scope_key')).not.toContain(attempt.intent.attemptToken);
    const token = randomUUID(); const key = `state-reference-v2/${token}/${'0'.repeat(64)}.png`;
    // Simulate an imported/corrupt row without weakening any DB trigger or CHECK.
    await pool.query(`INSERT INTO state_reference_copy_attempts
      (attempt_token,protocol,s3_key,state,actor_user_id,owner_user_id,organization_id,entity_id,state_id,job_id,
        candidate_ref_id,candidate_s3_key,expected_state_revision,descriptor,digest,mime_type,size_bytes,source_revision)
      SELECT $2,protocol,$3,'unresolved',actor_user_id,owner_user_id,organization_id,entity_id,state_id,job_id,
        candidate_ref_id||'-corrupt',candidate_s3_key,expected_state_revision,
        descriptor||jsonb_build_object('s3_key',$3::text,'ref_id',candidate_ref_id||'-corrupt'),digest,mime_type,size_bytes,source_revision
      FROM state_reference_copy_attempts WHERE attempt_token=$1`, [attempt.intent.attemptToken,token,key]);
    expect(await invariantIds('state_reference_copy_attempts.scope_key')).toContain(token);
  });

  it('deployment gate detects a visible descriptor without exact confirmed evidence', async () => {
    const input = await seed(pool); const attempt = requiredAttempt((await repository.admit(input, source)).attempt);
    await repository.authorizeDispatch(attempt);
    await repository.confirmObservedImage(attempt, imageReceipt(attempt));
    expect(await invariantIds('state_reference_copy_attempts.confirmed_evidence')).not.toContain(attempt.intent.attemptToken);
    expect(await invariantIds('entity_states.fenced_reference_evidence')).not.toContain(input.stateId);
    await pool.query(`UPDATE entity_states SET reference_image=reference_image||'{"ref_id":"unrecorded"}'::jsonb WHERE id=$1`, [input.stateId]);
    expect(await invariantIds('entity_states.fenced_reference_evidence')).toContain(input.stateId);
  });

  it('deployment gate rejects unscrubbed personal journal metadata after account completion', async () => {
    const input = await seed(pool); const attempt = requiredAttempt((await repository.admit(input, source)).attempt);
    expect(await invariantIds('state_reference_copy_attempts.completed_personal_scrub')).not.toContain(attempt.intent.attemptToken);
    await pool.query('UPDATE users SET account_deletion_started_at=NOW(),account_deleted_at=NOW() WHERE id=$1', [input.userId]);
    expect(await invariantIds('state_reference_copy_attempts.completed_personal_scrub')).toContain(attempt.intent.attemptToken);
  });

  it('同時受付の場合に試行を一つだけ作りdispatchも一回になる', async () => {
    const input = await seed(pool);
    const admissions = await Promise.all([repository.admit(input, source), repository.admit(input, source)]);
    const attempt = requiredAttempt(admissions[0].attempt);
    expect(admissions.map((item) => item.attempt?.intent.attemptToken)).toEqual([attempt.intent.attemptToken, attempt.intent.attemptToken]);
    expect(admissions.filter((item) => item.newlyAdmitted)).toHaveLength(1);
    expect((await Promise.all([repository.authorizeDispatch(attempt), repository.authorizeDispatch(attempt)])).sort()).toEqual([false, true]);
    expect(attempt.intent.s3Key).not.toContain(input.userId);
    expect((await pool.query('SELECT reference_image FROM entity_states WHERE id=$1', [input.stateId])).rows[0]?.reference_image).toBeNull();
  });

  it('受付COMMIT応答が失われても次の受付が同じ試行に収束する', async () => {
    const input = await seed(pool);
    let loseCommit = true;
    const faulty = new PostgresFencedStateReferenceRepository({
      query: database.query.bind(database),
      transaction: async (work) => {
        const result = await database.transaction(work);
        if (loseCommit) { loseCommit = false; throw new Error('commit acknowledgement lost'); }
        return result;
      },
    });
    expect(await throwingRejectionOf(faulty.admit(input, source))).toThrow('commit acknowledgement lost');
    const retry = await repository.admit(input, source);
    expect(retry.newlyAdmitted).toBe(false);
    expect((await pool.query('SELECT count(*)::int AS count FROM state_reference_copy_attempts WHERE job_id=$1', [input.jobId])).rows[0]?.count).toBe(1);
  });

  it('dispatch COMMIT応答が失われた場合に再送を認可しない', async () => {
    const attempt = requiredAttempt((await repository.admit(await seed(pool), source)).attempt);
    const faulty = new PostgresFencedStateReferenceRepository({
      query: database.query.bind(database),
      transaction: async (work) => { await database.transaction(work); throw new Error('dispatch commit lost'); },
    });
    expect(await throwingRejectionOf(faulty.authorizeDispatch(attempt))).toThrow('dispatch commit lost');
    expect(await repository.authorizeDispatch(attempt)).toBe(false);
  });

  it('正しいreceiptの場合だけdescriptorとreceiptを同時に確定する', async () => {
    const input = await seed(pool);
    const attempt = requiredAttempt((await repository.admit(input, source)).attempt);
    await repository.authorizeDispatch(attempt);
    const receipt = imageReceipt(attempt);
    const confirmed = await repository.confirmObservedImage(attempt, receipt);
    expect(confirmed.referenceImage.s3Key).toBe(attempt.intent.s3Key);
    expect(await repository.confirmObservedImage(attempt, receipt)).toEqual(confirmed);
    expect((await repository.admit(input, source)).confirmed).toEqual(confirmed);
    expect((await pool.query('SELECT state,image_receipt FROM state_reference_copy_attempts WHERE attempt_token=$1', [attempt.intent.attemptToken])).rows[0])
      .toMatchObject({ state: 'confirmed', image_receipt: receipt });
  });

  it.each(['attemptToken', 's3Key', 'digest', 'mimeType', 'sizeBytes', 'eTag'] as const)('receiptの%sが不正なら確定しない', async (field) => {
    const attempt = requiredAttempt((await repository.admit(await seed(pool), source)).attempt);
    await repository.authorizeDispatch(attempt);
    const receipt = { ...imageReceipt(attempt), [field]: field === 'sizeBytes' ? 101 : 'wrong' } as FencedImageReceipt;
    expect(await rejectionOf(repository.confirmObservedImage(attempt, receipt))).toMatchObject({ code: 'CONFLICT' });
    expect((await pool.query('SELECT state FROM state_reference_copy_attempts WHERE attempt_token=$1', [attempt.intent.attemptToken])).rows[0]?.state).toBe('unresolved');
  });

  it('画像確定のDB rollback後も同じreceiptで再開できる', async () => {
    const attempt = requiredAttempt((await repository.admit(await seed(pool), source)).attempt);
    await repository.authorizeDispatch(attempt);
    const faulty = new PostgresFencedStateReferenceRepository({
      query: database.query.bind(database),
      transaction: (work) => database.transaction(async (client) => { await work(client); throw new Error('rollback injected'); }),
    });
    expect(await throwingRejectionOf(faulty.confirmObservedImage(attempt, imageReceipt(attempt)))).toThrow('rollback injected');
    expect((await pool.query('SELECT reference_image FROM entity_states WHERE id=$1', [attempt.input.stateId])).rows[0]?.reference_image).toBeNull();
    expect(await (repository.confirmObservedImage(attempt, imageReceipt(attempt)))).toMatchObject({ entityId: attempt.input.entityId });
  });

  it('fencingをclaimした場合に同時の画像採用を遮断し二つのfencerが収束する', async () => {
    const attempt = requiredAttempt((await repository.admit(await seed(pool), source)).attempt);
    await repository.authorizeDispatch(attempt);
    const [first, second] = await Promise.all([
      repository.claimFencing(attempt, { reason: 'unconfirmed_recovery' }),
      repository.claimFencing(attempt, { reason: 'unconfirmed_recovery' }),
    ]);
    expect(first.state).toBe('fencing');
    expect(await rejectionOf(repository.confirmObservedImage(attempt, imageReceipt(attempt)))).toMatchObject({ code: 'CONFLICT' });
    const receipt = markerReceipt(attempt);
    expect((await Promise.all([repository.completeFencing(first, receipt), repository.completeFencing(second, receipt)])).map((item) => item.state))
      .toEqual(['effects_fenced', 'effects_fenced']);
    expect(await rejectionOf(repository.completeFencing(first, { ...receipt, eTag: '"different-marker"' }))).toMatchObject({ code: 'CONFLICT' });
  });

  it('fencing完了前には再受付せず完了後にだけ新しいkeyを作る', async () => {
    const input = await seed(pool);
    const attempt = requiredAttempt((await repository.admit(input, source)).attempt);
    const fence = await repository.claimFencing(attempt, { reason: 'unconfirmed_recovery' });
    expect((await repository.admit(input, source)).attempt?.intent.attemptToken).toBe(attempt.intent.attemptToken);
    await repository.completeFencing(fence, markerReceipt(attempt));
    const next = await repository.admit(input, source);
    expect(next.newlyAdmitted).toBe(true);
    expect(next.attempt?.intent.s3Key).not.toBe(attempt.intent.s3Key);
  });

  it('stale状態または退会開始後はdispatchと画像採用を拒否する', async () => {
    for (const mode of ['stale', 'deleting'] as const) {
      const input = await seed(pool);
      const attempt = requiredAttempt((await repository.admit(input, source)).attempt);
      if (mode === 'stale') await pool.query('UPDATE entity_states SET description=$2 WHERE id=$1', [input.stateId, 'changed']);
      else await pool.query('UPDATE users SET account_deletion_started_at=NOW() WHERE id=$1', [input.userId]);
      expect(await rejectionOf(repository.authorizeDispatch(attempt))).toMatchObject({ code: 'CONFLICT' });
      expect(await rejectionOf(repository.confirmObservedImage(attempt, imageReceipt(attempt)))).toMatchObject({ code: 'CONFLICT' });
      if (mode === 'stale') {
        expect((await repository.claimFencing(attempt, { reason: 'unconfirmed_recovery' })).state).toBe('fencing');
      } else {
        expect(await rejectionOf(repository.claimFencing(attempt, { reason: 'unconfirmed_recovery' }))).toMatchObject({ code: 'CONFLICT' });
        const processingToken = randomUUID();
        await startDeletion(pool, input.userId, processingToken);
        expect((await repository.claimFencing(attempt, { reason: 'account_deletion', processingToken })).state).toBe('fencing');
      }
    }
  });

  it('確定済み画像は有効な個人退会claimの場合だけfencingできる', async () => {
    const input = await seed(pool);
    const attempt = requiredAttempt((await repository.admit(input, source)).attempt);
    await repository.authorizeDispatch(attempt);
    await repository.confirmObservedImage(attempt, imageReceipt(attempt));
    expect(await rejectionOf(repository.claimFencing(attempt, { reason: 'unconfirmed_recovery' }))).toMatchObject({ code: 'CONFLICT' });
    expect(await rejectionOf(repository.claimFencing(attempt, { reason: 'account_deletion', processingToken: randomUUID() }))).toMatchObject({ code: 'CONFLICT' });
    const processingToken = randomUUID();
    await startDeletion(pool, input.userId, processingToken);
    expect((await repository.listPersonalPendingFences(input.userId, processingToken)).map((item) => item.intent.attemptToken)).toEqual([attempt.intent.attemptToken]);
    const claimed = await repository.claimFencing(attempt, { reason: 'account_deletion', processingToken });
    await pool.query('UPDATE account_deletion_requests SET processing_token=$2 WHERE user_id=$1', [input.userId, randomUUID()]);
    expect(await rejectionOf(repository.completeFencing(claimed, markerReceipt(attempt)))).toMatchObject({ code: 'CONFLICT' });
  });

  it('jobとwork削除後もjournalとfencing証拠が残る', async () => {
    const input = await seed(pool);
    const attempt = requiredAttempt((await repository.admit(input, source)).attempt);
    await pool.query('UPDATE generation_jobs SET result=NULL WHERE id=$1', [input.jobId]);
    await pool.query('DELETE FROM generation_jobs WHERE id=$1', [input.jobId]);
    await pool.query('DELETE FROM works WHERE user_id=$1', [input.userId]);
    expect(await rejectionOf(repository.claimFencing(attempt, { reason: 'unconfirmed_recovery' }))).toMatchObject({ code: 'CONFLICT' });
    const processingToken = randomUUID();
    await startDeletion(pool, input.userId, processingToken);
    const fence = await repository.claimFencing(attempt, { reason: 'account_deletion', processingToken });
    expect((await repository.completeFencing(fence, markerReceipt(attempt))).state).toBe('effects_fenced');
    expect((await pool.query('SELECT count(*)::int AS count FROM state_reference_copy_attempts WHERE attempt_token=$1', [attempt.intent.attemptToken])).rows[0]?.count).toBe(1);
  });

  it('旧形式unresolved履歴をv2で解除しない', async () => {
    const input = await seed(pool);
    const history = [{ attempt_id: randomUUID(), state: 'unresolved', s3_key: input.descriptor.s3Key, entity_id: input.entityId, state_id: input.stateId, ref_id: input.descriptor.refId }];
    await pool.query("UPDATE generation_jobs SET result=result||jsonb_build_object('state_reference_copies',$2::jsonb) WHERE id=$1", [input.jobId, JSON.stringify(history)]);
    expect(await rejectionOf(repository.admit(input, source))).toMatchObject({ code: 'CONFLICT' });
    expect((await pool.query('SELECT count(*)::int AS count FROM state_reference_copy_attempts WHERE job_id=$1', [input.jobId])).rows[0]?.count).toBe(0);
  });

  it('終端状態の巻戻しとjournal削除をDBが拒否する', async () => {
    const attempt = requiredAttempt((await repository.admit(await seed(pool), source)).attempt);
    const fence = await repository.claimFencing(attempt, { reason: 'unconfirmed_recovery' });
    await repository.completeFencing(fence, markerReceipt(attempt));
    expect(await rejectionOf(pool.query("UPDATE state_reference_copy_attempts SET state='unresolved' WHERE attempt_token=$1", [attempt.intent.attemptToken]))).toMatchObject({ code: '23514' });
    expect(await rejectionOf(pool.query('DELETE FROM state_reference_copy_attempts WHERE attempt_token=$1', [attempt.intent.attemptToken]))).toMatchObject({ code: '23514' });
  });

  it('marker receiptのDB rollback後に同じmarker証拠で再開できる', async () => {
    const attempt = requiredAttempt((await repository.admit(await seed(pool), source)).attempt);
    const fence = await repository.claimFencing(attempt, { reason: 'unconfirmed_recovery' });
    const faulty = new PostgresFencedStateReferenceRepository({
      query: database.query.bind(database),
      transaction: (work) => database.transaction(async (client) => { await work(client); throw new Error('marker receipt rollback'); }),
    });
    expect(await throwingRejectionOf(faulty.completeFencing(fence, markerReceipt(fence)))).toThrow('marker receipt rollback');
    expect((await pool.query('SELECT state,marker_receipt FROM state_reference_copy_attempts WHERE attempt_token=$1', [attempt.intent.attemptToken])).rows[0])
      .toEqual({ state: 'fencing', marker_receipt: null });
    expect((await repository.completeFencing(fence, markerReceipt(fence))).state).toBe('effects_fenced');
  });

  it('source版またはowner scopeが違う場合に同じ試行として扱わない', async () => {
    const input = await seed(pool);
    const attempt = requiredAttempt((await repository.admit(input, source)).attempt);
    expect(await rejectionOf(repository.admit(input, { ...source, sourceRevision: { eTag: '"another-source"' } }))).toMatchObject({ code: 'CONFLICT' });
    expect(await rejectionOf(repository.findActiveAttempt({ ...input, expectedStateRevision: '2026-09-29T00:00:00.000Z' }))).toMatchObject({ code: 'CONFLICT' });
    expect(await repository.findByKeyAndScope({ s3Key: attempt.intent.s3Key, ownerUserId: randomUUID(), entityId: input.entityId, organizationId: null })).toBeNull();
    expect(await repository.findByKeyAndScope({ s3Key: attempt.intent.s3Key, ownerUserId: input.userId, entityId: input.entityId, organizationId: randomUUID() })).toBeNull();
    expect(await rejectionOf(pool.query('UPDATE state_reference_copy_attempts SET source_revision=$2::jsonb WHERE attempt_token=$1', [attempt.intent.attemptToken, JSON.stringify({ eTag: '"different"' })]))).toMatchObject({ code: '23514' });
  });

  it('消去証拠のないscrubは拒否し個人退会後の終端scrubは復活できない', async () => {
    const input = await seed(pool);
    const attempt = requiredAttempt((await repository.admit(input, source)).attempt);
    expect(await rejectionOf(pool.query('UPDATE state_reference_copy_attempts SET scrubbed_at=NOW() WHERE attempt_token=$1', [attempt.intent.attemptToken]))).toMatchObject({ code: '23514' });
    const fence = await repository.claimFencing(attempt, { reason: 'unconfirmed_recovery' });
    await repository.completeFencing(fence, markerReceipt(fence));
    await startDeletion(pool, input.userId, randomUUID());
    await pool.query(`UPDATE state_reference_copy_attempts SET scrubbed_at=NOW(),actor_user_id=NULL,owner_user_id=NULL,
      organization_id=NULL,entity_id=NULL,state_id=NULL,job_id=NULL,candidate_ref_id=NULL,candidate_s3_key=NULL,
      expected_state_revision=NULL,descriptor=NULL,digest=NULL,mime_type=NULL,size_bytes=NULL,source_revision=NULL,
      image_receipt=NULL,deletion_processing_token=NULL WHERE attempt_token=$1`, [attempt.intent.attemptToken]);
    const row = (await pool.query('SELECT * FROM state_reference_copy_attempts WHERE attempt_token=$1', [attempt.intent.attemptToken])).rows[0];
    expect(row).toMatchObject({ state: 'effects_fenced',actor_user_id: null,descriptor: null,marker_receipt: markerReceipt(fence) });
    expect(await repository.findByKeyAndScope({ s3Key: attempt.intent.s3Key,ownerUserId: input.userId,entityId: input.entityId,organizationId: null })).toBeNull();
    expect(await rejectionOf(pool.query('UPDATE state_reference_copy_attempts SET scrubbed_at=NULL WHERE attempt_token=$1', [attempt.intent.attemptToken]))).toMatchObject({ code: '23514' });
    expect(await rejectionOf(repository.claimFencing(attempt, { reason: 'unconfirmed_recovery' }))).toMatchObject({ code: 'CONFLICT' });
  });
});

function requiredAttempt(attempt: FencedStateReferenceAttempt | null): FencedStateReferenceAttempt {
  if (attempt === null) throw new Error('missing attempt');
  return attempt;
}
function imageReceipt(attempt: FencedStateReferenceAttempt): FencedImageReceipt {
  const { protocol, attemptToken, s3Key, digest, mimeType, sizeBytes } = attempt.intent;
  return { kind: 'image', protocol, attemptToken, s3Key, digest, mimeType, sizeBytes, eTag: '"image-etag"', versionId: 'image-version' };
}
function markerReceipt(attempt: FencedStateReferenceAttempt): FencedErasureReceipt {
  const { protocol, attemptToken, s3Key } = attempt.intent;
  return { kind: 'marker', protocol, attemptToken, s3Key, eTag: '"marker-etag"', versionId: 'marker-version', historyErased: true };
}
async function startDeletion(pool: Pool, userId: string, token: string): Promise<void> {
  await pool.query('UPDATE users SET account_deletion_started_at=NOW() WHERE id=$1', [userId]);
  await pool.query(`INSERT INTO account_deletion_requests (user_id, identity_id, identity_key, status, processing_token, processing_started_at)
    VALUES ($1,$2,$3,'processing',$4,NOW())`, [userId, `fenced-${userId}`, userId.replaceAll('-', '') + 'x'.repeat(11), token]);
}
async function seed(pool: Pool): Promise<ConfirmEntityStateReferenceInput> {
  const userId = randomUUID(); const workId = randomUUID(); const entityId = randomUUID(); const stateId = randomUUID(); const jobId = randomUUID();
  await pool.query('INSERT INTO users (id,supabase_id,email) VALUES ($1,$2,$3)', [userId, `fenced-${userId}`, `${userId}@example.invalid`]);
  await pool.query("INSERT INTO works (id,user_id,title) VALUES ($1,$2,'Fenced local test')", [workId, userId]);
  await pool.query("INSERT INTO entities (id,work_id,user_id,name) VALUES ($1,$2,$3,'Character')", [entityId, workId, userId]);
  await pool.query("INSERT INTO reference_sets (entity_id,primary_ref_id,reference_images,status) VALUES ($1,'base-ref',$2::jsonb,'ready')", [entityId, JSON.stringify([{ ref_id: 'base-ref', s3_key: `saved/${userId}/entities/${entityId}/base.png` }])]);
  await pool.query("INSERT INTO entity_states (id,entity_id,name,description,created_at,updated_at) VALUES ($1,$2,'injured','A cheek scar','2026-09-30T00:00:00Z','2026-09-30T00:00:00Z')", [stateId, entityId]);
  const input: ConfirmEntityStateReferenceInput = {
    userId, organizationId: null, entityId, stateId, jobId, candidateS3Key: `session/${userId}/entities/${entityId}/${jobId}-1.png`, expectedStateRevision: '2026-09-30T00:00:00.000Z',
    descriptor: { refId: `${jobId}-1`, s3Key: `saved/${userId}/entities/${entityId}/states/${stateId}/${jobId}-1.png`, storageOwnerUserId: userId,
      imageModel: 'gpt-image-2', baseRefId: 'base-ref', createdAt: '2026-09-30T00:00:01.000Z', inputFingerprint: computeStateReferenceFingerprint({ entityId, stateId, name: 'injured', description: 'A cheek scar', baseRefId: 'base-ref' }) },
  };
  await pool.query(`INSERT INTO generation_jobs (id,user_id,job_type,status,credit_cost,params,result,completed_at)
    VALUES ($1,$2,'entity_generate','completed',1,$3::jsonb,$4::jsonb,'2026-09-30T00:00:01Z')`,
  [jobId, userId, JSON.stringify({ target: 'entity_state', entity_id: entityId, entity_state_id: stateId, base_primary_ref_id: 'base-ref', state_revision: input.expectedStateRevision,
    state_input_fingerprint: input.descriptor.inputFingerprint, image_model: 'gpt-image-2' }), JSON.stringify({ candidates: [{ ref_id: input.descriptor.refId, s3_key: input.candidateS3Key }] })]);
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
