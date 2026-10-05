import { CANONICAL_REPOSITORY_SCHEMA_PROFILE, type RepositorySchemaProfile } from './RepositorySchemaProfile.js';
import type { QueryResultRow } from 'pg';
import { roleHasCapability, type OrganizationMemberRole } from '../domain/types/organization.js';
import { isDeepStrictEqual } from 'node:util';
import { ConfigurationError, ConflictError, ForbiddenError, NotFoundError } from '../domain/errors/index.js';
import { assertLegacyPersonalWriteAllowed } from './LegacyAccountDeletionWriteFence.js';
import { bindTransaction } from './TransactionBoundDatabase.js';
import { PostgresStoryRepository } from './StoryRepository.js';
import { PostgresGenerationJobRepository } from './GenerationJobRepository.js';
import { fingerprintPageSkeletonContext } from '../domain/pageSkeletonFingerprint.js';
import type { PageSkeletonPreparation } from '../services/story/PageSkeletonService.js';
import type { PageSkeletonPersistResult } from '../domain/types/storyAi.js';
import type { EpisodePagePlanApplyResult } from '../domain/types/page.js';
import type { GenerationJob } from '../domain/types/job.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import { sanitizePersistedErrorMessage } from '../lib/errorSanitizer.js';
import {
  enqueueTerminalGenerationJobNotificationAfterRegistryLock,
  lockMobilePushTokenRegistryForTerminalSettlement,
} from './PushNotificationOutboxRepository.js';

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

export type EpisodePageSkeletonAttemptSettlement = 'active' | 'cancelled' | 'failed' | 'lost';

