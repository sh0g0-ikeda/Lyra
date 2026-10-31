import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations, runProduction44Expansion } from '../../src/lib/migrations.js';
import { createCancelledGenerationSettlementRecoveryRepository } from '../../src/repositories/CancelledGenerationSettlementRecoveryRepository.js';
import { createTerminalGenerationNotificationRecoveryRepository } from '../../src/repositories/TerminalGenerationNotificationRecoveryRepository.js';
import { checkReleaseCompatibility } from '../../scripts/checkReleaseCompatibility.js';
import { attestRuntimeSchema } from '../../src/lib/runtimeSchemaAttestation.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';
const url = process.env.DATABASE_URL;
function isSyntheticTarget(): boolean {
    if (process.env.APP_ENV !== 'test' || url === undefined) return false;
    const address = new URL(url);
    return ['postgres:', 'postgresql:'].includes(address.protocol) && ['127.0.0.1', 'localhost', '::1'].includes(address.hostname)
        && address.pathname === '/lyra_test' && address.search === '' && address.hash === ''
        && (['15432', '15433', '15435'].includes(address.port) || (process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true' && ['5432', '5433'].includes(address.port)));
}
const suite = isSyntheticTarget() ? describe : describe.skip;
for (const profile of ['canonical', 'expanded'] as const) suite(`Google recovery PostgreSQL ${profile}`, () => {
    const schema = 'google_recovery_attest_' + randomUUID().replaceAll('-', '');
    let admin: Pool, pool: Pool, database: DatabaseClient & TransactionRunner;
    beforeAll(async () => {
        admin = new Pool({ connectionString: url, max: 1 });
        await admin.query('CREATE SCHEMA ' + schema);
        pool = new Pool({ connectionString: url, options: '-c search_path=' + schema + ',public', max: 3 });
        database = { query: pool.query.bind(pool), transaction: async <T>(operation: (client: DatabaseClient) => Promise<T>): Promise<T> => {
            const client = await pool.connect();
            try { await client.query('BEGIN'); const result = await operation({ query: client.query.bind(client) }); await client.query('COMMIT'); return result; }
            catch (error) { await client.query('ROLLBACK'); throw error; }
            finally { client.release(); }
        } };
        await withPostgresTestMigrationLock(admin, async () => {
            await runPendingMigrations(database, profile === 'canonical' ? undefined : { migrationsDir: join(process.cwd(), 'tests/fixtures/production44-pg18') });
            // This suite rehearses the historical 050 -> 051 boundary.
            if (profile === 'canonical') await database.transaction(async client => {
                await client.query('DROP TABLE generation_worker_warm_controls');
                await client.query("DELETE FROM schema_migrations WHERE filename='052_add_generation_worker_warm_control.sql'");
            });
            if (profile === 'expanded') {
                await runProduction44Expansion(pool);
                await database.transaction(async client => {
                    await client.query(await readFile(join(process.cwd(), 'migrations/051_add_google_link_recovery.sql'), 'utf8'));
                    await client.query("INSERT INTO schema_migrations(filename) VALUES('051_add_google_link_recovery.sql')");
                });
            }
        });
    }, 180000);
    afterAll(async () => {
        if (pool) await pool.end();
        if (admin) { await admin.query('DROP SCHEMA ' + schema + ' CASCADE'); await admin.end(); }
    });
    async function withChangedSchema(sql: string, operation: (runner: TransactionRunner) => Promise<void>): Promise<void> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN'); await client.query(sql);
            await operation({ transaction: work => work({ query: client.query.bind(client) }) });
        } finally { await client.query('ROLLBACK'); client.release(); }
    }
    it('実DDLの051を検証した場合にだけ復旧を認定する', async () => {
        const runtime = await attestRuntimeSchema(database);
        expect(runtime.repositoryProfile).toBe(profile === 'canonical' ? 'canonical' : 'production44_expanded_pg18_v1');
        expect(runtime.capabilities.googleIdentityRecovery).toBe(true);
    });
    if (profile === 'expanded') {
        it('051の拡張schemaで返還と通知のrecovery factoryを認定する', async () => {
            expect((await createCancelledGenerationSettlementRecoveryRepository(database, 'production44_expanded_pg18_v1')).profile).toBe('production44_expanded_pg18_v1');
            expect((await createTerminalGenerationNotificationRecoveryRepository(database, 'production44_expanded_pg18_v1')).profile).toBe('production44_expanded_pg18_v1');
        });
        it('051の拡張schemaでrelease preflightを読取専用で認定する', async () => {
            const result = await checkReleaseCompatibility(database, { profile: 'backend-only', mobileClientIds: [], runtime: {
                generationQuotesEnabled: true, generationEnabled: true, pageGenerationEnabled: true, entityGenerationEnabled: true,
                entityImportAnalysisEnabled: true, entityReferenceDirectUploadEnabled: true, openAiApiKeyConfigured: true, openAiImageModel: 'gpt-image-2',
                generationQueueConfigured: true, imageStorageConfigured: true, awsRegionConfigured: true, localImageFallbackEnabled: false,
                webImageDeliveryClientIds: [], stateReferenceCopyV2AdmissionEnabled: false, stateReferenceCopyV2StorageContractAttested: false,
            } }, { schemaProfile: 'production44_expanded_pg18_v1' });
            expect(result).toMatchObject({ ok: true, violations: [] });
        });
    }    it('051以前のschemaは復旧capabilityなしで従来通り認定する', async () => {
        await withChangedSchema("DROP TABLE retired_auth_subjects; ALTER TABLE oauth_identity_links DROP COLUMN operation_phase, DROP COLUMN source_subject_key; DELETE FROM schema_migrations WHERE filename='051_add_google_link_recovery.sql'", async runner => {
            expect((await attestRuntimeSchema(runner)).capabilities.googleIdentityRecovery ?? false).toBe(false);
        });
    });
    it.each([
        ['table欠落', 'DROP TABLE retired_auth_subjects'],
        ['column欠落', 'ALTER TABLE oauth_identity_links DROP COLUMN source_subject_key'],
        ['危険なdefault', "ALTER TABLE oauth_identity_links ALTER COLUMN operation_phase SET DEFAULT 'ready'"],
        ['FK変更', 'ALTER TABLE retired_auth_subjects DROP CONSTRAINT retired_auth_subjects_destination_user_id_fkey; ALTER TABLE retired_auth_subjects ADD CONSTRAINT retired_auth_subjects_destination_user_id_fkey FOREIGN KEY(destination_user_id) REFERENCES users(id) ON DELETE CASCADE'],
        ['CHECK欠落', 'ALTER TABLE oauth_identity_links DROP CONSTRAINT oauth_identity_links_operation_phase_check'],
        ['NULL許可', 'ALTER TABLE oauth_identity_links ALTER COLUMN operation_phase DROP NOT NULL'],
        ['履歴欠落', "DELETE FROM schema_migrations WHERE filename='051_add_google_link_recovery.sql'"],
        ['既存guard変更', 'ALTER TABLE entity_states DISABLE TRIGGER entity_states_monotonic_revision'],
    ])('%sの場合に認定を拒否する', async (_name, sql) => {
        await withChangedSchema(sql, async runner => { await expect(attestRuntimeSchema(runner)).rejects.toThrow('SCHEMA_UNSUPPORTED'); });
    });
});
