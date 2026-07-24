import { describe, expect, it, vi } from 'vitest';
import type { ExportJob } from '../../../../src/domain/exportJob.js';
import { EpisodeExportService } from '../../../../src/services/export/EpisodeExportService.js';

const userId = '11111111-1111-4111-8111-111111111111';
const episodeId = '22222222-2222-4222-8222-222222222222';
const pageId = '33333333-3333-4333-8333-333333333333';

describe('EpisodeExportService', () => {
  it('creates an idempotent queued export and dispatches only a newly-created outbox job', async () => {
    const createOrGet = vi.fn().mockResolvedValue({
      job: buildJob(),
      created: true,
    });
    const enqueue = vi.fn().mockResolvedValue({ messageId: 'message-1' });
    const markDispatched = vi.fn().mockResolvedValue(undefined);
    const service = new EpisodeExportService(
      { createOrGet, markDispatched } as never,
      { enqueue } as never,
    );

    const result = await service.createExport({
      userId,
      organizationId: null,
      episodeId,
      pageIds: [pageId],
      format: 'pdf',
      filename: 'story.pdf',
      idempotencyKey: 'abcdefgh-12345678',
    });

    expect(result).toEqual({ jobId: buildJob().id, status: 'queued' });
    expect(enqueue).toHaveBeenCalledWith({ jobId: buildJob().id });
    expect(markDispatched).toHaveBeenCalledWith(buildJob().id, 'message-1');
  });

  it('does not expose a storage key or provider failure from a failed job', async () => {
    const findForScope = vi.fn().mockResolvedValue(buildJob({
      status: 'failed',
      artifactS3Key: 'exports/private-secret.pdf',
      errorMessage: 'AccessDenied: arn:aws:s3:::private',
    }));
    const service = new EpisodeExportService({ findForScope } as never, { enqueue: vi.fn() } as never);

    const result = await service.getExportStatus({ userId, organizationId: null, jobId: buildJob().id });

    expect(result).toMatchObject({ status: 'failed', error_code: 'EXPORT_FAILED' });
    expect(JSON.stringify(result)).not.toContain('private-secret');
    expect(JSON.stringify(result)).not.toContain('AccessDenied');
  });
});

function buildJob(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    userId,
    organizationId: null,
    episodeId,
    format: 'pdf',
    filename: 'story.pdf',
    pageIds: [pageId],
    pageSnapshot: [{ pageId, pageNumber: 1, s3Key: 'session/user/pages/page.png', mimeType: 'image/png' }],
    requestFingerprint: 'fingerprint',
    status: 'queued',
    progressStage: 'queued',
    progressPercent: 0,
    artifactS3Key: null,
    artifactMimeType: null,
    artifactSizeBytes: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date('2026-07-25T00:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    expiresAt: new Date('2026-07-26T00:00:00.000Z'),
    ...overrides,
  };
}