/** Selected by the factory only for legacy_2debe_v1, never by method presence. */
export interface LegacyEpisodePageSkeletonCommitPort {
  commitPreparedEpisodePageSkeleton(job: GenerationJob, preparation: PageSkeletonPreparation): Promise<PageSkeletonPersistResult>;
  settleEpisodePageSkeletonAttempt(job: GenerationJob, errorMessage?: string): Promise<EpisodePageSkeletonAttemptSettlement>;
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
  implements EpisodePageSkeletonExecutionRepository, LegacyEpisodePageSkeletonCommitPort
{
  public constructor(
    private readonly client: DatabaseClient & TransactionRunner,
    private readonly schemaProfile: RepositorySchemaProfile = CANONICAL_REPOSITORY_SCHEMA_PROFILE,
  ) {}

  public async commitPreparedEpisodePageSkeleton(
    job: GenerationJob,
    preparation: PageSkeletonPreparation,
  ): Promise<PageSkeletonPersistResult> {
    this.requireLegacyProfile();
    return this.client.transaction(async (client) => {
      // Read actual scope without a job lock, then take the shared admission order.
      const candidate = (await client.query<GenerationJobRow>('SELECT * FROM generation_jobs WHERE id = $1::uuid', [job.id])).rows[0];
      if (!sameSkeletonAttempt(candidate, job)
        || preparation.userId !== job.userId
        || preparation.organizationId !== (job.organizationId ?? null)
        || preparation.episodeId !== job.params.episode_id
        || preparation.overwriteExisting !== job.params.overwrite_existing
        || preparation.sourceFingerprint === undefined) {
        throw new ConflictError('Page skeleton attempt or source no longer matches');
      }
      await assertLegacyPersonalWriteAllowed(client, { userId: candidate.user_id, organizationId: candidate.organization_id });
      if (candidate.organization_id !== null) {
        // Anonymization locks users before deleting memberships. Keep that order
        // without applying the personal-write ban to a legitimate org workspace.
        const actor = await client.query('SELECT id FROM users WHERE id = $1::uuid FOR KEY SHARE', [candidate.user_id]);
        if (actor.rows[0] === undefined) throw new ForbiddenError('Organization membership is no longer active');
        // Member administration locks organizations before memberships. Terminal
        // job/FK checks can also revisit this row, so retain it before either lock.
        const organization = await client.query('SELECT id FROM organizations WHERE id = $1::uuid FOR KEY SHARE', [candidate.organization_id]);
        if (organization.rows[0] === undefined) throw new ForbiddenError('Organization membership is no longer active');
      }
      await lockMobilePushTokenRegistryForTerminalSettlement(client);
      const locked = (await client.query<GenerationJobRow>('SELECT * FROM generation_jobs WHERE id = $1::uuid FOR UPDATE', [job.id])).rows[0];
      if (!sameSkeletonAttempt(locked, job) || locked.status !== 'processing'
        || locked.cancel_requested_at !== null || locked.cancelled_at !== null || locked.commit_started_at !== null) {
        throw new ConflictError('Page skeleton attempt is no longer committable');
      }
      const bound = bindTransaction(client);
      if (!(await new PostgresGenerationJobRepository(bound, this.schemaProfile).beginCommit(job.id))) {
        throw new ConflictError('Page skeleton commit gate could not be acquired');
      }
      if (preparation.organizationId !== null) {
        const membership = (await client.query<{ organization_id: string; user_id: string; status: string; role: unknown }>(
          `SELECT organization_id, user_id, status, role FROM organization_members
           WHERE organization_id = $1::uuid AND user_id = $2::uuid FOR SHARE`,
          [preparation.organizationId, job.userId],
        )).rows[0];
        if (membership?.organization_id !== preparation.organizationId || membership.user_id !== job.userId || membership.status !== 'active'
          || !isKnownOrganizationRole(membership.role) || !roleHasCapability(membership.role, 'edit_work')) {
          throw new ForbiddenError('Organization membership is no longer active');
        }
      }
      await this.lockSkeletonSource(client, preparation);
      const story = new PostgresStoryRepository(bound, bound, this.schemaProfile);
      const context = await story.findEpisodePageSkeletonContextByIdAndUserId(preparation.episodeId, job.userId, preparation.organizationId);
      if (context === null) throw new NotFoundError('Episode not found');
      if (context.graphFingerprint === undefined) throw new ConfigurationError('Legacy skeleton source snapshot is missing');
      if (fingerprintPageSkeletonContext(context) !== preparation.sourceFingerprint) {
        throw new ConflictError('Page skeleton source changed during generation');
      }
      const result = await story.createPageSkeleton(preparation.episodeId, job.userId, preparation.pages,
        { overwriteExisting: preparation.overwriteExisting }, preparation.organizationId);
      if (result === null) throw new NotFoundError('Episode not found');
      if (!(await new PostgresEpisodePageSkeletonExecutionRepository(bound, this.schemaProfile)
        .completeEpisodePageSkeleton({ jobId: job.id, userId: job.userId, result, storyPlanApplied: false, storyPlanResult: null }))) {
        throw new ConflictError('Page skeleton terminal state could not be committed');
      }
      return result;
    });
  }

  public async settleEpisodePageSkeletonAttempt(
    job: GenerationJob,
    errorMessage?: string,
  ): Promise<EpisodePageSkeletonAttemptSettlement> {
    this.requireLegacyProfile();
    // Compensation stays available after admission closes, for this free attempt
    // only. A stale worker must never reach the generic failure/refund port.
    return this.client.transaction(async (client) => {
      await lockMobilePushTokenRegistryForTerminalSettlement(client);
      const locked = (await client.query<GenerationJobRow>('SELECT * FROM generation_jobs WHERE id = $1::uuid FOR UPDATE', [job.id])).rows[0];
      if (!sameSkeletonAttempt(locked, job) || locked.status !== 'processing' || locked.commit_started_at !== null) return 'lost';
      const bound = bindTransaction(client);
      if (locked.cancel_requested_at !== null) {
        return await new PostgresGenerationJobRepository(bound, this.schemaProfile).finalizeCancellation(job.id) ? 'cancelled' : 'lost';
      }
      if (locked.cancelled_at !== null) return 'lost';
      if (errorMessage === undefined) return 'active';
      return await new PostgresEpisodePageSkeletonExecutionRepository(bound, this.schemaProfile)
        .failEpisodePageSkeleton({ jobId: job.id, userId: job.userId, errorMessage }) ? 'failed' : 'lost';
    });
  }

  private requireLegacyProfile(): void {
    if (this.schemaProfile !== 'legacy_2debe_v1') throw new ConfigurationError('Legacy skeleton commit requires the legacy repository profile');
  }

  private async lockSkeletonSource(client: DatabaseClient, input: PageSkeletonPreparation): Promise<void> {
    try {
      await this.lockSkeletonSourceRows(client, input);
    } catch (error: unknown) {
      // Existing org editors have differing row orders. Prefer their edits over
      // an overwrite: do not wait while holding earlier graph locks. No retry or
      // other SQL-error translation is introduced here (including 40P01).
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '55P03') {
        throw new ConflictError('Page skeleton source is being edited; retry after editing finishes');
      }
      throw error;
    }
  }

