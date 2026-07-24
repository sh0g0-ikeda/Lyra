import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  jobAcceptedSchema,
  pageAutofillResponseSchema,
  pageGenerationReadinessSchema,
  pageSchema,
  pagesResponseSchema,
  saveAndGeneratePageResponseSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';
import { createApp } from '../../../src/app.js';
import { NotFoundError } from '../../../src/domain/errors/index.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { GenerationJob } from '../../../src/domain/types/job.js';
import type { PageSummary } from '../../../src/domain/types/page.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import { REQUEST_BODY_LIMITS } from '../../../src/routes/requestBody.js';
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
  PageGenerationReadinessResult,
} from '../../../src/services/page/PageGenerationService.js';
import type { SaveAndGeneratePageInput } from '../../../src/services/page/PageSaveAndGenerate.js';
import type { PageQueryServicePort } from '../../../src/services/page/PageQueryService.js';
import type { PageServicePort } from '../../../src/services/page/PageService.js';
import type {
  PageThumbnail,
  PageThumbnailServicePort,
} from '../../../src/services/page/PageThumbnailService.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';
import type {
  EpisodeStoryAutofillServicePort,
  EnqueueEpisodeStoryAutofillResult,
} from '../../../src/services/story/EpisodeStoryAutofillService.js';

const jwtSecret = 'unit-test-secret';
const user: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: 'supabase-user-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};

