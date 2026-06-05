import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import { runPendingMigrations } from '../../../src/lib/migrations.js';

class FakeMigrationDb {
  public readonly executedSql: string[] = [];
  public readonly insertedFilenames: string[] = [];
  public transactionCalls = 0;
  private readonly appliedFilenames = new Set<string>();

  public constructor(initialApplied: string[] = []) {
    for (const filename of initialApplied) {
      this.appliedFilenames.add(filename);
    }
  }

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.executedSql.push(text);

    if (text.includes('SELECT filename FROM schema_migrations')) {
      return {
        command: 'SELECT',
        rowCount: this.appliedFilenames.size,
        oid: 0,
        fields: [],
        rows: [...this.appliedFilenames].map((filename) => ({ filename })) as unknown as T[],
      };
    }

    if (text.includes('INSERT INTO schema_migrations')) {
      const filename = String(values?.[0]);
      this.appliedFilenames.add(filename);
      this.insertedFilenames.push(filename);
    }

    return {
      command: 'OK',
      rowCount: 0,
      oid: 0,
      fields: [],
      rows: [],
    };
  }

  public async transaction<T>(
    work: (client: {
      query<R extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: readonly unknown[],
      ): Promise<QueryResult<R>>;
    }) => Promise<T>,
  ): Promise<T> {
    this.transactionCalls += 1;
    return work({
      query: async <R extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: readonly unknown[],
      ): Promise<QueryResult<R>> => this.query<R>(text, values),
    });
  }
}

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function createTempMigrations(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lyra-migrations-'));
  const migrationsDir = join(root, 'migrations');
  tempDirs.push(root);
  await mkdir(migrationsDir);

  for (const [filename, sql] of Object.entries(files)) {
    await writeFile(join(migrationsDir, filename), sql, 'utf8');
  }

  return migrationsDir;
}

describe('runPendingMigrations', () => {
  it('applies pending migration files in filename order', async () => {
    const migrationsDir = await createTempMigrations({
      '002_second.sql': 'SELECT 2;',
      '001_first.sql': 'SELECT 1;',
    });
    const db = new FakeMigrationDb();

    const applied = await runPendingMigrations(db, { migrationsDir });

    expect(applied).toEqual(['001_first.sql', '002_second.sql']);
    expect(db.insertedFilenames).toEqual(['001_first.sql', '002_second.sql']);
    expect(db.transactionCalls).toBe(2);
  });

  it('skips already applied migration files', async () => {
    const migrationsDir = await createTempMigrations({
      '001_first.sql': 'SELECT 1;',
      '002_second.sql': 'SELECT 2;',
    });
    const db = new FakeMigrationDb(['001_first.sql']);

    const applied = await runPendingMigrations(db, { migrationsDir });

    expect(applied).toEqual(['002_second.sql']);
    expect(db.insertedFilenames).toEqual(['002_second.sql']);
  });

  it('no-transaction 指定の migration は transaction 外で実行する', async () => {
    const migrationsDir = await createTempMigrations({
      '001_concurrent_index.sql': [
        '-- lyra:migration no-transaction',
        'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_example ON example(id);',
      ].join('\n'),
    });
    const db = new FakeMigrationDb();

    const applied = await runPendingMigrations(db, { migrationsDir });

    expect(applied).toEqual(['001_concurrent_index.sql']);
    expect(db.transactionCalls).toBe(0);
    expect(db.executedSql).toContain(
      [
        '-- lyra:migration no-transaction',
        'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_example ON example(id);',
      ].join('\n'),
    );
    expect(db.insertedFilenames).toEqual(['001_concurrent_index.sql']);
  });
});
