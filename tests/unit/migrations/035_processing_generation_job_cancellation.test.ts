import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('035 processing generation-job cancellation migration', () => {
  it('stores only server-derived processing cancellation metadata and indexes pending checkpoints', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '035_add_processing_generation_job_cancellation.sql'),
      'utf8',
    );
    const normalized = sql.toLowerCase();

    expect(normalized).toContain('add column if not exists cancel_requested_at timestamptz');
    expect(normalized).toContain('add column if not exists cancel_requested_by uuid');
    expect(normalized).toContain('references users(id)');
    expect(normalized).toContain('idx_generation_jobs_processing_cancellation_requested');
    expect(normalized).toContain("where status = 'processing'");
    expect(normalized).toContain('cancel_requested_at is not null');
  });
});
