import {
  EPISODE_EXPORT_ARTIFACT_TTL_MS,
  EPISODE_EXPORT_DOWNLOAD_URL_TTL_SECONDS,
  EPISODE_EXPORT_MAX_ARTIFACT_BYTES,
  buildEpisodeExportArtifactKey,
  buildEpisodeExportRequestFingerprint,
  normalizeEpisodeExportFilename,
  type EpisodeExportFormat,
  type EpisodeExportJob,
  type EpisodeExportJobStatus,
} from '../../domain/episodeExportJob.js';
import {
  ConflictError,
  NotFoundError,
} from '../../domain/errors/index.js';
import type {
  EpisodeExportJobRepository,
} from '../../repositories/EpisodeExportJobRepository.js';
import type {
  EpisodeExportDispatchPort,
} from './EpisodeExportDispatchService.js';

export interface CreateEpisodeExportRequest {
  format: EpisodeExportFormat;
  pageIds: string[];
  filename?: string;
  idempotencyKey: string;
}

export interface EpisodeExportAccepted {
  jobId: string;
  status: EpisodeExportJobStatus;
}

export interface EpisodeExportStatus {
  jobId: string;
  status: EpisodeExportJobStatus;
  progressStage: string;
  progressPercent: number;
  error: { code: string; message: string } | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date;
  downloadReady: boolean;
}

export interface EpisodeExportDownload {
  url: string;
  expiresAt: Date;
}

export interface EpisodeExportDownloadSignerPort {
  sign(input: {
    job: EpisodeExportJob;
    expiresInSeconds: number;
  }): Promise<string>;
}

export interface EpisodeExportServicePort {
  createExport(
    userId: string,
    episodeId: string,
    input: CreateEpisodeExportRequest,
    organizationId: string | null,
  ): Promise<EpisodeExportAccepted>;
  getExport(
    userId: string,
    jobId: string,
    organizationId: string | null,
  ): Promise<EpisodeExportStatus>;
  createDownload(
    userId: string,
    jobId: string,
    organizationId: string | null,
  ): Promise<EpisodeExportDownload>;
}

export interface EpisodeExportServiceOptions {
  now?: () => Date;
}

export class EpisodeExportService implements EpisodeExportServicePort {
  private readonly now: () => Date;

  public constructor(
    private readonly repository: EpisodeExportJobRepository,
    private readonly dispatcher: EpisodeExportDispatchPort,
    private readonly downloadSigner: EpisodeExportDownloadSignerPort,
    options: EpisodeExportServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  public async createExport(
    userId: string,
    episodeId: string,
    input: CreateEpisodeExportRequest,
    organizationId: string | null,
  ): Promise<EpisodeExportAccepted> {
    const filename = normalizeEpisodeExportFilename(input.filename, input.format);
    const requestFingerprint = buildEpisodeExportRequestFingerprint({
      episodeId,
      format: input.format,
      pageIds: input.pageIds,
      filename,
    });
    const created = await this.repository.createOrGet({
      userId,
      organizationId,
      episodeId,
      pageIds: input.pageIds,
      format: input.format,
      filename,
      requestFingerprint,
      idempotencyKey: input.idempotencyKey,
      expiresAt: new Date(this.now().getTime() + EPISODE_EXPORT_ARTIFACT_TTL_MS),
    });

    await this.bestEffortDispatch(created.job);
    return {
      jobId: created.job.id,
      status: created.job.status,
    };
  }

  public async getExport(
    userId: string,
    jobId: string,
    organizationId: string | null,
  ): Promise<EpisodeExportStatus> {
    const job = await this.findScopedJob(userId, jobId, organizationId);
    await this.bestEffortDispatch(job);
    return {
      jobId: job.id,
      status: job.status,
      progressStage: job.progressStage,
      progressPercent: job.progressPercent,
      error:
        job.errorCode === null || job.errorMessage === null
          ? null
          : { code: job.errorCode, message: job.errorMessage },
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      expiresAt: job.expiresAt,
      downloadReady: isDownloadReady(job, this.now()),
    };
  }

  public async createDownload(
    userId: string,
    jobId: string,
    organizationId: string | null,
  ): Promise<EpisodeExportDownload> {
    const job = await this.findScopedJob(userId, jobId, organizationId);
    const currentTime = this.now();
    if (!isDownloadReady(job, currentTime)) {
      throw new ConflictError('Episode export download is not ready');
    }

    const remainingSeconds = Math.floor(
      (job.expiresAt.getTime() - currentTime.getTime()) / 1000,
    );
    const expiresInSeconds = Math.min(
      EPISODE_EXPORT_DOWNLOAD_URL_TTL_SECONDS,
      remainingSeconds,
    );
    if (expiresInSeconds < 1) {
      throw new ConflictError('Episode export download is not ready');
    }

    let url: string;
    try {
      url = await this.downloadSigner.sign({ job, expiresInSeconds });
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
  ): Promise<EpisodeExportJob> {
    const job = await this.repository.findForScope({
      userId,
      organizationId,
      jobId,
    });
    if (job === null) {
      throw new NotFoundError('Episode export not found');
    }
    return job;
  }

  private async bestEffortDispatch(job: EpisodeExportJob): Promise<void> {
    if (job.status !== 'queued' || job.expiresAt.getTime() <= this.now().getTime()) {
      return;
    }
    try {
      await this.dispatcher.dispatchJob(job.id);
    } catch {
      // Creation is committed and status reads must remain available while SQS recovers.
    }
  }
}

function isDownloadReady(job: EpisodeExportJob, now: Date): boolean {
  if (
    job.status !== 'completed'
    || job.artifactS3Key === null
    || job.artifactMimeType === null
    || job.artifactSizeBytes === null
    || job.artifactSizeBytes < 1
    || job.artifactSizeBytes > EPISODE_EXPORT_MAX_ARTIFACT_BYTES
    || job.artifactDeletedAt !== null
    || job.expiresAt.getTime() <= now.getTime()
  ) {
    return false;
  }
  const expectedMimeType =
    job.format === 'pdf' ? 'application/pdf' : 'application/zip';
  try {
    return job.artifactMimeType === expectedMimeType
      && job.artifactS3Key === buildEpisodeExportArtifactKey({
        userId: job.userId,
        organizationId: job.organizationId,
        episodeId: job.episodeId,
        jobId: job.id,
        format: job.format,
      });
  } catch {
    return false;
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