  private async lockSkeletonSourceRows(client: DatabaseClient, input: PageSkeletonPreparation): Promise<void> {
    const episode = await client.query(
      `SELECT episodes.id FROM episodes
       INNER JOIN chapters ON chapters.id = episodes.chapter_id
       INNER JOIN works ON works.id = chapters.work_id
       WHERE episodes.id = $1::uuid AND (
         ($3::uuid IS NULL AND works.user_id = $2::uuid AND works.organization_id IS NULL)
         OR ($3::uuid IS NOT NULL AND works.organization_id = $3::uuid AND EXISTS (
           SELECT 1 FROM organization_members WHERE organization_id = works.organization_id
             AND user_id = $2::uuid AND status = 'active')))
       FOR UPDATE OF works, chapters, episodes NOWAIT`,
      [input.episodeId, input.userId, input.organizationId],
    );
    if (episode.rows[0] === undefined) throw new NotFoundError('Episode not found');
    await client.query('SELECT id FROM scenes WHERE episode_id = $1::uuid ORDER BY "order", id FOR UPDATE NOWAIT', [input.episodeId]);
    await client.query('SELECT id FROM pages WHERE episode_id = $1::uuid ORDER BY page_number, id FOR UPDATE NOWAIT', [input.episodeId]);
    await client.query(`SELECT panels.id FROM panels INNER JOIN pages ON pages.id = panels.page_id
      WHERE pages.episode_id = $1::uuid ORDER BY pages.page_number, panels."order", panels.id FOR UPDATE OF panels NOWAIT`, [input.episodeId]);
    await client.query(`SELECT panel_frames.id FROM panel_frames INNER JOIN pages ON pages.id = panel_frames.page_id
      WHERE pages.episode_id = $1::uuid ORDER BY pages.page_number, panel_frames.reading_order, panel_frames.id FOR UPDATE OF panel_frames NOWAIT`, [input.episodeId]);
    await client.query(`SELECT entities.id FROM entities INNER JOIN chapters ON chapters.work_id = entities.work_id
      INNER JOIN episodes ON episodes.chapter_id = chapters.id
      WHERE episodes.id = $1::uuid ORDER BY entities.id FOR UPDATE OF entities NOWAIT`, [input.episodeId]);
    await client.query(`SELECT reference_sets.id FROM reference_sets INNER JOIN entities ON entities.id = reference_sets.entity_id
      INNER JOIN chapters ON chapters.work_id = entities.work_id INNER JOIN episodes ON episodes.chapter_id = chapters.id
      WHERE episodes.id = $1::uuid ORDER BY reference_sets.id FOR UPDATE OF reference_sets NOWAIT`, [input.episodeId]);
    await client.query(`SELECT entity_states.id FROM entity_states INNER JOIN entities ON entities.id = entity_states.entity_id
      INNER JOIN chapters ON chapters.work_id = entities.work_id INNER JOIN episodes ON episodes.chapter_id = chapters.id
      WHERE episodes.id = $1::uuid ORDER BY entity_states.id FOR UPDATE OF entity_states NOWAIT`, [input.episodeId]);
    await client.query(`SELECT balloons.id FROM balloons INNER JOIN pages ON pages.id = balloons.page_id
      WHERE pages.episode_id = $1::uuid ORDER BY balloons.id FOR UPDATE OF balloons NOWAIT`, [input.episodeId]);
  }

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
      [
        input.jobId,
        input.userId,
        JSON.stringify(progress),
      ],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async completeEpisodePageSkeleton(input: CompleteEpisodePageSkeletonInput): Promise<boolean> {
    return this.client.transaction(async (transactionClient) => {
      await lockMobilePushTokenRegistryForTerminalSettlement(transactionClient);
      const result = await transactionClient.query<GenerationJobRow>(
        `
        UPDATE generation_jobs
        SET status = 'completed',
            result = $3::jsonb,
            completed_at = NOW()
        WHERE id = $1
          AND user_id = $2
          AND status = 'processing'
          AND cancel_requested_at IS NULL
          AND cancelled_at IS NULL
          AND commit_started_at IS NOT NULL
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
      const completedJob = result.rows[0];
      if (completedJob === undefined) {
        return false;
      }

      await enqueueTerminalGenerationJobNotificationAfterRegistryLock(
        transactionClient,
        completedJob,
        'completed',
        this.schemaProfile,
      );
      return true;
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
    return this.client.transaction(async (transactionClient) => {
      await lockMobilePushTokenRegistryForTerminalSettlement(transactionClient);
      const result = await transactionClient.query<GenerationJobRow>(
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
          AND cancelled_at IS NULL
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
      const failedJob = result.rows[0];
      if (failedJob === undefined) {
        return false;
      }

      await enqueueTerminalGenerationJobNotificationAfterRegistryLock(
        transactionClient,
        failedJob,
        'failed',
        this.schemaProfile,
      );
      return true;
    });
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

function sameSkeletonAttempt(row: GenerationJobRow | undefined, job: GenerationJob): row is GenerationJobRow {
  return row !== undefined && row.id === job.id && row.user_id === job.userId
    && row.organization_id === (job.organizationId ?? null)
    && row.job_type === 'episode_page_skeleton' && job.jobType === 'episode_page_skeleton'
    && row.credit_cost === 0 && job.creditCost === 0
    && row.retry_count === job.retryCount && row.started_at !== null && job.startedAt !== null
    && row.started_at.getTime() === job.startedAt.getTime()
    && isDeepStrictEqual(toJsonObject(row.params), job.params);
}

function toJsonObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isKnownOrganizationRole(role: unknown): role is OrganizationMemberRole {
  return role === 'owner' || role === 'admin' || role === 'editor' || role === 'billing' || role === 'viewer';
}
