import type { MiddlewareHandler } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { AppError, ConflictError, ForbiddenError } from '../../../src/domain/errors/index.js';
import { buildEpisodeExportArtifactKey, type EpisodeExportJob } from '../../../src/domain/episodeExportJob.js';
import { createEpisodeExportRoutes } from '../../../src/routes/episodeExports.js';
import { EpisodeExportService } from '../../../src/services/export/EpisodeExportService.js';
import type { EpisodeExportJobRepository } from '../../../src/repositories/EpisodeExportJobRepository.js';
import type { AppEnv } from '../../../src/types/app.js';
import { episodeExportStatusResponseSchema } from '../../../packages/api-contract/src/mobileApiSchemas.js';
import { exportJobSchema } from '../../fixtures/production-mobile-2debe8c/exportSchemas.js';

const userId = '11111111-1111-4111-8111-111111111111';
const episodeId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
const pageId = '44444444-4444-4444-8444-444444444444';
const now = new Date('2026-10-01T00:00:00.000Z');
function exportJob(overrides: Partial<EpisodeExportJob> = {}): EpisodeExportJob {
  return {
    id: jobId, userId, organizationId: null, episodeId, format: 'pdf', filename: 'chapter.pdf',
    pageIds: [pageId], pageSnapshot: [{ pageId, pageNumber: 1, s3Key: 'private/source.png', mimeType: 'image/png' }],
    requestFingerprint: 'fingerprint', idempotencyKey: 'request-123', status: 'completed', progressStage: 'completed', progressPercent: 100,
    artifactS3Key: buildEpisodeExportArtifactKey({ userId, organizationId: null, episodeId, jobId, format: 'pdf' }),
    artifactMimeType: 'application/pdf', artifactSizeBytes: 100, artifactDeletedAt: null, errorCode: null, errorMessage: null,
    createdAt: now, startedAt: now, completedAt: now, expiresAt: new Date(now.getTime() + 600_000), updatedAt: now,
    attemptCount: 0, processingLeaseToken: 'private-lease', processingLeaseExpiresAt: null, lastHeartbeatAt: null, ...overrides,
  };
}
const auth: MiddlewareHandler<AppEnv> = async (c, next) => { c.set('user', { id: userId, supabaseId: userId, email: 'test@example.invalid', displayName: null, planCode: 'free' }); await next(); };
function setup(current: EpisodeExportJob | null = exportJob(), denied = false) {
  const findForScope = vi.fn().mockResolvedValue(current);
  const createOrGet = vi.fn().mockResolvedValue({ job: current, created: true });
  const signer = { sign: vi.fn().mockResolvedValue('https://downloads.example.invalid/signed-export') };
  const service = new EpisodeExportService({ findForScope, createOrGet } as unknown as EpisodeExportJobRepository, { dispatchJob: vi.fn().mockResolvedValue(undefined) }, signer, { now: () => now });
  const download = vi.spyOn(service, 'createDownload');
  const app = createEpisodeExportRoutes({ episodeExportService: service, authMiddleware: auth, rateLimitMiddleware: async (_c, next) => next(), organizationService: { requireMembership: async () => { if (denied) throw new ForbiddenError(); } } as never });
  app.onError((error, c) => c.json({ error: error instanceof AppError ? error.code : 'INTERNAL_ERROR' }, error instanceof AppError ? error.statusCode : 500));
  return { app, service, signer, download, findForScope, createOrGet };
}

