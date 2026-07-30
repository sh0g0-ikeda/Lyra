import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('generation job management migration 030', () => {
  it('履歴非表示のuser/job境界と一覧indexだけを加算的に追加する', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '030_add_generation_job_management.sql'),
      'utf8',
    );
    const normalized = sql.toLowerCase();

    expect(normalized).toContain('-- lyra:migration no-transaction');
    expect(normalized).toContain('create table if not exists generation_job_history_hides');
    expect(normalized).toContain('generation_job_id uuid not null references generation_jobs(id) on delete cascade');
    expect(normalized).toContain('user_id uuid not null references users(id) on delete cascade');
    expect(normalized).toContain('primary key (generation_job_id, user_id)');
    expect(normalized).toContain('create index concurrently idx_generation_job_history_hides_user_job');
    expect(normalized).toContain('create index concurrently idx_generation_jobs_scope_created');
  });

  it('既存キャンセル・返金・status制約の挙動を変更しない', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '030_add_generation_job_management.sql'),
      'utf8',
    );
    const normalized = sql.toLowerCase();

    expect(normalized).not.toContain('create trigger');
    expect(normalized).not.toContain('refund_late_canceled_generation_job_consume');
    expect(normalized).not.toContain('update credit_balances');
    expect(normalized).not.toContain('update organization_credit_balances');
    expect(normalized).not.toContain('credit_ledger_type_check');
    expect(normalized).not.toContain('generation_jobs_status_check');
  });
});
