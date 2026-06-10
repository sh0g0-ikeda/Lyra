import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import { REQUEST_BODY_LIMITS } from '../../../src/routes/requestBody.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../src/services/credit/CreditService.js';
import type { PageSkeletonServicePort } from '../../../src/services/story/PageSkeletonService.js';
import type { StoryCollaborationServicePort } from '../../../src/services/story/StoryCollaborationService.js';
import type { PageServicePort } from '../../../src/services/page/PageService.js';
import type {
  Chapter,
  CreateChapterRequest,
  CreateEpisodeRequest,
  CreateWorkRequest,
  Episode,
  StoryServicePort,
  UpdateChapterRequest,
  UpdateEpisodeRequest,
  UpdateWorkRequest,
  Work,
} from '../../../src/services/story/StoryService.js';

const jwtSecret = 'unit-test-secret';
const user: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: 'supabase-user-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};
const workId = '11111111-1111-4111-8111-111111111111';
const chapterId = '22222222-2222-4222-8222-222222222222';
const episodeId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-04-22T00:00:00.000Z');

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

class FakeStoryService implements StoryServicePort {
  public async listWorks(userId: string): Promise<Work[]> {
    return [buildWork({ userId })];
  }

  public async createWork(userId: string, input: CreateWorkRequest): Promise<Work> {
    return buildWork({ userId, title: input.title });
  }

  public async getWork(userId: string, requestedWorkId: string): Promise<Work> {
    return buildWork({ id: requestedWorkId, userId });
  }

  public async updateWork(
    userId: string,
    requestedWorkId: string,
    input: UpdateWorkRequest,
  ): Promise<Work> {
    return buildWork({ id: requestedWorkId, userId, title: input.title ?? '作品', version: 2 });
  }

  public async createChapter(
    _userId: string,
    requestedWorkId: string,
    input: CreateChapterRequest,
  ): Promise<Chapter> {
    return buildChapter({ workId: requestedWorkId, order: input.order, title: input.title });
  }

  public async listChapters(_userId: string, requestedWorkId: string): Promise<Chapter[]> {
    return [buildChapter({ workId: requestedWorkId })];
  }

  public async updateChapter(
    _userId: string,
    requestedChapterId: string,
    input: UpdateChapterRequest,
  ): Promise<Chapter> {
    return buildChapter({ id: requestedChapterId, title: input.title ?? '第一章', version: 2 });
  }

  public async deleteChapter(_userId: string, _requestedChapterId: string): Promise<void> {}

  public async createEpisode(
    _userId: string,
    requestedChapterId: string,
    input: CreateEpisodeRequest,
  ): Promise<Episode> {
    return buildEpisode({ chapterId: requestedChapterId, order: input.order, title: input.title });
  }

  public async listEpisodes(_userId: string, requestedChapterId: string): Promise<Episode[]> {
    return [buildEpisode({ chapterId: requestedChapterId })];
  }

  public async updateEpisode(
    _userId: string,
    requestedEpisodeId: string,
    input: UpdateEpisodeRequest,
  ): Promise<Episode> {
    return buildEpisode({ id: requestedEpisodeId, title: input.title ?? '第一話', version: 2 });
  }

  public async deleteEpisode(_userId: string, _requestedEpisodeId: string): Promise<void> {}
}

class FakeStoryCollaborationService implements StoryCollaborationServicePort {
  public lastInput: Record<string, unknown> | null = null;
  public lastImproveInput: Record<string, unknown> | null = null;

  public async collaborate(
    userId: string,
    input: {
      layer: 'work' | 'chapter' | 'episode';
      targetId: string;
      instruction: string;
      language: 'ja' | 'en';
      context: {
        currentDraft: string | null;
        selectedText: string | null;
        userNotes: string | null;
        focusPoints: string[];
        constraints: string[];
      };
    },
  ): Promise<AsyncIterable<string>> {
    this.lastInput = { userId, ...input };

    return (async function* streamChunks(): AsyncGenerator<string, void, void> {
      yield 'first';
      yield 'second';
    })();
  }

