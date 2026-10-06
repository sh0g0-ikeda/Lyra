import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { LegacyExportJob } from '../../../../src/legacy/export/LegacyEpisodeExportJob.js';
import type { LegacyExportJobRepositoryPort } from '../../../../src/legacy/export/LegacyEpisodeExportJobRepository.js';
import { LegacyEpisodeExportWorkerService, type LegacyExportArtifactBuilderPort, type LegacyExportStoragePort, type LegacyExportWorkerAccessGuardPort } from '../../../../src/legacy/export/LegacyEpisodeExportWorkerService.js';
import { LegacyExportOutboxDispatchService } from '../../../../src/legacy/export/LegacyExportOutboxDispatchService.js';
import { LegacyExportArtifactCleanupService } from '../../../../src/legacy/export/LegacyExportArtifactCleanupService.js';
import type { LegacyExportJobQueuePort } from '../../../../src/legacy/export/LegacyExportJobQueue.js';

describe('legacy export worker and maintenance', () => {
  it('同じqueued jobは一度だけclaimし、processing jobをreclaimしない', async () => {
    const repository = new WorkerRepository();
    const worker = new LegacyEpisodeExportWorkerService(repository, new MemoryStorage(), new AllowWorkerGuard(), () => new MemoryBuilder());
    expect((await worker.processJob(repository.job.id)).status).toBe('completed');
    expect((await worker.processJob(repository.job.id)).status).toBe('skipped');
    expect(repository.claimCount).toBe(2); expect(repository.completed).toBe(1);
  });

  it('outbox失敗を保持して再送し、期限切れartifactだけをcleanupする', async () => {
    const repository = new WorkerRepository(); repository.undispatched = [repository.job];
    const dispatch = new LegacyExportOutboxDispatchService(repository, new FlakyQueue());
    expect(await dispatch.dispatchPending()).toEqual({ dispatched: 0, failed: 1 });
    expect(await dispatch.dispatchPending()).toEqual({ dispatched: 1, failed: 0 });
    expect(repository.dispatchFailures).toBe(1); expect(repository.dispatched).toBe(1);
    const storage = new MemoryStorage(); repository.expired = [{ id: repository.job.id, artifactS3Key: 'exports/expired.zip' }];
    expect(await new LegacyExportArtifactCleanupService(repository, storage).cleanupExpiredArtifacts()).toBe(1);
    expect(storage.deleted).toEqual(['exports/expired.zip']);
  });
});

class WorkerRepository implements LegacyExportJobRepositoryPort {
  public readonly job: LegacyExportJob; public claimCount = 0; public completed = 0; public dispatchFailures = 0; public dispatched = 0;
  public undispatched: LegacyExportJob[] = []; public expired: Array<{ id: string; artifactS3Key: string }> = []; private claimed = false;
  public constructor() { const pageId = randomUUID(); this.job = { id: randomUUID(), userId: randomUUID(), organizationId: null, episodeId: randomUUID(), format: 'zip', filename: 'chapter.zip', pageIds: [pageId], pageSnapshot: [{ pageId, pageNumber: 1, s3Key: 'generated/page.png', mimeType: 'image/png' }], requestFingerprint: '0'.repeat(64), status: 'queued', progressStage: 'queued', progressPercent: 0, artifactS3Key: null, artifactMimeType: null, artifactSizeBytes: null, errorCode: null, errorMessage: null, createdAt: new Date(), startedAt: null, completedAt: null, expiresAt: new Date(Date.now() + 60_000) }; }
  public async createOrGet(): Promise<{ job: LegacyExportJob; created: boolean }> { return { job: this.job, created: true }; }
  public async findForScope(): Promise<LegacyExportJob | null> { return this.job; }
  public async findForWorker(): Promise<LegacyExportJob | null> { return this.job; }
  public async claim(): Promise<LegacyExportJob | null> { this.claimCount += 1; if (this.claimed) return null; this.claimed = true; return { ...this.job, status: 'processing' }; }
  public async expireQueued(): Promise<boolean> { return false; }
  public async updateProgress(): Promise<boolean> { return true; }
  public async registerArtifactTarget(): Promise<boolean> { return true; }
  public async complete(): Promise<boolean> { this.completed += 1; return true; }
  public async fail(): Promise<boolean> { return true; }
  public async markDispatched(): Promise<void> { this.dispatched += 1; }
  public async markDispatchFailure(): Promise<void> { this.dispatchFailures += 1; }
  public async listUndispatched(): Promise<LegacyExportJob[]> { return this.undispatched; }
  public async listExpiredArtifacts(): Promise<Array<{ id: string; artifactS3Key: string }>> { return this.expired; }
  public async markArtifactDeleted(): Promise<void> {}
}
class MemoryBuilder implements LegacyExportArtifactBuilderPort { public async build(): Promise<{ data: Buffer; mimeType: 'application/zip'; extension: 'zip' }> { return { data: Buffer.from('zip'), mimeType: 'application/zip', extension: 'zip' }; } }
class MemoryStorage implements LegacyExportStoragePort {
  public readonly deleted: string[] = [];
  public planArtifactTarget({ job }: { job: LegacyExportJob }): string { return `exports/${job.id}.zip`; }
  public async loadPageImage(): Promise<Buffer> { return Buffer.from('image'); }
  public async storeArtifact(): Promise<void> {}
  public async deleteArtifact(s3Key: string): Promise<void> { this.deleted.push(s3Key); }
}
class FlakyQueue implements LegacyExportJobQueuePort { private calls = 0; public async enqueue(): Promise<{ messageId: string | null }> { this.calls += 1; if (this.calls === 1) throw new Error('queue unavailable'); return { messageId: 'message-2' }; } }
class AllowWorkerGuard implements LegacyExportWorkerAccessGuardPort {
  public async assertLoadAllowed(): Promise<void> {}
  public async assertPublishAllowed(): Promise<void> {}
}
