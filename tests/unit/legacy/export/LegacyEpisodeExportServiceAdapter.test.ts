import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ImageDeliveryAudience } from '../../../../src/domain/generation/ImageAccessPolicy.js';
import type { LegacyExportJob } from '../../../../src/legacy/export/LegacyEpisodeExportJob.js';
import type { CreateLegacyExportJobInput, LegacyExportJobRepositoryPort } from '../../../../src/legacy/export/LegacyEpisodeExportJobRepository.js';
import { LegacyEpisodeExportServiceAdapter, type LegacyExportAccessGuardPort, type LegacyExportDownloadSignerPort } from '../../../../src/legacy/export/LegacyEpisodeExportServiceAdapter.js';
import type { LegacyExportJobQueuePort } from '../../../../src/legacy/export/LegacyExportJobQueue.js';

describe('LegacyEpisodeExportServiceAdapter', () => {
  it('guardを旧snapshot/fingerprint作成より先に実行し、camelCase snapshotを変えない', async () => {
    const events: string[] = [];
    const repository = new FakeRepository(events);
    const adapter = new LegacyEpisodeExportServiceAdapter(repository, new FakeQueue(events), new FakeGuard(events), new FakeSigner(), () => new Date('2026-10-04T00:00:00.000Z'));
    const accepted = await adapter.createExport(repository.job.userId, repository.job.episodeId, { audience: 'mobile', format: 'zip', pageIds: repository.job.pageIds, filename: 'chapter.zip', idempotencyKey: 'request-1234' }, null);
    expect(accepted).toEqual({ jobId: repository.job.id, status: 'queued' });
    expect(events).toEqual(['guard:create', 'repository:create', 'queue', 'repository:dispatched']);
    expect(repository.createInput?.requestFingerprint).toHaveLength(64);
    expect(repository.job.pageSnapshot).toEqual([{ pageId: repository.job.pageIds[0], pageNumber: 1, s3Key: 'generated/page-1.png', mimeType: 'image/png' }]);
  });

  it('download前にscope/provenance guardを再実行してHTTPS URLだけ返す', async () => {
    const events: string[] = [];
    const repository = new FakeRepository(events, 'completed');
    const adapter = new LegacyEpisodeExportServiceAdapter(repository, new FakeQueue(events), new FakeGuard(events), new FakeSigner(), () => new Date('2026-10-04T00:00:00.000Z'));
    expect((await adapter.getExport(repository.job.userId, repository.job.id, null, 'mobile')).downloadReady).toBe(true);
    expect((await adapter.createDownload(repository.job.userId, repository.job.id, null, 'mobile')).url).toBe('https://download.example.invalid/artifact');
    expect(events.filter((event) => event === 'guard:download')).toHaveLength(2);
  });

  it('create guard拒否時は旧snapshotを作らず、downloadはHTTP URLを拒否する', async () => {
    const createEvents: string[] = [];
    const createRepository = new FakeRepository(createEvents);
    const deniedAdapter = new LegacyEpisodeExportServiceAdapter(
      createRepository,
      new FakeQueue(createEvents),
      new FakeGuard(createEvents, true),
      new FakeSigner(),
    );
    let createFailure: unknown;
    try {
      await deniedAdapter.createExport(
        createRepository.job.userId,
        createRepository.job.episodeId,
        { format: 'zip', pageIds: createRepository.job.pageIds, idempotencyKey: 'request-1234' },
        null,
      );
    } catch (error) {
      createFailure = error;
    }
    expect(createFailure).toBeInstanceOf(Error);
    expect(createEvents).toEqual(['guard:create']);
    expect(createRepository.createInput).toBeUndefined();

    const downloadEvents: string[] = [];
    const downloadRepository = new FakeRepository(downloadEvents, 'completed');
    const insecureAdapter = new LegacyEpisodeExportServiceAdapter(
      downloadRepository,
      new FakeQueue(downloadEvents),
      new FakeGuard(downloadEvents),
      new FakeSigner('http://download.example.invalid/artifact'),
    );
    let downloadFailure: unknown;
    try {
      await insecureAdapter.createDownload(downloadRepository.job.userId, downloadRepository.job.id, null);
    } catch (error) {
      downloadFailure = error;
    }
    expect(downloadFailure).toMatchObject({ code: 'CONFLICT', statusCode: 409 });
  });

  it('download signer timeoutは有限にCONFLICTへ変換する', async () => {
    const events: string[] = [];
    const repository = new FakeRepository(events, 'completed');
    const adapter = new LegacyEpisodeExportServiceAdapter(
      repository,
      new FakeQueue(events),
      new FakeGuard(events),
      new NeverSigner(),
      () => new Date('2026-10-04T00:00:00.000Z'),
      5,
    );
    let failure: unknown;
    try { await adapter.createDownload(repository.job.userId, repository.job.id, null); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'CONFLICT', statusCode: 409 });
  });
});

