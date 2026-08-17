import { ValidationError } from '../../domain/errors/index.js';
import type { AppLanguage } from '../../domain/types/language.js';
import type {
  EpisodePageSkeletonExecutionRepository,
} from '../../repositories/EpisodePageSkeletonExecutionRepository.js';
import type { GenerationJobCancellationCheckpointPort } from '../../repositories/GenerationJobRepository.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';
import type { PageSkeletonServicePort } from './PageSkeletonService.js';

export interface ProcessEpisodePageSkeletonJobResult {
  status: 'processed' | 'skipped';
  jobStatus?: 'completed' | 'failed' | 'cancelled';
}

export interface EpisodePageSkeletonWorkerPort {
  processJob(jobId: string): Promise<ProcessEpisodePageSkeletonJobResult>;
}

/**
 * Provider work stays outside the database transaction. The repository owns
 * the short persistence transaction: job commit gate, source recheck, page
 * replacement, and terminal status are one boundary.
 */
export class EpisodePageSkeletonWorkerService implements EpisodePageSkeletonWorkerPort {
  public constructor(
    private readonly repository: EpisodePageSkeletonExecutionRepository,
    private readonly pageSkeletonService: PageSkeletonServicePort,
    private readonly cancellationCheckpoint?: GenerationJobCancellationCheckpointPort,
  ) {}

  public async processJob(jobId: string): Promise<ProcessEpisodePageSkeletonJobResult> {
    const job = await this.repository.claimQueuedEpisodePageSkeletonJob(jobId);
    if (job === null) return { status: 'skipped' };
    if (await this.finalizeCancellationIfRequested(job.id)) {
      return { status: 'processed', jobStatus: 'cancelled' };
    }

    const episodeId = readStringParam(job.params, 'episode_id');
    const language = readLanguageParam(job.params, 'language');
    const overwriteExisting = readBooleanParam(job.params, 'overwrite_existing');
    if (episodeId === null || language === null || overwriteExisting === null) {
      await this.failOrRetry(job.id, job.userId, 'Episode page skeleton job is missing required params');
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

      const prepareSkeleton = this.pageSkeletonService.prepareForEpisode;
      if (prepareSkeleton === undefined) {
        throw new ValidationError('Page skeleton preparation is not configured');
      }
      const prepared = await prepareSkeleton.call(
        this.pageSkeletonService,
        job.userId,
        episodeId,
        { overwriteExisting, language, allowCompilerFallback: false },
        job.organizationId,
      );

      if (await this.finalizeCancellationIfRequested(job.id)) {
        return { status: 'processed', jobStatus: 'cancelled' };
      }

      // Legacy apply_story_plan=true is intentionally ignored. Story application
      // is a distinct job created only from the explicit second action.
      const result = await this.repository.commitPreparedEpisodePageSkeleton({
        jobId: job.id,
        userId: job.userId,
        organizationId: job.organizationId ?? null,
        prepared,
        overwriteExisting,
      });
      if (result === null) {
        if (await this.finalizeCancellationIfRequested(job.id)) {
          return { status: 'processed', jobStatus: 'cancelled' };
        }
        throw new ValidationError('Page skeleton could not enter the save phase');
      }

      console.info('episode_page_skeleton_completed', {
        jobId: job.id,
        userId: job.userId,
        episodeId,
        pagesCreated: result.pagesCreated,
        panelsCreated: result.panelsCreated,
        storyPlanApplied: false,
      });
      return { status: 'processed', jobStatus: 'completed' };
    } catch (error) {
      if (await this.finalizeCancellationIfRequested(job.id)) {
        return { status: 'processed', jobStatus: 'cancelled' };
      }
      const errorMessage = sanitizePersistedErrorMessage(error, 'Episode page skeleton failed');
      console.warn('episode_page_skeleton_failed', {
        jobId: job.id,
        userId: job.userId,
        episodeId,
        reason: errorMessage,
      });
      await this.failOrRetry(job.id, job.userId, errorMessage, error);
      return { status: 'processed', jobStatus: 'failed' };
    }
  }

  private async failOrRetry(
    jobId: string,
    userId: string,
    errorMessage: string,
    originalError?: unknown,
  ): Promise<void> {
    const failed = await this.repository.failEpisodePageSkeleton({ jobId, userId, errorMessage });
    if (!failed) {
      // A committed transaction can be followed by an ambiguous connection error.
      // Do not overwrite a completed job as failed; surface it for queue retry.
      throw originalError instanceof Error ? originalError : new ValidationError(
        'Page skeleton job terminal state could not be persisted',
      );
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
