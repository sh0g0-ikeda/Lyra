import { randomUUID } from 'node:crypto';
import {
  EPISODE_EXPORT_MAX_ARTIFACT_BYTES,
  EPISODE_EXPORT_MAX_PROCESSING_ATTEMPTS,
  EPISODE_EXPORT_MAX_SOURCE_IMAGE_BYTES,
  EPISODE_EXPORT_MAX_TOTAL_SOURCE_BYTES,
  EPISODE_EXPORT_PROCESSING_LEASE_SECONDS,
  buildEpisodeExportArtifactKey,
  type EpisodeExportJob,
} from '../../domain/episodeExportJob.js';
import {
  EpisodeExportProcessingError,
  isEpisodeExportProcessingError,
} from '../../domain/episodeExportProcessing.js';
import type {
  EpisodeExportJobRepository,
} from '../../repositories/EpisodeExportJobRepository.js';
import { ensurePageImageKeyForPage } from '../storage/StoredImageKeyPolicy.js';
import type {
  EpisodeExportArtifactBuilderPort,
  EpisodeExportArtifactPage,
} from './EpisodeExportArtifactBuilder.js';
import type {
  EpisodeExportArtifactStoragePort,
  EpisodeExportSourceImageLoaderPort,
} from './EpisodeExportStorage.js';

export interface ProcessEpisodeExportJobResult {
  status: 'processed' | 'skipped' | 'retry';
  jobStatus?: 'completed' | 'failed';
  reason?: string;
}

export interface EpisodeExportWorkerOptions {
  leaseDurationSeconds?: number;
  maxAttempts?: number;
  minimumRemainingSeconds?: number;
  maxTotalSourceBytes?: number;
  leaseTokenFactory?: () => string;
}

interface ValidatedWorkerOptions {
  leaseDurationSeconds: number;
  maxAttempts: number;
  minimumRemainingSeconds: number;
  maxTotalSourceBytes: number;
  leaseTokenFactory: () => string;
}

export class EpisodeExportWorkerService {
  private readonly options: ValidatedWorkerOptions;

  public constructor(
    private readonly repository: EpisodeExportJobRepository,
    private readonly sourceLoader: EpisodeExportSourceImageLoaderPort,
    private readonly artifactBuilder: EpisodeExportArtifactBuilderPort,
    private readonly artifactStorage: EpisodeExportArtifactStoragePort,
    options: EpisodeExportWorkerOptions = {},
  ) {
    this.options = validateOptions(options);
  }

  public async processJob(
    jobId: string,
  ): Promise<ProcessEpisodeExportJobResult> {
    const leaseToken = this.options.leaseTokenFactory();
    const job = await this.repository.claim({
      jobId,
      leaseToken,
      leaseDurationSeconds: this.options.leaseDurationSeconds,
      maxAttempts: this.options.maxAttempts,
    });
    if (job === null) {
      return this.resolveUnclaimedJob(jobId);
    }

    try {
      const pages = await this.loadSourcePages(job, leaseToken);
      await this.updateProgress(job.id, leaseToken, 'building_artifact', 60);
      const built = await this.artifactBuilder.build({
        format: job.format,
        createdAt: job.createdAt,
        pages,
        onPageProcessed: async (completedCount, totalCount) => {
          await this.heartbeat(job.id, leaseToken);
          await this.updateProgress(
            job.id,
            leaseToken,
            'building_artifact',
            progressPercent(60, 84, completedCount, totalCount),
          );
        },
      });
      if (
        built.artifactData.length < 1
        || built.artifactData.length > EPISODE_EXPORT_MAX_ARTIFACT_BYTES
      ) {
        throw new EpisodeExportProcessingError(
          'EXPORT_ARTIFACT_TOO_LARGE',
          'The episode export artifact exceeds the allowed size',
          false,
        );
      }

      await this.heartbeat(job.id, leaseToken);
      await this.updateProgress(job.id, leaseToken, 'storing_artifact', 90);
      const artifactS3Key = buildEpisodeExportArtifactKey({
        userId: job.userId,
        organizationId: job.organizationId,
        episodeId: job.episodeId,
        jobId: job.id,
        format: job.format,
      });
      await this.artifactStorage.store({
        userId: job.userId,
        organizationId: job.organizationId,
        episodeId: job.episodeId,
        jobId: job.id,
        format: job.format,
        s3Key: artifactS3Key,
        mimeType: built.mimeType,
        artifactData: built.artifactData,
      });
      await this.heartbeat(job.id, leaseToken);
      await this.updateProgress(job.id, leaseToken, 'saving_result', 98);
      const completed = await this.repository.complete({
        jobId: job.id,
        leaseToken,
        artifactS3Key,
        artifactMimeType: built.mimeType,
        artifactSizeBytes: built.artifactData.length,
      });
      if (!completed) {
        return {
          status: 'retry',
          reason: 'Episode export lease was replaced before completion',
        };
      }
      return { status: 'processed', jobStatus: 'completed' };
    } catch (error) {
      return this.handleProcessingFailure(job.id, leaseToken, error);
    }
  }

