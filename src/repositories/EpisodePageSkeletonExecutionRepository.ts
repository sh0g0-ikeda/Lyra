import type { QueryResultRow } from 'pg';
import { ConflictError, NotFoundError } from '../domain/errors/index.js';
import {
  fingerprintPageSkeletonSource,
  type PreparedPageSkeleton,
} from '../domain/pageSkeletonSource.js';
import type { GenerationJob } from '../domain/types/job.js';
import type { PageSkeletonPersistResult } from '../domain/types/storyAi.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import { sanitizePersistedErrorMessage } from '../lib/errorSanitizer.js';
import { PostgresStoryRepository } from './StoryRepository.js';

export interface CommitPreparedEpisodePageSkeletonInput {
  jobId: string;
  userId: string;
  organizationId: string | null;
  prepared: PreparedPageSkeleton;
  overwriteExisting: boolean;
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
  commitPreparedEpisodePageSkeleton(
    input: CommitPreparedEpisodePageSkeletonInput,
  ): Promise<PageSkeletonPersistResult | null>;
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

interface LockedEpisodeRow extends QueryResultRow {
  episode_id: string;
}

export class PostgresEpisodePageSkeletonExecutionRepository
  implements EpisodePageSkeletonExecutionRepository
{
  public constructor(private readonly client: DatabaseClient & TransactionRunner) {}

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
        AND cancel_requested_at IS NULL
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
      [input.jobId, input.userId, JSON.stringify(progress)],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async commitPreparedEpisodePageSkeleton(
    input: CommitPreparedEpisodePageSkeletonInput,
  ): Promise<PageSkeletonPersistResult | null> {
    return this.client.transaction(async (transactionClient) => {
      await transactionClient.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      const commitStarted = await transactionClient.query<GenerationJobRow>(
        `
        UPDATE generation_jobs
        SET commit_started_at = NOW()
        WHERE id = $1
          AND user_id = $2
          AND job_type = 'episode_page_skeleton'
          AND status = 'processing'
          AND cancel_requested_at IS NULL
          AND commit_started_at IS NULL
        RETURNING *
        `,
        [input.jobId, input.userId],
      );
      if (commitStarted.rows[0] === undefined) {
        return null;
      }

      await this.lockEpisodeSkeletonSource(transactionClient, input);
      const storyRepository = new PostgresStoryRepository(transactionClient);
      const currentSource = await storyRepository.findEpisodePageSkeletonContextByIdAndUserId(
        input.prepared.context.episodeId,
        input.userId,
        input.organizationId,
      );
      if (currentSource === null) {
        throw new NotFoundError('Episode not found');
      }
      if (fingerprintPageSkeletonSource(currentSource) !== input.prepared.sourceFingerprint) {
        throw new ConflictError(
          'The episode changed while the page skeleton was being generated. Run the operation again.',
        );
      }

      const result = await storyRepository.createPageSkeleton(
        input.prepared.context.episodeId,
        input.userId,
        input.prepared.pages,
        { overwriteExisting: input.overwriteExisting },
        input.organizationId,
      );
      if (result === null) {
        throw new NotFoundError('Episode not found');
      }

      const completed = await transactionClient.query<GenerationJobRow>(
        `
        UPDATE generation_jobs
        SET status = 'completed',
            result = $3::jsonb,
            completed_at = NOW()
        WHERE id = $1
          AND user_id = $2
          AND job_type = 'episode_page_skeleton'
          AND status = 'processing'
          AND cancel_requested_at IS NULL
          AND commit_started_at IS NOT NULL
        RETURNING *
        `,
        [
          input.jobId,
          input.userId,
          JSON.stringify({
            pages_created: result.pagesCreated,
            panels_created: result.panelsCreated,
            replaced_existing: result.replacedExisting,
            story_plan_applied: false,
            progress_stage: 'completed',
            progress_message: 'Page skeleton generation completed.',
            progress_updated_at: new Date().toISOString(),
          }),
        ],
      );
      if (completed.rows[0] === undefined) {
        throw new ConflictError('Page skeleton job could not be completed');
      }

      return result;
    });
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
        AND job_type = 'episode_page_skeleton'
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

  private async lockEpisodeSkeletonSource(
    client: DatabaseClient,
    input: CommitPreparedEpisodePageSkeletonInput,
  ): Promise<void> {
    const episode = await client.query<LockedEpisodeRow>(
      `
      SELECT episodes.id AS episode_id
      FROM episodes
      INNER JOIN chapters ON chapters.id = episodes.chapter_id
      INNER JOIN works ON works.id = chapters.work_id
      WHERE episodes.id = $1
        AND (
          ($3::uuid IS NULL AND works.user_id = $2 AND works.organization_id IS NULL)
          OR (
            $3::uuid IS NOT NULL
            AND works.organization_id = $3::uuid
            AND EXISTS (
              SELECT 1
              FROM organization_members
              WHERE organization_members.organization_id = works.organization_id
                AND organization_members.user_id = $2
                AND organization_members.status = 'active'
            )
          )
        )
      FOR UPDATE OF works, chapters, episodes
      `,
      [input.prepared.context.episodeId, input.userId, input.organizationId],
    );
    if (episode.rows[0] === undefined) {
      throw new NotFoundError('Episode not found');
    }

    await client.query(
      `SELECT scenes.id FROM scenes WHERE scenes.episode_id = $1
       ORDER BY scenes."order" ASC, scenes.id ASC FOR UPDATE`,
      [input.prepared.context.episodeId],
    );
    await client.query(
      `SELECT pages.id FROM pages WHERE pages.episode_id = $1
       ORDER BY pages.page_number ASC, pages.id ASC FOR UPDATE`,
      [input.prepared.context.episodeId],
    );
    await client.query(
      `SELECT panels.id FROM panels
       INNER JOIN pages ON pages.id = panels.page_id
       WHERE pages.episode_id = $1
       ORDER BY pages.page_number ASC, panels."order" ASC, panels.id ASC
       FOR UPDATE OF panels`,
      [input.prepared.context.episodeId],
    );
    await client.query(
      `SELECT panel_frames.id FROM panel_frames
       INNER JOIN pages ON pages.id = panel_frames.page_id
       WHERE pages.episode_id = $1
       ORDER BY pages.page_number ASC, panel_frames.reading_order ASC, panel_frames.id ASC
       FOR UPDATE OF panel_frames`,
      [input.prepared.context.episodeId],
    );
    await client.query(
      `SELECT balloons.id FROM balloons
       INNER JOIN pages ON pages.id = balloons.page_id
       WHERE pages.episode_id = $1
       ORDER BY pages.page_number ASC, balloons.id ASC
       FOR UPDATE OF balloons`,
      [input.prepared.context.episodeId],
    );
    await client.query(
      `SELECT entities.id
       FROM entities
       INNER JOIN chapters ON chapters.work_id = entities.work_id
       INNER JOIN episodes ON episodes.chapter_id = chapters.id
       WHERE episodes.id = $1
       ORDER BY entities.id ASC
       FOR UPDATE OF entities`,
      [input.prepared.context.episodeId],
    );
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