type EpisodeAutofillRouteResult = Awaited<ReturnType<PageServicePort['autofillEpisodeFromStory']>>;

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
  public readinessPageId: string | null = null;
  public saveAndGeneratePageId: string | null = null;
  public saveAndGenerateRequestId: string | null = null;

  public async enqueuePageGeneration(
    _userId: string,
    requestedPageId: string,
  ): Promise<EnqueuePageGenerationResult> {
    this.lastPageId = requestedPageId;
    return { jobId: '11111111-1111-4111-8111-111111111111' };
  }

  public async getGenerationReadiness(_userId: string, requestedPageId: string): Promise<PageGenerationReadinessResult> {
    this.readinessPageId = requestedPageId;
    return {
      ready: false,
      blockers: [
        {
          code: 'CHARACTER_REFERENCE_REQUIRED',
          entityId: '66666666-6666-4666-8666-666666666666',
          field: 'entities',
          action: 'open_characters',
          messageKey: 'page.blocker.characterReference',
        },
      ],
      warnings: [],
      estimatedCreditCost: 3,
      pageRevision: '2026-07-24T00:00:00.000Z',
    };
  }

  public async saveAndGenerate(
    _userId: string,
    requestedPageId: string,
    input: SaveAndGeneratePageInput,
  ): Promise<{ jobId: string; pageRevision: string }> {
    this.saveAndGeneratePageId = requestedPageId;
    this.saveAndGenerateRequestId = input.requestId;
    return {
      jobId: '11111111-1111-4111-8111-111111111111',
      pageRevision: '2026-07-24T00:00:01.000Z',
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

  public async autofillEpisodeFromStory(
    _userId: string,
    episodeId: string,
  ): Promise<EpisodeAutofillRouteResult> {
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

class FakeEpisodeStoryAutofillService implements EpisodeStoryAutofillServicePort {
  public autofilledEpisodeId: string | null = null;
  public shouldThrow = false;

  public async enqueueEpisodeStoryAutofill(
    _userId: string,
    episodeId: string,
  ): Promise<EnqueueEpisodeStoryAutofillResult> {
    this.autofilledEpisodeId = episodeId;
    if (this.shouldThrow) {
      throw new NotFoundError('Story autofill is not available');
    }

    return { jobId: '55555555-5555-4555-8555-555555555555' };
  }
}

class FakePageQueryService implements PageQueryServicePort {
  public listPageRequest: { limit: number; cursor: { sort: string | number; id: string } | null } | null = null;
  public requestedPageId: string | null = null;
  public page: PageSummary | null = buildPageSummary('33333333-3333-4333-8333-333333333333');

  public async listEpisodePages(): Promise<PageSummary[]> {
    return [buildPageSummary('33333333-3333-4333-8333-333333333333')];
  }

  public async listEpisodePagesPage(
    _userId: string,
    _episodeId: string,
    request: { limit: number; cursor: { sort: string | number; id: string } | null },
  ): Promise<{ items: PageSummary[]; nextCursor: string | null }> {
    this.listPageRequest = request;
    return {
      items: [buildPageSummary('33333333-3333-4333-8333-333333333333')],
      nextCursor: 'eyJ2IjoxLCJrIjoicGFnZXMiLCJzb3J0IjoxLCJpZCI6IjMzMzMzMzMzLTMzMzMtNDMzMy04MzMzLTMzMzMzMzMzMzMzMyJ9',
    };
  }

  public async getPage(_userId: string, pageId: string): Promise<PageSummary> {
    this.requestedPageId = pageId;
    if (this.page === null) {
      throw new NotFoundError('Page not found');
    }
    return { ...this.page, id: pageId };
  }
}

class FakePageThumbnailService implements PageThumbnailServicePort {
  public imageRequestCount = 0;
  public requestedPageId: string | null = null;
  public requestedOrganizationId: string | null = null;

  public async getGeneratedImageThumbnailRevision(
    _userId: string,
    pageId: string,
    organizationId: string | null = null,
  ): Promise<string> {
    this.requestedPageId = pageId;
    this.requestedOrganizationId = organizationId;
    return '2026-05-01T00:00:00.000Z';
  }

  public async getGeneratedImageThumbnail(
    _userId: string,
    pageId: string,
    organizationId: string | null = null,
  ): Promise<PageThumbnail> {
    this.imageRequestCount += 1;
    this.requestedPageId = pageId;
    this.requestedOrganizationId = organizationId;
    return {
      imageData: Buffer.from('fake-thumbnail'),
      mimeType: 'image/webp',
      revision: '2026-05-01T00:00:00.000Z',
    };
  }
}

class InvalidPageResponseQueryService extends FakePageQueryService {
  public override async getPage(_userId: string, pageId: string): Promise<PageSummary> {
    return {
      ...buildPageSummary(pageId),
      pageNumber: 0,
    };
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
    const payload = await response.json();
    expect(payload).toEqual({
      pages: [
        expect.objectContaining({
          id: '33333333-3333-4333-8333-333333333333',
          page_number: 1,
          panel_count: 4,
          generated_image: {
            generation_mode: 'standard',
            generated_at: '2026-05-01T00:00:00.000Z',
          },
          story_source_scene_ids: ['scene-1'],
          story_page_purpose: 'This page escalates the rooftop confrontation.',
          story_continuity_note: 'Keep the mood restrained for the next page.',
        }),
      ],
    });
    expect(pagesResponseSchema.parse(payload)).toMatchObject(payload as Record<string, unknown>);
  });

  it('returns a bounded episode page list only when limit is supplied', async () => {
    const pageQueryService = new FakePageQueryService();
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      new FakeJobService(),
      pageQueryService,
    );
    const token = await createToken();

    const response = await app.request('/api/episodes/44444444-4444-4444-8444-444444444444/pages?limit=2', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ pages: [expect.any(Object)], next_cursor: expect.any(String) });
    expect(pageQueryService.listPageRequest).toEqual({ limit: 2, cursor: null });
  });

  it('rejects invalid page limits and cursors before the page query service call', async () => {
    const pageQueryService = new FakePageQueryService();
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      new FakeJobService(),
      pageQueryService,
    );
    const token = await createToken();
    const headers = { Authorization: `Bearer ${token}` };
    const entityCursor = 'eyJ2IjoxLCJrIjoiZW50aXRpZXMiLCJzb3J0IjoiMjAyNi0wNC0yMlQwMDowMDowMC4wMDBaIiwiaWQiOiIyMjIyMjIyMi0yMjIyLTQyMjItODIyMi0yMjIyMjIyMjIyMjIifQ';

    for (const query of ['?limit=0', '?limit=101', '?limit=1.5', '?cursor=bad', `?cursor=${entityCursor}`, `?limit=1&cursor=${entityCursor}`, `?limit=1&cursor=${'a'.repeat(1025)}`]) {
      const response = await app.request(`/api/episodes/44444444-4444-4444-8444-444444444444/pages${query}`, { headers });
      expect(response.status).toBe(422);
    }
    expect(pageQueryService.listPageRequest).toBeNull();
  });

  it('returns a tenant-scoped selected page and returns 404 when it is unavailable', async () => {
    const pageQueryService = new FakePageQueryService();
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      new FakeJobService(),
      pageQueryService,
    );
    const token = await createToken();
    const pageId = '33333333-3333-4333-8333-333333333333';

    const response = await app.request(`/api/pages/${pageId}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(pageSchema.parse(payload)).toMatchObject({ id: pageId });
    expect(pageQueryService.requestedPageId).toBe(pageId);

    pageQueryService.page = null;
    const unavailable = await app.request(`/api/pages/${pageId}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(unavailable.status).toBe(404);
  });

  it('page response が canonical schema に違反する場合は fail-closed になる', async () => {
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      new FakeJobService(),
      new InvalidPageResponseQueryService(),
    );
    const token = await createToken();

    const response = await app.request('/api/pages/33333333-3333-4333-8333-333333333333', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(500);
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
    const payload = await response.json();
    expect(pageSchema.parse(payload)).toMatchObject({
      id: '33333333-3333-4333-8333-333333333333',
      page_dialogue_toggle: true,
    });
    expect(pageService.updatedPageId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('page settings は巨大な JSON body を service 呼び出し前に 413 にする', async () => {
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
        'Content-Length': String(REQUEST_BODY_LIMITS.SMALL_JSON_BYTES + 1),
      },
      body: '{}',
    });

    expect(response.status).toBe(413);
    expect(pageService.updatedPageId).toBeNull();
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
    const payload = await response.json();
    expect(pageAutofillResponseSchema.parse(payload)).toEqual({
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

  it('scene から page autofill は巨大な options body を service 呼び出し前に 413 にする', async () => {
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
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': String(REQUEST_BODY_LIMITS.SMALL_JSON_BYTES + 1),
      },
      body: '{}',
    });

    expect(response.status).toBe(413);
    expect(pageService.autofilledPageId).toBeNull();
  });

  it('episode 全体の story plan autofill を実行する', async () => {
    const pageService = new FakePageService();
    const episodeStoryAutofillService = new FakeEpisodeStoryAutofillService();
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      new FakeJobService(),
      new FakePageQueryService(),
      pageService,
      new FakePageExportService(),
      episodeStoryAutofillService,
    );
    const token = await createToken();

    const response = await app.request('/api/episodes/33333333-3333-4333-8333-333333333333/autofill-pages-from-story', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(202);
    const payload = await response.json();
    expect(jobAcceptedSchema.parse(payload)).toEqual({
      job_id: '55555555-5555-4555-8555-555555555555',
    });
    expect(pageService.autofilledEpisodeId).toBeNull();
    expect(episodeStoryAutofillService.autofilledEpisodeId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('episode 全体の story plan autofill は enqueue 失敗時に成功扱いしない', async () => {
    const episodeStoryAutofillService = new FakeEpisodeStoryAutofillService();
    episodeStoryAutofillService.shouldThrow = true;
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      new FakeJobService(),
      new FakePageQueryService(),
      new FakePageService(),
      new FakePageExportService(),
      episodeStoryAutofillService,
    );
    const token = await createToken();

    const response = await app.request('/api/episodes/33333333-3333-4333-8333-333333333333/autofill-pages-from-story', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Story autofill is not available',
      },
    });
    expect(episodeStoryAutofillService.autofilledEpisodeId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('episode 全体の story plan autofill は巨大な options body を service 呼び出し前に 413 にする', async () => {
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
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': String(REQUEST_BODY_LIMITS.SMALL_JSON_BYTES + 1),
      },
      body: '{}',
    });

    expect(response.status).toBe(413);
    expect(pageService.autofilledEpisodeId).toBeNull();
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
    const payload = await response.json();
    expect(jobAcceptedSchema.parse(payload)).toEqual({
      job_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(pageGenerationService.lastPageId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('generation readiness は stable blocker と revision だけを返す', async () => {
    const pageGenerationService = new FakePageGenerationService();
    const app = createTestApp(pageGenerationService, new FakePageFinalizeService(), new FakeJobService());
    const token = await createToken();

    const response = await app.request('/api/pages/33333333-3333-4333-8333-333333333333/generation-readiness', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(pageGenerationReadinessSchema.parse(payload)).toEqual({
      ready: false,
      blockers: [
        {
          code: 'CHARACTER_REFERENCE_REQUIRED',
          entity_id: '66666666-6666-4666-8666-666666666666',
          field: 'entities',
          action: 'open_characters',
          message_key: 'page.blocker.characterReference',
        },
      ],
      warnings: [],
      estimated_credit_cost: 3,
      page_revision: '2026-07-24T00:00:00.000Z',
    });
    expect(pageGenerationService.readinessPageId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('save-and-generate は bounded payload と idempotency key を service に渡す', async () => {
    const pageGenerationService = new FakePageGenerationService();
    const app = createTestApp(pageGenerationService, new FakePageFinalizeService(), new FakeJobService());
    const token = await createToken();

    const response = await app.request('/api/pages/33333333-3333-4333-8333-333333333333/save-and-generate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'mobile-request-001',
      },
      body: JSON.stringify({
        expected_updated_at: '2026-07-24T00:00:00.000Z',
        page: {},
        panels: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            order: 1,
            entities: [],
          },
        ],
        frames: [
          {
            panel_id: '44444444-4444-4444-8444-444444444444',
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
              { x: 0, y: 1 },
            ],
            border_style: 'solid',
            border_width: 3,
            border_color: '#000000',
            z_index: 1,
            reading_order: 1,
          },
        ],
        generation: { language: 'ja' },
      }),
    });

    expect(response.status).toBe(202);
    const payload = await response.json();
    expect(saveAndGeneratePageResponseSchema.parse(payload)).toEqual({
      job_id: '11111111-1111-4111-8111-111111111111',
      page_revision: '2026-07-24T00:00:01.000Z',
    });
    expect(pageGenerationService.saveAndGeneratePageId).toBe('33333333-3333-4333-8333-333333333333');
    expect(pageGenerationService.saveAndGenerateRequestId).toBe('mobile-request-001');
  });

  it('save-and-generate は idempotency key がなければ保存を開始しない', async () => {
    const pageGenerationService = new FakePageGenerationService();
    const app = createTestApp(pageGenerationService, new FakePageFinalizeService(), new FakeJobService());
    const token = await createToken();

    const response = await app.request('/api/pages/33333333-3333-4333-8333-333333333333/save-and-generate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    expect(response.status).toBe(422);
    expect(pageGenerationService.saveAndGeneratePageId).toBeNull();
  });

  it('save-and-generate は 32KB を超える bounded payload を受け付ける', async () => {
    const pageGenerationService = new FakePageGenerationService();
    const app = createTestApp(pageGenerationService, new FakePageFinalizeService(), new FakeJobService());
    const token = await createToken();

    const response = await app.request('/api/pages/33333333-3333-4333-8333-333333333333/save-and-generate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'mobile-request-001',
        'Content-Length': String(REQUEST_BODY_LIMITS.SMALL_JSON_BYTES + 1),
      },
      body: '{}',
    });

    expect(response.status).toBe(422);
    expect(pageGenerationService.saveAndGeneratePageId).toBeNull();
  });

  it('save-and-generate は 512KB を超える payload を service 呼び出し前に 413 にする', async () => {
    const pageGenerationService = new FakePageGenerationService();
    const app = createTestApp(pageGenerationService, new FakePageFinalizeService(), new FakeJobService());
    const token = await createToken();

    const response = await app.request('/api/pages/33333333-3333-4333-8333-333333333333/save-and-generate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'mobile-request-001',
        'Content-Length': String(REQUEST_BODY_LIMITS.SAVE_AND_GENERATE_JSON_BYTES + 1),
      },
      body: '{}',
    });

    expect(response.status).toBe(413);
    expect(pageGenerationService.saveAndGeneratePageId).toBeNull();
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

  it('ページ一覧用thumbnailは固定WebPとprivate cache headerを返す', async () => {
    const pageThumbnailService = new FakePageThumbnailService();
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      new FakeJobService(),
      new FakePageQueryService(),
      new FakePageService(),
      new FakePageExportService(),
      new FakeEpisodeStoryAutofillService(),
      pageThumbnailService,
    );
    const token = await createToken();

    const response = await app.request(
      '/api/pages/33333333-3333-4333-8333-333333333333/thumbnail',
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(response.headers.get('ETag')).toMatch(/^"page-thumbnail-[0-9a-f]{24}"$/u);
    expect(pageThumbnailService.requestedPageId).toBe(
      '33333333-3333-4333-8333-333333333333',
    );
    expect(pageThumbnailService.requestedOrganizationId).toBeNull();
  });

  it('thumbnailのETag一致時は原画像の取得と変換を行わず304を返す', async () => {
    const pageThumbnailService = new FakePageThumbnailService();
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      new FakeJobService(),
      new FakePageQueryService(),
      new FakePageService(),
      new FakePageExportService(),
      new FakeEpisodeStoryAutofillService(),
      pageThumbnailService,
    );
    const token = await createToken();
    const path = '/api/pages/33333333-3333-4333-8333-333333333333/thumbnail';

    const initialResponse = await app.request(path, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const etag = initialResponse.headers.get('ETag');
    expect(initialResponse.status).toBe(200);
    expect(etag).not.toBeNull();
    expect(pageThumbnailService.imageRequestCount).toBe(1);

    const cachedResponse = await app.request(path, {
      headers: {
        Authorization: `Bearer ${token}`,
        'If-None-Match': etag ?? '',
      },
    });

    expect(cachedResponse.status).toBe(304);
    expect(pageThumbnailService.imageRequestCount).toBe(1);
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
      result: {},
    });
    expect(payload).not.toHaveProperty('openai_request_id');
    expect(result).not.toHaveProperty('cost_usd');
    expect(result).not.toHaveProperty('compiled_prompt_used');
    expect(result).not.toHaveProperty('prompt_compiler_provider');
    expect(result).not.toHaveProperty('compiler_model');
    expect(result).not.toHaveProperty('compiler_prompt_version');
    expect(result).not.toHaveProperty('compiler_error');
    expect(result).not.toHaveProperty('draft_prompt');
    expect(result).not.toHaveProperty('compiled_brief');
    expect(result).not.toHaveProperty('compiled_prompt');
    expect(result).not.toHaveProperty('s3_key');
    expect(result).not.toHaveProperty('cdn_url');
    expect(result).not.toHaveProperty('generated_image');
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
    const result = payload.result as Record<string, unknown>;
    const candidates = result.candidates as Array<Record<string, unknown>>;
    expect(result.provider_result).toBe(true);
    expect(result).not.toHaveProperty('cost_usd');
    expect(result).not.toHaveProperty('compiled_prompt_used');
    expect(result).not.toHaveProperty('prompt_compiler_provider');
    expect(result).not.toHaveProperty('compiler_model');
    expect(result).not.toHaveProperty('compiler_prompt_version');
    expect(result).not.toHaveProperty('compiler_error');
    expect(result).not.toHaveProperty('image_model');
    expect(result).not.toHaveProperty('image_params');
    expect(typeof candidates[0]?.candidate_token).toBe('string');
    expect(candidates[0]).not.toHaveProperty('s3_key');
    expect(candidates[0]).not.toHaveProperty('cdn_url');
    const params = payload.params as Record<string, unknown>;
    expect(params).not.toHaveProperty('source_s3_key');
    expect(params).not.toHaveProperty('previous_entity_status');
    expect(params).not.toHaveProperty('draft_prompt');
  });

  it('jobs endpoint は provider request id を返さず local fallback 候補を明示する', async () => {
    const jobService = new FakeJobService();
    jobService.job = buildEntityJob({
      openaiRequestId: null,
      result: {
        candidates: [
          {
            s3_key: 'session/user-1/entities/entity/job-1.png',
          },
        ],
        cost_usd: 0,
      },
    });
    const app = createTestApp(new FakePageGenerationService(), new FakePageFinalizeService(), jobService);
    const token = await createToken();

    const response = await app.request('/api/jobs/22222222-2222-4222-8222-222222222222', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    const result = payload.result as Record<string, unknown>;

    expect(payload).not.toHaveProperty('openai_request_id');
    expect(result.provider_result).toBe(false);
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
  episodeStoryAutofillService: EpisodeStoryAutofillServicePort = new FakeEpisodeStoryAutofillService(),
  pageThumbnailService: PageThumbnailServicePort = new FakePageThumbnailService(),
): ReturnType<typeof createApp> {
  return createApp({
    creditService: new FakeCreditService(),
    episodeStoryAutofillService,
    jobService,
    jwtSecret,
    pageExportService,
    pageFinalizeService,
    pageGenerationService,
    pageQueryService,
    pageService,
    pageThumbnailService,
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
    creditSettlement: {
      chargedCredits: 10,
      refundedCredits: 0,
      netCredits: 10,
      status: 'charged',
    },
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

function buildEntityJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    userId: user.id,
    jobType: 'entity_generate',
    status: 'completed',
    creditCost: 10,
    creditSettlement: {
      chargedCredits: 10,
      refundedCredits: 0,
      netCredits: 10,
      status: 'charged',
    },
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
    ...overrides,
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
