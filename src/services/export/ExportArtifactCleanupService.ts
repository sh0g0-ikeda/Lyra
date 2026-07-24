import type { ExportArtifactStoragePort } from '../../infrastructure/aws/S3ExportArtifactStorage.js';
import type { ExportJobRepository } from '../../repositories/ExportJobRepository.js';

/** Invoked by a scheduled worker; API status already blocks expired downloads. */
export class ExportArtifactCleanupService {
  public constructor(private readonly repository: ExportJobRepository, private readonly storage: ExportArtifactStoragePort) {}
  public async cleanupExpiredArtifacts(limit = 100): Promise<number> {
    const expired = await this.repository.listExpiredArtifacts(limit);
    let deleted = 0;
    for (const artifact of expired) {
      await this.storage.deleteArtifact(artifact.artifactS3Key);
      await this.repository.markArtifactDeleted(artifact.id);
      deleted += 1;
    }
    return deleted;
  }
}
