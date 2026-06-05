import type { QueryResultRow } from 'pg';
import type { PageStatus } from '../domain/types/page.js';
import type { PageGenerationMode } from '../domain/types/pageGeneration.js';
import type { DatabaseClient } from '../lib/db.js';

export interface StalePageGenerationJob {
  jobId: string;
  userId: string;
  creditCost: number;
  pageId: string;
  previousStatus: PageStatus;
  previousGenerationMode: PageGenerationMode | null;
  startedAt: Date;
}

export interface PageGenerationRecoveryRepository {
  listStaleProcessingJobs(cutoff: Date): Promise<StalePageGenerationJob[]>;
  listStaleProcessingJobsForPage(
    userId: string,
    pageId: string,
    cutoff: Date,
  ): Promise<StalePageGenerationJob[]>;
}

interface StalePageGenerationJobRow extends QueryResultRow {
  job_id: string;
  user_id: string;
  credit_cost: number;
  page_id: string;
  previous_page_status: string | null;
  previous_generation_mode: string | null;
  started_at: Date;
}

export class PostgresPageGenerationRecoveryRepository
  implements PageGenerationRecoveryRepository
{
  public constructor(private readonly client: DatabaseClient) {}

  public async listStaleProcessingJobs(cutoff: Date): Promise<StalePageGenerationJob[]> {
    const result = await this.client.query<StalePageGenerationJobRow>(
      buildBaseQuery(),
      [cutoff],
    );

    return result.rows.flatMap(mapStalePageGenerationJobRow);
  }

  public async listStaleProcessingJobsForPage(
    userId: string,
    pageId: string,
    cutoff: Date,
  ): Promise<StalePageGenerationJob[]> {
    const result = await this.client.query<StalePageGenerationJobRow>(
      `${buildBaseQuery()}
         AND generation_jobs.user_id = $2
         AND generation_jobs.params->>'page_id' = $3
      `,
      [cutoff, userId, pageId],
    );

    return result.rows.flatMap(mapStalePageGenerationJobRow);
  }
}

function buildBaseQuery(): string {
  return `
      SELECT
        generation_jobs.id AS job_id,
        generation_jobs.user_id,
        generation_jobs.credit_cost,
        generation_jobs.params->>'page_id' AS page_id,
        generation_jobs.params->>'previous_page_status' AS previous_page_status,
        generation_jobs.params->>'previous_generation_mode' AS previous_generation_mode,
        generation_jobs.started_at
      FROM generation_jobs
      WHERE generation_jobs.job_type = 'page_generate'
        AND generation_jobs.status = 'processing'
        AND generation_jobs.started_at IS NOT NULL
        AND generation_jobs.started_at < $1
    `;
}

function mapStalePageGenerationJobRow(row: StalePageGenerationJobRow): StalePageGenerationJob[] {
  const previousStatus = toPageStatus(row.previous_page_status);
  if (row.page_id.length === 0 || previousStatus === null) {
    return [];
  }

  return [
    {
      jobId: row.job_id,
      userId: row.user_id,
      creditCost: row.credit_cost,
      pageId: row.page_id,
      previousStatus,
      previousGenerationMode: toPageGenerationMode(row.previous_generation_mode),
      startedAt: row.started_at,
    },
  ];
}

function toPageStatus(value: string | null): PageStatus | null {
  return value === 'designing' ||
    value === 'generating' ||
    value === 'generated' ||
    value === 'editing' ||
    value === 'confirmed'
    ? value
    : null;
}

function toPageGenerationMode(value: string | null): PageGenerationMode | null {
  return value === 'standard' || value === 'thinking' ? value : null;
}
