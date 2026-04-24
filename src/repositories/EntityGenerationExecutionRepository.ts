import type { QueryResultRow } from 'pg';
import type { GenerationJob } from '../domain/types/job.js';
import type { DatabaseClient } from '../lib/db.js';

export interface CompleteEntityGenerationInput {
  jobId: string;
  userId: string;
  candidates: Array<{
    refId: string;
    s3Key: string;
    cdnUrl: string;
  }>;
  openaiRequestId: string | null;
  costUsd: number | null;
}

export interface EntityGenerationExecutionRepository {
  claimQueuedEntityGenerationJob(jobId: string): Promise<GenerationJob | null>;
  completeEntityGeneration(input: CompleteEntityGenerationInput): Promise<boolean>;
  failEntityGeneration(input: { jobId: string; userId: string; errorMessage: string }): Promise<boolean>;
}

interface GenerationJobRow extends QueryResultRow {
  id: string;
  user_id: string;
  job_type: GenerationJob['jobType'];
  status: GenerationJob['status'];
  generation_mode: string | null;
  credit_cost: number;
  params: unknown;
  result: unknown;
  sqs_message_id: string | null;
  openai_request_id: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  expires_at: Date | null;
}

export class PostgresEntityGenerationExecutionRepository implements EntityGenerationExecutionRepository {
  public constructor(private readonly client: DatabaseClient) {}

  public async claimQueuedEntityGenerationJob(jobId: string): Promise<GenerationJob | null> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET status = 'processing',
          started_at = COALESCE(started_at, NOW()),
          error_message = NULL
      WHERE id = $1
        AND job_type = 'entity_generate'
        AND status = 'queued'
      RETURNING *
      `,
      [jobId],
    );

    return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
  }

  public async completeEntityGeneration(input: CompleteEntityGenerationInput): Promise<boolean> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET status = 'completed',
          result = $3::jsonb,
          openai_request_id = $4,
          completed_at = NOW()
      WHERE id = $1
        AND user_id = $2
        AND status = 'processing'
      RETURNING *
      `,
      [
        input.jobId,
        input.userId,
        JSON.stringify({
          candidates: input.candidates.map((candidate) => ({
            ref_id: candidate.refId,
            s3_key: candidate.s3Key,
            cdn_url: candidate.cdnUrl,
          })),
          cost_usd: input.costUsd,
        }),
        input.openaiRequestId,
      ],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async failEntityGeneration(input: {
    jobId: string;
    userId: string;
    errorMessage: string;
  }): Promise<boolean> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET status = 'failed',
          error_message = $3,
          completed_at = NOW()
      WHERE id = $1
        AND user_id = $2
        AND status = 'processing'
      RETURNING *
      `,
      [input.jobId, input.userId, input.errorMessage],
    );

    return (result.rowCount ?? 0) > 0;
  }
}

function mapGenerationJobRow(row: GenerationJobRow): GenerationJob {
  return {
    id: row.id,
    userId: row.user_id,
    jobType: row.job_type,
    status: row.status,
    generationMode: row.generation_mode === 'standard' || row.generation_mode === 'thinking'
      ? row.generation_mode
      : null,
    creditCost: row.credit_cost,
    params:
      typeof row.params === 'object' && row.params !== null && !Array.isArray(row.params)
        ? (row.params as Record<string, unknown>)
        : {},
    result:
      typeof row.result === 'object' && row.result !== null && !Array.isArray(row.result)
        ? (row.result as Record<string, unknown>)
        : null,
    sqsMessageId: row.sqs_message_id,
    openaiRequestId: row.openai_request_id,
    errorMessage: row.error_message,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
  };
}
