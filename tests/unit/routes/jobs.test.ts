import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  generationJobSchema,
  generationJobsResponseSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';
import type { GenerationJob } from '../../../src/domain/types/job.js';
import { createJobRoutes } from '../../../src/routes/jobs.js';
import type { AppEnv } from '../../../src/types/app.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';

class FakeJobService {
  public listInput: unknown = null;
  public job: GenerationJob = buildJob();

  public async getJob(): Promise<GenerationJob> {
    return this.job;
  }

  public async listJobs(input: unknown): Promise<{ jobs: GenerationJob[]; nextCursor: string | null }> {
    this.listInput = input;
    return { jobs: [{ ...this.job, status: 'queued', errorMessage: null }], nextCursor: 'next-page' };
  }

  public async cancelJob(): Promise<GenerationJob> {
    return this.job;
  }
}

describe('job routes', () => {
  it('テナント、状態、種別、カーソルを指定してジョブ一覧を返す', async () => {
    const service = new FakeJobService();
    const app = createTestApp(service);

    const response = await app.request(
      `/jobs?organization_id=${organizationId}&limit=2&status=queued,failed&type=page_generate&cursor=cursor-1`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      next_cursor: 'next-page',
      jobs: [{ id: jobId, status: 'queued' }],
    });
    expect(() => generationJobsResponseSchema.parse(body)).not.toThrow();
    expect(service.listInput).toEqual({
      userId,
      organizationId,
      limit: 2,
      cursor: 'cursor-1',
      statuses: ['queued', 'failed'],
      jobTypes: ['page_generate'],
    });
  });

  it('既存の単体取得を維持しつつ、失敗の内部エラーを返さない', async () => {
    const app = createTestApp(new FakeJobService());

    const response = await app.request(`/jobs/${jobId}`);

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      id: jobId,
      job_type: 'page_generate',
      status: 'failed',
      retry_count: 1,
      error_code: 'GENERATION_TEMPORARILY_UNAVAILABLE',
      message_key: 'job.error.temporarilyUnavailable',
      retryable: true,
    });
    expect(body.error_message).not.toBe('OpenAI request req_secret failed: s3://private-bucket/key');
    expect(JSON.stringify(body)).not.toContain('req_secret');
    expect(JSON.stringify(body)).not.toContain('compiler internal stack');
    expect(() => generationJobSchema.parse(body)).not.toThrow();
  });
  it('returns only a bounded aggregate settlement, never ledger details', async () => {
    const service = new FakeJobService();
    service.job = buildJob({
      creditSettlement: {
        chargedCredits: 5,
        refundedCredits: 2,
        netCredits: 3,
        status: 'partially_refunded',
      },
    });
    const app = createTestApp(service);

    const response = await app.request(`/jobs/${jobId}`);

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.credit_settlement).toEqual({
      charged_credits: 5,
      refunded_credits: 2,
      net_credits: 3,
      status: 'partially_refunded',
    });
    expect(JSON.stringify(body)).not.toContain('ledger');
    expect(JSON.stringify(body)).not.toContain('description');
    expect(JSON.stringify(body)).not.toContain('provider');
    expect(() => generationJobSchema.parse(body)).not.toThrow();
  });

  it('processing cancellation request returns a safe pending action without internal cancellation metadata', async () => {
    const service = new FakeJobService();
    service.job = buildJob({
      status: 'processing',
      cancelRequestedAt: new Date('2026-07-25T00:03:00.000Z'),
      cancelRequestedByUserId: userId,
    });
    const app = createTestApp(service);

    const response = await app.request(`/jobs/${jobId}/cancel`, { method: 'POST' });

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.actions).toEqual(expect.objectContaining({
      cancel: { available: false, reason_key: 'job.action.cancelRequested' },
    }));
    expect(JSON.stringify(body)).not.toContain('cancelRequestedAt');
    expect(JSON.stringify(body)).not.toContain('cancel_requested_at');
    expect(JSON.stringify(body)).not.toContain('cancelRequestedByUserId');
    expect(() => generationJobSchema.parse(body)).not.toThrow();
  });

  it('credit settlement がない job 応答は canonical contract 境界で拒否する', async () => {
    const service = new FakeJobService();
    service.job = buildJob({ creditSettlement: undefined });
    const app = createTestApp(service);

    const response = await app.request(`/jobs/${jobId}`);

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.not.toContain('credit_settlement');
  });
});

function createTestApp(service: FakeJobService): Hono<AppEnv> {
  return createJobRoutes({
    authMiddleware: async (c, next) => {
      c.set('user', {
        id: userId,
        supabaseId: 'supabase-user',
        email: 'user@example.com',
        displayName: null,
        planCode: 'free',
      });
      await next();
    },
    rateLimitMiddleware: async (_c, next) => next(),
    jobService: service as never,
  });
}

function buildJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: jobId,
    userId,
    organizationId: null,
    jobType: 'page_generate',
    status: 'failed',
    generationMode: 'standard',
    creditCost: 3,
    creditSettlement: {
      chargedCredits: 3,
      refundedCredits: 0,
      netCredits: 3,
      status: 'charged',
    },
    params: { page_id: 'page-1', request_kind: 'standard' },
    result: {
      compiler_error: 'compiler internal stack',
      progress_stage: 'generating',
      progress_percent: 42,
    },
    sqsMessageId: 'sqs-private-id',
    openaiRequestId: 'req_secret',
    errorMessage: 'OpenAI request req_secret failed: s3://private-bucket/key',
    retryCount: 1,
    createdAt: new Date('2026-07-25T00:00:00.000Z'),
    startedAt: new Date('2026-07-25T00:01:00.000Z'),
    completedAt: new Date('2026-07-25T00:02:00.000Z'),
    expiresAt: null,
    ...overrides,
  };
}
