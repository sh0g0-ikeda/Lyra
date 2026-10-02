import { describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import { env } from '../../../src/lib/env.js';
import { createJobRoutes } from '../../../src/routes/jobs.js';
import type { AppEnv } from '../../../src/types/app.js';
import type { GenerationJob } from '../../../src/domain/types/job.js';
import { decodeGenerationJobHistoryCursor, encodeGenerationJobHistoryCursor } from '../../../src/domain/pagination.js';
const id = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-10-01T00:00:00.000Z');
const job: GenerationJob = { id, userId: id, organizationId: null, jobType: 'entity_generate', status: 'failed', generationMode: 'standard', creditCost: 4, params: { entity_id: id, entity_type: 'character' }, result: null, sqsMessageId: null, openaiRequestId: null, errorMessage: 'Provider timeout secret-token', retryCount: 0, createdAt: now, startedAt: now, completedAt: now, expiresAt: null, cancelRequestedAt: null, cancelRequestedBy: null, cancelledAt: null, commitStartedAt: null };
const auth: MiddlewareHandler<AppEnv> = async (c, next) => { c.set('user', { id, supabaseId: id, email: 'user@example.test', displayName: null, planCode: 'free' }); await next(); };
function setup(current = job, organizationService?: { requireMembership: (...args: unknown[]) => Promise<unknown> }) {
  const service = { getJob: vi.fn().mockResolvedValue(current), cancelJob: vi.fn().mockResolvedValue(current), listJobHistory: vi.fn().mockResolvedValue({ jobs: [current], nextCursor: null }), hideJobFromHistory: vi.fn() };
  const app = createJobRoutes({ jobService: service, organizationService: organizationService as never, authMiddleware: auth, rateLimitMiddleware: async (_c, next) => next() });
  app.onError((error, c) => c.json({ error: error.message }, 422));
  return { app, service };
}
describe('deployed job response compatibility', () => {
  it('parses production status/type filters and its cursor while preserving the continuation encoding', async () => {
    const encoded = Buffer.from(JSON.stringify({ active_rank: 1, created_at: now.toISOString(), id })).toString('base64url');
    const { app, service } = setup(); const response = await app.request(`/jobs?job_contract=v2&status=canceled,failed&type=entity_import_analysis,entity_generate&cursor=${encoded}`);
    expect(response.status).toBe(200);
    expect(service.listJobHistory).toHaveBeenCalledWith(id, expect.objectContaining({ statuses: ['cancelled', 'failed'], jobTypes: ['entity_import_analysis', 'entity_generate'], cursor: expect.objectContaining({ activeRank: 1, createdAt: now, id }) }));
    const cursor = decodeGenerationJobHistoryCursor(encoded); expect(encodeGenerationJobHistoryCursor(cursor)).toBe(encoded);
  });
  it.each(['status=unknown', 'type=unknown', 'status=queued,,failed'])('rejects unsupported filters: %s', async (query) => {
    const { app, service } = setup(); expect((await app.request(`/jobs?${query}`)).status).toBe(422); expect(service.listJobHistory).not.toHaveBeenCalled();
  });
  it('returns safe errors and actual pending settlement without exposing raw provider text', async () => {
    const { app } = setup({ ...job, creditSettlement: { chargedCredits: 4, refundedCredits: 0, netCredits: 4, status: 'refund_pending' } });
    const response = await app.request(`/jobs/${id}`); const body = await response.json();
    expect(body).toMatchObject({ error_code: 'GENERATION_TEMPORARILY_UNAVAILABLE', retryable: true, credit_settlement: { charged_credits: 4, refunded_credits: 0, status: 'refund_pending' }, progress_stage: null, progress_percent: null, actions: { hide: { available: true }, cancel: { available: false } } });
    expect(JSON.stringify(body)).not.toContain('secret-token'); expect((body as { support_id: string }).support_id).toMatch(/^J-[A-F0-9]{16}$/u);
  });
  it('normalizes cancellation without inferring a refund and keeps disabled/committing jobs uncancelable', async () => {
    const cancelled = setup({ ...job, status: 'cancelled', creditSettlement: { chargedCredits: 4, refundedCredits: 0, netCredits: 4, status: 'refund_pending' } });
    expect(await (await cancelled.app.request(`/jobs/${id}/cancel`, { method: 'POST' })).json()).toMatchObject({ status: 'canceled', credit_settlement: { status: 'refund_pending', refunded_credits: 0 } });
    const processing = setup({ ...job, status: 'processing', commitStartedAt: now, completedAt: null });
    expect(await (await processing.app.request(`/jobs/${id}`)).json()).toMatchObject({ actions: { cancel: { available: false } } });
  });
  it('only offers enabled cancellation to a member with edit permission before commit', async () => {
    const previous = env.GENERATION_JOB_CANCELLATION_ENABLED; env.GENERATION_JOB_CANCELLATION_ENABLED = true;
    try {
      const active = setup({ ...job, status: 'processing', completedAt: null });
      expect(await (await active.app.request(`/jobs/${id}`)).json()).toMatchObject({ actions: { cancel: { available: true } } });
      const viewer = setup({ ...job, status: 'processing', completedAt: null }, { requireMembership: async (...args) => { if (args[2] === 'edit_work') throw new Error('Forbidden'); } });
      expect(await (await viewer.app.request(`/jobs/${id}?organization_id=22222222-2222-4222-8222-222222222222`)).json()).toMatchObject({ actions: { cancel: { available: false } } });
      const saving = setup({ ...job, status: 'processing', completedAt: null, commitStartedAt: now });
      expect(await (await saving.app.request(`/jobs/${id}`)).json()).toMatchObject({ actions: { cancel: { available: false } } });
    } finally { env.GENERATION_JOB_CANCELLATION_ENABLED = previous; }
  });
  it('retains Mobile provenance redaction while adding progress and error metadata', async () => {
    const { app } = setup({ ...job, status: 'completed', openaiRequestId: 'provider-result', params: { ...job.params, image_model: 'hy4-preview', provider: 'tencent' }, result: { image_model: null, candidates: [{ image_model: 'hy4-preview', s3_key: 'private/source', cdn_url: 'https://cdn.example.test/private' }] } });
    const response = await app.request(`/jobs/${id}`); const text = await response.text();
    expect(response.status).toBe(200); expect(text).toContain('web_only'); expect(text).not.toContain('candidate_token'); expect(text).not.toContain('cdn.example'); expect(text).not.toContain('private/source');
    expect(JSON.parse(text)).toMatchObject({ progress_stage: 'completed', progress_percent: 100 });
  });
});
