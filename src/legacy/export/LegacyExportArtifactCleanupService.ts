import type { LegacyExportStoragePort } from './LegacyEpisodeExportWorkerService.js';
import type { LegacyExportJobRepositoryPort } from './LegacyEpisodeExportJobRepository.js';
import {
  LEGACY_EXPORT_EXTERNAL_OPERATION_TIMEOUT_MS,
  withLegacyExportExternalTimeout,
} from './LegacyEpisodeExportJob.js';

/** Invoked by a scheduled worker; API status already blocks expired downloads. */
export class LegacyExportArtifactCleanupService {
  public constructor(
    private readonly repository: LegacyExportJobRepositoryPort,
    private readonly storage: LegacyExportStoragePort,
    private readonly timeoutMs = LEGACY_EXPORT_EXTERNAL_OPERATION_TIMEOUT_MS,
  ) {}
  public async cleanupExpiredArtifacts(limit = 100): Promise<number> {
    const expired = await this.repository.listExpiredArtifacts(limit);
    let deleted = 0;
    for (const artifact of expired) {
      await withLegacyExportExternalTimeout(
        () => this.storage.deleteArtifact(artifact.artifactS3Key),
        this.timeoutMs,
      );
      await this.repository.markArtifactDeleted(artifact.id);
      deleted += 1;
    }
    return deleted;
  }
}
