import { randomUUID } from 'node:crypto';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeStateReferenceFingerprint } from '../../src/domain/state/StateReferenceFingerprint.js';
import type { ConfirmEntityStateReferenceInput } from '../../src/domain/types/entityStateReference.js';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import {
  PostgresFencedStateReferenceRepository,
  type FencedStateReferenceAttempt,
} from '../../src/repositories/FencedStateReferenceRepository.js';
import type { ReleaseCompatibilityRuntime } from '../../src/domain/release/ReleaseCompatibilityPolicy.js';
import { checkReleaseCompatibility } from '../../scripts/checkReleaseCompatibility.js';
import {
  createSyntheticPostgresDatabase,
  type SyntheticPostgresDatabase,
} from './postgresTestDatabase.js';

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.APP_ENV === 'test' && databaseUrl !== undefined ? describe : describe.skip;

describePostgres('release compatibility preflight', () => {
  let pool: Pool;
  let database: TestDatabase;
  let synthetic: SyntheticPostgresDatabase;

  beforeAll(async () => {
    synthetic = await createSyntheticPostgresDatabase({
      databaseUrl: databaseUrl!,
      prefix: 'releasecompat',
      max: 4,
    });
    pool = synthetic.pool;
    database = new TestDatabase(pool);
    await runPendingMigrations(database);
    database.transactionStatements.length = 0;
  }, 120_000);

  afterAll(async () => {
    await synthetic?.close();
  });

  it('047現行historyとinvariantを単一read-only snapshotで検査し空journalを許可する', async () => {
    const before = Number((await pool.query('SELECT COUNT(*)::int AS count FROM schema_migrations')).rows[0]?.count);
    const report = await checkReleaseCompatibility(database, {
      profile: 'backend-only', mobileClientIds: [], runtime: runtime(),
    });
    const after = Number((await pool.query('SELECT COUNT(*)::int AS count FROM schema_migrations')).rows[0]?.count);
    expect(report).toMatchObject({ ok: true, profile: 'backend-only', journalPresent: false });
    expect(report.remoteStoragePolicyVerified).toBe(false);
    expect(report.violations).toEqual([]);
    expect(after).toBe(before);
    expect(database.transactionStatements).toEqual(expect.arrayContaining([
      expect.stringContaining('REPEATABLE READ'),
      expect.stringContaining('lock_timeout'),
      expect.stringContaining('statement_timeout'),
    ]));
    expect(database.transactionStatements.every((sql) => /^\s*(SELECT|WITH|SET)\b/u.test(sql))).toBe(true);
  });

  it('terminal v2 journalがあればadmission OFFでもrecovery設定なしを拒否する', async () => {
    const repository = new PostgresFencedStateReferenceRepository(database);
    const attempt = requiredAttempt((await repository.admit(await seed(pool), {
      mimeType: 'image/png', sizeBytes: 100, digest: 'a'.repeat(64), sourceRevision: { eTag: '"source-etag"' },
    })).attempt);
    const unresolved = await checkReleaseCompatibility(database, {
      profile: 'backend-only', mobileClientIds: [], runtime: runtime(),
    });
    expect(unresolved.violations.map((entry) => entry.code)).toContain('DATA_INVARIANT:state_reference_copy_attempts.unresolved');
    expect(JSON.stringify(unresolved)).not.toContain(attempt.intent.attemptToken);
    const claimed = await repository.claimFencing(attempt, { reason: 'unconfirmed_recovery' });
    await repository.completeFencing(claimed, {
      kind: 'marker', protocol: claimed.intent.protocol, attemptToken: claimed.intent.attemptToken,
      s3Key: claimed.intent.s3Key, eTag: '"marker-etag"', versionId: 'marker-version', historyErased: true,
    });

    const missing = await checkReleaseCompatibility(database, {
      profile: 'backend-only', mobileClientIds: [], runtime: runtime(),
    });
    expect(missing.journalPresent).toBe(true);
    expect(missing.violations.map((entry) => entry.code)).toContain('STATE_RECOVERY_CONFIG_REQUIRED');

    const configured = await checkReleaseCompatibility(database, {
      profile: 'backend-only', mobileClientIds: [], runtime: runtime({
        stateReferenceCopyV2StorageContractAttested: true,
        stateReferenceCopyV2ImageRoleArn: 'arn:aws:iam::123456789012:role/lyra-state-image',
        stateReferenceCopyV2RecoveryRoleArn: 'arn:aws:iam::123456789012:role/lyra-state-recovery',
        stateReferenceCopyV2ExpectedBucketOwner: '123456789012',
        stateReferenceCopyV2VersioningHistory: 'versioned',
        stateReferenceCopyV2BucketName: 'lyra-images',
        stateReferenceCopyV2Region: 'ap-northeast-1',
      }),
    });
    expect(configured).toMatchObject({ ok: true, journalPresent: true, violations: [] });
  });

  it('schema history差異はrow識別子を返さず後続shape検査を止める', async () => {
    await pool.query("DELETE FROM schema_migrations WHERE filename='047_add_state_reference_copy_attempts.sql'");
    try {
      const report = await checkReleaseCompatibility(database, {
        profile: 'backend-only', mobileClientIds: [], runtime: runtime(),
      });
      expect(report.ok).toBe(false);
      expect(report.violations).toContainEqual({ category: 'database', code: 'SCHEMA_HISTORY_MISMATCH', count: 1 });
      expect(JSON.stringify(report)).not.toContain('047_add_state_reference_copy_attempts.sql');
    } finally {
      await pool.query("INSERT INTO schema_migrations(filename) VALUES('047_add_state_reference_copy_attempts.sql')");
    }
  });
});

