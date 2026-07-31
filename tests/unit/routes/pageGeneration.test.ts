import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import {
  decodeGenerationJobHistoryCursor,
  decodePageListCursor,
} from '../../../src/domain/pagination.js';
import { NotFoundError } from '../../../src/domain/errors/index.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { GenerationJob } from '../../../src/domain/types/job.js';
import type { PageSummary } from '../../../src/domain/types/page.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import { REQUEST_BODY_LIMITS } from '../../../src/routes/requestBody.js';
import type {
  GenerationJobHistoryCursor,
  GenerationJobHistoryPage,
} from '../../../src/repositories/GenerationJobRepository.js';
import type {
  PageListCursor,
  PageListPage,
} from '../../../src/repositories/PageRepository.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../src/services/credit/CreditService.js';
import type { JobServicePort } from '../../../src/services/job/JobService.js';
import type { OrganizationServicePort } from '../../../src/services/organization/OrganizationService.js';
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
  public page: PageListPage = {
    pages: [buildPageSummary('33333333-3333-4333-8333-333333333333')],
    nextCursor: null,
  };
  public pageCalls: Array<{
    userId: string;
    episodeId: string;
    limit: number;
    cursor: PageListCursor | null;
    organizationId: string | null;
  }> = [];

  public async listEpisodePages(): Promise<PageSummary[]> {
    return [buildPageSummary('33333333-3333-4333-8333-333333333333')];
  }

  public async listEpisodePagesPage(
    userId: string,
    episodeId: string,
    input: { limit: number; cursor: PageListCursor | null },
    organizationId: string | null = null,
  ): Promise<PageListPage> {
    this.pageCalls.push({
      userId,
      episodeId,
      ...input,
      organizationId,
    });
    return this.page;
  }
}

class FakeJobService implements JobServicePort {
  public job: GenerationJob | null = buildJob();
  public historyPage: GenerationJobHistoryPage = {
    jobs: [],
    nextCursor: null,
  };
  public historyCalls: Array<{
    userId: string;
    organizationId: string | null;
    limit: number;
    cursor: GenerationJobHistoryCursor | null;
  }> = [];
  public hiddenJobs: Array<{
    userId: string;
    jobId: string;
    organizationId: string | null;
  }> = [];
  public cancelledJob: {
    userId: string;
    jobId: string;
    organizationId: string | null;
  } | null = null;

  public async getJob(
    _userId: string,
    _jobId: string,
    _organizationId: string | null = null,
  ): Promise<GenerationJob> {
    if (this.job === null) {
      throw new NotFoundError('Job not found');
    }

    return this.job;
  }

  public async cancelJob(
    userId: string,
    jobId: string,
    organizationId: string | null = null,
  ): Promise<GenerationJob> {
    if (this.job === null) {
      throw new NotFoundError('Job not found');
    }

    this.cancelledJob = { userId, jobId, organizationId };
    return this.job;
  }

  public async listJobHistory(
    userId: string,
    input: {
      organizationId?: string | null;
      limit: number;
      cursor: GenerationJobHistoryCursor | null;
    },
  ): Promise<GenerationJobHistoryPage> {
    this.historyCalls.push({
      userId,
      organizationId: input.organizationId ?? null,
      limit: input.limit,
      cursor: input.cursor,
    });
    return this.historyPage;
  }

