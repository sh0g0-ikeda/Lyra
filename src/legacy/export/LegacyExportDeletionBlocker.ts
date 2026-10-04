import { ConfigurationError } from '../../domain/errors/index.js';
import type { DatabaseClient } from '../../lib/db.js';

/** Read-only blocker for the legacy export relation. Runtime wiring is intentionally separate. */
export class LegacyExportDeletionBlocker {
  public constructor(private readonly client: DatabaseClient) {}

  public async countActivePersonalJobs(userId: string): Promise<number> {
    await this.client.query(
      `UPDATE export_jobs
       SET status='failed', progress_stage='failed', error_code='EXPORT_EXPIRED',
           error_message='Export expired before processing', completed_at=NOW(), updated_at=NOW()
       WHERE user_id=$1 AND organization_id IS NULL
         AND status='queued' AND expires_at <= NOW()`,
      [userId],
    );
    const result = await this.client.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM export_jobs
      WHERE user_id = $1
        AND organization_id IS NULL
        AND status IN ('queued', 'processing')
      `,
      [userId],
    );
    const count = Number(result.rows[0]?.count);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new ConfigurationError('Legacy export deletion blocker returned an invalid count');
    }
    return count;
  }
}
