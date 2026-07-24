import {
  MAX_EXPORT_ARTIFACT_BYTES,
  MAX_EXPORT_SOURCE_IMAGE_BYTES,
  MAX_EXPORT_TOTAL_SOURCE_BYTES,
  type ExportJob,
} from '../../domain/exportJob.js';
import { PayloadTooLargeError, ValidationError } from '../../domain/errors/index.js';
import type { ExportArtifactStoragePort } from '../../infrastructure/aws/S3ExportArtifactStorage.js';
import { createExportArtifactBuilder, type ExportArtifactBuilderPort } from '../../infrastructure/export/ExportArtifactBuilder.js';
import type { ExportJobRepository } from '../../repositories/ExportJobRepository.js';

export interface ProcessExportJobResult { status: 'completed' | 'failed' | 'skipped' | 'retry'; jobStatus?: 'completed' | 'failed'; reason?: string; }
export interface EpisodeExportWorkerPort { processJob(jobId: string): Promise<ProcessExportJobResult>; }
export interface EpisodeExportWorkerLimits { maxTotalSourceBytes?: number; }

export class EpisodeExportWorkerService implements EpisodeExportWorkerPort {
  public constructor(
    private readonly repository: ExportJobRepository,
    private readonly storage: ExportArtifactStoragePort,
    private readonly artifactBuilderFactory: (format: ExportJob['format']) => ExportArtifactBuilderPort = createExportArtifactBuilder,
    private readonly limits: EpisodeExportWorkerLimits = {},
  ) {}

  public async processJob(jobId: string): Promise<ProcessExportJobResult> {
    const job = await this.repository.claim(jobId);
    if (job === null) return { status: 'skipped' };
    try {
      const sourceImages: Array<{ pageId: string; imageData: Buffer; mimeType: ExportJob['pageSnapshot'][number]['mimeType'] }> = [];
      let totalSourceBytes = 0;
      const maxTotalSourceBytes = this.limits.maxTotalSourceBytes ?? MAX_EXPORT_TOTAL_SOURCE_BYTES;
      for (let index = 0; index < job.pageSnapshot.length; index += 1) {
        const page = job.pageSnapshot[index] as ExportJob['pageSnapshot'][number];
        const imageData = await this.storage.loadPageImage({ s3Key: page.s3Key, mimeType: page.mimeType });
        if (imageData.length > MAX_EXPORT_SOURCE_IMAGE_BYTES) {
          throw new PayloadTooLargeError('Export source image is too large');
        }
        totalSourceBytes += imageData.length;
        if (totalSourceBytes > maxTotalSourceBytes) {
          throw new PayloadTooLargeError('Export source images are too large');
        }
        sourceImages.push({ pageId: page.pageId, imageData, mimeType: page.mimeType });
        await this.repository.updateProgress(job.id, 'loading_images', Math.max(1, Math.floor(((index + 1) / job.pageSnapshot.length) * 50)));
      }
      await this.repository.updateProgress(job.id, 'building_artifact', 65);
      const artifact = await this.artifactBuilderFactory(job.format).build(sourceImages);
      if (artifact.data.length > MAX_EXPORT_ARTIFACT_BYTES) throw new PayloadTooLargeError('Export artifact is too large');
      await this.repository.updateProgress(job.id, 'storing_artifact', 90);
      const stored = await this.storage.storeArtifact({ jobId: job.id, artifact, expiresAt: job.expiresAt });
      await this.repository.complete({ jobId: job.id, artifactS3Key: stored.s3Key, artifactMimeType: artifact.mimeType, artifactSizeBytes: artifact.data.length });
      return { status: 'completed', jobStatus: 'completed' };
    } catch (error) {
      const failure = classifyExportFailure(error);
      await this.repository.fail(job.id, failure.code, failure.message);
      return { status: 'failed', jobStatus: 'failed', reason: failure.code };
    }
  }
}

function classifyExportFailure(error: unknown): { code: string; message: string } {
  if (error instanceof PayloadTooLargeError) return { code: 'EXPORT_TOO_LARGE', message: 'Export exceeds the supported size' };
  if (error instanceof ValidationError) return { code: 'EXPORT_SOURCE_UNAVAILABLE', message: 'One or more export pages are unavailable' };
  return { code: 'EXPORT_FAILED', message: 'Export could not be completed' };
}
