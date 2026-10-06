import { describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import { AppError, ForbiddenError } from '../../../src/domain/errors/index.js';
import type { GenerationJob } from '../../../src/domain/types/job.js';
import { createJobRoutes } from '../../../src/routes/jobs.js';
import type { JobServicePort } from '../../../src/services/job/JobService.js';
import type { AppEnv } from '../../../src/types/app.js';
import { buildPushNavigationPayload } from '../../../src/domain/pushNotification.js';
import { generationJobHistoryResponseSchema, generationJobResponseSchema } from '../../../packages/api-contract/src/mobileApiSchemas.js';
import { generationJobSchema as productionJobSchema, generationJobsResponseSchema as productionJobsSchema } from '../../fixtures/production-mobile-2debe8c/jobSchemas.js';
import { env } from '../../../src/lib/env.js';
import {
  parseDraftReferenceCandidateToken,
  parseReferenceCandidateToken,
} from '../../../src/services/entity/ReferenceCandidateToken.js';

const userId = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-10-01T00:00:00.000Z');
const legacyTypes = ['page_generate', 'entity_generate', 'episode_story_autofill', 'episode_page_skeleton'] as const;
const referenceTokenOptions = {
  secret: env.REFERENCE_CANDIDATE_TOKEN_SECRET
    ?? env.SUPABASE_JWT_SECRET
    ?? env.STRIPE_WEBHOOK_SECRET
    ?? 'development-reference-candidate-token-secret',
};
function job(jobType: GenerationJob['jobType'], index = 1): GenerationJob {
  return {
    id: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`, userId, organizationId: null,
    jobType, status: 'completed', generationMode: 'standard', creditCost: 1, params: {}, result: null,
    sqsMessageId: null, openaiRequestId: null, errorMessage: null, retryCount: 0,
    createdAt: now, startedAt: now, completedAt: now, expiresAt: null,
    cancelRequestedAt: null, cancelRequestedBy: null, cancelledAt: null, commitStartedAt: null,
    creditSettlement: { chargedCredits: 1, refundedCredits: 0, netCredits: 1, status: 'charged' },
  };
}
const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('user', { id: userId, supabaseId: userId, email: 'user@example.invalid', displayName: null, planCode: 'free' });
  await next();
};
function setup(jobs: GenerationJob[], denyOrganization = false) {
  const service = {
    getJob: vi.fn().mockResolvedValue(jobs[0]),
    cancelJob: vi.fn().mockResolvedValue(jobs[0]),
    hideJobFromHistory: vi.fn(),
    listJobHistory: vi.fn<JobServicePort['listJobHistory']>().mockImplementation(async (_userId, input) => {
      const visible = jobs.filter((entry) => !input.jobTypes?.length || input.jobTypes.includes(entry.jobType));
      return { jobs: visible.slice(0, input.limit), nextCursor: visible.length > input.limit ? { activeRank: 1, createdAt: now, id: visible[input.limit - 1]!.id } : null };
    }),
  };
  const requireMembership = vi.fn().mockImplementation(async () => { if (denyOrganization) throw new ForbiddenError(); });
  const app = createJobRoutes({ jobService: service, authMiddleware: auth, rateLimitMiddleware: async (_c, next) => next(), organizationService: { requireMembership } as never });
  app.onError((error, c) => c.json({ error: error instanceof AppError ? error.code : 'INTERNAL_ERROR' }, error instanceof AppError ? error.statusCode : 500));
  return { app, service, requireMembership };
}

describe('negotiated generation job contract', () => {
  it.each(['', '?job_contract=v1'])('keeps mixed history readable by the exact production Mobile schema: %s', async (query) => {
    const jobs = [job('entity_import_analysis', 5), ...legacyTypes.map((type, i) => job(type, i + 1))];
    const { app, service } = setup(jobs);
    const response = await app.request(`/jobs${query}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(productionJobsSchema.safeParse(body).success).toBe(true);
    expect(body.jobs.map((entry: { job_type: string }) => entry.job_type)).toEqual(legacyTypes);
    expect(service.listJobHistory).toHaveBeenCalledWith(userId, expect.objectContaining({ jobTypes: legacyTypes }));
  });
  it('passes legacy types before the page limit and returns their actual continuation', async () => {
    const { app, service } = setup([job('entity_import_analysis', 9), job('entity_generate', 2), job('page_generate', 3)]);
    const response = await app.request('/jobs?limit=1');
    const body = await response.json();
    expect(productionJobsSchema.safeParse(body).success).toBe(true);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].job_type).toBe('entity_generate');
    expect(body.next_cursor).not.toBeNull();
    expect(service.listJobHistory).toHaveBeenCalledWith(userId, expect.objectContaining({ jobTypes: legacyTypes, limit: 1 }));
  });
  it('includes imports only for v2 and lets upgraded clients filter them explicitly', async () => {
    const { app } = setup([job('entity_generate'), job('entity_import_analysis', 2)]);
    const mixed = await (await app.request('/jobs?job_contract=v2')).json();
    expect(generationJobHistoryResponseSchema.safeParse(mixed).success).toBe(true);
    expect(mixed.jobs).toHaveLength(2);
    expect(productionJobsSchema.safeParse(mixed).success).toBe(false);
    const filtered = await (await app.request('/jobs?job_contract=v2&type=entity_import_analysis')).json();
    expect(filtered.jobs.map((entry: { job_type: string }) => entry.job_type)).toEqual(['entity_import_analysis']);
  });
  it.each(['type=entity_import_analysis', 'job_contract=v1&type=entity_import_analysis', 'job_contract=v3', 'job_contract=', 'job_contract=v2,v1'])('rejects unsupported negotiation before reading history: %s', async (query) => {
    const { app, service } = setup([job('entity_generate')]);
    expect((await app.request(`/jobs?${query}`)).status).toBe(422);
    expect(service.listJobHistory).not.toHaveBeenCalled();
  });
  it('keeps the default type bound when a legacy client sends an empty filter', async () => {
    const { app, service } = setup([job('entity_import_analysis')]);
    const response = await app.request('/jobs?type=');
    expect(await response.json()).toEqual({ jobs: [], next_cursor: null });
    expect(service.listJobHistory).toHaveBeenCalledWith(userId, expect.objectContaining({ jobTypes: legacyTypes }));
  });
  it.each(['', '?job_contract=v1'])('does not expose or cancel an import through the legacy detail/cancel contract: %s', async (query) => {
    const current = job('entity_import_analysis');
    const { app, service } = setup([current]);
    expect((await app.request(`/jobs/${current.id}${query}`)).status).toBe(404);
    expect((await app.request(`/jobs/${current.id}/cancel${query}`, { method: 'POST' })).status).toBe(404);
    expect(service.cancelJob).not.toHaveBeenCalled();
  });
  it('allows v2 import detail and cancellation without loosening the response schema', async () => {
    const current = job('entity_import_analysis');
    const { app, service } = setup([current]);
    for (const [suffix, method] of [['', 'GET'], ['/cancel', 'POST']]) {
      const response = await app.request(`/jobs/${current.id}${suffix}?job_contract=v2`, { method });
      expect(response.status).toBe(200);
      expect(generationJobResponseSchema.parse(await response.json()).job_type).toBe('entity_import_analysis');
    }
    expect(service.cancelJob).toHaveBeenCalledWith(userId, current.id, null);
  });
  it('entity未指定import jobはpersonal draft tokenを返す', async () => {
    const current = {
      ...job('entity_import_analysis'),
      params: { entity_type: 'character' },
      result: {
        import_analysis: {
          suggested_fields: { art_style: 'anime' },
          prompt_supplement: 'anime heroine',
          tmp_image_s3_key: `tmp/${userId}/entities/imports/source.png`,
        },
      },
    };
    const { app } = setup([current]);

    const response = await app.request(`/jobs/${current.id}?job_contract=v2`);
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { tmp_image_token: string } };
    expect(parseDraftReferenceCandidateToken(body.result.tmp_image_token, {
      userId,
      organizationId: null,
    }, referenceTokenOptions)).toMatchObject({
      entityType: 'character',
      s3Key: `tmp/${userId}/entities/imports/source.png`,
    });
  });
  it('organization import jobは同じorganizationにだけ使えるdraft tokenを返す', async () => {
    const organizationId = '44444444-4444-4444-8444-444444444444';
    const current = {
      ...job('entity_import_analysis'),
      organizationId,
      params: { entity_type: 'nonhuman' },
      result: {
        import_analysis: {
          suggested_fields: { species: 'dragon' },
          prompt_supplement: 'blue dragon',
          tmp_image_s3_key: `tmp/${userId}/entities/imports/source.webp`,
        },
      },
    };
    const { app } = setup([current]);

    const response = await app.request(`/jobs/${current.id}?job_contract=v2&organization_id=${organizationId}`);
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { tmp_image_token: string } };
    expect(parseDraftReferenceCandidateToken(body.result.tmp_image_token, {
      userId,
      organizationId,
    }, referenceTokenOptions)).toMatchObject({ entityType: 'nonhuman' });
    expect(() => parseDraftReferenceCandidateToken(body.result.tmp_image_token, {
      userId,
      organizationId: null,
    }, referenceTokenOptions)).toThrow();
  });
  it('entity指定import jobは従来のentity-bound tokenを返す', async () => {
    const importedEntityId = '33333333-3333-4333-8333-333333333333';
    const current = {
      ...job('entity_import_analysis'),
      params: { entity_id: importedEntityId, entity_type: 'character' },
      result: {
        import_analysis: {
          entity_id: importedEntityId,
          suggested_fields: { art_style: 'anime' },
          prompt_supplement: 'anime heroine',
          tmp_image_s3_key: `tmp/${userId}/entities/imports/source.png`,
        },
      },
    };
    const { app } = setup([current]);

    const response = await app.request(`/jobs/${current.id}?job_contract=v2`);
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { tmp_image_token: string } };
    expect(parseReferenceCandidateToken(body.result.tmp_image_token, {
      userId,
      entityId: importedEntityId,
    }, referenceTokenOptions)).toBe(`tmp/${userId}/entities/imports/source.png`);
  });
  it('still checks organization access before import detail or cancellation', async () => {
    const current = job('entity_import_analysis');
    const { app, service } = setup([current], true);
    for (const [suffix, method] of [['', 'GET'], ['/cancel', 'POST']]) {
      expect((await app.request(`/jobs/${current.id}${suffix}?job_contract=v2&organization_id=${userId}`, { method })).status).toBe(403);
    }
    expect(service.getJob).not.toHaveBeenCalled();
    expect(service.cancelJob).not.toHaveBeenCalled();
  });
  it('does not create a legacy push navigation target for import analysis', () => {
    expect(buildPushNavigationPayload({ jobId: userId, organizationId: null, jobType: 'entity_import_analysis', workId: userId, chapterId: userId, episodeId: userId, pageId: userId, entityId: userId })).toBeNull();
  });
});

