import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
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

  it('旧Mobile migration名は同一内容だけを補完し変更済みmigrationは再適用する', async () => {
    const migrationsDir = await createTempMigrations({
      '024_add_generation_job_cancellation.sql': 'SELECT 24 AS skip_reconciled_cancellation;',
      '027_add_account_deletion_requests.sql': 'SELECT 27 AS skip_same_account;',
      '028_add_page_story_metadata_columns.sql': 'SELECT 28 AS skip_same_pages;',
      '029_add_mobile_store_purchase_ledger.sql': 'SELECT 29 AS skip_same_store;',
      '030_add_generation_job_management.sql': 'SELECT 30 AS reapply_jobs;',
      '031_add_entity_reference_upload_tokens.sql': 'SELECT 31 AS skip_same_uploads;',
      '032_add_episode_export_jobs.sql': 'SELECT 32 AS skip_same_exports;',
      '033_add_mobile_push_token_registry.sql': 'SELECT 33 AS skip_same_tokens;',
      '034_add_mobile_push_notification_outbox.sql': 'SELECT 34 AS skip_same_outbox;',
      '035_add_processing_generation_job_cancellation.sql': 'SELECT 35 AS reapply_cancellation;',
    });
    const db = new FakeMigrationDb([
      '024_add_account_deletion_requests.sql',
      '025_add_page_story_metadata_columns.sql',
      '026_add_mobile_store_purchase_ledger.sql',
      '027_add_generation_job_management.sql',
      '028_add_entity_reference_upload_tokens.sql',
      '029_add_episode_export_jobs.sql',
      '030_add_mobile_push_token_registry.sql',
      '031_add_mobile_push_notification_outbox.sql',
      '032_add_processing_generation_job_cancellation.sql',
    ]);

    const applied = await runPendingMigrations(db, { migrationsDir });

    expect(applied).toEqual([
      '030_add_generation_job_management.sql',
      '035_add_processing_generation_job_cancellation.sql',
    ]);
    expect(db.insertedFilenames).toEqual(
      expect.arrayContaining([
        '024_add_generation_job_cancellation.sql',
        '027_add_account_deletion_requests.sql',
        '028_add_page_story_metadata_columns.sql',
        '029_add_mobile_store_purchase_ledger.sql',
        '031_add_entity_reference_upload_tokens.sql',
        '032_add_episode_export_jobs.sql',
        '033_add_mobile_push_token_registry.sql',
        '034_add_mobile_push_notification_outbox.sql',
      ]),
    );
    expect(db.executedSql.some((sql) => sql.includes('skip_same_'))).toBe(false);
    expect(
      db.executedSql.some((sql) => sql.includes('skip_reconciled_cancellation')),
    ).toBe(false);
    expect(db.executedSql.some((sql) => sql.includes('reapply_jobs'))).toBe(true);
    expect(db.executedSql.some((sql) => sql.includes('reapply_cancellation'))).toBe(true);
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
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_example_name ON example(name) WHERE name <> 'a;b';",
      ].join('\n'),
    });
    const db = new FakeMigrationDb();

    const applied = await runPendingMigrations(db, { migrationsDir });

    expect(applied).toEqual(['001_concurrent_index.sql']);
    expect(db.transactionCalls).toBe(0);
    expect(db.executedSql).toContain(
      [
        '-- lyra:migration no-transaction',
        'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_example ON example(id)',
      ].join('\n'),
    );
    expect(db.executedSql).toContain(
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_example_name ON example(name) WHERE name <> 'a;b'",
    );
    expect(
      db.executedSql.filter((sql) => sql.includes('CONCURRENTLY')).every((sql) => !sql.trim().endsWith(';')),
    ).toBe(true);
    expect(db.insertedFilenames).toEqual(['001_concurrent_index.sql']);
  });

  it('CONCURRENTLY を使う migration は no-transaction 指定を持つ', async () => {
    const migrationDir = join(process.cwd(), 'migrations');
    const filenames = (await readdir(migrationDir)).filter((filename) => filename.endsWith('.sql'));

    for (const filename of filenames) {
      const sql = await readFile(join(migrationDir, filename), 'utf8');
      if (!sql.includes('CONCURRENTLY')) {
        continue;
      }

      expect(
        sql
          .split('\n')
          .slice(0, 5)
          .some((line) => line.trim() === '-- lyra:migration no-transaction'),
        `${filename} uses CONCURRENTLY and must opt out of transaction wrapping`,
      ).toBe(true);
    }
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

  it('episode story autofill job type is allowed by the updated DB constraint', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '015_add_episode_story_autofill_job_type.sql'),
      'utf8',
    );

    expect(sql).toContain(
      "CHECK (job_type IN ('page_generate', 'entity_generate', 'episode_story_autofill'))",
    );
    expect(sql).toContain('VALIDATE CONSTRAINT generation_jobs_job_type_check');
  });

  it('generation_jobs の active resource lock は同一ページ・同一キャラの二重生成を防ぐ', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '003_add_generation_active_resource_locks.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_jobs_active_page_resource');
    expect(sql).toContain("ON generation_jobs ((params->>'page_id'))");
    expect(sql).toContain("WHERE job_type = 'page_generate'");
    expect(sql).toContain("AND status IN ('queued', 'processing')");
    expect(sql).toContain("AND params ? 'page_id'");
    expect(sql).toContain('CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_jobs_active_entity_resource');
    expect(sql).toContain("ON generation_jobs ((params->>'entity_id'))");
    expect(sql).toContain("WHERE job_type = 'entity_generate'");
    expect(sql).toContain("AND params ? 'entity_id'");
  });

  it('episode story autofill active resource lock prevents duplicate active jobs', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '016_add_episode_story_autofill_active_lock.sql'),
      'utf8',
    );

    expect(sql).toContain('-- lyra:migration no-transaction');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_jobs_active_episode_story_autofill_resource',
    );
    expect(sql).toContain("ON generation_jobs ((params->>'episode_id'))");
    expect(sql).toContain("WHERE job_type = 'episode_story_autofill'");
    expect(sql).toContain("AND status IN ('queued', 'processing')");
    expect(sql).toContain("AND params ? 'episode_id'");
  });

  it('episode page skeleton job type and active resource lock are declared', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '017_add_episode_page_skeleton_job_type.sql'),
      'utf8',
    );

    expect(sql).toContain('-- lyra:migration no-transaction');
    expect(sql).toContain(
      "CHECK (job_type IN ('page_generate', 'entity_generate', 'episode_story_autofill', 'episode_page_skeleton'))",
    );
    expect(sql).toContain('VALIDATE CONSTRAINT generation_jobs_job_type_check');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_generation_jobs_active_episode_page_skeleton_resource',
    );
    expect(sql).toContain("ON generation_jobs ((params->>'episode_id'))");
    expect(sql).toContain("WHERE job_type = 'episode_page_skeleton'");
    expect(sql).toContain("AND status IN ('queued', 'processing')");
    expect(sql).toContain("AND params ? 'episode_id'");
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

  it('Stripe webhook と payment record はDB unique indexで冪等化する', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '005_add_billing_idempotency_indexes.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_ledger_stripe_event_unique');
    expect(sql).toContain('ON credit_ledger(stripe_event_id)');
    expect(sql).toContain('WHERE stripe_event_id IS NOT NULL');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_records_checkout_session_kind_status_unique',
    );
    expect(sql).toContain('ON payment_records(stripe_checkout_session_id, kind, status)');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_records_invoice_kind_status_unique',
    );
    expect(sql).toContain('ON payment_records(stripe_invoice_id, kind, status)');
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

  it('subscriptions の状態値はDB制約でStripe契約に揃える', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '013_add_subscription_status_constraint.sql'),
      'utf8',
    );

    expect(sql).toContain("'active'");
    expect(sql).toContain("'incomplete_expired'");
    expect(sql).toContain("'paused'");
    expect(sql).toContain("'unpaid'");
    expect(sql).toContain('VALIDATE CONSTRAINT subscriptions_status_check');
  });

  it('payment record はcheckout sessionかinvoiceの片方だけに紐づく', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '014_add_payment_record_external_id_constraint.sql'),
      'utf8',
    );

    expect(sql).toContain('(stripe_checkout_session_id IS NULL) <> (stripe_invoice_id IS NULL)');
    expect(sql).toContain('VALIDATE CONSTRAINT payment_records_exactly_one_external_id_check');
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

  it('account deletion request has resumable checkpoints', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '027_add_account_deletion_requests.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE account_deletion_requests');
    expect(sql).toContain("CHECK (status IN ('blocked', 'processing', 'pending_external_action', 'completed'))");
    expect(sql).toContain('cancelled_subscription_ids text[]');
    expect(sql).toContain('identity_disabled_at timestamptz');
    expect(sql).toContain('identity_deleted_at timestamptz');
    expect(sql).toContain('scheduled_asset_keys text[]');
    expect(sql).toContain('data_anonymized_at timestamptz');
  });

  it('ジョブ管理 migration は取消状態、論理非表示、遅延消費の返金ガードを定義する', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '030_add_generation_job_management.sql'),
      'utf8',
    );

    expect(sql).toContain("CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled'))");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS generation_job_history_hides');
    expect(sql).toContain('PRIMARY KEY (generation_job_id, user_id)');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION refund_late_canceled_generation_job_consume()');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('CREATE TRIGGER generation_job_late_consume_refund');
  });

  it('entity reference upload token は期限・MIME・size・single-use をDB制約で持つ', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '031_add_entity_reference_upload_tokens.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE TABLE entity_reference_upload_tokens');
    expect(sql).toContain('token_hash TEXT NOT NULL UNIQUE');
    expect(sql).toContain("purpose IN ('entity_reference_import')");
    expect(sql).toContain("mime_type IN ('image/jpeg', 'image/png', 'image/webp')");
    expect(sql).toContain('size_bytes > 0 AND size_bytes <= 5242880');
    expect(sql).toContain("s3_key LIKE 'tmp/%'");
    expect(sql).toContain('WHERE consumed_at IS NULL');
  });

  it('episode export jobs persist bounded artifacts and a durable dispatch outbox', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '032_add_episode_export_jobs.sql'),
      'utf8',
    );
    expect(sql).toContain('CREATE TABLE export_jobs');
    expect(sql).toContain("format IN ('pdf', 'zip')");
    expect(sql).toContain("status IN ('queued', 'processing', 'completed', 'failed', 'canceled')");
    expect(sql).toContain('cardinality(page_ids) BETWEEN 1 AND 100');
    expect(sql).toContain('CREATE UNIQUE INDEX idx_export_jobs_idempotency_scope');
    expect(sql).toContain('CREATE TABLE export_job_outbox');
    expect(sql).toContain('WHERE dispatched_at IS NULL');
    expect(sql).toContain('artifact_deleted_at TIMESTAMPTZ');
  });

  it('旧クレジット消費行は一意に特定できるjob_idだけを補完する', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '026_backfill_legacy_credit_consume_job_links.sql'),
      'utf8',
    );

    expect(sql).toContain("generation_jobs.job_type IN ('page_generate', 'entity_generate')");
    expect(sql).toContain("generation_jobs.status IN ('failed', 'cancelled')");
    expect(sql).toContain('WITH verified_pairs (ledger_id, job_id) AS');
    expect(sql.match(/'[-0-9a-f]{36}'::uuid, '[-0-9a-f]{36}'::uuid/giu)).toHaveLength(12);
    expect(sql).toContain("consume_ledger.type = 'consume'");
    expect(sql).toContain('consume_ledger.job_id IS NULL');
    expect(sql).toContain('consume_ledger.amount = -generation_jobs.credit_cost');
    expect(sql).toContain('consume_ledger.organization_id = generation_jobs.organization_id');
    expect(sql).toContain('consume_ledger.user_id = generation_jobs.user_id');
    expect(sql).toContain('refund_ledger.amount = generation_jobs.credit_cost');
    expect(sql).toContain('SET job_id = verified_pairs.job_id');
    expect(sql).not.toContain('created_at BETWEEN');
    expect(sql).not.toContain("INTERVAL '5 seconds'");
    expect(sql).not.toMatch(/SET\s+(?:\w+\.)?amount\b/iu);
    expect(sql).not.toContain('UPDATE credit_balances');
    expect(sql).not.toContain('UPDATE organization_credit_balances');
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/iu);
  });
});
