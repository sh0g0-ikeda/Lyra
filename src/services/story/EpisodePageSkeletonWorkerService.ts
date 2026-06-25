import { ValidationError } from '../../domain/errors/index.js';
import type { AppLanguage } from '../../domain/types/language.js';
import type { EpisodePagePlanApplyResult } from '../../domain/types/page.js';
import type {
  EpisodePageSkeletonExecutionRepository,
} from '../../repositories/EpisodePageSkeletonExecutionRepository.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';
import type {
  EpisodePagePlanProgress,
  PageServicePort,
} from '../page/PageService.js';
import type { PageSkeletonServicePort } from './PageSkeletonService.js';

export interface ProcessEpisodePageSkeletonJobResult {
  status: 'processed' | 'skipped';
  jobStatus?: 'completed' | 'failed';
}

export interface EpisodePageSkeletonWorkerPort {
  processJob(jobId: string): Promise<ProcessEpisodePageSkeletonJobResult>;
}

export class EpisodePageSkeletonWorkerService implements EpisodePageSkeletonWorkerPort {
  public constructor(
    private readonly repository: EpisodePageSkeletonExecutionRepository,
    private readonly pageSkeletonService: PageSkeletonServicePort,
    private readonly pageService?: PageServicePort,
  ) {}

  public async processJob(jobId: string): Promise<ProcessEpisodePageSkeletonJobResult> {
    const job = await this.repository.claimQueuedEpisodePageSkeletonJob(jobId);
    if (job === null) {
      return { status: 'skipped' };
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
      });

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
            await this.recordEpisodePlanProgress(job.id, job.userId, progress);
          },
        );
        if (!storyPlanResult.compilerUsed) {
          throw new ValidationError(
            storyPlanResult.compilerError ??
              'AI story plan autofill did not complete; page and panel fields were not changed',
          );
        }
      }

      await this.repository.completeEpisodePageSkeleton({
        jobId: job.id,
        userId: job.userId,
        result,
        storyPlanApplied: applyStoryPlan,
        storyPlanResult,
      });
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
      console.warn('episode_page_skeleton_failed', {
        jobId: job.id,
        userId: job.userId,
        episodeId,
        reason: sanitizePersistedErrorMessage(error, 'Episode page skeleton failed'),
      });
      await this.repository.failEpisodePageSkeleton({
        jobId: job.id,
        userId: job.userId,
        errorMessage: sanitizePersistedErrorMessage(error, 'Episode page skeleton failed'),
      });
      return { status: 'processed', jobStatus: 'failed' };
    }
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
}

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
