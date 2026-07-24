import type { QueryResultRow } from 'pg';
import type { PageSkeletonPersistResult } from '../domain/types/storyAi.js';
import type { EpisodePagePlanApplyResult } from '../domain/types/page.js';
import type { GenerationJob } from '../domain/types/job.js';
import type { DatabaseClient } from '../lib/db.js';
import { sanitizePersistedErrorMessage } from '../lib/errorSanitizer.js';

export interface CompleteEpisodePageSkeletonInput {
  jobId: string;
  userId: string;
  result: PageSkeletonPersistResult;
  storyPlanApplied: boolean;
  storyPlanResult: EpisodePagePlanApplyResult | null;
}

export interface UpdateEpisodePageSkeletonProgressInput {
  jobId: string;
  userId: string;
  stage: string;
  message: string;
  currentChunk?: number | null;
  totalChunks?: number | null;
}

export interface EpisodePageSkeletonExecutionRepository {
  claimQueuedEpisodePageSkeletonJob(jobId: string): Promise<GenerationJob | null>;
  updateEpisodePageSkeletonProgress(input: UpdateEpisodePageSkeletonProgressInput): Promise<boolean>;
  completeEpisodePageSkeleton(input: CompleteEpisodePageSkeletonInput): Promise<boolean>;
  failEpisodePageSkeleton(input: {
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
  cancel_requested_at: Date | null;
  cancel_requested_by: string | null;
  cancelled_at: Date | null;
  commit_started_at: Date | null;
}

export class PostgresEpisodePageSkeletonExecutionRepository
  implements EpisodePageSkeletonExecutionRepository
{
  public constructor(private readonly client: DatabaseClient) {}

  public async claimQueuedEpisodePageSkeletonJob(jobId: string): Promise<GenerationJob | null> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET status = 'processing',
          started_at = COALESCE(started_at, NOW()),
          error_message = NULL
      WHERE id = $1
        AND job_type = 'episode_page_skeleton'
        AND status = 'queued'
      RETURNING *
      `,
      [jobId],
    );

    return result.rows[0] === undefined ? null : mapGenerationJobRow(result.rows[0]);
  }

  public async updateEpisodePageSkeletonProgress(
    input: UpdateEpisodePageSkeletonProgressInput,
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
        AND job_type = 'episode_page_skeleton'
        AND status = 'processing'
        AND cancel_requested_at IS NULL
      RETURNING *
      `,
      [
        input.jobId,
        input.userId,
        JSON.stringify(progress),
      ],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async completeEpisodePageSkeleton(input: CompleteEpisodePageSkeletonInput): Promise<boolean> {
    const result = await this.client.query<GenerationJobRow>(
      `
      UPDATE generation_jobs
      SET status = 'completed',
          result = $3::jsonb,
          completed_at = NOW()
      WHERE id = $1
        AND user_id = $2
        AND status = 'processing'
        AND cancel_requested_at IS NULL
      RETURNING *
      `,
      [
        input.jobId,
        input.userId,
        JSON.stringify({
          pages_created: input.result.pagesCreated,
          panels_created: input.result.panelsCreated,
          replaced_existing: input.result.replacedExisting,
          story_plan_applied: input.storyPlanApplied,
          story_plan_result: input.storyPlanResult === null ? null : {
            updated_page_count: input.storyPlanResult.updatedPageCount,
            updated_panel_count: input.storyPlanResult.updatedPanelCount,
            updated_assignment_count: input.storyPlanResult.updatedAssignmentCount,
            filled_field_count: input.storyPlanResult.filledFieldCount,
            compiler_used: input.storyPlanResult.compilerUsed,
            compiler_provider: input.storyPlanResult.compilerProvider,
            compiler_model: input.storyPlanResult.compilerModel,
            compiler_prompt_version: input.storyPlanResult.compilerPromptVersion,
            compiler_error: input.storyPlanResult.compilerError,
          },
          progress_stage: 'completed',
          progress_message: 'Page skeleton generation completed.',
          progress_updated_at: new Date().toISOString(),
        }),
      ],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async failEpisodePageSkeleton(input: {
    jobId: string;
    userId: string;
    errorMessage: string;
  }): Promise<boolean> {
    const persistedErrorMessage = sanitizePersistedErrorMessage(
      input.errorMessage,
      'Page skeleton generation failed',
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
        AND cancel_requested_at IS NULL
      RETURNING *
      `,
      [
        input.jobId,
        input.userId,
        persistedErrorMessage,
        JSON.stringify({
          progress_stage: 'failed',
          progress_message: 'Page skeleton generation failed.',
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
    cancelRequestedAt: row.cancel_requested_at,
    cancelRequestedBy: row.cancel_requested_by,
    cancelledAt: row.cancelled_at,
    commitStartedAt: row.commit_started_at,
  };
}

function toJsonObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
