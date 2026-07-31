import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('episode export processing lease migration 036', () => {
  it('適用済み032を変更せずlease・attempt・heartbeatを加算する', async () => {
    const sql = await readFile(
      join(process.cwd(), 'migrations', '036_add_episode_export_processing_lease.sql'),
      'utf8',
    );

    expect(sql).toContain('ALTER TABLE episode_export_jobs');
    expect(sql).toContain('ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('ADD COLUMN processing_lease_token UUID');
    expect(sql).toContain('ADD COLUMN processing_lease_expires_at TIMESTAMPTZ');
    expect(sql).toContain('ADD COLUMN last_heartbeat_at TIMESTAMPTZ');
    expect(sql).toContain('episode_export_jobs_processing_lease_check');
    expect(sql).toContain('attempt_count BETWEEN 0 AND 100');
    expect(sql).toContain("status = 'processing'");
    expect(sql).toContain('processing_lease_expires_at > last_heartbeat_at');
    expect(sql).toContain("INTERVAL '30 minutes'");
    expect(sql).toContain('NOT VALID');
    expect(sql).toContain('CREATE INDEX idx_episode_export_jobs_expired_processing_lease');
    expect(sql).not.toContain('UPDATE episode_export_jobs');
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('DROP COLUMN');
  });
});