function runtime(overrides: Partial<ReleaseCompatibilityRuntime> = {}): ReleaseCompatibilityRuntime {
  return {
    generationQuotesEnabled: false,
    generationEnabled: true,
    pageGenerationEnabled: true,
    entityGenerationEnabled: true,
    entityImportAnalysisEnabled: true,
    entityReferenceDirectUploadEnabled: true,
    openAiApiKeyConfigured: true,
    openAiImageModel: 'gpt-image-2',
    generationQueueConfigured: true,
    imageStorageConfigured: true,
    awsRegionConfigured: true,
    localImageFallbackEnabled: false,
    webImageDeliveryClientIds: [],
    stateReferenceCopyV2AdmissionEnabled: false,
    stateReferenceCopyV2StorageContractAttested: false,
    ...overrides,
  };
}

function requiredAttempt(attempt: FencedStateReferenceAttempt | null): FencedStateReferenceAttempt {
  if (attempt === null) throw new Error('missing attempt');
  return attempt;
}

async function seed(target: Pool): Promise<ConfirmEntityStateReferenceInput> {
  const userId = randomUUID();
  const workId = randomUUID();
  const entityId = randomUUID();
  const stateId = randomUUID();
  const jobId = randomUUID();
  await target.query('INSERT INTO users (id,supabase_id,email) VALUES ($1,$2,$3)', [userId, `release-${userId}`, `${userId}@example.invalid`]);
  await target.query("INSERT INTO works (id,user_id,title) VALUES ($1,$2,'Release compatibility')", [workId, userId]);
  await target.query("INSERT INTO entities (id,work_id,user_id,name) VALUES ($1,$2,$3,'Character')", [entityId, workId, userId]);
  await target.query("INSERT INTO reference_sets (entity_id,primary_ref_id,reference_images,status) VALUES ($1,'base-ref',$2::jsonb,'ready')", [entityId, JSON.stringify([{ ref_id: 'base-ref', s3_key: `saved/${userId}/entities/${entityId}/base.png` }])]);
  await target.query("INSERT INTO entity_states (id,entity_id,name,description,created_at,updated_at) VALUES ($1,$2,'injured','A cheek scar','2026-09-30T00:00:00Z','2026-09-30T00:00:00Z')", [stateId, entityId]);
  const expectedStateRevision = '2026-09-30T00:00:00.000Z';
  const inputFingerprint = computeStateReferenceFingerprint({ entityId, stateId, name: 'injured', description: 'A cheek scar', baseRefId: 'base-ref' });
  const candidateS3Key = `session/${userId}/entities/${entityId}/${jobId}-1.png`;
  await target.query(`INSERT INTO generation_jobs (id,user_id,job_type,status,credit_cost,params,result,completed_at)
    VALUES ($1,$2,'entity_generate','completed',1,$3::jsonb,$4::jsonb,'2026-09-30T00:00:01Z')`, [
    jobId, userId,
    JSON.stringify({ target: 'entity_state', entity_id: entityId, entity_state_id: stateId, base_primary_ref_id: 'base-ref', state_revision: expectedStateRevision, state_input_fingerprint: inputFingerprint, image_model: 'gpt-image-2' }),
    JSON.stringify({ candidates: [{ ref_id: `${jobId}-1`, s3_key: candidateS3Key }] }),
  ]);
  return {
    userId, organizationId: null, entityId, stateId, jobId, candidateS3Key, expectedStateRevision,
    descriptor: {
      refId: `${jobId}-1`, s3Key: `saved/${userId}/entities/${entityId}/states/${stateId}/${jobId}-1.png`,
      storageOwnerUserId: userId, imageModel: 'gpt-image-2', baseRefId: 'base-ref',
      createdAt: '2026-09-30T00:00:01.000Z', inputFingerprint,
    },
  };
}

class TestDatabase implements DatabaseClient, TransactionRunner {
  public readonly transactionStatements: string[] = [];
  public constructor(private readonly pool: Pool) {}
  public query<T extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values === undefined ? undefined : [...values]);
  }
  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work({
        query: <R extends QueryResultRow>(text: string, values?: readonly unknown[]) => {
          this.transactionStatements.push(text);
          return client.query<R>(text, values === undefined ? undefined : [...values]);
        },
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