describe('production Mobile export compatibility', () => {
  it.each(['queued', 'processing', 'completed', 'failed', 'canceled'] as const)('returns the frozen production %s status contract by default', async (status) => {
    const current = exportJob({ status, progressStage: status, progressPercent: status === 'completed' ? 100 : 0, ...(status === 'failed' ? { errorCode: 'EXPORT_FAILED', errorMessage: 'Export could not complete' } : {}) });
    const { app, signer } = setup(current);
    const response = await app.request(`/exports/${jobId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(exportJobSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ id: jobId, episode_id: episodeId, format: 'pdf', filename: 'chapter.pdf', status, cancel_supported: false, cancel_reason_code: 'EXPORT_CANCEL_UNSUPPORTED' });
    expect(body.error_code).toBe(current.errorCode);
    expect(body.message_key).toBeNull();
    expect(signer.sign).toHaveBeenCalledTimes(status === 'completed' ? 1 : 0);
    expect(body.download_url).toBe(status === 'completed' ? 'https://downloads.example.invalid/signed-export' : undefined);
    for (const secret of ['private/source.png', 'private-lease', 'fingerprint', 'request-123', current.artifactS3Key!]) expect(JSON.stringify(body)).not.toContain(secret);
  });
  it('preserves the current nested status under explicit v2 without eagerly signing', async () => {
    const { app, signer } = setup();
    const response = await app.request(`/exports/${jobId}?export_contract=v2`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(episodeExportStatusResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ job_id: jobId, download_ready: true, progress: { stage: 'completed', percent: 100 } });
    expect(signer.sign).not.toHaveBeenCalled();
  });
  it.each(['v3', '', 'v2,v1'])('rejects unknown export contract %s before querying', async (version) => {
    const { app, findForScope } = setup();
    expect((await app.request(`/exports/${jobId}?export_contract=${version}`)).status).toBe(422);
    expect(findForScope).not.toHaveBeenCalled();
  });
  it.each(['hy4-preview', 'unknown-provider-model'])('never signs %s images for a legacy Mobile status request', async (imageModel) => {
    const current = exportJob(); current.pageSnapshot[0]!.imageModel = imageModel;
    const { app, signer, download } = setup(current);
    const response = await app.request(`/exports/${jobId}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(exportJobSchema.safeParse(body).success).toBe(true);
    expect(body).not.toHaveProperty('download_url');
    expect(download).not.toHaveBeenCalled();
    expect(signer.sign).not.toHaveBeenCalled();
  });
  it.each([
    { expiresAt: now }, { artifactDeletedAt: now }, { artifactS3Key: 'private/foreign-export.pdf' },
  ])('does not return a URL for expired, deleted or wrong-key artifacts: %s', async (overrides) => {
    const { app, signer } = setup(exportJob(overrides));
    const body = await (await app.request(`/exports/${jobId}`)).json();
    expect(exportJobSchema.safeParse(body).success).toBe(true);
    expect(body).not.toHaveProperty('download_url');
    expect(signer.sign).not.toHaveBeenCalled();
  });
  it('omits a URL if an artifact expires between the readiness read and guarded download', async () => {
    const { app, download } = setup();
    download.mockRejectedValue(new ConflictError('Episode export download is not ready'));
    const response = await app.request(`/exports/${jobId}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(exportJobSchema.safeParse(body).success).toBe(true);
    expect(body).not.toHaveProperty('download_url');
  });
  it('checks owner/organization scope again before signing and refuses missing exports', async () => {
    const { app, findForScope, download } = setup();
    await app.request(`/exports/${jobId}`);
    expect(findForScope).toHaveBeenCalledTimes(2);
    expect(findForScope).toHaveBeenNthCalledWith(2, { userId, jobId, organizationId: null });
    expect(download).toHaveBeenCalledWith(userId, jobId, null);
    const missing = setup(null);
    expect((await missing.app.request(`/exports/${jobId}`)).status).toBe(404);
    expect(missing.signer.sign).not.toHaveBeenCalled();
    const denied = setup(exportJob(), true);
    expect((await denied.app.request(`/exports/${jobId}?organization_id=${episodeId}`)).status).toBe(403);
    expect(denied.findForScope).not.toHaveBeenCalled();
  });
  it('retains the separate verified Web-client gate', async () => {
    const { app, signer } = setup();
    expect((await app.request(`/web/exports/${jobId}`)).status).toBe(403);
    expect(signer.sign).not.toHaveBeenCalled();
  });
  it.each(['', '   '])('accepts the old blank filename payload and uses safe normalization: %j', async (filename) => {
    const { app, createOrGet } = setup(exportJob({ status: 'queued' }));
    const response = await app.request(`/episodes/${episodeId}/exports`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-123' }, body: JSON.stringify({ format: 'pdf', page_ids: [pageId], filename }) });
    expect(response.status).toBe(202);
    expect(createOrGet).toHaveBeenCalledWith(expect.objectContaining({ filename: 'lyra-export.pdf' }));
  });
});
