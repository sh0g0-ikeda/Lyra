import { randomUUID } from 'node:crypto';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { computeStateReferenceFingerprint } from '../../src/domain/state/StateReferenceFingerprint.js';
import type { ConfirmEntityStateReferenceInput } from '../../src/domain/types/entityStateReference.js';
import type { FencedErasureReceipt, FencedImageReceipt, FencedStateReferenceIntent, FencedStateReferenceRecoveryPort } from '../../src/infrastructure/aws/FencedStateReferenceStorage.js';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresEntityStateReferenceRepository } from '../../src/repositories/EntityStateReferenceRepository.js';
import { PostgresFencedStateReferenceRepository } from '../../src/repositories/FencedStateReferenceRepository.js';
import { PostgresGenerationJobRepository } from '../../src/repositories/GenerationJobRepository.js';
import { EntityStateReferenceService } from '../../src/services/entity/EntityStateReferenceService.js';
import { FencedStateReferenceConfirmationService } from '../../src/services/entity/FencedStateReferenceConfirmationService.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';
import { rejectionOf, throwingRejectionOf } from './asyncPostgresAssertions.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
const source = { imageData: Buffer.alloc(100), mimeType: 'image/png' as const, sizeBytes: 100,
  digest: 'a'.repeat(64), sourceRevision: { eTag: '"source"' } };
const originalRevision = '2026-09-30T00:00:00.000Z';
const changedRevision = '2026-10-01T00:00:00.000Z';

