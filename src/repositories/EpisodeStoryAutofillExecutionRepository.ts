import type { QueryResultRow } from 'pg';
import type { EpisodePagePlanApplyResult } from '../domain/types/page.js';
import type { GenerationJob } from '../domain/types/job.js';
import type { DatabaseClient } from '../lib/db.js';
import { sanitizePersistedErrorMessage } from '../lib/errorSanitizer.js';

export interface CompleteEpisodeStoryAutofillInput {
  jobId: string;
  userId: string;
  result: EpisodePagePlanApplyResult;
}

export interface UpdateEpisodeStoryAutofillProgressInput {
  jobId: string;
  userId: string;
  stage: string;
  message: string;
  currentChunk?: number | null;
  totalChunks?: number | null;
}

export interface EpisodeStoryAutofillExecutionRepository {
  claimQueuedEpisodeStoryAutofillJob(jobId: string): Promise<GenerationJob | null>;
  updateEpisodeStoryAutofillProgress(input: UpdateEpisodeStoryAutofillProgressInput): Promise<boolean>;
  completeEpisodeStoryAutofill(input: CompleteEpisodeStoryAutofillInput): Promise<boolean>;
  failEpisodeStoryAutofill(input: {
    jobId: string;
    userId: string;
    errorMessage: string;
  }): Promise<boolean>;
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

export class PostgresEpisodeStoryAutofillExecutionRepository
  implements EpisodeStoryAutofillExecutionRepository
{
  public constructor(private readonly client: DatabaseClient) {}

  public async claimQueuedEpisodeStoryAutofillJob(jobId: string): Promise<GenerationJob | null> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET status = 'processing',
          started_at = COALESCE(started_at, NOW()),
          error_message = NULL
      WHERE id = $1
        AND job_type = 'episode_story_autofill'
        AND status = 'queued'
      RETURNING *
      `,
      [jobId],
    );

    return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
  }

  public async updateEpisodeStoryAutofillProgress(
    input: UpdateEpisodeStoryAutofillProgressInput,
  ): Promise<boolean> {
    const updatedAt = new Date().toISOString();
    const progress: Record<string, unknown> = {
      progress_stage: input.stage,
      progress_message: input.message,
      progress_updated_at: updatedAt,
    };
    if (input.currentChunk !== undefined) {
      progress.progress_current_chunk = input.currentChunk;
    }
    if (input.totalChunks !== undefined) {
      progress.progress_total_chunks = input.totalChunks;
    }
    if (input.stage === 'started') {
      progress.progress_started_at = updatedAt;
    }

    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET result = COALESCE(result, '{}'::jsonb) || $3::jsonb
      WHERE id = $1
        AND user_id = $2
        AND job_type = 'episode_story_autofill'
        AND status = 'processing'
      RETURNING *
      `,
      [input.jobId, input.userId, JSON.stringify(progress)],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async completeEpisodeStoryAutofill(
    input: CompleteEpisodeStoryAutofillInput,
  ): Promise<boolean> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET status = 'completed',
          result = $3::jsonb,
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
          updated_page_count: input.result.updatedPageCount,
          updated_panel_count: input.result.updatedPanelCount,
          updated_assignment_count: input.result.updatedAssignmentCount,
          filled_field_count: input.result.filledFieldCount,
          compiler_used: input.result.compilerUsed,
          compiler_provider: input.result.compilerProvider,
          compiler_model: input.result.compilerModel,
          compiler_prompt_version: input.result.compilerPromptVersion,
          compiler_error: input.result.compilerError,
          progress_stage: 'completed',
          progress_message: 'Story plan applied to pages and panels.',
          progress_updated_at: new Date().toISOString(),
        }),
      ],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async failEpisodeStoryAutofill(input: {
    jobId: string;
    userId: string;
    errorMessage: string;
  }): Promise<boolean> {
    const persistedErrorMessage = sanitizePersistedErrorMessage(
      input.errorMessage,
      'Episode story autofill failed',
    );
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET status = 'failed',
          error_message = $3,
          result = COALESCE(result, '{}'::jsonb) || $4::jsonb,
          completed_at = NOW()
      WHERE id = $1
        AND user_id = $2
        AND status IN ('queued', 'processing')
      RETURNING *
      `,
      [
        input.jobId,
        input.userId,
        persistedErrorMessage,
        JSON.stringify({
          progress_stage: 'failed',
          progress_message: 'Story plan autofill failed.',
          progress_updated_at: new Date().toISOString(),
        }),
      ],
    );

    return (result.rowCount ?? 0) > 0;
  }
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
    params: toJsonObject(row.params),
    result: row.result === null ? null : toJsonObject(row.result),
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

function toJsonObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
