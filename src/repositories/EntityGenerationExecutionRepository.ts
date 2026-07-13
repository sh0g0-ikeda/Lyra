import type { QueryResultRow } from 'pg';
import type { GenerationJob } from '../domain/types/job.js';
import type { DatabaseClient } from '../lib/db.js';
import { sanitizePersistedErrorMessage } from '../lib/errorSanitizer.js';
import { buildPersistedPromptDiagnostics } from '../lib/promptDiagnostics.js';

export interface CompleteEntityGenerationInput {
  jobId: string;
  userId: string;
  structuredFields: Record<string, unknown>;
  candidates: Array<{
    refId: string;
    s3Key: string;
    cdnUrl: string;
  }>;
  compiledBrief: string;
  compiledPrompt: string;
  openaiRequestId: string | null;
  costUsd: number | null;
  compiledPromptUsed: boolean;
  promptCompilerProvider: 'openai' | 'none';
  compilerModel: string | null;
  compilerPromptVersion: string | null;
  compilerError: string | null;
  imageModel: string;
  imageParams: {
    quality: string;
    size: string;
  };
  createdAt: string;
}

export interface TouchEntityGenerationProgressInput {
  jobId: string;
  userId: string;
  message: string;
  updatedAt: string;
}

export interface FailEntityGenerationInput {
  jobId: string;
  userId: string;
  errorMessage: string;
  staleBefore?: Date;
}

export interface EntityGenerationExecutionRepository {
  claimQueuedEntityGenerationJob(jobId: string): Promise<GenerationJob | null>;
  touchEntityGenerationProgress(input: TouchEntityGenerationProgressInput): Promise<boolean>;
  completeEntityGeneration(input: CompleteEntityGenerationInput): Promise<boolean>;
  failEntityGeneration(input: FailEntityGenerationInput): Promise<boolean>;
}

interface GenerationJobRow extends QueryResultRow {
  id: string;
  user_id: string;
  organization_id: string | null;
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

  public async touchEntityGenerationProgress(input: TouchEntityGenerationProgressInput): Promise<boolean> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
            'progress_message', $3::text,
            'progress_updated_at', $4::text
          )
      WHERE id = $1
        AND user_id = $2
        AND job_type = 'entity_generate'
        AND status = 'processing'
      RETURNING *
      `,
      [input.jobId, input.userId, input.message, input.updatedAt],
    );

    return (result.rowCount ?? 0) > 0;
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
          structured_fields: input.structuredFields,
          candidates: input.candidates.map((candidate) => ({
            ref_id: candidate.refId,
            s3_key: candidate.s3Key,
            cdn_url: candidate.cdnUrl,
          })),
          ...buildPromptDiagnostics(input),
          cost_usd: input.costUsd,
          compiled_prompt_used: input.compiledPromptUsed,
          prompt_compiler_provider: input.promptCompilerProvider,
          compiler_model: input.compilerModel,
          compiler_prompt_version: input.compilerPromptVersion,
          compiler_error: input.compilerError,
          image_model: input.imageModel,
          image_params: input.imageParams,
          created_at: input.createdAt,
        }),
        input.openaiRequestId,
      ],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async failEntityGeneration(input: FailEntityGenerationInput): Promise<boolean> {
    const persistedErrorMessage = sanitizePersistedErrorMessage(input.errorMessage, 'Entity generation failed');
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET status = 'failed',
          error_message = $3,
          completed_at = NOW()
      WHERE id = $1
        AND user_id = $2
        AND status IN ('queued', 'processing')
        AND (
          $4::timestamptz IS NULL
          OR (
            status = 'queued'
            AND created_at < $4::timestamptz
          )
          OR (
            status = 'processing'
            AND COALESCE(
              CASE
                WHEN result->>'progress_updated_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$'
                THEN (result->>'progress_updated_at')::timestamptz
                ELSE NULL
              END,
              started_at,
              created_at
            ) < $4::timestamptz
          )
        )
      RETURNING *
      `,
      [input.jobId, input.userId, persistedErrorMessage, input.staleBefore?.toISOString() ?? null],
    );

    return (result.rowCount ?? 0) > 0;
  }
}

function buildPromptDiagnostics(
  input: Pick<CompleteEntityGenerationInput, 'compiledBrief' | 'compiledPrompt'>,
): Record<string, string | number> {
  const compiledBrief = buildPersistedPromptDiagnostics(input.compiledBrief);
  const compiledPrompt = buildPersistedPromptDiagnostics(input.compiledPrompt);

  return {
    compiled_brief_sha256: compiledBrief.sha256,
    compiled_brief_bytes: compiledBrief.bytes,
    compiled_prompt_sha256: compiledPrompt.sha256,
    compiled_prompt_bytes: compiledPrompt.bytes,
  };
}

function mapGenerationJobRow(row: GenerationJobRow): GenerationJob {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
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