// Public service + real journal transactions, with storage effects independent of
// response delivery. No SDK, credentials or external provider calls are involved.
describePostgres('public state confirmation recovers durable stale copies', () => {
  let admin: Pool; let pool: Pool; let database: TestDatabase;
  const schema = `public_fenced_${process.pid}_${Date.now()}`;
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8, options: `-c search_path=${schema},public` });
    database = new TestDatabase(pool);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database));
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });

  function fixture() {
    const journal = new PostgresFencedStateReferenceRepository(database);
    const objects = new Map<string, FencedImageReceipt | FencedErasureReceipt>();
    const controls = { loseNextResponse: true, storeImage: true };
    const imageCreator = {
      loadSource: vi.fn(async () => source),
      createImage: vi.fn(async ({ intent }: { intent: FencedStateReferenceIntent }) => {
        const receipt = imageReceipt(intent);
        if (controls.storeImage) objects.set(intent.s3Key, receipt);
        if (controls.loseNextResponse) { controls.loseNextResponse = false; throw new Error('PUT response lost'); }
        return receipt;
      }),
    };
    const recovery: FencedStateReferenceRecoveryPort = {
      observe: vi.fn(async (intent) => objects.get(intent.s3Key) ?? { kind: 'absent' as const }),
      fenceAndErase: vi.fn(async (intent) => {
        const receipt: FencedErasureReceipt = { kind: 'marker', protocol: intent.protocol, attemptToken: intent.attemptToken,
          s3Key: intent.s3Key, eTag: '"marker"', historyErased: true };
        objects.set(intent.s3Key, receipt); return receipt;
      }),
    };
    const legacyCopy = vi.fn(async (): Promise<never> => { throw new Error('Unexpected legacy copy'); });
    function service(options: { admissionEnabled?: boolean; missingRecovery?: boolean } = {}): EntityStateReferenceService {
      const unused = async (): Promise<never> => { throw new Error('Unexpected unrelated service call'); };
      return new EntityStateReferenceService({
        stateRepository: new PostgresEntityStateReferenceRepository(database),
        generationJobRepository: new PostgresGenerationJobRepository(database),
        fencedConfirmationService: new FencedStateReferenceConfirmationService({ repository: journal, imageCreator,
          ...(options.missingRecovery ? {} : { recovery }), admissionEnabled: options.admissionEnabled ?? true }),
        imageStorage: { storeImportedImage: unused, storeGeneratedCandidate: unused,
          finalizeReferenceImage: unused, finalizeStateReferenceImage: legacyCopy },
        storedImageLoader: { loadByS3Key: unused },
        creditService: { getBalance: unused, grantSignupBonus: unused, consumeCredits: unused, refundCredits: unused },
        generationQueue: { enqueue: unused }, imageModel: 'gpt-image-2',
      });
    }
    const confirm = (input: ConfirmEntityStateReferenceInput, options?: Parameters<typeof service>[0]) =>
      service(options).confirmReference(input.userId, input.entityId, input.stateId, input, input.organizationId);
    const rows = async (input: ConfirmEntityStateReferenceInput) => (await pool.query(
      'SELECT * FROM state_reference_copy_attempts WHERE entity_id=$1 AND state_id=$2 ORDER BY created_at,attempt_token',
      [input.entityId, input.stateId],
    )).rows;
    return { journal, imageCreator, recovery, objects, controls, confirm, rows, legacyCopy };
  }

  it('recovers a lost PUT response before rejecting the original stale candidate, then accepts a current candidate', async () => {
    const f = fixture(); const input = await seed(pool);
    expect(await rejectionOf(f.confirm(input))).toMatchObject({ code: 'CONFLICT' });
    const [admitted] = await f.rows(input);
    const next = await editAndSeedCandidate(pool, input);
    expect(await rejectionOf(f.confirm(input))).toMatchObject({ code: 'CONFLICT' });
    expect(f.recovery.observe).toHaveBeenCalledOnce();
    expect(f.recovery.fenceAndErase).toHaveBeenCalledOnce();
    expect((await f.rows(input))[0]).toMatchObject({ state: 'effects_fenced', descriptor: admitted.descriptor,
      expected_state_revision: originalRevision, candidate_s3_key: input.candidateS3Key });
    expect((await f.confirm(next)).referenceImage.refId).toBe(next.descriptor.refId);
    expect(f.imageCreator.createImage).toHaveBeenCalledTimes(2);
    expect(f.legacyCopy).not.toHaveBeenCalled();
  });

  it.each([true, false])('a new candidate alone recovers the previous scope with image present=%s', async (storeImage) => {
    const f = fixture(); const input = await seed(pool); f.controls.storeImage = storeImage;
    expect(await rejectionOf(f.confirm(input))).toMatchObject({ code: 'CONFLICT' });
    const [admitted] = await f.rows(input);
    const next = await editAndSeedCandidate(pool, input); f.controls.storeImage = true;
    const confirmed = await f.confirm(next);
    expect(confirmed.referenceImage.refId).toBe(next.descriptor.refId);
    expect(confirmed.referenceImage.s3Key).not.toBe(admitted.s3_key);
    expect((await f.rows(input)).map((row) => row.state)).toEqual(['effects_fenced', 'confirmed']);
    expect((await f.rows(input))[0].descriptor).toEqual(admitted.descriptor);
    expect(f.recovery.fenceAndErase).toHaveBeenCalledOnce();
  });

  it('recovers before readiness checks when the base reference is removed', async () => {
    const f = fixture(); const input = await seed(pool);
    expect(await throwingRejectionOf(f.confirm(input))).toThrow();
    await pool.query("UPDATE reference_sets SET primary_ref_id=NULL,reference_images='[]'::jsonb WHERE entity_id=$1", [input.entityId]);
    expect(await rejectionOf(f.confirm(input))).toMatchObject({ code: 'CONFLICT' });
    expect((await f.rows(input))[0].state).toBe('effects_fenced');
    expect(f.imageCreator.createImage).toHaveBeenCalledOnce();
  });

  it('recovers the same valid candidate with admission OFF without loading or creating a second image', async () => {
    const f = fixture(); const input = await seed(pool);
    expect(await throwingRejectionOf(f.confirm(input))).toThrow();
    expect((await f.confirm(input, { admissionEnabled: false })).referenceImage.refId).toBe(input.descriptor.refId);
    expect(f.imageCreator.loadSource).toHaveBeenCalledOnce();
    expect(f.imageCreator.createImage).toHaveBeenCalledOnce();
    expect(f.recovery.fenceAndErase).not.toHaveBeenCalled();
  });

  it('preserves a confirmed historical image when a different candidate is confirmed after an edit', async () => {
    const f = fixture(); const input = await seed(pool); f.controls.loseNextResponse = false;
    const original = await f.confirm(input);
    const next = await editAndSeedCandidate(pool, input);
    expect(await rejectionOf(f.confirm(input))).toMatchObject({ code: 'CONFLICT' });
    await f.confirm(next);
    expect((await f.rows(input)).map((row) => row.state)).toEqual(['confirmed', 'confirmed']);
    expect(f.objects.get(original.referenceImage.s3Key)?.kind).toBe('image');
    expect(f.recovery.fenceAndErase).not.toHaveBeenCalled();
  });

  it('holds existing pending work when recovery configuration is missing or observation is unknown', async () => {
    const f = fixture(); const input = await seed(pool);
    expect(await throwingRejectionOf(f.confirm(input))).toThrow();
    const next = await editAndSeedCandidate(pool, input);
    expect(await throwingRejectionOf(f.confirm(next, { missingRecovery: true }))).toThrow();
    vi.spyOn(f.recovery, 'observe').mockRejectedValue(new Error('Unknown storage identity'));
    expect(await rejectionOf(f.confirm(next))).toMatchObject({ code: 'CONFLICT' });
    expect((await f.rows(input))[0].state).toBe('unresolved');
    expect(f.imageCreator.loadSource).toHaveBeenCalledOnce();
    expect(f.imageCreator.createImage).toHaveBeenCalledOnce();
    expect(f.recovery.fenceAndErase).not.toHaveBeenCalled();
    expect(f.legacyCopy).not.toHaveBeenCalled();
  });

  it('does not recover a different actor, organization, entity or state', async () => {
    const f = fixture(); const input = await seed(pool);
    expect(await throwingRejectionOf(f.confirm(input))).toThrow();
    const other = await seed(pool);
    for (const mutation of [{ userId: other.userId }, { organizationId: randomUUID() },
      { entityId: other.entityId }, { stateId: other.stateId }]) {
      expect(await throwingRejectionOf(f.confirm({ ...input, ...mutation }))).toThrow();
    }
    expect(f.recovery.observe).not.toHaveBeenCalled();
    expect(f.recovery.fenceAndErase).not.toHaveBeenCalled();
    expect((await f.rows(input))[0].state).toBe('unresolved');
  });

  it('requires live organization membership even when the admitted actor still owns the image', async () => {
    const f = fixture(); const input = await seed(pool, true);
    expect(await throwingRejectionOf(f.confirm(input))).toThrow();
    await pool.query("UPDATE organization_members SET status='removed' WHERE organization_id=$1 AND user_id=$2", [input.organizationId, input.userId]);
    expect(await throwingRejectionOf(f.confirm(input))).toThrow();
    expect(f.recovery.observe).not.toHaveBeenCalled();
    expect(f.recovery.fenceAndErase).not.toHaveBeenCalled();
    expect((await f.rows(input))[0].state).toBe('unresolved');
  });

  it('does not adopt an observed image after the same organization actor is downgraded to viewer', async () => {
    const f = fixture(); const input = await seed(pool, true);
    expect(await throwingRejectionOf(f.confirm(input))).toThrow();
    const observe = f.recovery.observe;
    vi.spyOn(f.recovery, 'observe').mockImplementationOnce(async (intent) => {
      await pool.query("UPDATE organization_members SET role='viewer' WHERE organization_id=$1 AND user_id=$2", [input.organizationId,input.userId]);
      const receipt = f.objects.get(intent.s3Key);
      if (receipt?.kind !== 'image') throw new Error('Expected admitted image');
      return receipt;
    });
    expect(await rejectionOf(f.confirm(input))).toMatchObject({ code: 'CONFLICT' });
    expect(observe).toHaveBeenCalledOnce();
    expect(f.recovery.fenceAndErase).not.toHaveBeenCalled();
    expect((await f.rows(input))[0].state).toBe('unresolved');
    expect((await pool.query('SELECT reference_image FROM entity_states WHERE id=$1', [input.stateId])).rows[0].reference_image).toBeNull();
  });

  it('does not admit or dispatch after organization edit access is lost while loading the source', async () => {
    const f = fixture(); const input = await seed(pool, true);
    vi.spyOn(f.imageCreator, 'loadSource').mockImplementationOnce(async () => {
      await pool.query("UPDATE organization_members SET role='viewer' WHERE organization_id=$1 AND user_id=$2", [input.organizationId,input.userId]);
      return source;
    });
    expect(await rejectionOf(f.confirm(input))).toMatchObject({ code: 'CONFLICT' });
    expect(await f.rows(input)).toHaveLength(0);
    expect(f.imageCreator.createImage).not.toHaveBeenCalled();
    expect(f.recovery.fenceAndErase).not.toHaveBeenCalled();
  });

  it('does not dispatch an admitted image after organization edit access is lost', async () => {
    const f = fixture(); const input = await seed(pool, true);
    const authorize = f.journal.authorizeDispatch.bind(f.journal);
    vi.spyOn(f.journal, 'authorizeDispatch').mockImplementationOnce(async (attempt) => {
      await pool.query("UPDATE organization_members SET role='viewer' WHERE organization_id=$1 AND user_id=$2", [input.organizationId,input.userId]);
      return authorize(attempt);
    });
    expect(await rejectionOf(f.confirm(input))).toMatchObject({ code: 'CONFLICT' });
    expect((await f.rows(input))[0]).toMatchObject({ state: 'unresolved', dispatch_started_at: null });
    expect(f.imageCreator.createImage).not.toHaveBeenCalled();
    expect(f.recovery.fenceAndErase).not.toHaveBeenCalled();
  });

  it('lets an active organization editor fence an orphaned attempt without adopting or rebinding its image', async () => {
    const f = fixture(); const input = await seed(pool, true);
    expect(await throwingRejectionOf(f.confirm(input))).toThrow();
    const [original] = await f.rows(input);
    const next = await candidateForOtherMember(pool, input);
    await pool.query("UPDATE organization_members SET status='removed' WHERE organization_id=$1 AND user_id=$2", [input.organizationId,input.userId]);
    await pool.query('UPDATE users SET account_deletion_started_at=NOW(),account_deleted_at=NOW() WHERE id=$1', [input.userId]);
    const confirmed = await f.confirm(next);
    expect(confirmed.referenceImage.refId).toBe(next.descriptor.refId);
    expect(confirmed.referenceImage.storageOwnerUserId).toBe(next.userId);
    expect((await f.rows(input))[0]).toMatchObject({ state: 'effects_fenced', actor_user_id: input.userId,
      owner_user_id: input.userId, descriptor: original.descriptor, expected_state_revision: original.expected_state_revision });
    expect(f.objects.get(original.s3_key)?.kind).toBe('marker');
    expect((await f.rows(input))[1].state).toBe('confirmed');
  });

  it.each(['viewer', 'removed', 'cross-organization'] as const)('does not let a %s caller fence another organization member image', async (mode) => {
    const f = fixture(); const input = await seed(pool, true);
    expect(await throwingRejectionOf(f.confirm(input))).toThrow();
    const next = await candidateForOtherMember(pool, input);
    if (mode === 'viewer') await pool.query("UPDATE organization_members SET role='viewer' WHERE organization_id=$1 AND user_id=$2", [next.organizationId,next.userId]);
    if (mode === 'removed') await pool.query("UPDATE organization_members SET status='removed' WHERE organization_id=$1 AND user_id=$2", [next.organizationId,next.userId]);
    if (mode === 'cross-organization') next.organizationId = (await seed(pool, true)).organizationId;
    expect(await throwingRejectionOf(f.confirm(next))).toThrow();
    expect(f.recovery.observe).not.toHaveBeenCalled();
    expect(f.recovery.fenceAndErase).not.toHaveBeenCalled();
    expect((await f.rows(input))[0].state).toBe('unresolved');
  });

  it('rechecks the recovering editor membership after selecting another member pending attempt', async () => {
    const f = fixture(); const input = await seed(pool, true);
    expect(await throwingRejectionOf(f.confirm(input))).toThrow();
    const next = await candidateForOtherMember(pool, input);
    const claim = f.journal.claimFencing.bind(f.journal);
    vi.spyOn(f.journal, 'claimFencing').mockImplementation(async (attempt, request) => {
      await pool.query("UPDATE organization_members SET status='removed' WHERE organization_id=$1 AND user_id=$2", [next.organizationId,next.userId]);
      return claim(attempt, request);
    });
    expect(await rejectionOf(f.confirm(next))).toMatchObject({ code: 'CONFLICT' });
    expect(f.journal.claimFencing).toHaveBeenCalledOnce();
    expect(f.recovery.fenceAndErase).not.toHaveBeenCalled();
    expect((await f.rows(input))[0].state).toBe('unresolved');
  });

  it('keeps a former organization member confirmed historical image intact for a new member candidate', async () => {
    const f = fixture(); const input = await seed(pool, true); f.controls.loseNextResponse = false;
    const confirmed = await f.confirm(input);
    const next = await candidateForOtherMember(pool, input);
    await pool.query("UPDATE organization_members SET status='removed' WHERE organization_id=$1 AND user_id=$2", [input.organizationId,input.userId]);
    await f.confirm(next);
    expect((await f.rows(input)).map((row) => row.state)).toEqual(['confirmed', 'confirmed']);
    expect(f.objects.get(confirmed.referenceImage.s3Key)?.kind).toBe('image');
    expect(f.recovery.fenceAndErase).not.toHaveBeenCalled();
  });

  it('rechecks account authorization after observation before claiming an ordinary fence', async () => {
    const f = fixture(); const input = await seed(pool);
    expect(await throwingRejectionOf(f.confirm(input))).toThrow();
    const next = await editAndSeedCandidate(pool, input);
    vi.spyOn(f.recovery, 'observe').mockImplementation(async () => {
      await pool.query('UPDATE users SET account_deletion_started_at=NOW() WHERE id=$1', [input.userId]);
      return { kind: 'absent' };
    });
    expect(await rejectionOf(f.confirm(next))).toMatchObject({ code: 'CONFLICT' });
    expect(f.recovery.observe).toHaveBeenCalledOnce();
    expect(f.recovery.fenceAndErase).not.toHaveBeenCalled();
    expect((await f.rows(input))[0].state).toBe('unresolved');
  });

  it('never settles legacy unknown copy history while recovering a v2 blocker', async () => {
    const f = fixture(); const input = await seed(pool);
    expect(await throwingRejectionOf(f.confirm(input))).toThrow();
    const next = await editAndSeedCandidate(pool, input);
    const history = [{ attempt_id: randomUUID(), state: 'unresolved', s3_key: next.descriptor.s3Key,
      entity_id: next.entityId, state_id: next.stateId, ref_id: next.descriptor.refId }];
    await pool.query("UPDATE generation_jobs SET result=result||jsonb_build_object('state_reference_copies',$2::jsonb) WHERE id=$1", [next.jobId, JSON.stringify(history)]);
    expect(await rejectionOf(f.confirm(next))).toMatchObject({ code: 'CONFLICT' });
    expect((await f.rows(input))[0].state).toBe('effects_fenced');
    expect((await pool.query('SELECT result FROM generation_jobs WHERE id=$1', [next.jobId])).rows[0].result.state_reference_copies).toEqual(history);
    expect(f.imageCreator.createImage).toHaveBeenCalledOnce();
  });
});

