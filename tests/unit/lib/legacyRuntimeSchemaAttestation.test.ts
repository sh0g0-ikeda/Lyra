import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import { ConfigurationError } from '../../../src/domain/errors/index.js';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import type { RuntimeSchemaCatalog } from '../../../src/lib/runtimeSchemaAttestation.js';
import { LEGACY_RUNTIME_SCHEMA_REFERENCE } from '../../../src/lib/legacyRuntimeSchemaDescriptor.js';
import { attestLegacyRuntimeSchema, describeLegacyRuntimeSchema } from '../../../src/lib/legacyRuntimeSchemaAttestation.js';

describe('旧38 schemaのread-only候補判定', () => {
  it('旧38の列・関数本文まで一致する場合にlegacy descriptorを返す', () => {
    expect(describeLegacyRuntimeSchema(legacyCatalog())).toEqual({ kind: 'legacy_2debe_v1', failures: [] });
  });

  const mutations: Array<[string, (catalog: RuntimeSchemaCatalog) => void]> = [
    ['physical metadata欠落', c => { c.columns = c.columns.filter(x => !(x.relation === 'pages' && x.name === 'story_page_purpose')); }],
    ['quote hybrid relation', c => { c.relations.push({ name: 'generation_quotes', kind: 'r' }); }],
    ['late refund trigger欠落', c => { c.triggers = c.triggers.filter(x => x.name !== 'generation_job_late_consume_refund'); }],
    ['同名trigger定義改変', c => { c.triggers[0]!.definitionSha256 = '0'.repeat(64); }],
    ['同名返還function本文改変', c => { c.functions!.find(x => x.name === 'refund_late_canceled_generation_job_consume')!.bodySha256 = '0'.repeat(64); }],
    ['column default属性の改変', c => {
      c.columns.find(x => x.relation === 'users' && x.name === 'id')!.defaultExpressionSha256 = null;
    }],
    ['function volatility属性の改変', c => {
      c.functions!.find(x => x.name === 'refund_late_canceled_generation_job_consume')!.volatility = 'immutable';
    }],
    ['relation RLS属性の改変', c => {
      c.relations.find(x => x.name === 'users')!.rowSecurity = true;
    }],
    ['function権限の改変', c => { c.functions![0]!.securityDefiner = !c.functions![0]!.securityDefiner; }],
    ['function設定の改変', c => { c.functions![0]!.settings = ['search_path=public']; }],
    ['未知migration追加', c => { c.migrationFilenames.push('999_unknown.sql'); }],
  ];
  it.each(mutations)('%sがある場合に旧runtime候補として拒否する', (_label, mutate) => {
    const catalog = legacyCatalog(); mutate(catalog);
    expect(describeLegacyRuntimeSchema(catalog).kind).toBe('unsupported');
  });

  it('旧descriptorの照合は同じREAD ONLY transaction内で行いwriterやmigrationを開始しない', async () => {
    const queries: string[] = [];
    const result = await attestLegacyRuntimeSchema(catalogDatabase(legacyCatalog(), queries));
    expect(result).toBe('legacy_2debe_v1');
    expect(queries[0]).toBe('SET TRANSACTION READ ONLY');
    expect(queries.join('\n')).toContain('procedure.prosrc');
    expect(queries.join('\n')).not.toMatch(/INSERT|UPDATE|DELETE|ALTER|CREATE/u);
  });

  it('照合queryが失敗した場合に秘密を含まない安定したエラーにする', async () => {
    const database: TransactionRunner = {
      transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => work({
        query: async () => { throw new Error('postgres://test:private-password@example.invalid/private'); },
      }),
    };
    let failure: unknown;
    try { await attestLegacyRuntimeSchema(database); } catch (error) { failure = error; }
    expect(failure).toEqual(new ConfigurationError('Runtime legacy schema attestation failed: SCHEMA_QUERY_FAILED'));
  });
});

function legacyCatalog(): RuntimeSchemaCatalog { return structuredClone(LEGACY_RUNTIME_SCHEMA_REFERENCE); }
function catalogDatabase(catalog: RuntimeSchemaCatalog, queries: string[]): TransactionRunner {
  return {
    transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => work({
      query: async <R extends QueryResultRow>(sql: string): Promise<QueryResult<R>> => {
        queries.push(sql);
        let rows: unknown[];
        if (sql === 'SET TRANSACTION READ ONLY') rows = [];
        else if (sql.includes('FROM pg_class relation')) rows = catalog.relations;
        else if (sql.includes('FROM information_schema.columns')) rows = catalog.columns;
        else if (sql.includes('FROM pg_constraint schema_constraint')) rows = catalog.constraints;
        else if (sql.includes('FROM pg_index schema_index')) rows = catalog.indexes;
        else if (sql.includes('FROM pg_trigger schema_trigger')) rows = catalog.triggers;
        else if (sql.includes('SELECT artifact.kind')) rows = catalog.namespaceArtifacts;
        else if (sql.includes('procedure.prosrc')) rows = catalog.functions ?? [];
        else if (sql.includes('SELECT filename FROM schema_migrations')) rows = catalog.migrationFilenames.map(filename => ({ filename }));
        else throw new Error('Unexpected catalog query');
        return { rows: rows as R[], rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
      },
    }),
  };
}
