import type { QueryResultRow } from 'pg';
import type { PageStatus } from '../domain/types/page.js';
import type { PageGenerationMode } from '../domain/types/pageGeneration.js';
import type { DatabaseClient } from '../lib/db.js';

export interface StalePageGenerationJob {
  jobId: string;
  userId: string;
  organizationId?: string | null;
  creditCost: number;
  pageId: string;
  previousStatus: PageStatus;
  previousGenerationMode: PageGenerationMode | null;
  staleAt: Date;
}

export interface FailedPageGenerationJobMissingRefund {
  jobId: string;
  userId: string;
  organizationId?: string | null;
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
    organizationId?: string | null,
  ): Promise<StalePageGenerationJob[]>;
  listFailedJobsMissingRefund(limit: number): Promise<FailedPageGenerationJobMissingRefund[]>;
  listFailedJobsMissingRefundForPage(
    userId: string,
    pageId: string,
    limit: number,
    organizationId?: string | null,
  ): Promise<FailedPageGenerationJobMissingRefund[]>;
}

interface StalePageGenerationJobRow extends QueryResultRow {
  job_id: string;
  user_id: string;
  organization_id: string | null;
  credit_cost: number;
  page_id: string;
  previous_page_status: string | null;
  previous_generation_mode: string | null;
  stale_at: Date;
}

interface FailedPageGenerationJobMissingRefundRow extends QueryResultRow {
  job_id: string;
  user_id: string;
  organization_id: string | null;
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
    organizationId: string | null = null,
  ): Promise<StalePageGenerationJob[]> {
    validateRecoveryLimit(limit);
    const result = await this.client.query<StalePageGenerationJobRow>(
      buildStaleJobsQuery(
        `
         AND generation_jobs.user_id = $2
         AND generation_jobs.params->>'page_id' = $3
         AND (
           ($4::uuid IS NULL AND generation_jobs.organization_id IS NULL)
           OR (
             $4::uuid IS NOT NULL
             AND generation_jobs.organization_id = $4::uuid
             AND EXISTS (
               SELECT 1
               FROM organization_members
               WHERE organization_members.organization_id = generation_jobs.organization_id
                 AND organization_members.user_id = $2
                 AND organization_members.status = 'active'
             )
           )
         )
      `,
        '$5',
      ),
      [cutoff, userId, pageId, organizationId, limit],
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
    organizationId: string | null = null,
  ): Promise<FailedPageGenerationJobMissingRefund[]> {
    validateRecoveryLimit(limit);
    const result = await this.client.query<FailedPageGenerationJobMissingRefundRow>(
      buildFailedJobsMissingRefundQuery(
        `
         AND generation_jobs.user_id = $1
         AND generation_jobs.params->>'page_id' = $2
         AND (
           ($3::uuid IS NULL AND generation_jobs.organization_id IS NULL)
           OR (
             $3::uuid IS NOT NULL
             AND generation_jobs.organization_id = $3::uuid
             AND EXISTS (
               SELECT 1
               FROM organization_members
               WHERE organization_members.organization_id = generation_jobs.organization_id
                 AND organization_members.user_id = $1
                 AND organization_members.status = 'active'
             )
           )
         )
      `,
        '$4',
      ),
      [userId, pageId, organizationId, limit],
    );

    return result.rows.flatMap(mapFailedPageGenerationJobMissingRefundRow);
  }
}

function buildStaleJobsQuery(extraConditions: string, limitPlaceholder: string): string {
  return `
      WITH candidate_jobs AS (
        SELECT
          generation_jobs.id AS job_id,
          generation_jobs.user_id,
          generation_jobs.organization_id,
          generation_jobs.credit_cost,
          generation_jobs.params->>'page_id' AS page_id,
          generation_jobs.params->>'previous_page_status' AS previous_page_status,
          generation_jobs.params->>'previous_generation_mode' AS previous_generation_mode,
          generation_jobs.status,
          generation_jobs.created_at,
          CASE
            WHEN generation_jobs.status = 'processing'
              AND generation_jobs.result->>'progress_updated_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$'
              THEN (generation_jobs.result->>'progress_updated_at')::timestamptz
            ELSE COALESCE(generation_jobs.started_at, generation_jobs.created_at)
          END AS stale_at
        FROM generation_jobs
        WHERE generation_jobs.job_type = 'page_generate'
          AND generation_jobs.status IN ('processing', 'queued')
          ${extraConditions}
      )
      SELECT
        job_id,
        user_id,
        organization_id,
        credit_cost,
        page_id,
        previous_page_status,
        previous_generation_mode,
        stale_at
      FROM candidate_jobs
      WHERE (
          (
            status = 'processing'
            AND stale_at < $1
          )
          OR (
            status = 'queued'
            AND created_at < $1
          )
        )
      ORDER BY stale_at ASC, created_at ASC
      LIMIT ${limitPlaceholder}
    `;
}

function buildFailedJobsMissingRefundQuery(extraConditions: string, limitPlaceholder: string): string {
  return `
      SELECT
        generation_jobs.id AS job_id,
        generation_jobs.user_id,
        generation_jobs.organization_id,
        generation_jobs.credit_cost,
        generation_jobs.params->>'page_id' AS page_id,
        generation_jobs.completed_at
      FROM generation_jobs
      WHERE generation_jobs.job_type = 'page_generate'
        AND generation_jobs.status = 'failed'
        AND generation_jobs.credit_cost > 0
        AND generation_jobs.params ? 'page_id'
        AND EXISTS (
          SELECT 1
          FROM credit_ledger AS consumed_ledger
          WHERE consumed_ledger.user_id = generation_jobs.user_id
            AND COALESCE(consumed_ledger.organization_id::text, '') = COALESCE(generation_jobs.organization_id::text, '')
            AND consumed_ledger.job_id = generation_jobs.id
            AND consumed_ledger.type = 'consume'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM credit_ledger
          WHERE credit_ledger.user_id = generation_jobs.user_id
            AND COALESCE(credit_ledger.organization_id::text, '') = COALESCE(generation_jobs.organization_id::text, '')
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
      organizationId: row.organization_id,
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
      organizationId: row.organization_id,
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
