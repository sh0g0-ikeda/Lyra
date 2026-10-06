import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import ts from 'typescript';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import type { RuntimeSchemaCatalog } from '../../../src/lib/runtimeSchemaAttestation.js';
import { describeRuntimeSchema, startAttestedCanonicalRuntime } from '../../../src/lib/runtimeSchemaAttestation.js';
import { attestProduction44RuntimeSchema, describeProduction44RuntimeSchema } from '../../../src/lib/production44RuntimeSchemaAttestation.js';

// Spec 11 C0: exact attestation is evidence for a finite adapter, not startup activation.
const fixture = join(process.cwd(), 'tests/fixtures/production44-pg18');
function catalog(): RuntimeSchemaCatalog { return JSON.parse(readFileSync(join(fixture, 'catalog.json'), 'utf8')) as RuntimeSchemaCatalog; }

describe('実44 PG18 schemaの有限候補判定', () => {
  it('実44の完全catalogに一致してもcanonical startupの許可にはならない', () => {
    expect(describeProduction44RuntimeSchema(catalog())).toEqual({ kind: 'production44_pg18_v1', failures: [] });
    expect(describeRuntimeSchema(catalog()).kind).toBe('unsupported');
  });
  it('候補descriptorを既存bootstrapへ渡してもwriterを開始しない', async () => {
    let started = false;
    await expect(startAttestedCanonicalRuntime({
      attest: async () => 'production44_pg18_v1' as 'canonical_fresh_v1',
      start: async () => { started = true; },
    })).rejects.toThrow();
    expect(started).toBe(false);
  });
  it('SQL fixtureの44ファイルが観測再構築manifestの内容と順序に一致する', () => {
    const manifest = JSON.parse(readFileSync(join(fixture, 'manifest.json'), 'utf8')) as { migrations: Array<{ filename: string; sha256: string }> };
    expect(manifest.migrations.map(x => x.filename)).toEqual(catalog().migrationFilenames);
    expect(manifest.migrations).toHaveLength(44);
    for (const entry of manifest.migrations) expect(createHash('sha256').update(readFileSync(join(fixture, entry.filename))).digest('hex')).toBe(entry.sha256);
  });
  it('旧writer fixtureは固定source hashと再生成可能な限定依存closureを保持する', () => {
    const root = join(fixture, 'old-runtime');
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
      sourceCommit: string; fullSourceOrDependencyIdentityProven: boolean;
      files: Array<{ file: string; sourcePath: string; runtimePath: string; sourceSha256: string; runtimeSha256: string; selectedImageTokenIdentityRoles: string[] }>;
    };
    expect(manifest.sourceCommit).toBe('2debe8c3c22633ed077e7b189ddcfa8b209a00dc');
    expect(manifest.fullSourceOrDependencyIdentityProven).toBe(false);
    expect(manifest.files).toHaveLength(15);
    expect(manifest.files.filter(file => file.selectedImageTokenIdentityRoles.length === 2)).toHaveLength(5);
    for (const entry of manifest.files) {
      const source = readFileSync(join(root, entry.sourcePath));
      const runtime = readFileSync(join(root, entry.runtimePath));
      expect(createHash('sha256').update(source).digest('hex')).toBe(entry.sourceSha256);
      expect(createHash('sha256').update(runtime).digest('hex')).toBe(entry.runtimeSha256);
      const generated = ts.transpileModule(source.toString('utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext },
        fileName: entry.file.replace(/\.ts$/u, '.mts'),
      });
      expect(generated.outputText).toBe(runtime.toString('utf8'));
    }
  });
  const parts = ['migrationFilenames', 'relations', 'namespaceArtifacts', 'columns', 'constraints', 'indexes', 'triggers', 'functions'] as const;
  it.each(parts)('%sの欠落・追加・属性変更を全て拒否する', part => {
    for (const mode of ['missing', 'extra', 'changed'] as const) {
      const value = catalog();
      const rows: unknown[] = value[part]!;
      if (mode === 'missing') rows.pop();
      if (mode === 'extra') rows.push(structuredClone(rows[0]));
      if (mode === 'changed') rows[0] = typeof rows[0] === 'string' ? 'unknown.sql' : { ...rows[0] as object, changed: true };
      expect(describeProduction44RuntimeSchema(value)).toEqual({ kind: 'unsupported', failures: ['PRODUCTION44_' + part.toUpperCase() + '_MISMATCH'] });
    }
  });
  it('driverのrow順序が異なる場合も同じcatalogを受け入れる', () => {
    const value = catalog();
    for (const part of parts) value[part]?.reverse();
    expect(describeProduction44RuntimeSchema(value).kind).toBe('production44_pg18_v1');
  });
  it('全定義を同一read-only transactionで取得しschema/行を変更しない', async () => {
    const queries: string[] = [];
    expect(await attestProduction44RuntimeSchema(database(catalog(), queries))).toBe('production44_pg18_v1');
    expect(queries[0]).toBe('SET TRANSACTION READ ONLY');
    expect(queries.join('\n')).toContain('procedure.prosrc');
    expect(queries.join('\n')).toContain('column_default');
    expect(queries.join('\n')).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/u);
  });
  it('接続失敗は秘密を含まない固定エラーとして拒否する', async () => {
    const failing: TransactionRunner = { transaction: async () => { throw new Error('private connection details'); } };
    await expect(attestProduction44RuntimeSchema(failing)).rejects.toThrow('Runtime production44 schema attestation failed: SCHEMA_QUERY_FAILED');
  });
  it('照合不一致はprofileを返さない', async () => {
    const value = catalog(); value.functions = [];
    await expect(attestProduction44RuntimeSchema(database(value, []))).rejects.toThrow('SCHEMA_UNSUPPORTED');
  });
});

function database(value: RuntimeSchemaCatalog, queries: string[]): TransactionRunner {
  return { transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => work({
    query: async <R extends QueryResultRow>(sql: string): Promise<QueryResult<R>> => {
      queries.push(sql);
      let rows: unknown[];
      if (sql === 'SET TRANSACTION READ ONLY') rows = [];
      else if (sql.includes('FROM pg_class relation')) rows = value.relations;
      else if (sql.includes('FROM information_schema.columns')) rows = value.columns;
      else if (sql.includes('FROM pg_constraint schema_constraint')) rows = value.constraints;
      else if (sql.includes('FROM pg_index schema_index')) rows = value.indexes;
      else if (sql.includes('FROM pg_trigger schema_trigger')) rows = value.triggers;
      else if (sql.includes('SELECT artifact.kind')) rows = value.namespaceArtifacts;
      else if (sql.includes('procedure.prosrc')) rows = value.functions ?? [];
      else if (sql.includes('SELECT filename FROM schema_migrations')) rows = value.migrationFilenames.map(filename => ({ filename }));
      else throw new Error('Unexpected catalog query');
      return { rows: rows as R[], rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
    },
  }) };
}