  public async improveEpisodeDraft(
    userId: string,
    input: {
      episodeId: string;
      instruction: string;
      language: 'ja' | 'en';
      baseDraft: {
        title: string | null;
        purpose: string | null;
        storyInputMode: 'structured' | 'full';
        storyFullDraft: string | null;
        introduction: string | null;
        middle: string | null;
        climax: string | null;
        endingHook: string | null;
      };
    },
  ): Promise<{
    draft: {
      title: string | null;
      purpose: string | null;
      storyInputMode: 'structured' | 'full';
      storyFullDraft: string | null;
      introduction: string | null;
      middle: string | null;
      climax: string | null;
      endingHook: string | null;
    };
    compilerProvider: 'openai' | 'fallback';
    compilerModel: string | null;
    compilerPromptVersion: string | null;
    compilerError: string | null;
  }> {
    this.lastImproveInput = { userId, ...input };
    return {
      draft: {
        title: '改善済みタイトル',
        purpose: '改善済みの目的',
        storyInputMode: 'structured',
        storyFullDraft: null,
        introduction: '改善済み導入',
        middle: '改善済み中盤',
        climax: '改善済みクライマックス',
        endingHook: '改善済み引き',
      },
      compilerProvider: 'openai',
      compilerModel: 'gpt-5.4-mini',
      compilerPromptVersion: 'story_episode_improve_v1',
      compilerError: null,
    };
  }
}
class FakePageSkeletonService implements PageSkeletonServicePort {
  public requestedEpisodeId: string | null = null;
  public overwriteExisting = false;

  public async generateForEpisode(
    _userId: string,
    requestedEpisodeId: string,
    options?: { overwriteExisting?: boolean },
  ): Promise<{
    pagesCreated: number;
    panelsCreated: number;
    replacedExisting: boolean;
  }> {
    this.requestedEpisodeId = requestedEpisodeId;
    this.overwriteExisting = options?.overwriteExisting === true;

    return {
      pagesCreated: 16,
      panelsCreated: 80,
      replacedExisting: this.overwriteExisting,
    };
  }
}

class FakePageService implements PageServicePort {
  public async updatePageSettings(): Promise<never> {
    throw new Error('not implemented');
  }

  public async autofillFromScenes(): Promise<never> {
    throw new Error('not implemented');
  }

  public async autofillEpisodeFromStory(): Promise<{
    updatedPageCount: number;
    updatedPanelCount: number;
    updatedAssignmentCount: number;
    filledFieldCount: number;
    compilerUsed: boolean;
    compilerProvider: 'openai' | 'fallback';
    compilerModel: string | null;
    compilerPromptVersion: string | null;
    compilerError: string | null;
  }> {
    return {
      updatedPageCount: 16,
      updatedPanelCount: 80,
      updatedAssignmentCount: 80,
      filledFieldCount: 240,
      compilerUsed: true,
      compilerProvider: 'openai',
      compilerModel: 'gpt-5',
      compilerPromptVersion: 'episode_page_plan_v1',
      compilerError: null,
    };
  }
}

