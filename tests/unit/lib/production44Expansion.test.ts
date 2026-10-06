import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuntimeSchemaCatalog } from '../../../src/lib/runtimeSchemaAttestation.js';
import { describeProduction44ExpansionCheckpoint } from '../../../src/lib/production44ExpandedRuntimeSchemaAttestation.js';
import { PRODUCTION44_EXPANSION_MIGRATIONS } from '../../../src/lib/production44ExpandedRuntimeSchemaDescriptor.js';
import { runProduction44Expansion } from '../../../src/lib/migrations.js';

describe('actual44 expansion exact checkpoints', () => {
  it('immutable44は開始点としてのみ認識し046を含まない8追加だけを列挙する', async () => {
    const catalog = JSON.parse(await readFile(join(process.cwd(), 'tests/fixtures/production44-pg18/catalog.json'), 'utf8')) as RuntimeSchemaCatalog;
    expect(describeProduction44ExpansionCheckpoint(catalog)).toBe(0);
    expect(PRODUCTION44_EXPANSION_MIGRATIONS).toHaveLength(8);
    expect(PRODUCTION44_EXPANSION_MIGRATIONS.some(item => item.filename.startsWith('046'))).toBe(false);
    catalog.functions![0]!.bodySha256 = '0'.repeat(64);
    expect(describeProduction44ExpansionCheckpoint(catalog)).toBeNull();
  });
  it('expanded最終catalogは8であり列・関数・履歴の変更は全て拒否する', async () => {
    const catalog = JSON.parse(await readFile(join(process.cwd(), 'tests/fixtures/production44-expanded-pg18/catalog.json'), 'utf8')) as RuntimeSchemaCatalog;
    expect(describeProduction44ExpansionCheckpoint(catalog)).toBe(8);
    for (const part of ['relations', 'namespaceArtifacts', 'columns', 'constraints', 'indexes', 'triggers', 'functions', 'migrationFilenames'] as const) {
      const changed = structuredClone(catalog);
      changed[part]!.pop();
      expect(describeProduction44ExpansionCheckpoint(changed)).toBeNull();
    }
  });
  it('明示migration directoryが存在しなければconnection取得より前に拒否する', async () => {
    let connections = 0;
    await expect(runProduction44Expansion({ connect: async () => { connections++; throw new Error('unexpected'); } }, { migrationsDir: 'missing-expansion-files' })).rejects.toThrow('MIGRATION_FILE_MISMATCH');
    expect(connections).toBe(0);
  });
});
