import { ValidationError } from '../../domain/errors/index.js';
import type { AppLanguage } from '../../domain/types/language.js';
import type { EpisodePagePlanApplyResult } from '../../domain/types/page.js';
import type {
  EpisodePageSkeletonExecutionRepository,
} from '../../repositories/EpisodePageSkeletonExecutionRepository.js';
import type { GenerationJobCancellationCheckpointPort } from '../../repositories/GenerationJobRepository.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';
import type {
  EpisodePagePlanProgress,
  PageServicePort,
} from '../page/PageService.js';
import type { PageSkeletonServicePort } from './PageSkeletonService.js';

export interface ProcessEpisodePageSkeletonJobResult {
  status: 'processed' | 'skipped';
  jobStatus?: 'completed' | 'failed' | 'cancelled';
}

export interface EpisodePageSkeletonWorkerPort {
  processJob(jobId: string): Promise<ProcessEpisodePageSkeletonJobResult>;
}

export class EpisodePageSkeletonWorkerService implements EpisodePageSkeletonWorkerPort {
  public constructor(
    private readonly repository: EpisodePageSkeletonExecutionRepository,
    private readonly pageSkeletonService: PageSkeletonServicePort,
    private readonly pageService?: PageServicePort,
    private readonly cancellationCheckpoint?: GenerationJobCancellationCheckpointPort,
  ) {}

  public async processJob(jobId: string): Promise<ProcessEpisodePageSkeletonJobResult> {
    const job = await this.repository.claimQueuedEpisodePageSkeletonJob(jobId);
    if (job === null) {
      return { status: 'skipped' };
    }
    if (await this.finalizeCancellationIfRequested(job.id)) {
      return { status: 'processed', jobStatus: 'cancelled' };
    }

    const episodeId = readStringParam(job.params, 'episode_id');
    const language = readLanguageParam(job.params, 'language');
    const overwriteExisting = readBooleanParam(job.params, 'overwrite_existing');
    const applyStoryPlan = readBooleanParam(job.params, 'apply_story_plan');
    if (
      episodeId === null ||
      language === null ||
      overwriteExisting === null ||
      applyStoryPlan === null
    ) {
      await this.repository.failEpisodePageSkeleton({
        jobId: job.id,
        userId: job.userId,
        errorMessage: 'Episode page skeleton job is missing required params',
      });
      return { status: 'processed', jobStatus: 'failed' };
    }

    let skeletonResult: Awaited<ReturnType<PageSkeletonServicePort['generateForEpisode']>> | null = null;
    let storyPlanCompleted = applyStoryPlan === false;

    try {
      await this.recordProgress(job.id, job.userId, {
        stage: 'started',
        message: 'Generating page skeleton. This process can take around 20 minutes.',
      });
      console.info('episode_page_skeleton_started', {
        jobId: job.id,
        userId: job.userId,
        episodeId,
      });

      const result = await this.pageSkeletonService.generateForEpisode(job.userId, episodeId, {
        overwriteExisting,
        language,
        allowCompilerFallback: false,
      }, job.organizationId);
      skeletonResult = result;

      if (await this.finalizeCancellationIfRequested(job.id)) {
        return { status: 'processed', jobStatus: 'cancelled' };
      }

      let storyPlanResult: EpisodePagePlanApplyResult | null = null;
      if (applyStoryPlan) {
        if (this.pageService === undefined) {
          throw new ValidationError('Page service is not configured for story plan autofill');
        }

        await this.recordProgress(job.id, job.userId, {
          stage: 'applying_story_plan',
          message: 'Applying story plan to pages and panels. This process can take around 20 minutes.',
        });
        storyPlanResult = await this.pageService.autofillEpisodeFromStory(
          job.userId,
          episodeId,
          language,
          async (progress) => {
            if (await this.finalizeCancellationIfRequested(job.id)) {
              throw new ProcessingCancellationRequestedError();
            }
            await this.recordEpisodePlanProgress(job.id, job.userId, progress);
          },
          job.organizationId,
        );
        if (!storyPlanResult.compilerUsed) {
          throw new ValidationError(
            storyPlanResult.compilerError ??
              'AI story plan autofill did not complete; page and panel fields were not changed',
          );
        }
        storyPlanCompleted = true;
      }

      if (await this.finalizeCancellationIfRequested(job.id)) {
        return { status: 'processed', jobStatus: 'cancelled' };
      }

      const completed = await this.repository.completeEpisodePageSkeleton({
        jobId: job.id,
        userId: job.userId,
        result,
        storyPlanApplied: applyStoryPlan,
        storyPlanResult,
      });
      if (!completed) {
        if (await this.finalizeCancellationIfRequested(job.id)) {
          return { status: 'processed', jobStatus: 'cancelled' };
        }
        throw new ValidationError('Failed to persist episode page skeleton result');
      }
      console.info('episode_page_skeleton_completed', {
        jobId: job.id,
        userId: job.userId,
        episodeId,
        pagesCreated: result.pagesCreated,
        panelsCreated: result.panelsCreated,
        storyPlanApplied: applyStoryPlan,
      });
      return { status: 'processed', jobStatus: 'completed' };
    } catch (error) {
      if (error instanceof ProcessingCancellationRequestedError) {
        return { status: 'processed', jobStatus: 'cancelled' };
      }
      console.warn('episode_page_skeleton_failed', {
        jobId: job.id,
        userId: job.userId,
        episodeId,
        reason: sanitizePersistedErrorMessage(error, 'Episode page skeleton failed'),
      });
      if (applyStoryPlan && skeletonResult !== null && !skeletonResult.replacedExisting && !storyPlanCompleted) {
        await this.rollbackFreshSkeletonAfterStoryPlanFailure(
          job.id,
          job.userId,
          episodeId,
          skeletonResult.pagesCreated,
          job.organizationId ?? null,
        );
      }
      await this.repository.failEpisodePageSkeleton({
        jobId: job.id,
        userId: job.userId,
        errorMessage: sanitizePersistedErrorMessage(error, 'Episode page skeleton failed'),
      });
      return { status: 'processed', jobStatus: 'failed' };
    }
  }

