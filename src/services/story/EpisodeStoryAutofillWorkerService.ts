import { ValidationError } from '../../domain/errors/index.js';
import type { AppLanguage } from '../../domain/types/language.js';
import type {
  EpisodeStoryAutofillExecutionRepository,
} from '../../repositories/EpisodeStoryAutofillExecutionRepository.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';
import type {
  EpisodePagePlanExecutionControl,
  EpisodePagePlanProgress,
  PageServicePort,
} from '../page/PageService.js';

export interface ProcessEpisodeStoryAutofillJobResult {
  status: 'processed' | 'skipped';
  jobStatus?: 'completed' | 'failed' | 'cancelled';
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
    private readonly cancellationEnabled = true,
  ) {}

  public async processJob(jobId: string): Promise<ProcessEpisodeStoryAutofillJobResult> {
    const job = await this.repository.claimQueuedEpisodeStoryAutofillJob(jobId);
    if (job === null) {
      return { status: 'skipped' };
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

      const executionControl = this.createExecutionControl(job.id, job.userId);

      const result = await this.pageService.autofillEpisodeFromStory(
        job.userId,
        episodeId,
        language,
        async (progress) => {
          await this.recordProgress(job.id, job.userId, progress);
        },
        job.organizationId,
        executionControl,
      );
      if (!result.compilerUsed) {
        throw new ValidationError(
          result.compilerError ??
            'AI story plan autofill did not complete; page and panel fields were not changed',
        );
      }

      const completed = await this.repository.completeEpisodeStoryAutofill({
        jobId: job.id,
        userId: job.userId,
        result,
      });
      if (!completed) {
        throw new ValidationError('Episode story autofill result could not be committed');
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
      const cancellationFinalized =
        (error instanceof EpisodeStoryAutofillCancelledError || this.cancellationEnabled) &&
        await this.repository.cancelEpisodeStoryAutofill(job.id, job.userId);
      if (cancellationFinalized) {
        console.info('episode_story_autofill_cancelled', {
          jobId: job.id,
          userId: job.userId,
          episodeId,
        });
        return { status: 'processed', jobStatus: 'cancelled' };
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

  private createExecutionControl(jobId: string, userId: string): EpisodePagePlanExecutionControl {
    return {
      checkpoint: async () => {
        if (
          this.cancellationEnabled &&
          await this.repository.isEpisodeStoryAutofillCancellationRequested(jobId, userId)
        ) {
          throw new EpisodeStoryAutofillCancelledError();
        }
      },
      beginCommit: async () => {
        const started = await this.repository.beginEpisodeStoryAutofillCommit(jobId, userId);
        if (started) {
          return;
        }
        if (
          this.cancellationEnabled &&
          await this.repository.isEpisodeStoryAutofillCancellationRequested(jobId, userId)
        ) {
          throw new EpisodeStoryAutofillCancelledError();
        }
        throw new ValidationError('Episode story autofill could not enter the save phase');
      },
    };
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

class EpisodeStoryAutofillCancelledError extends Error {
  public constructor() {
    super('Episode story autofill was cancelled');
    this.name = 'EpisodeStoryAutofillCancelledError';
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