class FakeGuard implements LegacyExportAccessGuardPort {
  public constructor(private readonly events: string[], private readonly rejectCreate = false) {}
  public async assertCreateAllowed(): Promise<void> {
    this.events.push('guard:create');
    if (this.rejectCreate) throw new Error('create denied');
  }
  public async assertDownloadAllowed(_input: { userId: string; organizationId: string | null; audience: ImageDeliveryAudience; job: LegacyExportJob }): Promise<void> { this.events.push('guard:download'); }
}
class FakeSigner implements LegacyExportDownloadSignerPort {
  public constructor(private readonly url = 'https://download.example.invalid/artifact') {}
  public async sign(): Promise<string> { return this.url; }
}
class NeverSigner implements LegacyExportDownloadSignerPort {
  public async sign(): Promise<string> { return new Promise(() => undefined); }
}
class FakeQueue implements LegacyExportJobQueuePort {
  public constructor(private readonly events: string[]) {}
  public async enqueue(): Promise<{ messageId: string | null }> { this.events.push('queue'); return { messageId: 'message-1' }; }
}
class FakeRepository implements LegacyExportJobRepositoryPort {
  public readonly job: LegacyExportJob;
  public createInput?: CreateLegacyExportJobInput;
  public constructor(private readonly events: string[], status: LegacyExportJob['status'] = 'queued') {
    const now = new Date('2026-10-04T00:00:00.000Z'); const pageId = randomUUID();
    this.job = { id: randomUUID(), userId: randomUUID(), organizationId: null, episodeId: randomUUID(), format: 'zip', filename: 'chapter.zip', pageIds: [pageId], pageSnapshot: [{ pageId, pageNumber: 1, s3Key: 'generated/page-1.png', mimeType: 'image/png' }], requestFingerprint: '0'.repeat(64), status, progressStage: status, progressPercent: status === 'completed' ? 100 : 0, artifactS3Key: status === 'completed' ? 'exports/job.zip' : null, artifactMimeType: status === 'completed' ? 'application/zip' : null, artifactSizeBytes: status === 'completed' ? 100 : null, errorCode: null, errorMessage: null, createdAt: now, startedAt: null, completedAt: status === 'completed' ? now : null, expiresAt: new Date('2026-10-05T00:00:00.000Z') };
  }
  public async createOrGet(input: CreateLegacyExportJobInput): Promise<{ job: LegacyExportJob; created: boolean }> { this.events.push('repository:create'); this.createInput = input; return { job: this.job, created: true }; }
  public async findForScope(): Promise<LegacyExportJob | null> { return this.job; }
  public async findForWorker(): Promise<LegacyExportJob | null> { return this.job; }
  public async claim(): Promise<LegacyExportJob | null> { return this.job; }
  public async expireQueued(): Promise<boolean> { return false; }
  public async updateProgress(): Promise<boolean> { return true; }
  public async registerArtifactTarget(): Promise<boolean> { return true; }
  public async complete(): Promise<boolean> { return true; }
  public async fail(): Promise<boolean> { return true; }
  public async markDispatched(): Promise<void> { this.events.push('repository:dispatched'); }
  public async markDispatchFailure(): Promise<void> {}
  public async listUndispatched(): Promise<LegacyExportJob[]> { return []; }
  public async listExpiredArtifacts(): Promise<Array<{ id: string; artifactS3Key: string }>> { return []; }
  public async markArtifactDeleted(): Promise<void> {}
}
