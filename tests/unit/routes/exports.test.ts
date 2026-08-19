import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createApp, resolveConfiguredEpisodeExportService } from '../../../src/app.js';
import { createExportRoutes } from '../../../src/routes/exports.js';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import type { AppEnv } from '../../../src/types/app.js';

const userId = '11111111-1111-4111-8111-111111111111';
const episodeId = '22222222-2222-4222-8222-222222222222';
const pageId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';

describe('export routes', () => {
  it('default compositionではflagが未設定のexport routeを公開しない', async () => {
    const app = createApp({ enableDevAuthBypass: true });

    const response = await app.request(`/api/episodes/${episodeId}/exports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'pdf', page_ids: [pageId] }),
    });

    expect(response.status).toBe(404);
  });

  it('createAppが非同期export APIを/apiへ配線する', async () => {
    const app = createApp({
      enableDevAuthBypass: true,
      episodeExportService: {
        async createExport() {
          return { jobId, status: 'queued' as const };
        },
        async getExportStatus() {
          throw new Error('not used');
        },
      },
    });

    const response = await app.request(`/api/episodes/${episodeId}/exports`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'mobile-export-request-1',
      },
      body: JSON.stringify({ format: 'pdf', page_ids: [pageId] }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ job_id: jobId, status: 'queued' });
  });

  it('flag=false ではS3とSQSが設定済みでもdefault export serviceを構築しない', () => {
    const constructExportService = vi.fn();

    const resolved = resolveConfiguredEpisodeExportService(
      {
        EPISODE_EXPORT_ENABLED: false,
        S3_BUCKET_IMAGES: 'lyra-images',
        SQS_QUEUE_URL_GENERATION: 'https://sqs.ap-northeast-1.amazonaws.com/123456789012/generation',
      },
      constructExportService,
    );

    expect(resolved).toBeUndefined();
    expect(constructExportService).not.toHaveBeenCalled();
  });

  it('validates an idempotent export request and returns 202', async () => {
    const calls: unknown[] = [];
    const app = createTestApp({
      async createExport(input: unknown): Promise<{ jobId: string; status: string }> { calls.push(input); return { jobId, status: 'queued' }; },
      async getExportStatus(): Promise<never> { throw new Error('not used'); },
    });

    const response = await app.request(`/episodes/${episodeId}/exports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'abcdefgh-12345678' },
      body: JSON.stringify({ format: 'pdf', page_ids: [pageId], filename: '../../story.pdf' }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ job_id: jobId, status: 'queued' });
    expect(calls).toEqual([expect.objectContaining({ userId, episodeId, pageIds: [pageId], filename: 'story.pdf' })]);
  });

  it('rejects a missing idempotency key and does not call the service', async () => {
    const app = createTestApp({
      async createExport(): Promise<never> { throw new Error('must not be called'); },
      async getExportStatus(): Promise<never> { throw new Error('not used'); },
    });
    const response = await app.request(`/episodes/${episodeId}/exports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format: 'zip', page_ids: [pageId] }) });
    expect(response.status).toBe(422);
  });

  it('returns a safe completed download URL only for the authorized status route', async () => {
    const app = createTestApp({
      async createExport(): Promise<never> { throw new Error('not used'); },
      async getExportStatus(): Promise<unknown> {
        return {
          id: jobId,
          episode_id: episodeId,
          format: 'pdf',
          filename: 'story.pdf',
          status: 'completed',
          progress_stage: 'completed',
          progress_percent: 100,
          error_code: null,
          message_key: null,
          expires_at: '2026-07-26T00:00:00.000Z',
          completed_at: '2026-07-25T00:00:00.000Z',
          cancel_supported: false,
          cancel_reason_code: null,
          download_url: 'https://signed.example/export',
        };
      },
    });
    const response = await app.request(`/exports/${jobId}`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: jobId, download_url: 'https://signed.example/export' });
  });

  it('export作成の成功応答がcanonical schemaに違反する場合は500になる', async () => {
    const app = createTestApp({
      async createExport(): Promise<{ jobId: string; status: string }> {
        return { jobId: '', status: 'queued' };
      },
      async getExportStatus(): Promise<never> {
        throw new Error('not used');
      },
    });

    const response = await app.request(`/episodes/${episodeId}/exports`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'contract-failure-1',
      },
      body: JSON.stringify({ format: 'pdf', page_ids: [pageId] }),
    });

    expect(response.status).toBe(500);
  });
});

function createTestApp(exportService: object): Hono<AppEnv> {
  const app = createExportRoutes({
    authMiddleware: async (c, next) => { c.set('user', { id: userId, supabaseId: 'subject', email: 'user@example.com', displayName: null, planCode: 'free' }); await next(); },
    rateLimitMiddleware: async (_c, next) => next(),
    exportService: exportService as never,
  });
  app.onError(errorHandler);
  return app;
}
