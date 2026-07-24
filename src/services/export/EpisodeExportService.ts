import {
  buildExportRequestFingerprint,
  EXPORT_ARTIFACT_TTL_MS,
  EXPORT_DOWNLOAD_URL_TTL_SECONDS,
  type ExportFormat,
  type ExportJob,
} from '../../domain/exportJob.js';
import { ConfigurationError, NotFoundError } from '../../domain/errors/index.js';
import type { ExportArtifactStoragePort } from '../../infrastructure/aws/S3ExportArtifactStorage.js';
import type { ExportJobRepository } from '../../repositories/ExportJobRepository.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';
import type { ExportJobQueuePort } from './ExportJobQueue.js';

export interface EpisodeExportServicePort {
  createExport(input: CreateEpisodeExportInput): Promise<{ jobId: string; status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled' }>;
  getExportStatus(input: GetExportStatusInput): Promise<ExportJobResponse>;
}

export interface CreateEpisodeExportInput { userId: string; organizationId: string | null; episodeId: string; pageIds: string[]; format: ExportFormat; filename: string; idempotencyKey: string; }
export interface GetExportStatusInput { userId: string; organizationId: string | null; jobId: string; }
export interface ExportJobResponse {
  id: string;
  episode_id: string;
  format: ExportFormat;
  filename: string;
  status: ExportJob['status'];
  progress_stage: string;
  progress_percent: number;
  error_code: string | null;
  message_key: string | null;
  expires_at: string;
  completed_at: string | null;
  cancel_supported: false;
  cancel_reason_code: 'EXPORT_CANCEL_UNSUPPORTED' | null;
  download_url?: string;
}

export class EpisodeExportService implements EpisodeExportServicePort {
  public constructor(
    private readonly repository: ExportJobRepository,
    private readonly queue: ExportJobQueuePort,
    private readonly storage?: ExportArtifactStoragePort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async createExport(input: CreateEpisodeExportInput): Promise<{ jobId: string; status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled' }> {
    const created = await this.repository.createOrGet({
      ...input,
      requestFingerprint: buildExportRequestFingerprint(input),
      expiresAt: new Date(this.clock().getTime() + EXPORT_ARTIFACT_TTL_MS),
    });
    if (created.created) {
      try {
        const queued = await this.queue.enqueue({ jobId: created.job.id });
        await this.repository.markDispatched(created.job.id, queued.messageId);
      } catch (error) {
        await this.repository.markDispatchFailure(created.job.id, sanitizePersistedErrorMessage(error, 'Export dispatch failed'));
      }
    }
    return { jobId: created.job.id, status: created.job.status };
  }

  public async getExportStatus(input: GetExportStatusInput): Promise<ExportJobResponse> {
    const job = await this.repository.findForScope(input);
    if (job === null) throw new NotFoundError('Export job not found');
    const response: ExportJobResponse = {
      id: job.id, episode_id: job.episodeId, format: job.format, filename: job.filename, status: job.status,
      progress_stage: job.progressStage, progress_percent: job.progressPercent,
      error_code: job.status === 'failed' ? (job.errorCode ?? 'EXPORT_FAILED') : null,
      message_key: job.status === 'failed' ? 'export.error.failed' : null,
      expires_at: job.expiresAt.toISOString(), completed_at: job.completedAt?.toISOString() ?? null,
      cancel_supported: false,
      cancel_reason_code: job.status === 'queued' || job.status === 'processing' ? 'EXPORT_CANCEL_UNSUPPORTED' : null,
    };
    if (job.status === 'completed' && job.artifactS3Key !== null && job.expiresAt > this.clock()) {
      if (this.storage === undefined) throw new ConfigurationError('Export artifact storage is not configured');
      response.download_url = await this.storage.createDownloadUrl({ s3Key: job.artifactS3Key, filename: job.filename, expiresInSeconds: EXPORT_DOWNLOAD_URL_TTL_SECONDS });
    }
    return response;
  }
}
