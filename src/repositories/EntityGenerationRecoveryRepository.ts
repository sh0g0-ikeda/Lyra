import type { QueryResultRow } from 'pg';
import type { DatabaseClient } from '../lib/db.js';

export interface StaleEntityGenerationJob {
  jobId: string;
  userId: string;
  creditCost: number;
  entityId: string;
  staleAt: Date;
}

export interface FailedEntityGenerationJobMissingRefund {
  jobId: string;
  userId: string;
  creditCost: number;
  entityId: string;
  completedAt: Date | null;
}

export interface EntityGenerationRecoveryRepository {
  listStaleProcessingJobs(cutoff: Date, limit: number): Promise<StaleEntityGenerationJob[]>;
  listStaleProcessingJobsForEntity(
    userId: string,
    entityId: string,
    cutoff: Date,
    limit: number,
  ): Promise<StaleEntityGenerationJob[]>;
  listFailedJobsMissingRefund(limit: number): Promise<FailedEntityGenerationJobMissingRefund[]>;
  listFailedJobsMissingRefundForEntity(
    userId: string,
    entityId: string,
    limit: number,
  ): Promise<FailedEntityGenerationJobMissingRefund[]>;
}

interface StaleEntityGenerationJobRow extends QueryResultRow {
  job_id: string;
  user_id: string;
  credit_cost: number;
  entity_id: string | null;
  stale_at: Date;
}

interface FailedEntityGenerationJobMissingRefundRow extends QueryResultRow {
  job_id: string;
  user_id: string;
  credit_cost: number;
  entity_id: string | null;
  completed_at: Date | null;
}

export class PostgresEntityGenerationRecoveryRepository
  implements EntityGenerationRecoveryRepository
{
  public constructor(private readonly client: DatabaseClient) {}

  public async listStaleProcessingJobs(cutoff: Date, limit: number): Promise<StaleEntityGenerationJob[]> {
    validateRecoveryLimit(limit);
    const result = await this.client.query<StaleEntityGenerationJobRow>(
      buildStaleJobsQuery('', '$2'),
      [cutoff, limit],
    );

    return result.rows.flatMap(mapStaleEntityGenerationJobRow);
  }

  public async listStaleProcessingJobsForEntity(
    userId: string,
    entityId: string,
    cutoff: Date,
    limit: number,
  ): Promise<StaleEntityGenerationJob[]> {
    validateRecoveryLimit(limit);
    const result = await this.client.query<StaleEntityGenerationJobRow>(
      buildStaleJobsQuery(
        `
         AND generation_jobs.user_id = $2
         AND generation_jobs.params->>'entity_id' = $3
      `,
        '$4',
      ),
      [cutoff, userId, entityId, limit],
    );

    return result.rows.flatMap(mapStaleEntityGenerationJobRow);
  }

  public async listFailedJobsMissingRefund(limit: number): Promise<FailedEntityGenerationJobMissingRefund[]> {
    validateRecoveryLimit(limit);
    const result = await this.client.query<FailedEntityGenerationJobMissingRefundRow>(
      buildFailedJobsMissingRefundQuery('', '$1'),
      [limit],
    );

    return result.rows.flatMap(mapFailedEntityGenerationJobMissingRefundRow);
  }

  public async listFailedJobsMissingRefundForEntity(
    userId: string,
    entityId: string,
    limit: number,
  ): Promise<FailedEntityGenerationJobMissingRefund[]> {
    validateRecoveryLimit(limit);
    const result = await this.client.query<FailedEntityGenerationJobMissingRefundRow>(
      buildFailedJobsMissingRefundQuery(
        `
         AND generation_jobs.user_id = $1
         AND generation_jobs.params->>'entity_id' = $2
      `,
        '$3',
      ),
      [userId, entityId, limit],
    );

    return result.rows.flatMap(mapFailedEntityGenerationJobMissingRefundRow);
  }
}

function buildStaleJobsQuery(extraConditions: string, limitPlaceholder: string): string {
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
        generation_jobs.params->>'entity_id' AS entity_id,
        generation_jobs.completed_at
      FROM generation_jobs
      WHERE generation_jobs.job_type = 'entity_generate'
        AND generation_jobs.status = 'failed'
        AND generation_jobs.credit_cost > 0
        AND generation_jobs.params ? 'entity_id'
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

function mapFailedEntityGenerationJobMissingRefundRow(
  row: FailedEntityGenerationJobMissingRefundRow,
): FailedEntityGenerationJobMissingRefund[] {
  if (row.entity_id === null || row.entity_id.length === 0) {
    return [];
  }

  return [
    {
      jobId: row.job_id,
      userId: row.user_id,
      creditCost: row.credit_cost,
      entityId: row.entity_id,
      completedAt: row.completed_at,
    },
  ];
}
