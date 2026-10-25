import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { attestRuntimeSchema, type RuntimeSchemaCatalog } from '../../../src/lib/runtimeSchemaAttestation.js';

const filename = '051_add_google_link_recovery.sql';
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
function fixture(profile: 'canonical' | 'expanded', recovery = true): RuntimeSchemaCatalog {
    const catalog = JSON.parse(readFileSync(join(process.cwd(), `tests/fixtures/work-deletion-pg18/${profile}-catalog.json`), 'utf8')) as RuntimeSchemaCatalog;
    if (!recovery) return catalog;
    catalog.migrationFilenames.push(filename);
    catalog.relations.push({ name: 'retired_auth_subjects', kind: 'r', rowSecurity: false, forceRowSecurity: false });
    for (const [relation, name, type, nullable, expression] of [
        ['retired_auth_subjects', 'subject_key', 'text', false, null],
        ['retired_auth_subjects', 'destination_user_id', 'uuid', false, null],
        ['retired_auth_subjects', 'created_at', 'timestamp with time zone', false, 'now()'],
        ['oauth_identity_links', 'operation_phase', 'text', false, "'attempted'::text"],
        ['oauth_identity_links', 'source_subject_key', 'text', true, null],
    ] as const) catalog.columns.push({ relation, name, type, nullable, defaultExpressionSha256: expression === null ? null : hash(expression), identityGeneration: null, generatedExpressionSha256: null });
    for (const [relation, name, type, definition] of [
        ['retired_auth_subjects', 'retired_auth_subjects_pkey', 'p', 'PRIMARY KEY (subject_key)'],
        ['retired_auth_subjects', 'retired_auth_subjects_subject_key_check', 'c', 'CHECK (char_length(subject_key) = 43)'],
        ['retired_auth_subjects', 'retired_auth_subjects_destination_user_id_fkey', 'f', 'FOREIGN KEY (destination_user_id) REFERENCES users(id) ON DELETE RESTRICT'],
        ['retired_auth_subjects', 'retired_auth_subjects_subject_key_not_null', 'n', 'NOT NULL subject_key'],
        ['retired_auth_subjects', 'retired_auth_subjects_destination_user_id_not_null', 'n', 'NOT NULL destination_user_id'],
        ['retired_auth_subjects', 'retired_auth_subjects_created_at_not_null', 'n', 'NOT NULL created_at'],
        ['oauth_identity_links', 'oauth_identity_links_operation_phase_not_null', 'n', 'NOT NULL operation_phase'],
        ['oauth_identity_links', 'oauth_identity_links_operation_phase_check', 'c', "CHECK (operation_phase = ANY (ARRAY['ready'::text, 'attempted'::text, 'rejected'::text, 'linked'::text]))"],
        ['oauth_identity_links', 'oauth_identity_links_source_subject_key_check', 'c', 'CHECK (source_subject_key IS NULL OR char_length(source_subject_key) = 43)'],
    ] as const) catalog.constraints.push({ relation, name, type, validated: true, definitionSha256: hash(definition) });
    catalog.indexes.push({ relation: 'retired_auth_subjects', name: 'retired_auth_subjects_pkey', unique: true, valid: true, definitionSha256: hash('[["subject_key"], ""]') });
    return catalog;
}
function database(catalog: RuntimeSchemaCatalog): TransactionRunner {
    const client: DatabaseClient = { query: async <T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> => {
        let rows: unknown[];
        if (sql === 'SET TRANSACTION READ ONLY') rows = [];
        else if (sql.includes("current_setting('server_version_num')")) rows = [{ serverVersionNum: '180003' }];
        else if (sql.includes('FROM pg_class relation')) rows = catalog.relations;
        else if (sql.includes('FROM information_schema.columns')) rows = catalog.columns;
        else if (sql.includes('FROM pg_constraint schema_constraint')) rows = catalog.constraints;
        else if (sql.includes('FROM pg_index schema_index')) rows = catalog.indexes;
        else if (sql.includes('FROM pg_trigger schema_trigger')) rows = catalog.triggers;
        else if (sql.includes('SELECT artifact.kind')) rows = catalog.namespaceArtifacts;
        else if (sql.includes('procedure.prosrc')) rows = catalog.functions ?? [];
        else if (sql.includes('SELECT filename FROM schema_migrations')) rows = catalog.migrationFilenames.map(filename => ({ filename }));
        else throw new Error('Unexpected catalog query');
        return { rows: rows as T[], rowCount: rows.length, command: 'SELECT', fields: [], oid: 0 };
    } };
    return { transaction: work => work(client) };
}
// Spec 4/11: only proven additive 051 structures may be projected away; the
// existing canonical and frozen expanded baseline must still pass unchanged.
for (const profile of ['canonical', 'expanded'] as const) describe(`Google recovery schema ${profile}`, () => {
    it('051より前のcatalogは復旧capabilityを与えず従来通り認定する', async () => {
        const runtime = await attestRuntimeSchema(database(fixture(profile, false)));
        expect(runtime.capabilities.googleIdentityRecovery ?? false).toBe(false);
    });
    it('051の履歴と全追加構造を確認できた場合にだけ復旧capabilityを与える', async () => {
        const runtime = await attestRuntimeSchema(database(fixture(profile)));
        expect(runtime.repositoryProfile).toBe(profile === 'canonical' ? 'canonical' : 'production44_expanded_pg18_v1');
        expect(runtime.capabilities.googleIdentityRecovery).toBe(true);
    });
    it.each([
        ['table欠落', (c: RuntimeSchemaCatalog): void => { c.relations = c.relations.filter(r => r.name !== 'retired_auth_subjects'); }],
        ['列欠落', (c: RuntimeSchemaCatalog): void => { c.columns = c.columns.filter(r => r.name !== 'operation_phase'); }],
        ['default変更', (c: RuntimeSchemaCatalog): void => { c.columns.find(r => r.name === 'operation_phase')!.defaultExpressionSha256 = hash("'ready'::text"); }],
        ['NULL許可', (c: RuntimeSchemaCatalog): void => { c.columns.find(r => r.name === 'operation_phase')!.nullable = true; }],
        ['FK変更', (c: RuntimeSchemaCatalog): void => { c.constraints.find(r => r.name === 'retired_auth_subjects_destination_user_id_fkey')!.definitionSha256 = hash('cascade'); }],
        ['CHECK未検証', (c: RuntimeSchemaCatalog): void => { c.constraints.find(r => r.name === 'oauth_identity_links_operation_phase_check')!.validated = false; }],
        ['NOT NULL欠落', (c: RuntimeSchemaCatalog): void => { c.constraints = c.constraints.filter(r => r.name !== 'retired_auth_subjects_subject_key_not_null'); }],
        ['PK無効', (c: RuntimeSchemaCatalog): void => { c.indexes.find(r => r.name === 'retired_auth_subjects_pkey')!.valid = false; }],
        ['RLS有効', (c: RuntimeSchemaCatalog): void => { c.relations.find(r => r.name === 'retired_auth_subjects')!.rowSecurity = true; }],
        ['未知の追加列', (c: RuntimeSchemaCatalog): void => { c.columns.push({ relation: 'retired_auth_subjects', name: 'unknown', type: 'text', nullable: true }); }],
        ['未知の追加trigger', (c: RuntimeSchemaCatalog): void => { c.triggers.push({ relation: 'retired_auth_subjects', name: 'unexpected', functionName: 'unexpected', enabled: 'O', definitionSha256: hash('unexpected') }); }],
        ['履歴欠落', (c: RuntimeSchemaCatalog): void => { c.migrationFilenames = c.migrationFilenames.filter(f => f !== filename); }],
        ['既存guard改変', (c: RuntimeSchemaCatalog): void => { c.triggers.find(r => r.name === 'entity_states_monotonic_revision')!.definitionSha256 = hash('changed'); }],
    ] as const)('%sの場合に認定を拒否する', async (_label, mutate) => {
        const catalog = fixture(profile); mutate(catalog);
        await expect(attestRuntimeSchema(database(catalog))).rejects.toThrow('SCHEMA_UNSUPPORTED');
    });
});