describe('story routes', () => {
  it('lists works', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request('/api/works', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { works: Array<Record<string, unknown>> };
    expect(payload).toEqual({
      works: [
        expect.objectContaining({
          id: workId,
        }),
      ],
    });
    expect(payload.works[0]).not.toHaveProperty('user_id');
  });

  it('creates a work when JWT is valid', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request('/api/works', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: '作品',
        genre: 'fantasy',
      }),
    });

    expect(response.status).toBe(201);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      id: workId,
      title: '作品',
      version: 1,
    });
    expect(payload).not.toHaveProperty('user_id');
  });

  it('returns 422 for invalid work creation input', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request('/api/works', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: '',
      }),
    });

    expect(response.status).toBe(422);
    const payload = (await response.json()) as { error: { message: string } };
    expect(payload.error.message).toContain('Validation failed:');
    expect(payload.error.message).not.toContain('"code"');
    expect(payload.error.message.length).toBeLessThanOrEqual(500);
  });

  it('creates a chapter', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request(`/api/works/${workId}/chapters`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        order: 1,
        title: '第一章',
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      work_id: workId,
      order: 1,
      title: '第一章',
    });
  });

  it('creates an episode', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request(`/api/chapters/${chapterId}/episodes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        order: 1,
        title: '第一話',
        estimated_pages: 16,
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      chapter_id: chapterId,
      title: '第一話',
      estimated_pages: 16,
    });
  });

  it('story list responses do not expose internal edit history', async () => {
    const app = createTestApp();
    const token = await createToken();
    const authHeaders = {
      Authorization: `Bearer ${token}`,
    };

    const worksResponse = await app.request('/api/works', {
      headers: authHeaders,
    });
    const chaptersResponse = await app.request(`/api/works/${workId}/chapters`, {
      headers: authHeaders,
    });
    const episodesResponse = await app.request(`/api/chapters/${chapterId}/episodes`, {
      headers: authHeaders,
    });

    expect(worksResponse.status).toBe(200);
    expect(chaptersResponse.status).toBe(200);
    expect(episodesResponse.status).toBe(200);

    const worksPayload = (await worksResponse.json()) as { works: Array<Record<string, unknown>> };
    const chaptersPayload = (await chaptersResponse.json()) as { chapters: Array<Record<string, unknown>> };
    const episodesPayload = (await episodesResponse.json()) as { episodes: Array<Record<string, unknown>> };

    expect(worksPayload.works[0]).not.toHaveProperty('edit_history');
    expect(chaptersPayload.chapters[0]).not.toHaveProperty('edit_history');
    expect(episodesPayload.episodes[0]).not.toHaveProperty('edit_history');
  });

  it('returns 401 when authentication is missing', async () => {
    const app = createTestApp();

    const response = await app.request(`/api/chapters/${chapterId}/episodes`);

    expect(response.status).toBe(401);
  });

  it('streams story collaboration events', async () => {
    const collaborationService = new FakeStoryCollaborationService();
    const app = createTestApp(collaborationService, new FakePageSkeletonService());
    const token = await createToken();

    const response = await app.request('/api/story/collaborate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        layer: 'episode',
        target_id: episodeId,
        instruction: '描写を少し具体化して',
        language: 'ja',
        context: {
          current_draft: '主人公が屋上へ向かう。',
          focus_points: ['静かな動き'],
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    await expect(response.text()).resolves.toContain('"text":"first"');
    expect(collaborationService.lastInput).toMatchObject({
      userId: user.id,
      layer: 'episode',
      targetId: episodeId,
    });
  });

  it('story collaborate returns 422 for unknown keys', async () => {
    const app = createTestApp(new FakeStoryCollaborationService(), new FakePageSkeletonService());
    const token = await createToken();

    const response = await app.request('/api/story/collaborate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        layer: 'work',
        target_id: workId,
        instruction: '整えて',
        language: 'ja',
        injected: true,
      }),
    });

    expect(response.status).toBe(422);
  });

  it('story improve episode draft returns structured fields', async () => {
    const collaborationService = new FakeStoryCollaborationService();
    const app = createTestApp(collaborationService, new FakePageSkeletonService());
    const token = await createToken();

    const response = await app.request('/api/story/improve-episode-draft', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        episode_id: episodeId,
        instruction: '矛盾なく導入を改善して',
        language: 'ja',
        base_draft: {
          title: '元タイトル',
          purpose: '元目的',
          story_input_mode: 'structured',
          story_full_draft: null,
          introduction: '元導入',
          middle: '元中盤',
          climax: '元クライマックス',
          ending_hook: '元引き',
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      draft: {
        title: '改善済みタイトル',
        purpose: '改善済みの目的',
        story_input_mode: 'structured',
        story_full_draft: null,
        introduction: '改善済み導入',
        middle: '改善済み中盤',
        climax: '改善済みクライマックス',
        ending_hook: '改善済み引き',
      },
      compiler_provider: 'openai',
      compiler_model: 'gpt-5.4-mini',
      compiler_prompt_version: 'story_episode_improve_v1',
      compiler_error: null,
    });
    expect(collaborationService.lastImproveInput).toMatchObject({
      userId: user.id,
      episodeId,
      instruction: '矛盾なく導入を改善して',
    });
  });

  it('creates a page skeleton and applies the story plan', async () => {
    const pageSkeletonService = new FakePageSkeletonService();
    const app = createTestApp(new FakeStoryCollaborationService(), pageSkeletonService);
    const token = await createToken();

    const response = await app.request(`/api/episodes/${episodeId}/generate-page-skeleton`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      pages_created: 16,
      panels_created: 80,
      replaced_existing: false,
      story_plan_applied: true,
      story_plan_result: {
        updated_page_count: 16,
        updated_panel_count: 80,
        updated_assignment_count: 80,
        filled_field_count: 240,
        compiler_used: true,
        compiler_provider: 'openai',
        compiler_model: 'gpt-5',
        compiler_prompt_version: 'episode_page_plan_v1',
        compiler_error: null,
      },
    });
    expect(pageSkeletonService.requestedEpisodeId).toBe(episodeId);
  });

  it('page skeleton forwards overwrite_existing to the service', async () => {
    const pageSkeletonService = new FakePageSkeletonService();
    const app = createTestApp(new FakeStoryCollaborationService(), pageSkeletonService);
    const token = await createToken();

    const response = await app.request(`/api/episodes/${episodeId}/generate-page-skeleton`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ overwrite_existing: true }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      pages_created: 16,
      panels_created: 80,
      replaced_existing: true,
      story_plan_applied: true,
      story_plan_result: {
        updated_page_count: 16,
        updated_panel_count: 80,
        updated_assignment_count: 80,
        filled_field_count: 240,
        compiler_used: true,
        compiler_provider: 'openai',
        compiler_model: 'gpt-5',
        compiler_prompt_version: 'episode_page_plan_v1',
        compiler_error: null,
      },
    });
    expect(pageSkeletonService.overwriteExisting).toBe(true);
  });

  it('page skeleton 生成は巨大な options body を service 呼び出し前に 413 にする', async () => {
    const pageSkeletonService = new FakePageSkeletonService();
    const app = createTestApp(new FakeStoryCollaborationService(), pageSkeletonService);
    const token = await createToken();

    const response = await app.request(`/api/episodes/${episodeId}/generate-page-skeleton`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': String(REQUEST_BODY_LIMITS.SMALL_JSON_BYTES + 1),
      },
      body: '{}',
    });

    expect(response.status).toBe(413);
    expect(pageSkeletonService.requestedEpisodeId).toBeNull();
  });

  it('returns 422 for unknown keys in story CRUD', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request('/api/works', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: '作品',
        injected: 'nope',
      }),
    });

    expect(response.status).toBe(422);
  });
});

function createTestApp(
  storyCollaborationService: StoryCollaborationServicePort = new FakeStoryCollaborationService(),
  pageSkeletonService: PageSkeletonServicePort = new FakePageSkeletonService(),
  pageService: PageServicePort = new FakePageService(),
): ReturnType<typeof createApp> {
  return createApp({
    creditService: new FakeCreditService(),
    pageService,
    pageSkeletonService,
    storyCollaborationService,
    storyService: new FakeStoryService(),
    userProvisioningService: new FakeUserProvisioningService(),
    jwtSecret,
  });
}

function buildWork(overrides: Partial<Work> = {}): Work {
  return {
    id: workId,
    userId: user.id,
    title: '作品',
    genre: null,
    worldSetting: null,
    theme: null,
    mainEntityIds: [],
    startingPoint: null,
    endingPoint: null,
    overallFlow: null,
    version: 1,
    editHistory: [],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: chapterId,
    workId,
    order: 1,
    title: '第一章',
    purpose: null,
    startingState: null,
    endingState: null,
    emotionCurve: null,
    entitiesInvolved: [],
    keyBeats: [],
    version: 1,
    editHistory: [],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: episodeId,
    chapterId,
    order: 1,
    title: '第一話',
    purpose: null,
    storyInputMode: 'structured',
    storyFullDraft: null,
    introduction: null,
    middle: null,
    climax: null,
    endingHook: null,
    estimatedPages: 16,
    entitiesInvolved: [],
    pageSkeletonGenerated: false,
    version: 1,
    editHistory: [],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
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

