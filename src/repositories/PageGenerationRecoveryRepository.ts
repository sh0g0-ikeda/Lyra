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
  staleAt: Date;
}

export interface FailedPageGenerationJobMissingRefund {
  jobId: string;
  userId: string;
  creditCost: number;
  pageId: string;
  completedAt: Date | null;
}

export interface PageGenerationRecoveryRepository {
  listStaleProcessingJobs(cutoff: Date, limit: number): Promise<StalePageGenerationJob[]>;
  listStaleProcessingJobsForPage(
    userId: string,
    pageId: string,
    cutoff: Date,
    limit: number,
  ): Promise<StalePageGenerationJob[]>;
  listFailedJobsMissingRefund(limit: number): Promise<FailedPageGenerationJobMissingRefund[]>;
  listFailedJobsMissingRefundForPage(
    userId: string,
    pageId: string,
    limit: number,
  ): Promise<FailedPageGenerationJobMissingRefund[]>;
}

interface StalePageGenerationJobRow extends QueryResultRow {
  job_id: string;
  user_id: string;
  credit_cost: number;
  page_id: string;
  previous_page_status: string | null;
  previous_generation_mode: string | null;
  stale_at: Date;
}

interface FailedPageGenerationJobMissingRefundRow extends QueryResultRow {
  job_id: string;
  user_id: string;
  credit_cost: number;
  page_id: string | null;
  completed_at: Date | null;
}

export class PostgresPageGenerationRecoveryRepository
  implements PageGenerationRecoveryRepository
{
  public constructor(private readonly client: DatabaseClient) {}

  public async listStaleProcessingJobs(cutoff: Date, limit: number): Promise<StalePageGenerationJob[]> {
    validateRecoveryLimit(limit);
    const result = await this.client.query<StalePageGenerationJobRow>(
      buildStaleJobsQuery('', '$2'),
      [cutoff, limit],
    );

    return result.rows.flatMap(mapStalePageGenerationJobRow);
  }

  public async listStaleProcessingJobsForPage(
    userId: string,
    pageId: string,
    cutoff: Date,
    limit: number,
  ): Promise<StalePageGenerationJob[]> {
    validateRecoveryLimit(limit);
    const result = await this.client.query<StalePageGenerationJobRow>(
      buildStaleJobsQuery(
        `
         AND generation_jobs.user_id = $2
         AND generation_jobs.params->>'page_id' = $3
      `,
        '$4',
      ),
      [cutoff, userId, pageId, limit],
    );

    return result.rows.flatMap(mapStalePageGenerationJobRow);
  }

  public async listFailedJobsMissingRefund(limit: number): Promise<FailedPageGenerationJobMissingRefund[]> {
    validateRecoveryLimit(limit);
    const result = await this.client.query<FailedPageGenerationJobMissingRefundRow>(
      buildFailedJobsMissingRefundQuery('', '$1'),
      [limit],
    );

    return result.rows.flatMap(mapFailedPageGenerationJobMissingRefundRow);
  }

  public async listFailedJobsMissingRefundForPage(
    userId: string,
    pageId: string,
    limit: number,
  ): Promise<FailedPageGenerationJobMissingRefund[]> {
    validateRecoveryLimit(limit);
    const result = await this.client.query<FailedPageGenerationJobMissingRefundRow>(
      buildFailedJobsMissingRefundQuery(
        `
         AND generation_jobs.user_id = $1
         AND generation_jobs.params->>'page_id' = $2
      `,
        '$3',
      ),
      [userId, pageId, limit],
    );

    return result.rows.flatMap(mapFailedPageGenerationJobMissingRefundRow);
  }
}

function buildStaleJobsQuery(extraConditions: string, limitPlaceholder: string): string {
  return `
      SELECT
        generation_jobs.id AS job_id,
        generation_jobs.user_id,
        generation_jobs.credit_cost,
        generation_jobs.params->>'page_id' AS page_id,
        generation_jobs.params->>'previous_page_status' AS previous_page_status,
        generation_jobs.params->>'previous_generation_mode' AS previous_generation_mode,
        COALESCE(generation_jobs.started_at, generation_jobs.created_at) AS stale_at
      FROM generation_jobs
      WHERE generation_jobs.job_type = 'page_generate'
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
        ${extraConditions}
      ORDER BY stale_at ASC, generation_jobs.created_at ASC
      LIMIT ${limitPlaceholder}
    `;
}

function buildFailedJobsMissingRefundQuery(extraConditions: string, limitPlaceholder: string): string {
  return `
      SELECT
        generation_jobs.id AS job_id,
        generation_jobs.user_id,
        generation_jobs.credit_cost,
        generation_jobs.params->>'page_id' AS page_id,
        generation_jobs.completed_at
      FROM generation_jobs
      WHERE generation_jobs.job_type = 'page_generate'
        AND generation_jobs.status = 'failed'
        AND generation_jobs.credit_cost > 0
        AND generation_jobs.params ? 'page_id'
        AND NOT EXISTS (
          SELECT 1
          FROM credit_ledger
          WHERE credit_ledger.user_id = generation_jobs.user_id
            AND credit_ledger.job_id = generation_jobs.id
            AND credit_ledger.type = 'refund'
        )
        ${extraConditions}
      ORDER BY generation_jobs.completed_at ASC NULLS FIRST, generation_jobs.created_at ASC
      LIMIT ${limitPlaceholder}
    `;
}

function validateRecoveryLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('recovery limit must be a positive safe integer');
  }
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
      staleAt: row.stale_at,
    },
  ];
}

function mapFailedPageGenerationJobMissingRefundRow(
  row: FailedPageGenerationJobMissingRefundRow,
): FailedPageGenerationJobMissingRefund[] {
  if (row.page_id === null || row.page_id.length === 0) {
    return [];
  }

  return [
    {
      jobId: row.job_id,
      userId: row.user_id,
      creditCost: row.credit_cost,
      pageId: row.page_id,
      completedAt: row.completed_at,
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
