import type { QueryResultRow } from 'pg';
import type { DatabaseClient } from '../lib/db.js';

export interface StaleEntityGenerationJob {
  jobId: string;
  userId: string;
  creditCost: number;
  entityId: string;
  staleAt: Date;
}

export interface EntityGenerationRecoveryRepository {
  listStaleProcessingJobs(cutoff: Date): Promise<StaleEntityGenerationJob[]>;
  listStaleProcessingJobsForEntity(
    userId: string,
    entityId: string,
    cutoff: Date,
  ): Promise<StaleEntityGenerationJob[]>;
}

interface StaleEntityGenerationJobRow extends QueryResultRow {
  job_id: string;
  user_id: string;
  credit_cost: number;
  entity_id: string | null;
  stale_at: Date;
}

export class PostgresEntityGenerationRecoveryRepository
  implements EntityGenerationRecoveryRepository
{
  public constructor(private readonly client: DatabaseClient) {}

  public async listStaleProcessingJobs(cutoff: Date): Promise<StaleEntityGenerationJob[]> {
    const result = await this.client.query<StaleEntityGenerationJobRow>(
      buildBaseQuery(),
      [cutoff],
    );

    return result.rows.flatMap(mapStaleEntityGenerationJobRow);
  }

  public async listStaleProcessingJobsForEntity(
    userId: string,
    entityId: string,
    cutoff: Date,
  ): Promise<StaleEntityGenerationJob[]> {
    const result = await this.client.query<StaleEntityGenerationJobRow>(
      `${buildBaseQuery()}
         AND generation_jobs.user_id = $2
         AND generation_jobs.params->>'entity_id' = $3
      `,
      [cutoff, userId, entityId],
    );

    return result.rows.flatMap(mapStaleEntityGenerationJobRow);
  }
}

function buildBaseQuery(): string {
  return `
      SELECT
        generation_jobs.id AS job_id,
        generation_jobs.user_id,
        generation_jobs.credit_cost,
        generation_jobs.params->>'entity_id' AS entity_id,
        COALESCE(generation_jobs.started_at, generation_jobs.created_at) AS stale_at
      FROM generation_jobs
      WHERE generation_jobs.job_type = 'entity_generate'
        AND (
          (
            generation_jobs.status = 'processing'
            AND generation_jobs.started_at IS NOT NULL
            AND generation_jobs.started_at < $1
          )
          OR (
            generation_jobs.status = 'queued'
            AND generation_jobs.created_at < $1
          )
        )
    `;
}

function mapStaleEntityGenerationJobRow(
  row: StaleEntityGenerationJobRow,
): StaleEntityGenerationJob[] {
  if (row.entity_id === null || row.entity_id.length === 0) {
    return [];
  }

  return [
    {
      jobId: row.job_id,
      userId: row.user_id,
      creditCost: row.credit_cost,
      entityId: row.entity_id,
      staleAt: row.stale_at,
    },
  ];
}
