import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { NotFoundError } from '../../../src/domain/errors/index.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { GenerationJob } from '../../../src/domain/types/job.js';
import type { PageSummary } from '../../../src/domain/types/page.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../src/services/credit/CreditService.js';
import type { JobServicePort } from '../../../src/services/job/JobService.js';
import type { PageExportServicePort } from '../../../src/services/page/PageExportService.js';
import type { PageFinalizeServicePort } from '../../../src/services/page/PageFinalizeService.js';
import type {
  EnqueuePageGenerationResult,
  PageGenerationServicePort,
} from '../../../src/services/page/PageGenerationService.js';
import type { PageQueryServicePort } from '../../../src/services/page/PageQueryService.js';
import type { PageServicePort } from '../../../src/services/page/PageService.js';
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

  public async grantSignupBonus(userId: string): Promise<CreditBalanceSnapshot> {
    return this.getBalance(userId);
  }

  public async consumeCredits(params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance(params.userId);
  }

  public async refundCredits(params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance(params.userId);
  }
}

class FakePageGenerationService implements PageGenerationServicePort {
  public lastPageId: string | null = null;

  public async enqueuePageGeneration(
    _userId: string,
    requestedPageId: string,
  ): Promise<EnqueuePageGenerationResult> {
    this.lastPageId = requestedPageId;
    return { jobId: '11111111-1111-4111-8111-111111111111' };
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

class FakePageExportService implements PageExportServicePort {
  public exportedPageId: string | null = null;

  public async exportGeneratedImage(_userId: string, pageId: string) {
    this.exportedPageId = pageId;
    return {
      imageData: Buffer.from('fake-image'),
      mimeType: 'image/png' as const,
    };
  }
}

class FakePageService implements PageServicePort {
  public updatedPageId: string | null = null;
  public autofilledPageId: string | null = null;
  public autofilledEpisodeId: string | null = null;

  public async updatePageSettings(_userId: string, pageId: string): Promise<PageSummary> {
    this.updatedPageId = pageId;
    return buildPageSummary(pageId);
  }

  public async autofillFromScenes(_userId: string, pageId: string) {
    this.autofilledPageId = pageId;
    return {
      updatedPanelCount: 2,
      filledFieldCount: 9,
      compilerUsed: true,
      compilerProvider: 'openai' as const,
      compilerModel: 'gpt-5.4-mini',
      compilerPromptVersion: 'page_autofill_v2',
      compilerError: null,
    };
  }

  public async autofillEpisodeFromStory(_userId: string, episodeId: string) {
    this.autofilledEpisodeId = episodeId;
    return {
      updatedPageCount: 2,
      updatedPanelCount: 8,
      updatedAssignmentCount: 6,
      filledFieldCount: 24,
      compilerUsed: true,
      compilerProvider: 'openai' as const,
      compilerModel: 'gpt-5.4-mini',
      compilerPromptVersion: 'page_autofill_v2',
      compilerError: null,
    };
  }
}

class FakePageQueryService implements PageQueryServicePort {
  public async listEpisodePages(): Promise<PageSummary[]> {
    return [buildPageSummary('33333333-3333-4333-8333-333333333333')];
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
  it('episode pages 一覧を返す', async () => {
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      new FakeJobService(),
      new FakePageQueryService(),
    );
    const token = await createToken();

    const response = await app.request('/api/episodes/44444444-4444-4444-8444-444444444444/pages', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pages: [
        expect.objectContaining({
          id: '33333333-3333-4333-8333-333333333333',
          page_number: 1,
          panel_count: 4,
          generated_image: {
            cdn_url: 'https://cdn.example.com/page.png',
            generation_mode: 'standard',
            generated_at: '2026-05-01T00:00:00.000Z',
          },
          story_source_scene_ids: ['scene-1'],
          story_page_purpose: 'This page escalates the rooftop confrontation.',
          story_continuity_note: 'Keep the mood restrained for the next page.',
        }),
      ],
    });
  });

  it('page settings を更新する', async () => {
    const pageService = new FakePageService();
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      new FakeJobService(),
      new FakePageQueryService(),
      pageService,
    );
    const token = await createToken();

    const response = await app.request('/api/pages/33333333-3333-4333-8333-333333333333', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dialogue_mode: 'mixed',
        page_dialogue_toggle: true,
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        id: '33333333-3333-4333-8333-333333333333',
        page_dialogue_toggle: true,
      }),
    );
    expect(pageService.updatedPageId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('scene から page autofill を実行する', async () => {
    const pageService = new FakePageService();
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      new FakeJobService(),
      new FakePageQueryService(),
      pageService,
    );
    const token = await createToken();

    const response = await app.request('/api/pages/33333333-3333-4333-8333-333333333333/autofill-from-scenes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      updated_panel_count: 2,
      filled_field_count: 9,
      compiler_used: true,
      compiler_provider: 'openai',
      compiler_model: 'gpt-5.4-mini',
      compiler_prompt_version: 'page_autofill_v2',
      compiler_error: null,
    });
    expect(pageService.autofilledPageId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('episode 全体の story plan autofill を実行する', async () => {
    const pageService = new FakePageService();
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      new FakeJobService(),
      new FakePageQueryService(),
      pageService,
    );
    const token = await createToken();

    const response = await app.request('/api/episodes/33333333-3333-4333-8333-333333333333/autofill-pages-from-story', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      updated_page_count: 2,
      updated_panel_count: 8,
      updated_assignment_count: 6,
      filled_field_count: 24,
      compiler_used: true,
      compiler_provider: 'openai',
      compiler_model: 'gpt-5.4-mini',
      compiler_prompt_version: 'page_autofill_v2',
      compiler_error: null,
    });
    expect(pageService.autofilledEpisodeId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('ページ生成 enqueue は 202 と job_id を返す', async () => {
    const pageGenerationService = new FakePageGenerationService();
    const app = createTestApp(pageGenerationService, new FakePageFinalizeService(), new FakeJobService());
    const token = await createToken();

    const response = await app.request('/api/pages/33333333-3333-4333-8333-333333333333/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      job_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(pageGenerationService.lastPageId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('ページ画像エクスポートは画像 bytes を返す', async () => {
    const pageExportService = new FakePageExportService();
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      new FakeJobService(),
      new FakePageQueryService(),
      new FakePageService(),
      pageExportService,
    );
    const token = await createToken();

    const response = await app.request('/api/pages/33333333-3333-4333-8333-333333333333/export-image', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(pageExportService.exportedPageId).toBe('33333333-3333-4333-8333-333333333333');
    await expect(response.arrayBuffer()).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it('jobs endpoint で対象 job を返す', async () => {
    const app = createTestApp(new FakePageGenerationService(), new FakePageFinalizeService(), new FakeJobService());
    const token = await createToken();

    const response = await app.request('/api/jobs/22222222-2222-4222-8222-222222222222', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    const result = payload.result as Record<string, unknown>;

    expect(payload).toMatchObject({
      id: '22222222-2222-4222-8222-222222222222',
      job_type: 'page_generate',
      params: {
        page_id: '33333333-3333-4333-8333-333333333333',
        request_kind: 'initial',
        generation_mode: 'standard',
        quality: 'medium',
        requires_planner: false,
      },
      result: {
        generated_image: {
          cdn_url: 'https://cdn.example.com/page.png',
        },
        compiled_prompt_used: true,
      },
      openai_request_id: null,
    });
    expect(result).not.toHaveProperty('draft_prompt');
    expect(result).not.toHaveProperty('compiled_brief');
    expect(result).not.toHaveProperty('compiled_prompt');
    expect(result).not.toHaveProperty('s3_key');
    const generatedImage = result.generated_image as Record<string, unknown>;
    expect(generatedImage).not.toHaveProperty('s3_key');
    const params = payload.params as Record<string, unknown>;
    expect(params).not.toHaveProperty('previous_page_status');
    expect(params).not.toHaveProperty('previous_generation_mode');
    expect(params).not.toHaveProperty('draft_prompt');
    expect(payload).not.toHaveProperty('user_id');
    expect(payload).not.toHaveProperty('sqs_message_id');
  });

  it('jobs endpoint は entity job の内部 source key を返さない', async () => {
    const jobService = new FakeJobService();
    jobService.job = buildEntityJob();
    const app = createTestApp(new FakePageGenerationService(), new FakePageFinalizeService(), jobService);
    const token = await createToken();

    const response = await app.request('/api/jobs/22222222-2222-4222-8222-222222222222', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(payload).toMatchObject({
      job_type: 'entity_generate',
      params: {
        entity_id: '55555555-5555-4555-8555-555555555555',
        entity_type: 'character',
      },
    });
    const params = payload.params as Record<string, unknown>;
    expect(params).not.toHaveProperty('source_s3_key');
    expect(params).not.toHaveProperty('previous_entity_status');
    expect(params).not.toHaveProperty('draft_prompt');
  });

  it('不正な UUID は 422 になる', async () => {
    const app = createTestApp(new FakePageGenerationService(), new FakePageFinalizeService(), new FakeJobService());
    const token = await createToken();

    const response = await app.request('/api/jobs/not-a-uuid', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(422);
  });

  it('認証が無ければ 401 になる', async () => {
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
      headers: { Authorization: `Bearer ${token}` },
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
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(204);
    expect(pageFinalizeService.reopenedPageId).toBe('33333333-3333-4333-8333-333333333333');
  });
});

function createTestApp(
  pageGenerationService: PageGenerationServicePort,
  pageFinalizeService: PageFinalizeServicePort,
  jobService: JobServicePort,
  pageQueryService: PageQueryServicePort = new FakePageQueryService(),
  pageService: PageServicePort = new FakePageService(),
  pageExportService: PageExportServicePort = new FakePageExportService(),
): ReturnType<typeof createApp> {
  return createApp({
    creditService: new FakeCreditService(),
    jobService,
    jwtSecret,
    pageExportService,
    pageFinalizeService,
    pageGenerationService,
    pageQueryService,
    pageService,
    userProvisioningService: new FakeUserProvisioningService(),
  });
}

function buildPageSummary(pageId: string): PageSummary {
  return {
    id: pageId,
    episodeId: '44444444-4444-4444-8444-444444444444',
    pageNumber: 1,
    layoutConfig: { type: 'template', template_id: 'standard_4' },
    storySourceSceneIds: ['scene-1'],
    storyPagePurpose: 'This page escalates the rooftop confrontation.',
    storyContinuityNote: 'Keep the mood restrained for the next page.',
    dialogueMode: 'mixed',
    pageDialogueToggle: true,
    generationMode: null,
    generatedImage: {
      s3Key: 'session/user-1/pages/page-1/result.png',
      cdnUrl: 'https://cdn.example.com/page.png',
      generationMode: 'standard',
      generatedAt: '2026-05-01T00:00:00.000Z',
    },
    status: 'editing',
    panelCount: 4,
    frameCount: 4,
    balloonCount: 0,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
  };
}

function buildJob(): GenerationJob {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    userId: user.id,
    jobType: 'page_generate',
    status: 'completed',
    creditCost: 10,
    generationMode: 'standard',
    params: {
      page_id: '33333333-3333-4333-8333-333333333333',
      request_kind: 'initial',
      generation_mode: 'standard',
      quality: 'medium',
      requires_planner: false,
      previous_page_status: 'editing',
      previous_generation_mode: null,
      draft_prompt: 'internal draft prompt should not be returned',
    },
    result: {
      s3_key: 'session/user-1/pages/page-1/result.png',
      cdn_url: 'https://cdn.example.com/page.png',
      generated_image: {
        s3_key: 'session/user-1/pages/page-1/result.png',
        cdn_url: 'https://cdn.example.com/page.png',
      },
      draft_prompt: 'very long draft prompt should not be returned',
      compiled_brief: 'very long compiler brief should not be returned',
      compiled_prompt: 'very long compiled prompt should not be returned',
      compiled_prompt_used: true,
    },
    sqsMessageId: null,
    openaiRequestId: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    startedAt: new Date('2026-05-01T00:00:01.000Z'),
    completedAt: new Date('2026-05-01T00:00:02.000Z'),
    expiresAt: null,
  };
}

function buildEntityJob(): GenerationJob {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    userId: user.id,
    jobType: 'entity_generate',
    status: 'completed',
    creditCost: 10,
    generationMode: null,
    params: {
      entity_id: '55555555-5555-4555-8555-555555555555',
      entity_type: 'character',
      previous_entity_status: 'draft',
      source_s3_key: 'tmp/user-1/entities/imports/source.png',
      draft_prompt: 'internal entity prompt should not be returned',
    },
    result: {
      candidates: [
        {
          s3_key: 'session/user-1/entities/entity/job-1.png',
          cdn_url: 'https://cdn.example.com/entity.png',
        },
      ],
      cost_usd: 0.02,
    },
    sqsMessageId: null,
    openaiRequestId: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    startedAt: new Date('2026-05-01T00:00:01.000Z'),
    completedAt: new Date('2026-05-01T00:00:02.000Z'),
    expiresAt: null,
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
