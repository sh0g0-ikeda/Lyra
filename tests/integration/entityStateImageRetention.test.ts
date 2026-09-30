import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresAccountDeletionRepository } from '../../src/repositories/AccountDeletionRepository.js';
import { PostgresEntityRepository } from '../../src/repositories/EntityRepository.js';
import { PostgresImageStorageReferenceRepository } from '../../src/repositories/ImageStorageReferenceRepository.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const databaseUrl = process.env.DATABASE_URL;
const shouldRunPostgresTest = process.env.APP_ENV === 'test' && databaseUrl !== undefined;
const describePostgres = shouldRunPostgresTest ? describe : describe.skip;

describePostgres('entity state image retention', () => {
  let adminPool: Pool;
  let pool: Pool;
  let schemaName: string;

  beforeAll(async () => {
    adminPool = createPool();
    schemaName = `entity_state_retention_${process.pid}_${Date.now()}`;
    assertSafeSchemaName(schemaName);
    await adminPool.query(`CREATE SCHEMA ${schemaName}`);
    pool = createPool(schemaName);
    const applied = await withPostgresTestMigrationLock(adminPool, () => runPendingMigrations(
      new PoolTransactionDatabase(pool),
      { migrationLockPollMs: 1, migrationLockMaxAttempts: 10 },
    ));
    expect(applied.at(-1)).toBe('040_add_entity_state_variants.sql');
  }, 120_000);

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.end();
    }
    if (adminPool !== undefined && schemaName !== undefined) {
      assertSafeSchemaName(schemaName);
      await adminPool.query(`DROP SCHEMA ${schemaName} CASCADE`);
      await adminPool.end();
    }
  });

  it('live state descriptorとinput snapshot参照をprune保護し、退会対象はpersonal state画像だけにする', async () => {
    const ids = createFixtureIds();
    const personalStateKey = `state-images/${ids.personalStateId}/personal.png`;
    const organizationStateKey = `state-images/${ids.organizationStateId}/organization.png`;
    const snapshotKey = `page-inputs/${ids.jobId}/reference.png`;
    await insertFixture(pool, ids, {
      organizationStateKey,
      personalStateKey,
      snapshotKey,
    });

    const database = new PoolTransactionDatabase(pool);
    const protectedKeys = await new PostgresImageStorageReferenceRepository(database)
      .findProtectedImageS3Keys({ protectRecentCandidateHours: 1 });
    const flight = await new PostgresAccountDeletionRepository(database, database)
      .getFlight(ids.userId);

    expect([...protectedKeys]).toEqual(expect.arrayContaining([
      personalStateKey,
      organizationStateKey,
      snapshotKey,
    ]));
    expect(flight.personalAssetKeys).toContain(personalStateKey);
    expect(flight.personalAssetKeys).not.toContain(organizationStateKey);
  });

  it('旧ページの不正な状態IDでは既定画像を維持し、存在しないUUID状態は拒否する', async () => {
    const ids = createFixtureIds();
    const baseKey = `saved/${ids.userId}/entities/${ids.personalEntityId}/base.png`;
    await insertFixture(pool, ids, {
      organizationStateKey: `state-images/${ids.organizationStateId}/organization.png`,
      personalStateKey: `state-images/${ids.personalStateId}/personal.png`,
      snapshotKey: `page-inputs/${ids.jobId}/reference.png`,
    });
    await pool.query(
      `INSERT INTO reference_sets (entity_id, reference_images, primary_ref_id, status)
       VALUES ($1::uuid, $2::jsonb, 'base-ref', 'ready')`,
      [ids.personalEntityId, JSON.stringify([{
        ref_id: 'base-ref', s3_key: baseKey, cdn_url: 'https://img.lyra.test/base.png',
        source: 'generated', created_at: '2026-09-30T00:00:00.000Z',
      }])],
    );

    const repository = new PostgresEntityRepository(new PoolTransactionDatabase(pool));
    const missingStateId = randomUUID();
    const resolved = await repository.findResolvedReferenceImagesByAssignmentsAndUserId?.([
      { entityId: ids.personalEntityId, stateId: 'legacy-invalid-id' },
      { entityId: ids.personalEntityId, stateId: missingStateId },
    ], ids.personalWorkId, ids.userId);

    expect(resolved?.find((row) => row.stateId === 'legacy-invalid-id')).toMatchObject({
      stateExists: true, refId: 'base-ref', s3Key: baseKey,
    });
    expect(resolved?.find((row) => row.stateId === missingStateId)).toMatchObject({
      stateExists: false, refId: null, s3Key: null,
    });
  });
});