  public async hideJobFromHistory(
    userId: string,
    jobId: string,
    organizationId: string | null = null,
  ): Promise<void> {
    this.hiddenJobs.push({ userId, jobId, organizationId });
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
    expect(payload).not.toHaveProperty('next_cursor');
  });

  it('episode pages一覧をopaque cursorでpage取得する', async () => {
    const pageQueryService = new FakePageQueryService();
    const nextCursor: PageListCursor = {
      pageNumber: 1,
      id: '33333333-3333-4333-8333-333333333333',
    };
    pageQueryService.page.nextCursor = nextCursor;
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      new FakeJobService(),
      pageQueryService,
    );
    const token = await createToken();
    const headers = { Authorization: `Bearer ${token}` };
    const episodeId = '44444444-4444-4444-8444-444444444444';

    const first = await app.request(
      `/api/episodes/${episodeId}/pages?limit=40`,
      { headers },
    );
    const firstPayload = (await first.json()) as { next_cursor: string };
    const second = await app.request(
      `/api/episodes/${episodeId}/pages?limit=10&cursor=${encodeURIComponent(firstPayload.next_cursor)}`,
      { headers },
    );

    expect(first.status).toBe(200);
    expect(decodePageListCursor(firstPayload.next_cursor)).toEqual(nextCursor);
    expect(second.status).toBe(200);
    expect(pageQueryService.pageCalls).toEqual([
      {
        userId: user.id,
        episodeId,
        limit: 40,
        cursor: null,
        organizationId: null,
      },
      {
        userId: user.id,
        episodeId,
        limit: 10,
        cursor: nextCursor,
        organizationId: null,
      },
    ]);
  });

  it('episode pages一覧の不正limit・cursorを422にする', async () => {
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      new FakeJobService(),
    );
    const token = await createToken();
    const headers = { Authorization: `Bearer ${token}` };
    const basePath =
      '/api/episodes/44444444-4444-4444-8444-444444444444/pages';

    const responses = await Promise.all([
      app.request(`${basePath}?limit=0`, { headers }),
      app.request(`${basePath}?limit=101`, { headers }),
      app.request(`${basePath}?limit=1.5`, { headers }),
      app.request(`${basePath}?cursor=opaque`, { headers }),
      app.request(`${basePath}?limit=10&cursor=invalid`, { headers }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      422, 422, 422, 422, 422,
    ]);
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

  it('page一覧とsettings更新は契約外Service値を500にする', async () => {
    const pageQueryService = new FakePageQueryService();
    pageQueryService.listEpisodePages = async () => [buildPageSummary('')];
    const pageService = new FakePageService();
    pageService.updatePageSettings = async () => buildPageSummary('');
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      new FakeJobService(),
      pageQueryService,
      pageService,
    );
    const token = await createToken();

    const responses = await Promise.all([
      app.request('/api/episodes/44444444-4444-4444-8444-444444444444/pages', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      app.request('/api/pages/33333333-3333-4333-8333-333333333333', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dialogue_mode: 'mixed',
          page_dialogue_toggle: true,
        }),
      }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'CONFIGURATION_ERROR' },
      });
    }
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
    await expect(response.json()).resolves.toEqual({
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
    await expect(response.json()).resolves.toEqual({
      job_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(pageGenerationService.lastPageId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('page job受付とautofill成功JSONは契約外Service値を500にする', async () => {
    const pageGenerationService = new FakePageGenerationService();
    pageGenerationService.enqueuePageGeneration = async () => ({ jobId: '' });
    const pageService: PageServicePort = new FakePageService();
    pageService.autofillFromScenes = async () => ({
      updatedPanelCount: 0,
      filledFieldCount: 0,
      compilerUsed: false,
      compilerProvider: 'legacy' as 'openai',
      compilerModel: null,
      compilerPromptVersion: null,
      compilerError: null,
    });
    const episodeStoryAutofillService = new FakeEpisodeStoryAutofillService();
    episodeStoryAutofillService.enqueueEpisodeStoryAutofill = async () => ({ jobId: '' });
    const app = createTestApp(
      pageGenerationService,
      new FakePageFinalizeService(),
      new FakeJobService(),
      new FakePageQueryService(),
      pageService,
      new FakePageExportService(),
      episodeStoryAutofillService,
    );
    const token = await createToken();
    const headers = { Authorization: `Bearer ${token}` };

    const responses = await Promise.all([
      app.request('/api/episodes/33333333-3333-4333-8333-333333333333/autofill-pages-from-story', {
        method: 'POST',
        headers,
      }),
      app.request('/api/pages/33333333-3333-4333-8333-333333333333/autofill-from-scenes', {
        method: 'POST',
        headers,
      }),
      app.request('/api/pages/33333333-3333-4333-8333-333333333333/generate', {
        method: 'POST',
        headers,
      }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'CONFIGURATION_ERROR' },
      });
    }
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

  it('job履歴0件を正常なempty stateとして返す', async () => {
    const jobService = new FakeJobService();
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      jobService,
    );
    const token = await createToken();

    const response = await app.request('/api/jobs?limit=25', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobs: [],
      next_cursor: null,
    });
    expect(jobService.historyCalls).toEqual([
      {
        userId: user.id,
        organizationId: null,
        limit: 25,
        cursor: null,
      },
    ]);
  });

  it('job履歴のnext cursorをopaque値で返し次page入力を復号する', async () => {
    const jobService = new FakeJobService();
    const cursor = {
      activeRank: 1 as const,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      id: '22222222-2222-4222-8222-222222222222',
    };
    jobService.historyPage = {
      jobs: [buildJob()],
      nextCursor: cursor,
    };
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      jobService,
    );
    const token = await createToken();

    const first = await app.request('/api/jobs', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const firstPayload = (await first.json()) as {
      next_cursor: string;
    };
    const second = await app.request(
      `/api/jobs?limit=10&cursor=${encodeURIComponent(firstPayload.next_cursor)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(first.status).toBe(200);
    expect(decodeGenerationJobHistoryCursor(firstPayload.next_cursor)).toEqual(
      cursor,
    );
    expect(second.status).toBe(200);
    expect(jobService.historyCalls[1]).toEqual({
      userId: user.id,
      organizationId: null,
      limit: 10,
      cursor,
    });
  });

  it('job履歴の不正limit・cursorを422にする', async () => {
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      new FakeJobService(),
    );
    const token = await createToken();
    const headers = { Authorization: `Bearer ${token}` };

    const responses = await Promise.all([
      app.request('/api/jobs?limit=0', { headers }),
      app.request('/api/jobs?limit=101', { headers }),
      app.request('/api/jobs?limit=1.5', { headers }),
      app.request('/api/jobs?cursor=not-a-cursor', { headers }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      422, 422, 422, 422,
    ]);
  });

  it('terminal jobを履歴から非表示にしてもdirect GETを維持する', async () => {
    const jobService = new FakeJobService();
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      jobService,
    );
    const token = await createToken();
    const headers = { Authorization: `Bearer ${token}` };
    const jobId = '22222222-2222-4222-8222-222222222222';

    const hidden = await app.request(`/api/jobs/${jobId}`, {
      method: 'DELETE',
      headers,
    });
    const direct = await app.request(`/api/jobs/${jobId}`, { headers });

    expect(hidden.status).toBe(204);
    expect(direct.status).toBe(200);
    expect(jobService.hiddenJobs).toEqual([
      { userId: user.id, jobId, organizationId: null },
    ]);
  });

  it('organization job履歴と非表示はview_work確認後に同じscopeを渡す', async () => {
    const organizationId = '11111111-1111-4111-8111-111111111111';
    const requiredCapabilities: string[] = [];
    const organizationService = {
      requireMembership: async (
        _organizationId: string,
        _userId: string,
        capability: string,
      ) => {
        requiredCapabilities.push(capability);
        return {};
      },
    } as unknown as OrganizationServicePort;
    const jobService = new FakeJobService();
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      jobService,
      new FakePageQueryService(),
      new FakePageService(),
      new FakePageExportService(),
      new FakeEpisodeStoryAutofillService(),
      organizationService,
    );
    const token = await createToken();
    const headers = { Authorization: `Bearer ${token}` };
    const jobId = '22222222-2222-4222-8222-222222222222';

    const list = await app.request(
      `/api/jobs?organization_id=${organizationId}`,
      { headers },
    );
    const hidden = await app.request(
      `/api/jobs/${jobId}?organization_id=${organizationId}`,
      { method: 'DELETE', headers },
    );

    expect(list.status).toBe(200);
    expect(hidden.status).toBe(204);
    expect(requiredCapabilities).toEqual(['view_work', 'view_work']);
    expect(jobService.historyCalls[0]?.organizationId).toBe(organizationId);
    expect(jobService.hiddenJobs[0]?.organizationId).toBe(organizationId);
  });

  it('job取得と停止は契約外Service値を500にする', async () => {
    const jobService = new FakeJobService();
    jobService.job = { ...buildJob(), id: '' };
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      jobService,
    );
    const token = await createToken();
    const headers = { Authorization: `Bearer ${token}` };

    const responses = await Promise.all([
      app.request('/api/jobs/22222222-2222-4222-8222-222222222222', { headers }),
      app.request('/api/jobs/22222222-2222-4222-8222-222222222222/cancel', {
        method: 'POST',
        headers,
      }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'CONFIGURATION_ERROR' },
      });
    }
  });

  it('話全体反映 job の停止要求を認証ユーザーで受け付ける', async () => {
    const jobService = new FakeJobService();
    jobService.job = buildJob();
    jobService.job = {
      ...jobService.job,
      jobType: 'episode_story_autofill',
      status: 'processing',
      generationMode: null,
      creditCost: 0,
      params: { episode_id: '44444444-4444-4444-8444-444444444444', language: 'ja' },
      cancelRequestedAt: new Date('2026-05-01T00:00:03.000Z'),
    };
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      jobService,
    );
    const token = await createToken();

    const response = await app.request(
      '/api/jobs/22222222-2222-4222-8222-222222222222/cancel',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    expect(response.status).toBe(200);
    expect(jobService.cancelledJob).toEqual({
      userId: user.id,
      jobId: '22222222-2222-4222-8222-222222222222',
      organizationId: null,
    });
    await expect(response.json()).resolves.toMatchObject({
      job_type: 'episode_story_autofill',
      status: 'processing',
      cancel_requested_at: '2026-05-01T00:00:03.000Z',
      commit_started_at: null,
    });
  });

  it('法人の話全体反映 job は権限確認後に法人スコープで停止する', async () => {
    const organizationId = '11111111-1111-4111-8111-111111111111';
    const requiredMemberships: Array<{
      organizationId: string;
      userId: string;
      capability: string;
    }> = [];
    const organizationService = {
      requireMembership: async (
        requestedOrganizationId: string,
        userId: string,
        capability: string,
      ) => {
        requiredMemberships.push({
          organizationId: requestedOrganizationId,
          userId,
          capability,
        });
        return {};
      },
    } as unknown as OrganizationServicePort;
    const jobService = new FakeJobService();
    jobService.job = {
      ...buildJob(),
      jobType: 'episode_story_autofill',
      status: 'processing',
      generationMode: null,
      creditCost: 0,
      organizationId,
      params: { episode_id: '44444444-4444-4444-8444-444444444444', language: 'ja' },
    };
    const app = createTestApp(
      new FakePageGenerationService(),
      new FakePageFinalizeService(),
      jobService,
      new FakePageQueryService(),
      new FakePageService(),
      new FakePageExportService(),
      new FakeEpisodeStoryAutofillService(),
      organizationService,
    );
    const token = await createToken();

    const response = await app.request(
      `/api/jobs/22222222-2222-4222-8222-222222222222/cancel?organization_id=${organizationId}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    expect(response.status).toBe(200);
    expect(requiredMemberships).toEqual([
      { organizationId, userId: user.id, capability: 'edit_work' },
    ]);
    expect(jobService.cancelledJob).toEqual({
      userId: user.id,
      jobId: '22222222-2222-4222-8222-222222222222',
      organizationId,
    });
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
  organizationService?: OrganizationServicePort,
): ReturnType<typeof createApp> {
  return createApp({
    creditService: new FakeCreditService(),
    episodeStoryAutofillService,
    jobService,
    organizationService,
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
    cancelRequestedAt: null,
    cancelRequestedBy: null,
    cancelledAt: null,
    commitStartedAt: null,
  };
}

function buildEntityJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
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
    cancelRequestedAt: null,
    cancelRequestedBy: null,
    cancelledAt: null,
    commitStartedAt: null,
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
