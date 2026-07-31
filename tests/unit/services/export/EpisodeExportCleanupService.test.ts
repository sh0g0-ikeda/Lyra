import { describe, expect, it } from 'vitest';
import type { EpisodeExportJob } from '../../../../src/domain/episodeExportJob.js';
import type {
  EpisodeExportJobRepository,
  ExpiredEpisodeExportArtifact,
} from '../../../../src/repositories/EpisodeExportJobRepository.js';
import {
  EpisodeExportCleanupService,
} from '../../../../src/services/export/EpisodeExportCleanupService.js';
import type {
  EpisodeExportArtifactStoragePort,
} from '../../../../src/services/export/EpisodeExportStorage.js';

const userId = '11111111-1111-4111-8111-111111111111';
const episodeId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const artifactS3Key = `exports/${userId}/episodes/${episodeId}/${jobId}.pdf`;

describe('EpisodeExportCleanupService', () => {
  it('期限切れartifactの完全なidentityを検証しdelete後に同じkeyだけmarkする', async () => {
    const repository = new FakeRepository();
    const storage = new FakeStorage();
    const service = new EpisodeExportCleanupService(
      repository as unknown as EpisodeExportJobRepository,
      storage,
    );

    await expect(service.cleanupExpired(50)).resolves.toEqual({
      selectedCount: 1,
      deletedCount: 1,
      failedCount: 0,
    });
    expect(storage.deleted).toEqual([{
      userId,
      organizationId: null,
      episodeId,
      jobId,
      format: 'pdf',
      s3Key: artifactS3Key,
      mimeType: 'application/pdf',
    }]);
    expect(repository.marked).toEqual([{ jobId, artifactS3Key }]);
  });

  it('storage削除失敗時はDBをmarkせず次回再試行可能にする', async () => {
    const repository = new FakeRepository();
    const storage = new FakeStorage();
    storage.fail = true;
    const service = new EpisodeExportCleanupService(
      repository as unknown as EpisodeExportJobRepository,
      storage,
    );

    await expect(service.cleanupExpired(50)).resolves.toEqual({
      selectedCount: 1,
      deletedCount: 0,
      failedCount: 1,
    });
    expect(repository.marked).toEqual([]);
  });

  it('DB jobとartifact keyが一致しない場合は削除しない', async () => {
    const repository = new FakeRepository();
    repository.job = buildJob({ artifactS3Key: `${artifactS3Key}.unexpected` });
    const storage = new FakeStorage();
    const service = new EpisodeExportCleanupService(
      repository as unknown as EpisodeExportJobRepository,
      storage,
    );

    await expect(service.cleanupExpired(50)).resolves.toEqual({
      selectedCount: 1,
      deletedCount: 0,
      failedCount: 1,
    });
    expect(storage.deleted).toEqual([]);
  });
});

class FakeRepository {
  public expired: ExpiredEpisodeExportArtifact[] = [{
    jobId,
    artifactS3Key,
  }];
  public job: EpisodeExportJob | null = buildJob();
  public marked: Array<{ jobId: string; artifactS3Key: string }> = [];

  public async listExpiredArtifacts(): Promise<ExpiredEpisodeExportArtifact[]> {
    return this.expired;
  }

  public async findForWorker(): Promise<EpisodeExportJob | null> {
    return this.job;
  }

  public async markArtifactDeleted(
    id: string,
    key: string,
  ): Promise<boolean> {
    this.marked.push({ jobId: id, artifactS3Key: key });
    return true;
  }
}

class FakeStorage {
  public deleted: Array<Parameters<EpisodeExportArtifactStoragePort['delete']>[0]> = [];
  public fail = false;

  public async store(): Promise<void> {}

  public async delete(
    input: Parameters<EpisodeExportArtifactStoragePort['delete']>[0],
  ): Promise<void> {
    if (this.fail) {
      throw new Error('temporary storage failure');
    }
    this.deleted.push(input);
  }
}

function buildJob(overrides: Partial<EpisodeExportJob> = {}): EpisodeExportJob {
  const timestamp = new Date('2026-07-31T00:00:00.000Z');
  return {
    id: jobId,
    userId,
    organizationId: null,
    episodeId,
    format: 'pdf',
    filename: 'export.pdf',
    pageIds: ['55555555-5555-4555-8555-555555555555'],
    pageSnapshot: [],
    requestFingerprint: 'a'.repeat(64),
    idempotencyKey: 'request-123',
    status: 'completed',
    progressStage: 'completed',
    progressPercent: 100,
    artifactS3Key,
    artifactMimeType: 'application/pdf',
    artifactSizeBytes: 1024,
    artifactDeletedAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: timestamp,
    startedAt: timestamp,
    completedAt: timestamp,
    expiresAt: timestamp,
    updatedAt: timestamp,
    attemptCount: 1,
    processingLeaseToken: null,
    processingLeaseExpiresAt: null,
    lastHeartbeatAt: null,
    ...overrides,
  };
}