  private async loadSourcePages(
    job: EpisodeExportJob,
    leaseToken: string,
  ): Promise<EpisodeExportArtifactPage[]> {
    const pages: EpisodeExportArtifactPage[] = [];
    let totalSourceBytes = 0;
    for (let index = 0; index < job.pageSnapshot.length; index += 1) {
      const snapshot = job.pageSnapshot[index];
      if (snapshot === undefined) {
        throw permanentSourceFailure();
      }
      await this.heartbeat(job.id, leaseToken);
      try {
        ensurePageImageKeyForPage(
          snapshot.s3Key,
          snapshot.pageId,
          'episode export source image key',
        );
      } catch {
        throw permanentSourceFailure();
      }
      const loaded = await this.sourceLoader.load({
        s3Key: snapshot.s3Key,
        mimeType: snapshot.mimeType,
      });
      if (
        loaded.mimeType !== snapshot.mimeType
        || loaded.imageData.length < 1
        || loaded.imageData.length > EPISODE_EXPORT_MAX_SOURCE_IMAGE_BYTES
      ) {
        throw permanentSourceFailure();
      }
      totalSourceBytes += loaded.imageData.length;
      if (totalSourceBytes > this.options.maxTotalSourceBytes) {
        throw new EpisodeExportProcessingError(
          'EXPORT_SOURCE_TOO_LARGE',
          'The selected page images exceed the export size limit',
          false,
        );
      }
      pages.push({
        pageId: snapshot.pageId,
        pageNumber: snapshot.pageNumber,
        imageData: loaded.imageData,
        mimeType: loaded.mimeType,
      });
      await this.updateProgress(
        job.id,
        leaseToken,
        'loading_images',
        progressPercent(5, 55, index + 1, job.pageSnapshot.length),
      );
    }
    return pages;
  }

  private async heartbeat(jobId: string, leaseToken: string): Promise<void> {
    const updated = await this.repository.heartbeat({
      jobId,
      leaseToken,
      leaseDurationSeconds: this.options.leaseDurationSeconds,
    });
    if (!updated) {
      throw lostLeaseError();
    }
  }

  private async updateProgress(
    jobId: string,
    leaseToken: string,
    stage: string,
    percent: number,
  ): Promise<void> {
    const updated = await this.repository.updateProgress({
      jobId,
      leaseToken,
      stage,
      percent,
    });
    if (!updated) {
      throw lostLeaseError();
    }
  }

  private async handleProcessingFailure(
    jobId: string,
    leaseToken: string,
    error: unknown,
  ): Promise<ProcessEpisodeExportJobResult> {
    const safeError = toSafeProcessingError(error);
    if (safeError.leaseLost) {
      return {
        status: 'retry',
        reason: 'Episode export processing lease was replaced',
      };
    }
    if (safeError.retryable) {
      const released = await this.repository.releaseForRetry({
        jobId,
        leaseToken,
      });
      return {
        status: 'retry',
        reason: released
          ? 'Episode export will retry after a temporary failure'
          : 'Episode export lease was replaced during retry release',
      };
    }
    const failed = await this.repository.fail({
      jobId,
      leaseToken,
      errorCode: safeError.code,
      errorMessage: safeError.message,
    });
    if (!failed) {
      return {
        status: 'retry',
        reason: 'Episode export lease was replaced before failure was saved',
      };
    }
    return { status: 'processed', jobStatus: 'failed' };
  }

