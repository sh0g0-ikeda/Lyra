import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('generation terminal push outbox connection migration 039', () => {
  it('retryごとのterminal event identityを既存migrationの編集なしで追加する', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '039_connect_generation_terminal_push_outbox.sql'),
      'utf8',
    );

    expect(sql).toContain('ADD COLUMN generation_retry_count INTEGER');
    expect(sql).toContain('mobile_push_notification_outbox_retry_count_check');
    expect(sql).toContain('CHECK (generation_retry_count >= 0)');
    expect(sql).toContain(
      'UNIQUE (generation_job_id, terminal_status, generation_retry_count)',
    );
    expect(sql).toContain("constraint_type = 'UNIQUE'");
    expect(sql).toContain(
      "ARRAY['generation_job_id']::information_schema.sql_identifier[]",
    );
    expect(sql).toMatch(
      /ARRAY\s*\[\s*'generation_job_id',\s*'terminal_status'\s*\]::information_schema\.sql_identifier\[\]/u,
    );
    expect(sql).not.toContain('CREATE TRIGGER');
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION');
  });
});
