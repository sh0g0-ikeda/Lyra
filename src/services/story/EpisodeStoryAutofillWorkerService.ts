import { ValidationError } from '../../domain/errors/index.js';
import type { AppLanguage } from '../../domain/types/language.js';
import type {
  EpisodeStoryAutofillExecutionRepository,
} from '../../repositories/EpisodeStoryAutofillExecutionRepository.js';
import type { GenerationJobCancellationCheckpointPort } from '../../repositories/GenerationJobRepository.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';
import type { EpisodePagePlanProgress, PageServicePort } from '../page/PageService.js';

export interface ProcessEpisodeStoryAutofillJobResult {
  status: 'processed' | 'skipped';
  jobStatus?: 'completed' | 'failed' | 'canceled';
}

export interface EpisodeStoryAutofillWorkerPort {
  processJob(jobId: string): Promise<ProcessEpisodeStoryAutofillJobResult>;
}

/**
 * Executes queued story-to-page autofill jobs outside the HTTP request path.
 * The compiler result must be AI-backed; fallback-only results are recorded as
 * failed so sparse panel fields are not silently written as successful output.
 */
export class EpisodeStoryAutofillWorkerService implements EpisodeStoryAutofillWorkerPort {
  public constructor(
    private readonly repository: EpisodeStoryAutofillExecutionRepository,
    private readonly pageService: PageServicePort,
    private readonly cancellationCheckpoint?: GenerationJobCancellationCheckpointPort,
  ) {}

  public async processJob(jobId: string): Promise<ProcessEpisodeStoryAutofillJobResult> {
    const job = await this.repository.claimQueuedEpisodeStoryAutofillJob(jobId);
    if (job === null) {
      return { status: 'skipped' };
    }
    if (await this.finalizeCancellationIfRequested(job.id)) {
      return { status: 'processed', jobStatus: 'canceled' };
    }

    const episodeId = readStringParam(job.params, 'episode_id');
    const language = readLanguageParam(job.params, 'language');
    if (episodeId === null || language === null) {
      await this.repository.failEpisodeStoryAutofill({
        jobId: job.id,
        userId: job.userId,
        errorMessage: 'Episode story autofill job is missing required params',
      });
      return { status: 'processed', jobStatus: 'failed' };
    }

    try {
      await this.recordProgress(job.id, job.userId, {
        stage: 'started',
        message: 'Applying story plan to pages and panels. This process can take around 20 minutes.',
        currentChunk: null,
        totalChunks: null,
      });
      console.info('episode_story_autofill_started', {
        jobId: job.id,
        userId: job.userId,
        episodeId,
      });

      const result = await this.pageService.autofillEpisodeFromStory(
        job.userId,
        episodeId,
        language,
        async (progress) => {
          if (await this.finalizeCancellationIfRequested(job.id)) {
            throw new ProcessingCancellationRequestedError();
          }
          await this.recordProgress(job.id, job.userId, progress);
        },
        job.organizationId,
      );
      if (!result.compilerUsed) {
        throw new ValidationError(
          result.compilerError ??
            'AI story plan autofill did not complete; page and panel fields were not changed',
        );
      }

      if (await this.finalizeCancellationIfRequested(job.id)) {
        return { status: 'processed', jobStatus: 'canceled' };
      }

      const completed = await this.repository.completeEpisodeStoryAutofill({
        jobId: job.id,
        userId: job.userId,
        result,
      });
      if (!completed) {
        if (await this.finalizeCancellationIfRequested(job.id)) {
          return { status: 'processed', jobStatus: 'canceled' };
        }
        throw new ValidationError('Failed to persist episode story autofill result');
      }
      console.info('episode_story_autofill_completed', {
        jobId: job.id,
        userId: job.userId,
        episodeId,
        updatedPageCount: result.updatedPageCount,
        updatedPanelCount: result.updatedPanelCount,
        filledFieldCount: result.filledFieldCount,
      });
      return { status: 'processed', jobStatus: 'completed' };
    } catch (error) {
      if (error instanceof ProcessingCancellationRequestedError) {
        return { status: 'processed', jobStatus: 'canceled' };
      }
      console.warn('episode_story_autofill_failed', {
        jobId: job.id,
        userId: job.userId,
        episodeId,
        reason: sanitizePersistedErrorMessage(error, 'Episode story autofill failed'),
      });
      await this.repository.failEpisodeStoryAutofill({
        jobId: job.id,
        userId: job.userId,
        errorMessage: sanitizePersistedErrorMessage(error, 'Episode story autofill failed'),
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
    progress: EpisodePagePlanProgress | {
      stage: string;
      message: string;
      currentChunk: number | null;
      totalChunks: number | null;
    },
  ): Promise<void> {
    try {
      await this.repository.updateEpisodeStoryAutofillProgress({
        jobId,
        userId,
        stage: progress.stage,
        message: progress.message,
        currentChunk: progress.currentChunk,
        totalChunks: progress.totalChunks,
      });
    } catch (error) {
      console.warn('episode_story_autofill_progress_update_failed', {
        jobId,
        reason: sanitizePersistedErrorMessage(error, 'Progress update failed'),
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