  private async resolveUnclaimedJob(
    jobId: string,
  ): Promise<ProcessEpisodeExportJobResult> {
    const existing = await this.repository.findForWorker(jobId);
    if (existing === null) {
      return {
        status: 'skipped',
        reason: 'Episode export job no longer exists',
      };
    }
    if (
      existing.status === 'completed'
      || existing.status === 'failed'
      || existing.status === 'canceled'
    ) {
      return {
        status: 'skipped',
        reason: `Episode export job is already ${existing.status}`,
      };
    }
    const failed = await this.repository.failUnclaimable({
      jobId,
      maxAttempts: this.options.maxAttempts,
      minimumRemainingSeconds: this.options.minimumRemainingSeconds,
      errorCode: 'EXPORT_ATTEMPTS_EXHAUSTED',
      errorMessage: 'Episode export could not finish within its retry limit',
    });
    if (failed) {
      return { status: 'processed', jobStatus: 'failed' };
    }
    return {
      status: 'retry',
      reason: existing.status === 'processing'
        ? 'Episode export job is already processing'
        : 'Episode export job was not claimed yet',
    };
  }
}

function validateOptions(
  options: EpisodeExportWorkerOptions,
): ValidatedWorkerOptions {
  return {
    leaseDurationSeconds: boundedInteger(
      options.leaseDurationSeconds ?? EPISODE_EXPORT_PROCESSING_LEASE_SECONDS,
      1,
      30 * 60,
      'Episode export worker lease configuration is invalid',
    ),
    maxAttempts: boundedInteger(
      options.maxAttempts ?? EPISODE_EXPORT_MAX_PROCESSING_ATTEMPTS,
      1,
      100,
      'Episode export worker attempts configuration is invalid',
    ),
    minimumRemainingSeconds: boundedInteger(
      options.minimumRemainingSeconds
        ?? EPISODE_EXPORT_PROCESSING_LEASE_SECONDS,
      1,
      24 * 60 * 60,
      'Episode export worker remaining time configuration is invalid',
    ),
    maxTotalSourceBytes: boundedInteger(
      options.maxTotalSourceBytes ?? EPISODE_EXPORT_MAX_TOTAL_SOURCE_BYTES,
      1,
      EPISODE_EXPORT_MAX_TOTAL_SOURCE_BYTES,
      'Episode export worker source size configuration is invalid',
    ),
    leaseTokenFactory: options.leaseTokenFactory ?? randomUUID,
  };
}

function progressPercent(
  minimum: number,
  maximum: number,
  completedCount: number,
  totalCount: number,
): number {
  if (
    totalCount < 1
    || completedCount < 0
    || completedCount > totalCount
  ) {
    return minimum;
  }
  return Math.min(
    maximum,
    Math.max(
      minimum,
      Math.round(minimum + (
        (maximum - minimum) * completedCount
      ) / totalCount),
    ),
  );
}

function permanentSourceFailure(): EpisodeExportProcessingError {
  return new EpisodeExportProcessingError(
    'EXPORT_SOURCE_INVALID',
    'One or more page images are unavailable for export',
    false,
  );
}

function lostLeaseError(): EpisodeExportProcessingError {
  return new EpisodeExportProcessingError(
    'EXPORT_LEASE_LOST',
    'Episode export processing lease was replaced',
    true,
    true,
  );
}

function toSafeProcessingError(error: unknown): EpisodeExportProcessingError {
  if (isEpisodeExportProcessingError(error)) {
    return error;
  }
  return new EpisodeExportProcessingError(
    'EXPORT_TEMPORARY_FAILURE',
    'Episode export is temporarily unavailable',
    true,
  );
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  message: string,
): number {
  if (
    !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw new Error(message);
  }
  return value;
}
