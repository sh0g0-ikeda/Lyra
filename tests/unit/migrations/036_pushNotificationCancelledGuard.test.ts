import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('036 push notification cancelled guard migration', () => {
  it('適用済みoutbox関数をforward-onlyで置換しcancelled jobを除外する', async () => {
    const sql = await readFile(
      join(
        process.cwd(),
        'migrations',
        '036_fix_push_notification_cancelled_guard.sql',
      ),
      'utf8',
    );
    const normalized = sql.toLowerCase();

    expect(normalized).toContain(
      'create or replace function enqueue_mobile_push_notification_for_terminal_job()',
    );
    expect(normalized).toContain("old.status <> 'cancelled'");
    expect(normalized).not.toContain("old.status <> 'canceled'");
    expect(normalized).toContain(
      'insert into mobile_push_notification_outbox',
    );
    expect(normalized).toContain(
      'insert into mobile_push_notification_deliveries',
    );
    expect(normalized).not.toContain('drop table');
    expect(normalized).not.toContain('delete from');
  });
});
