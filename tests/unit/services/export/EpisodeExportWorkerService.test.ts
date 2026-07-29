import { describe, expect, it, vi } from 'vitest';
import type { ExportJob } from '../../../../src/domain/exportJob.js';
import { ValidationError } from '../../../../src/domain/errors/index.js';
import { EpisodeExportWorkerService } from '../../../../src/services/export/EpisodeExportWorkerService.js';

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    userId: '11111111-1111-4111-8111-111111111111',
    organizationId: null,
    episodeId: '22222222-2222-4222-8222-222222222222',
    format: 'zip',
    filename: 'story.zip',
    pageIds: ['33333333-3333-4333-8333-333333333333'],
    pageSnapshot: [{ pageId: '33333333-3333-4333-8333-333333333333', pageNumber: 1, s3Key: 'session/user/pages/page.png', mimeType: 'image/png' }],
    requestFingerprint: 'a'.repeat(64),
    status: 'queued',
    progressStage: 'queued',
    progressPercent: 0,
    artifactS3Key: null,
    artifactMimeType: null,
    artifactSizeBytes: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

describe('EpisodeExportWorkerService', () => {
  it('stores a server-built artifact and marks the job completed', async () => {
    const complete = vi.fn();
    const repository = { claim: vi.fn().mockResolvedValue(job()), updateProgress: vi.fn(), complete, fail: vi.fn() };
    const storage = { loadPageImage: vi.fn().mockResolvedValue(Buffer.from('image')), storeArtifact: vi.fn().mockResolvedValue({ s3Key: 'exports/44444444-4444-4444-8444-444444444444.zip' }) };
    const builder = { build: vi.fn().mockResolvedValue({ data: Buffer.from('zip'), mimeType: 'application/zip', extension: 'zip' }) };
    const service = new EpisodeExportWorkerService(repository as never, storage as never, () => builder);
    await expect(service.processJob(job().id)).resolves.toMatchObject({ status: 'completed' });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ artifactS3Key: 'exports/44444444-4444-4444-8444-444444444444.zip', artifactSizeBytes: 3 }));
  });

  it('records a stable safe failure when an authenticated source image is unavailable', async () => {
    const fail = vi.fn();
    const repository = { claim: vi.fn().mockResolvedValue(job()), updateProgress: vi.fn(), complete: vi.fn(), fail };
    const storage = { loadPageImage: vi.fn().mockRejectedValue(new ValidationError('s3://private/key AccessDenied')), storeArtifact: vi.fn() };
    const service = new EpisodeExportWorkerService(repository as never, storage as never);
    await expect(service.processJob(job().id)).resolves.toMatchObject({ status: 'failed', reason: 'EXPORT_SOURCE_UNAVAILABLE' });
    expect(fail).toHaveBeenCalledWith(job().id, 'EXPORT_SOURCE_UNAVAILABLE', 'One or more export pages are unavailable');
  });

  it('fails before artifact construction when source images exceed the bounded total', async () => {
    const fail = vi.fn();
    const repository = {
      claim: vi.fn().mockResolvedValue(job({
        pageSnapshot: Array.from({ length: 4 }, (_value, index) => ({
          pageId: `33333333-3333-4333-8333-33333333333${index}`,
          pageNumber: index + 1,
          s3Key: `session/user/pages/page-${index}.png`,
          mimeType: 'image/png' as const,
        })),
      })),
      updateProgress: vi.fn(),
      complete: vi.fn(),
      fail,
    };
    const source = Buffer.alloc(4);
    const storage = { loadPageImage: vi.fn().mockResolvedValue(source), storeArtifact: vi.fn() };
    const builder = { build: vi.fn() };
    const service = new EpisodeExportWorkerService(repository as never, storage as never, () => builder, { maxTotalSourceBytes: 8 });

    await expect(service.processJob(job().id)).resolves.toMatchObject({ status: 'failed', reason: 'EXPORT_TOO_LARGE' });

    expect(builder.build).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(job().id, 'EXPORT_TOO_LARGE', 'Export exceeds the supported size');
  });
});
