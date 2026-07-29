import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('031 mobile push notification outbox migration', () => {
  it('terminal job と端末別配送を同一トランザクションで一度だけ記録する', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '034_add_mobile_push_notification_outbox.sql'),
      'utf8',
    );
    const normalized = sql.toLowerCase();

    expect(normalized).toContain('alter table mobile_push_tokens');
    expect(normalized).toContain("locale in ('ja', 'en')");
    expect(normalized).toContain('create table if not exists mobile_push_notification_outbox');
    expect(normalized).toContain('unique (generation_job_id)');
    expect(normalized).toContain('create table if not exists mobile_push_notification_deliveries');
    expect(normalized).toContain('unique (outbox_id, push_token_id)');
    expect(normalized).toContain('on delete set null');
    expect(normalized).toContain('create trigger');
    expect(normalized).toContain('after update of status on generation_jobs');
    expect(normalized).toContain("new.status in ('completed', 'failed')");
    expect(normalized).toContain("old.status not in ('completed', 'failed')");
    expect(normalized).toContain('insert into mobile_push_notification_outbox');
    expect(normalized).toContain('insert into mobile_push_notification_deliveries');
    expect(normalized).toContain('from mobile_push_tokens');
    expect(normalized).not.toContain('story_text');
    expect(normalized).not.toContain('dialogue');
    expect(normalized).not.toContain('email');
  });

  it('cancel は通知対象に含めず配送leaseと再試行時刻を保持する', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '034_add_mobile_push_notification_outbox.sql'),
      'utf8',
    );
    const normalized = sql.toLowerCase();

    expect(normalized).not.toContain("new.status in ('completed', 'failed', 'canceled')");
    expect(normalized).toContain('available_at');
    expect(normalized).toContain('locked_at');
    expect(normalized).toContain('lease_token');
    expect(normalized).toContain('attempt_count');
    expect(normalized).toContain("status in ('pending', 'processing', 'sent', 'dead')");
  });
});
