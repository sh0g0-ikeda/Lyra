import {
  buildEpisodeExportArtifactKey,
} from '../../domain/episodeExportJob.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import type {
  EpisodeExportJobRepository,
} from '../../repositories/EpisodeExportJobRepository.js';
import type {
  EpisodeExportArtifactStoragePort,
} from './EpisodeExportStorage.js';

const MAX_CLEANUP_BATCH_SIZE = 1000;

export interface EpisodeExportCleanupResult {
  selectedCount: number;
  deletedCount: number;
  failedCount: number;
}

export class EpisodeExportCleanupService {
  public constructor(
    private readonly repository: EpisodeExportJobRepository,
    private readonly artifactStorage: EpisodeExportArtifactStoragePort,
  ) {}

  public async cleanupExpired(limit: number): Promise<EpisodeExportCleanupResult> {
    assertCleanupLimit(limit);
    const expired = await this.repository.listExpiredArtifacts(limit);
    let deletedCount = 0;
    let failedCount = 0;

    for (const artifact of expired) {
      try {
        const job = await this.repository.findForWorker(artifact.jobId);
        if (
          job === null
          || job.status !== 'completed'
          || job.artifactS3Key !== artifact.artifactS3Key
          || job.artifactMimeType === null
        ) {
          failedCount += 1;
          continue;
        }
        const expectedKey = buildEpisodeExportArtifactKey({
          userId: job.userId,
          organizationId: job.organizationId,
          episodeId: job.episodeId,
          jobId: job.id,
          format: job.format,
        });
        const expectedMimeType =
          job.format === 'pdf' ? 'application/pdf' : 'application/zip';
        if (
          expectedKey !== artifact.artifactS3Key
          || job.artifactMimeType !== expectedMimeType
        ) {
          failedCount += 1;
          continue;
        }

        await this.artifactStorage.delete({
          userId: job.userId,
          organizationId: job.organizationId,
          episodeId: job.episodeId,
          jobId: job.id,
          format: job.format,
          s3Key: artifact.artifactS3Key,
          mimeType: expectedMimeType,
        });
        const marked = await this.repository.markArtifactDeleted(
          job.id,
          artifact.artifactS3Key,
        );
        if (marked) {
          deletedCount += 1;
        } else {
          failedCount += 1;
        }
      } catch {
        failedCount += 1;
      }
    }

    return {
      selectedCount: expired.length,
      deletedCount,
      failedCount,
    };
  }
}

function assertCleanupLimit(value: number): void {
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > MAX_CLEANUP_BATCH_SIZE
  ) {
    throw new ConfigurationError('Episode export cleanup limit is invalid');
  }
}