describe('page job provenance response compatibility', () => {
  const privateFields = { s3_key: 'private/page.png', cdn_url: 'https://private.example/image', compiled_prompt: 'private prompt', candidate_token: 'private-token' };
  const provenanceCases = [
    ['absent', {}, undefined],
    ['OpenAI', { image_model: 'gpt-image-2', provider_model_id: 'gpt-image-2', provider: 'openai' }, 'available'],
    ['Web only', { image_model: 'hy4-preview', provider_model_id: 'hy4-preview', provider: 'tencent' }, 'web_only'],
    ['conflicting', { image_model: 'gpt-image-2', provider_model_id: 'hy4-preview', provider: 'tencent' }, 'unavailable'],
    ['unknown', { image_model: 'future-model', provider: 'future-provider' }, 'unavailable'],
  ] as const;
  it.each(provenanceCases)('accepts safe nested %s metadata across list/detail and canonical/production schemas', async (_name, provenance, access) => {
    const current = { ...job('page_generate'), result: { generation_mode: 'standard', generated_image: { generation_mode: 'standard', generated_at: now.toISOString(), ...provenance, ...privateFields } } };
    const { app } = setup([current]);
    for (const url of ['/jobs', `/jobs/${current.id}`]) {
      const response = await app.request(url);
      expect(response.status).toBe(200);
      const body = await response.json();
      const record = url === '/jobs' ? body.jobs[0] : body;
      expect(generationJobResponseSchema.safeParse(record).success).toBe(true);
      expect(productionJobSchema.safeParse(record).success).toBe(true);
      expect(record.result.generated_image).toEqual({ generation_mode: 'standard', generated_at: now.toISOString(), ...provenance, ...(access === undefined ? {} : { mobile_access: access }) });
      for (const value of Object.values(privateFields)) expect(JSON.stringify(body)).not.toContain(value);
    }
  });
  it('keeps the actual normal worker flat result as a 200 sanitized control', async () => {
    const current = { ...job('page_generate'), result: { generation_mode: 'standard', request_kind: 'initial', image_model: 'hy4-preview', provider_model_id: 'hy4-preview', provider: 'tencent', ...privateFields } };
    const { app } = setup([current]);
    const response = await app.request(`/jobs/${current.id}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toEqual({ generation_mode: 'standard', request_kind: 'initial' });
    expect(productionJobSchema.safeParse(body).success).toBe(true);
  });
  it('continues rejecting private nested image fields in the canonical schema', async () => {
    const current = job('page_generate');
    const response = await setup([current]).app.request(`/jobs/${current.id}`);
    const body = await response.json();
    for (const [key, value] of Object.entries(privateFields)) {
      expect(generationJobResponseSchema.safeParse({ ...body, result: { generated_image: { [key]: value } } }).success).toBe(false);
    }
  });
});