function imageReceipt(intent: FencedStateReferenceIntent): FencedImageReceipt {
  const { protocol, attemptToken, s3Key, digest, mimeType, sizeBytes } = intent;
  return { kind: 'image', protocol, attemptToken, s3Key, digest, mimeType, sizeBytes, eTag: '"image"' };
}
async function seed(pool: Pool, organization = false): Promise<ConfirmEntityStateReferenceInput> {
  const userId = randomUUID(); const workId = randomUUID(); const entityId = randomUUID(); const stateId = randomUUID();
  const organizationId = organization ? randomUUID() : null;
  await pool.query('INSERT INTO users (id,supabase_id,email) VALUES ($1,$2,$3)', [userId, `public-fenced-${userId}`, `${userId}@example.invalid`]);
  if (organizationId) {
    await pool.query("INSERT INTO organizations (id,name,created_by_user_id,status) VALUES ($1,'Recovery fixture',$2,'active')", [organizationId,userId]);
    await pool.query("INSERT INTO organization_members (organization_id,user_id,role,status,joined_at) VALUES ($1,$2,'editor','active',NOW())", [organizationId,userId]);
  }
  await pool.query("INSERT INTO works (id,user_id,title,organization_id) VALUES ($1,$2,'Public recovery test',$3)", [workId,userId,organizationId]);
  await pool.query("INSERT INTO entities (id,work_id,user_id,name,status) VALUES ($1,$2,$3,'Character','ready')", [entityId,workId,userId]);
  await pool.query("INSERT INTO reference_sets (entity_id,primary_ref_id,reference_images,status) VALUES ($1,'base-ref',$2::jsonb,'ready')", [entityId,
    JSON.stringify([{ ref_id: 'base-ref', s3_key: `saved/${userId}/entities/${entityId}/base.png` }])]);
  await pool.query("INSERT INTO entity_states (id,entity_id,name,description,created_at,updated_at) VALUES ($1,$2,'injured','A cheek scar',$3,$3)", [stateId,entityId,originalRevision]);
  return seedCandidate(pool, { userId, organizationId, entityId, stateId }, originalRevision, 'A cheek scar');
}
async function editAndSeedCandidate(pool: Pool, input: ConfirmEntityStateReferenceInput): Promise<ConfirmEntityStateReferenceInput> {
  await pool.query("UPDATE entity_states SET description='Changed appearance',updated_at=$2 WHERE id=$1", [input.stateId,changedRevision]);
  return seedCandidate(pool, input, changedRevision, 'Changed appearance');
}
async function candidateForOtherMember(pool: Pool, input: ConfirmEntityStateReferenceInput): Promise<ConfirmEntityStateReferenceInput> {
  const userId = randomUUID();
  await pool.query('INSERT INTO users (id,supabase_id,email) VALUES ($1,$2,$3)', [userId, `recovering-${userId}`, `${userId}@example.invalid`]);
  await pool.query("INSERT INTO organization_members (organization_id,user_id,role,status,joined_at) VALUES ($1,$2,'editor','active',NOW())", [input.organizationId,userId]);
  await pool.query("UPDATE entity_states SET description='Changed appearance',updated_at=$2 WHERE id=$1", [input.stateId,changedRevision]);
  return seedCandidate(pool, { ...input, userId }, changedRevision, 'Changed appearance');
}
async function seedCandidate(pool: Pool, scope: Pick<ConfirmEntityStateReferenceInput, 'userId' | 'organizationId' | 'entityId' | 'stateId'>,
  revision: string, description: string): Promise<ConfirmEntityStateReferenceInput> {
  const { userId, organizationId, entityId, stateId } = scope; const jobId = randomUUID();
  const input: ConfirmEntityStateReferenceInput = { userId, organizationId, entityId, stateId, jobId,
    candidateS3Key: `session/${userId}/entities/${entityId}/${jobId}-1.png`, expectedStateRevision: revision,
    descriptor: { refId: `${jobId}-1`, s3Key: `saved/${userId}/entities/${entityId}/states/${stateId}/${jobId}-1.png`, storageOwnerUserId: userId,
      imageModel: 'gpt-image-2', baseRefId: 'base-ref', createdAt: '2026-09-30T00:00:01.000Z',
      inputFingerprint: computeStateReferenceFingerprint({ entityId, stateId, name: 'injured', description, baseRefId: 'base-ref' }) } };
  await pool.query(`INSERT INTO generation_jobs (id,user_id,organization_id,job_type,status,credit_cost,params,result,completed_at)
    VALUES ($1,$2,$3,'entity_generate','completed',1,$4::jsonb,$5::jsonb,'2026-09-30T00:00:01Z')`,
  [jobId,userId,organizationId,JSON.stringify({ target: 'entity_state', entity_id: entityId, entity_state_id: stateId, base_primary_ref_id: 'base-ref',
    state_revision: revision, state_input_fingerprint: input.descriptor.inputFingerprint, image_model: 'gpt-image-2' }),
  JSON.stringify({ candidates: [{ ref_id: input.descriptor.refId, s3_key: input.candidateS3Key }] })]);
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
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