interface FixtureIds {
  jobId: string;
  organizationId: string;
  organizationEntityId: string;
  organizationStateId: string;
  organizationWorkId: string;
  personalEntityId: string;
  personalStateId: string;
  personalWorkId: string;
  userId: string;
}

interface FixtureKeys {
  organizationStateKey: string;
  personalStateKey: string;
  snapshotKey: string;
}

function createFixtureIds(): FixtureIds {
  return {
    jobId: randomUUID(),
    organizationId: randomUUID(),
    organizationEntityId: randomUUID(),
    organizationStateId: randomUUID(),
    organizationWorkId: randomUUID(),
    personalEntityId: randomUUID(),
    personalStateId: randomUUID(),
    personalWorkId: randomUUID(),
    userId: randomUUID(),
  };
}

async function insertFixture(pool: Pool, ids: FixtureIds, keys: FixtureKeys): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, supabase_id, email)
     VALUES ($1::uuid, $2, $3)`,
    [ids.userId, `entity-state-retention-${ids.userId}`, `${ids.userId}@example.invalid`],
  );
  await pool.query(
    `INSERT INTO organizations (id, name, created_by_user_id)
     VALUES ($1::uuid, 'Entity state retention organization', $2::uuid)`,
    [ids.organizationId, ids.userId],
  );
  await pool.query(
    `INSERT INTO works (id, user_id, title, organization_id)
     VALUES ($1::uuid, $2::uuid, 'Personal work', NULL),
            ($3::uuid, $2::uuid, 'Organization work', $4::uuid)`,
    [ids.personalWorkId, ids.userId, ids.organizationWorkId, ids.organizationId],
  );
  await pool.query(
    `INSERT INTO entities (id, work_id, user_id, name)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'Personal character'),
            ($4::uuid, $5::uuid, $3::uuid, 'Organization character')`,
    [
      ids.personalEntityId,
      ids.personalWorkId,
      ids.userId,
      ids.organizationEntityId,
      ids.organizationWorkId,
    ],
  );
  await pool.query(
    `INSERT INTO entity_states (id, entity_id, name, description, reference_image)
     VALUES ($1::uuid, $2::uuid, 'injured', 'A cheek scar', $3::jsonb),
            ($4::uuid, $5::uuid, 'rain', 'Wet hair', $6::jsonb)`,
    [
      ids.personalStateId,
      ids.personalEntityId,
      JSON.stringify({ s3_key: keys.personalStateKey }),
      ids.organizationStateId,
      ids.organizationEntityId,
      JSON.stringify({ s3_key: keys.organizationStateKey }),
    ],
  );
  await pool.query(
    `INSERT INTO generation_jobs (id, user_id, job_type, status, credit_cost, params, result)
     VALUES ($1::uuid, $2::uuid, 'page_generate', 'completed', 0, '{}'::jsonb, $3::jsonb)`,
    [
      ids.jobId,
      ids.userId,
      JSON.stringify({
        input_snapshot: {
          references: [{ s3Key: keys.snapshotKey }],
        },
      }),
    ],
  );
}

function createPool(schemaName?: string): Pool {
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required for the entity state image retention integration test');
  }
  return new Pool({
    connectionString: databaseUrl,
    max: 8,
    ...(schemaName === undefined ? {} : { options: `-c search_path=${schemaName},public` }),
  });
}

function assertSafeSchemaName(value: string): void {
  if (!/^entity_state_retention_[0-9]+_[0-9]+$/u.test(value)) {
    throw new Error('Unsafe PostgreSQL test schema name');
  }
}

class PoolTransactionDatabase implements DatabaseClient, TransactionRunner {
  public constructor(private readonly pool: Pool) {}

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values === undefined ? undefined : [...values]);
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(toDatabaseClient(client));
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

function toDatabaseClient(client: PoolClient): DatabaseClient {
  return {
    query: <T extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<T>> => client.query<T>(
      text,
      values === undefined ? undefined : [...values],
    ),
  };
}
