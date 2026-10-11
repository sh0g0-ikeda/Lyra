import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSyntheticPostgresDatabase, type SyntheticPostgresDatabase } from './postgresTestDatabase.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { attestRuntimeSchema } from '../../src/lib/runtimeSchemaAttestation.js';
import { assertAttestedRuntimeCapabilities } from '../../src/lib/runtimeGuards.js';
const suite = process.env.APP_ENV === 'test' && process.env.DATABASE_URL ? describe : describe.skip;
suite('永久削除スキーマの起動検証', () => {
  let db: SyntheticPostgresDatabase;
  beforeAll(async () => {
    db = await createSyntheticPostgresDatabase({ databaseUrl: process.env.DATABASE_URL!, prefix: 'releasecompat' });
    await runPendingMigrations(db.database);
  }, 120000);
  afterAll(async () => { await db?.close(); });
  it('050が実スキーマで確認された場合にだけ作品削除を有効にする', async () => {
    const runtime = await attestRuntimeSchema(db.database);
    expect(runtime.capabilities.workDeletion).toBe(true);
    expect(() => assertAttestedRuntimeCapabilities(runtime, {})).not.toThrow();
  });
  it('削除ガードの関数が変更された場合に起動を拒否する', async () => {
    const session = await db.pool.connect();
    await session.query('BEGIN');
    try {
      await session.query("CREATE OR REPLACE FUNCTION lyra_guard_work_deletion() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$");
      const database = { transaction: async <T>(work: (client: typeof db.database) => Promise<T>): Promise<T> => work({ query: session.query.bind(session), transaction: db.database.transaction }) };
      await expect(attestRuntimeSchema(database)).rejects.toThrow('SCHEMA_UNSUPPORTED');
    } finally { await session.query('ROLLBACK'); session.release(); }
  });
});
