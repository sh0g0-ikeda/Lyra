import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import { runPendingMigrations } from '../../../src/lib/migrations.js';

class FakeMigrationDb {
  public readonly executedSql: string[] = [];
  public readonly insertedFilenames: string[] = [];
  public transactionCalls = 0;
  public migrationLockAttempts = 0;
  private readonly appliedFilenames = new Set<string>();
  private readonly migrationLockResponses: boolean[];

  public constructor(initialApplied: string[] = [], migrationLockResponses: boolean[] = [true]) {
    this.migrationLockResponses = [...migrationLockResponses];
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

    if (text.includes('SELECT EXISTS(SELECT 1 FROM inserted) AS acquired')) {
      this.migrationLockAttempts += 1;
      const acquired = this.migrationLockResponses.shift() ?? true;
      return {
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [{ acquired }] as unknown as T[],
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
    expect(db.executedSql.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS schema_migration_locks'))).toBe(true);
    expect(db.migrationLockAttempts).toBe(1);
    expect(db.executedSql.at(-1)).toContain('DELETE FROM schema_migration_locks');
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

  it('migration lock が先に取られている場合は再試行する', async () => {
    const migrationsDir = await createTempMigrations({
      '001_first.sql': 'SELECT 1;',
    });
    const db = new FakeMigrationDb([], [false, true]);

    const applied = await runPendingMigrations(db, {
      migrationsDir,
      migrationLockPollMs: 0,
    });

    expect(applied).toEqual(['001_first.sql']);
    expect(db.migrationLockAttempts).toBe(2);
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

  it('generation_jobs の状態列はDB制約で型契約を守る', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '009_add_generation_job_state_constraints.sql'),
      'utf8',
    );

    expect(sql).toContain("CHECK (job_type IN ('page_generate', 'entity_generate'))");
    expect(sql).toContain("CHECK (status IN ('queued', 'processing', 'completed', 'failed'))");
    expect(sql).toContain(
      "CHECK (generation_mode IS NULL OR generation_mode IN ('standard', 'thinking'))",
    );
    expect(sql).toContain('VALIDATE CONSTRAINT generation_jobs_job_type_check');
  });

  it('課金系の種類と状態はDB制約で型契約を守る', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '010_add_billing_state_constraints.sql'),
      'utf8',
    );

    expect(sql).toContain("CHECK (plan_code IN ('free', 'standard', 'premium'))");
    expect(sql).toContain(
      "CHECK (type IN ('signup_bonus', 'monthly_grant', 'purchase', 'consume', 'refund'))",
    );
    expect(sql).toContain("CHECK (kind IN ('subscription', 'credit_purchase'))");
    expect(sql).toContain("CHECK (status IN ('paid', 'failed'))");
    expect(sql).toContain('CHECK (amount_jpy >= 0)');
    expect(sql).toContain('VALIDATE CONSTRAINT credit_ledger_type_check');
  });

  it('credit ledger の金額符号はDB制約で型契約を守る', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '012_add_credit_ledger_amount_sign_constraint.sql'),
      'utf8',
    );

    expect(sql).toContain("(type = 'consume' AND amount < 0)");
    expect(sql).toContain("type IN ('signup_bonus', 'monthly_grant', 'purchase', 'refund')");
    expect(sql).toContain('AND amount > 0');
    expect(sql).toContain('VALIDATE CONSTRAINT credit_ledger_amount_sign_check');
  });

  it('story/page/entity UIパイプラインの状態値はDB制約で型契約を守る', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '011_add_core_app_state_constraints.sql'),
      'utf8',
    );

    expect(sql).toContain("CHECK (status IN ('draft', 'reviewing', 'ready'))");
    expect(sql).toContain("CHECK (status IN ('draft', 'ready'))");
    expect(sql).toContain("CHECK (status IN ('empty', 'partial', 'ready'))");
    expect(sql).toContain(
      "CHECK (status IN ('designing', 'generating', 'generated', 'editing', 'confirmed'))",
    );
    expect(sql).toContain("CHECK (dialogue_mode IN ('image_baked', 'balloon_only', 'mixed'))");
    expect(sql).toContain(
      "CHECK (panel_role IS NULL OR panel_role IN ('establish', 'action', 'reaction', 'emphasis', 'transition', 'pause', 'impact'))",
    );
    expect(sql).toContain(
      "CHECK (balloon_type IN ('speech', 'thought', 'narration', 'shout', 'whisper', 'sfx', 'caption'))",
    );
    expect(sql).toContain('VALIDATE CONSTRAINT pages_status_check');
  });
});
