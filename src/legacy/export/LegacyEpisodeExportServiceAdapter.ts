import type { ImageDeliveryAudience } from '../../domain/generation/ImageAccessPolicy.js';
import { ConflictError, NotFoundError } from '../../domain/errors/index.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';
import type {
  CreateEpisodeExportRequest,
  EpisodeExportAccepted,
  EpisodeExportDownload,
  EpisodeExportServicePort,
  EpisodeExportStatus,
} from '../../services/export/EpisodeExportService.js';
import type { LegacyExportJob } from './LegacyEpisodeExportJob.js';
import {
  LEGACY_EXPORT_ARTIFACT_TTL_MS,
  LEGACY_EXPORT_DOWNLOAD_URL_TTL_SECONDS,
  LEGACY_EXPORT_EXTERNAL_OPERATION_TIMEOUT_MS,
  MAX_LEGACY_EXPORT_ARTIFACT_BYTES,
  buildLegacyExportRequestFingerprint,
  normalizeLegacyExportFilename,
  withLegacyExportExternalTimeout,
} from './LegacyEpisodeExportJob.js';
import type { LegacyExportJobRepositoryPort } from './LegacyEpisodeExportJobRepository.js';
import type { LegacyExportJobQueuePort } from './LegacyExportJobQueue.js';

export interface LegacyExportAccessGuardPort {
  assertCreateAllowed(input: {
    userId: string;
    organizationId: string | null;
    episodeId: string;
    pageIds: string[];
    audience: ImageDeliveryAudience;
  }): Promise<void>;
  assertDownloadAllowed(input: {
    userId: string;
    organizationId: string | null;
    audience: ImageDeliveryAudience;
    job: LegacyExportJob;
  }): Promise<void>;
}

export interface LegacyExportDownloadSignerPort {
  sign(input: { job: LegacyExportJob; expiresInSeconds: number }): Promise<string>;
}

/** Current service facade backed by the legacy physical export contract. Runtime wiring is gated elsewhere. */
export class LegacyEpisodeExportServiceAdapter implements EpisodeExportServicePort {
  public constructor(
    private readonly repository: LegacyExportJobRepositoryPort,
    private readonly queue: LegacyExportJobQueuePort,
    private readonly guard: LegacyExportAccessGuardPort,
    private readonly signer: LegacyExportDownloadSignerPort,
    private readonly now: () => Date = () => new Date(),
    private readonly externalOperationTimeoutMs = LEGACY_EXPORT_EXTERNAL_OPERATION_TIMEOUT_MS,
  ) {}

  public async createExport(
    userId: string,
    episodeId: string,
    input: CreateEpisodeExportRequest,
    organizationId: string | null,
  ): Promise<EpisodeExportAccepted> {
    const audience = input.audience ?? 'mobile';
    await this.guard.assertCreateAllowed({
      userId,
      organizationId,
      episodeId,
      pageIds: input.pageIds,
      audience,
    });

    const filename = normalizeLegacyExportFilename(input.filename, input.format);
    // Property order is part of the legacy request fingerprint written by the old route.
    const legacyRequest = {
      userId,
      organizationId,
      episodeId,
      pageIds: input.pageIds,
      format: input.format,
      filename,
      idempotencyKey: input.idempotencyKey,
    };
    const created = await this.repository.createOrGet({
      ...legacyRequest,
      requestFingerprint: buildLegacyExportRequestFingerprint(legacyRequest),
      expiresAt: new Date(this.now().getTime() + LEGACY_EXPORT_ARTIFACT_TTL_MS),
    });

    if (created.created) {
      try {
        const queued = await this.queue.enqueue({ jobId: created.job.id });
        await this.repository.markDispatched(created.job.id, queued.messageId);
      } catch (error) {
        await this.repository.markDispatchFailure(
          created.job.id,
          sanitizePersistedErrorMessage(error, 'Export dispatch failed'),
        );
      }
    }
    return { jobId: created.job.id, status: created.job.status };
  }

  public async getExport(
    userId: string,
    jobId: string,
    organizationId: string | null,
    audience: ImageDeliveryAudience = 'mobile',
  ): Promise<EpisodeExportStatus> {
    const job = await this.findScopedJob(userId, jobId, organizationId);
    let guardAllowsDownload = false;
    if (isLegacyDownloadReady(job, this.now())) {
      try {
        await this.guard.assertDownloadAllowed({ userId, organizationId, audience, job });
        guardAllowsDownload = true;
      } catch {
        guardAllowsDownload = false;
      }
    }
    return {
      jobId: job.id,
      episodeId: job.episodeId,
      format: job.format,
      filename: job.filename,
      status: job.status,
      progressStage: job.progressStage,
      progressPercent: job.progressPercent,
      error: job.errorCode === null || job.errorMessage === null
        ? null
        : { code: job.errorCode, message: job.errorMessage },
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      expiresAt: job.expiresAt,
      downloadReady: guardAllowsDownload,
    };
  }

  public async createDownload(
    userId: string,
    jobId: string,
    organizationId: string | null,
    audience: ImageDeliveryAudience = 'mobile',
  ): Promise<EpisodeExportDownload> {
    const job = await this.findScopedJob(userId, jobId, organizationId);
    await this.guard.assertDownloadAllowed({ userId, organizationId, audience, job });
    const currentTime = this.now();
    if (!isLegacyDownloadReady(job, currentTime)) {
      throw new ConflictError('Episode export download is not ready');
    }
    const remainingSeconds = Math.floor((job.expiresAt.getTime() - currentTime.getTime()) / 1000);
    const expiresInSeconds = Math.min(LEGACY_EXPORT_DOWNLOAD_URL_TTL_SECONDS, remainingSeconds);
    if (expiresInSeconds < 1) {
      throw new ConflictError('Episode export download is not ready');
    }
    let url: string;
    try {
      url = await withLegacyExportExternalTimeout(
        () => this.signer.sign({ job, expiresInSeconds }),
        this.externalOperationTimeoutMs,
      );
    } catch {
      throw new ConflictError('Episode export download is unavailable');
    }
    if (!isHttpsUrl(url)) {
      throw new ConflictError('Episode export download is unavailable');
    }
    return {
      url,
      expiresAt: new Date(currentTime.getTime() + expiresInSeconds * 1000),
    };
  }

  private async findScopedJob(
    userId: string,
    jobId: string,
    organizationId: string | null,
  ): Promise<LegacyExportJob> {
    const job = await this.repository.findForScope({ userId, jobId, organizationId });
    if (job === null) {
      throw new NotFoundError('Episode export not found');
    }
    return job;
  }
}

function isLegacyDownloadReady(job: LegacyExportJob, now: Date): boolean {
  if (
    job.status !== 'completed'
    || job.artifactS3Key === null
    || job.artifactMimeType === null
    || job.artifactSizeBytes === null
    || job.artifactSizeBytes < 1
    || job.artifactSizeBytes > MAX_LEGACY_EXPORT_ARTIFACT_BYTES
    || job.expiresAt.getTime() <= now.getTime()
  ) {
    return false;
  }
  const expectedMimeType = job.format === 'pdf' ? 'application/pdf' : 'application/zip';
  return job.artifactMimeType === expectedMimeType;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
