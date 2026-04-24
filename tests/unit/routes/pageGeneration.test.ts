import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { NotFoundError } from '../../../src/domain/errors/index.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { GenerationJob } from '../../../src/domain/types/job.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../src/services/credit/CreditService.js';
import type { JobServicePort } from '../../../src/services/job/JobService.js';
import type { PageFinalizeServicePort } from '../../../src/services/page/PageFinalizeService.js';
import type {
  EnqueuePageGenerationResult,
  PageGenerationServicePort,
} from '../../../src/services/page/PageGenerationService.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';

const jwtSecret = 'unit-test-secret';
const user: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: 'supabase-user-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};

class FakeUserProvisioningService implements UserProvisioningPort {
  public async provisionFromSupabaseClaims(claims: SupabaseJwtClaims): Promise<ProvisionedUser> {
    return {
      user: {
        ...user,
        supabaseId: claims.sub,
        email: claims.email,
      },
      isNewUser: false,
    };
  }
}

class FakeCreditService implements CreditServicePort {
  public async getBalance(_userId: string): Promise<CreditBalanceSnapshot> {
    return { monthlyCredits: 0, purchasedCredits: 0, totalCredits: 0, monthlyExpiresAt: null };
  }

  public async grantSignupBonus(_userId: string): Promise<CreditBalanceSnapshot> {
    return this.getBalance(_userId);
  }

  public async consumeCredits(_params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance(_params.userId);
  }

  public async refundCredits(_params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance(_params.userId);
  }
}

class FakePageGenerationService implements PageGenerationServicePort {
  public lastPageId: string | null = null;

  public async enqueuePageGeneration(_userId: string, requestedPageId: string): Promise<EnqueuePageGenerationResult> {
    this.lastPageId = requestedPageId;
    return {
      jobId: '11111111-1111-4111-8111-111111111111',
    };
  }
}

class FakePageFinalizeService implements PageFinalizeServicePort {
  public confirmedPageId: string | null = null;
  public reopenedPageId: string | null = null;

  public async confirmPage(_userId: string, pageId: string): Promise<void> {
    this.confirmedPageId = pageId;
  }

  public async reopenPage(_userId: string, pageId: string): Promise<void> {
    this.reopenedPageId = pageId;
  }
}

class FakeJobService implements JobServicePort {
  public job: GenerationJob | null = buildJob();

  public async getJob(_userId: string, _jobId: string): Promise<GenerationJob> {
    if (this.job === null) {
      throw new NotFoundError('Job not found');
    }

    return this.job;
  }
}

describe('page generation routes', () => {
  it('認証済みならページ生成 enqueue で202とjob_idを返す', async () => {
    const pageGenerationService = new FakePageGenerationService();
    const app = createTestApp(pageGenerationService, new FakePageFinalizeService(), new FakeJobService());
    const token = await createToken();

    const response = await app.request('/api/pages/33333333-3333-4333-8333-333333333333/generate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      job_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(pageGenerationService.lastPageId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('認証済みならjob取得で対象jobを返す', async () => {
    const app = createTestApp(new FakePageGenerationService(), new FakePageFinalizeService(), new FakeJobService());
    const token = await createToken();

    const response = await app.request('/api/jobs/22222222-2222-4222-8222-222222222222', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();

    expect(payload).toMatchObject({
      id: '22222222-2222-4222-8222-222222222222',
      job_type: 'page_generate',
      params: {
        requires_planner: false,
      },
    });
    expect(payload).not.toHaveProperty('user_id');
    expect(payload).not.toHaveProperty('sqs_message_id');
    expect(payload).not.toHaveProperty('openai_request_id');
  });

  it('不正なUUIDは422になる', async () => {
    const app = createTestApp(new FakePageGenerationService(), new FakePageFinalizeService(), new FakeJobService());
    const token = await createToken();

    const response = await app.request('/api/jobs/not-a-uuid', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(422);
  });

  it('認証が無ければ401になる', async () => {
    const app = createTestApp(new FakePageGenerationService(), new FakePageFinalizeService(), new FakeJobService());

    const generateResponse = await app.request('/api/pages/33333333-3333-4333-8333-333333333333/generate', {
      method: 'POST',
    });
    const jobResponse = await app.request('/api/jobs/22222222-2222-4222-8222-222222222222');

    expect(generateResponse.status).toBe(401);
    expect(jobResponse.status).toBe(401);
  });

  it('confirm は 204 を返す', async () => {
    const pageFinalizeService = new FakePageFinalizeService();
    const app = createTestApp(new FakePageGenerationService(), pageFinalizeService, new FakeJobService());
    const token = await createToken();

    const response = await app.request('/api/pages/33333333-3333-4333-8333-333333333333/confirm', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(204);
    expect(pageFinalizeService.confirmedPageId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('reopen は 204 を返す', async () => {
    const pageFinalizeService = new FakePageFinalizeService();
    const app = createTestApp(new FakePageGenerationService(), pageFinalizeService, new FakeJobService());
    const token = await createToken();

    const response = await app.request('/api/pages/33333333-3333-4333-8333-333333333333/reopen', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(204);
    expect(pageFinalizeService.reopenedPageId).toBe('33333333-3333-4333-8333-333333333333');
  });
});

function createTestApp(
  pageGenerationService: PageGenerationServicePort,
  pageFinalizeService: PageFinalizeServicePort,
  jobService: JobServicePort,
): ReturnType<typeof createApp> {
  return createApp({
    creditService: new FakeCreditService(),
    jobService,
    pageFinalizeService,
    pageGenerationService,
    userProvisioningService: new FakeUserProvisioningService(),
    jwtSecret,
  });
}

function buildJob(): GenerationJob {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    userId: user.id,
    jobType: 'page_generate',
    status: 'queued',
    generationMode: 'standard',
    creditCost: 10,
    params: {
      page_id: '33333333-3333-4333-8333-333333333333',
      request_kind: 'initial',
      generation_mode: 'standard',
      quality: 'medium',
      requires_planner: false,
    },
    result: null,
    sqsMessageId: 'message-1',
    openaiRequestId: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    expiresAt: new Date('2026-05-01T00:00:00.000Z'),
  };
}

async function createToken(): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.supabaseId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(jwtSecret));
}
