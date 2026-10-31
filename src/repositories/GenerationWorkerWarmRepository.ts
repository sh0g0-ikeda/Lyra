import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import type { GenerationWorkerWarmRepository, LockedWorkerWarmState } from '../services/generation/GenerationWorkerWarmService.js';

interface WarmRow { lease_until: Date | null; last_applied_floor: 0 | 1 | null; now: Date }

export class PostgresGenerationWorkerWarmRepository implements GenerationWorkerWarmRepository {
  public constructor(private readonly database: TransactionRunner) {}

  public async withLock<T>(resourceId: string, work: (state: LockedWorkerWarmState) => Promise<T>): Promise<T> {
    return this.database.transaction(async (client) => {
      // Advisory lock covers the first INSERT too. The bounded AWS call remains
      // under this lock so another replica cannot apply an older stop decision.
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`generation-worker-warm:${resourceId}`]);
      await client.query('INSERT INTO generation_worker_warm_controls (resource_id) VALUES ($1) ON CONFLICT DO NOTHING', [resourceId]);
      const result = await client.query<WarmRow>(
        'SELECT lease_until, last_applied_floor, clock_timestamp() AS now FROM generation_worker_warm_controls WHERE resource_id = $1 FOR UPDATE', [resourceId],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('Generation worker warm control unavailable');
      const state: LockedWorkerWarmState = {
        now: row.now,
        leaseUntil: row.lease_until,
        lastAppliedFloor: row.last_applied_floor,
        hasActiveJobs: () => this.hasActiveJobs(client),
        extendLease: async (seconds) => {
          const updated = await client.query<{ lease_until: Date }>(
            'UPDATE generation_worker_warm_controls SET lease_until = GREATEST(COALESCE(lease_until, clock_timestamp()), clock_timestamp() + $2::int * interval \'1 second\'), updated_at = clock_timestamp() WHERE resource_id = $1 RETURNING lease_until',
            [resourceId, seconds],
          );
          state.leaseUntil = updated.rows[0]?.lease_until ?? state.leaseUntil;
        },
        recordAppliedFloor: async (floor) => {
          await client.query('UPDATE generation_worker_warm_controls SET last_applied_floor = $2, updated_at = clock_timestamp() WHERE resource_id = $1', [resourceId, floor]);
        },
      };
      return work(state);
    });
  }

  private async hasActiveJobs(client: DatabaseClient): Promise<boolean> {
    const result = await client.query<{ active: boolean }>(
      // Capacity is shared by every generation job, including import analysis.
      "SELECT EXISTS (SELECT 1 FROM generation_jobs WHERE status IN ('queued', 'processing')) AS active",
    );
    return result.rows[0]?.active ?? true;
  }
}