  private async finalizeCancellationIfRequested(jobId: string): Promise<boolean> {
    return this.cancellationCheckpoint?.finalizeCancellationIfRequested(jobId) ?? false;
  }

  private async recordProgress(
    jobId: string,
    userId: string,
    progress: { stage: string; message: string },
  ): Promise<void> {
    try {
      await this.repository.updateEpisodePageSkeletonProgress({
        jobId,
        userId,
        stage: progress.stage,
        message: progress.message,
      });
    } catch (error) {
      console.warn('episode_page_skeleton_progress_update_failed', {
        jobId,
        reason: sanitizePersistedErrorMessage(error, 'Progress update failed'),
      });
    }
  }

  private async recordEpisodePlanProgress(
    jobId: string,
    userId: string,
    progress: EpisodePagePlanProgress,
  ): Promise<void> {
    try {
      await this.repository.updateEpisodePageSkeletonProgress({
        jobId,
        userId,
        stage: progress.stage,
        message: progress.message,
        currentChunk: progress.currentChunk,
        totalChunks: progress.totalChunks,
      });
    } catch (error) {
      console.warn('episode_page_skeleton_progress_update_failed', {
        jobId,
        reason: sanitizePersistedErrorMessage(error, 'Progress update failed'),
      });
    }
  }

  private async rollbackFreshSkeletonAfterStoryPlanFailure(
    jobId: string,
    userId: string,
    episodeId: string,
    expectedPageCount: number,
    organizationId: string | null,
  ): Promise<void> {
    try {
      await this.recordProgress(jobId, userId, {
        stage: 'rolling_back',
        message: 'Story plan could not be applied, so the temporary page skeleton is being rolled back.',
      });
      const rolledBack = await this.pageSkeletonService.rollbackFreshSkeleton(
        userId,
        episodeId,
        expectedPageCount,
        organizationId,
      );
      console.warn('episode_page_skeleton_rolled_back_after_story_plan_failure', {
        jobId,
        userId,
        episodeId,
        rolledBack,
      });
    } catch (rollbackError) {
      console.error('episode_page_skeleton_rollback_failed', {
        jobId,
        userId,
        episodeId,
        reason: sanitizePersistedErrorMessage(rollbackError, 'Page skeleton rollback failed'),
      });
    }
  }
}

class ProcessingCancellationRequestedError extends Error {}

function readStringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readLanguageParam(params: Record<string, unknown>, key: string): AppLanguage | null {
  const value = params[key];
  return value === 'ja' || value === 'en' ? value : null;
}

function readBooleanParam(params: Record<string, unknown>, key: string): boolean | null {
  const value = params[key];
  return typeof value === 'boolean' ? value : null;
}
