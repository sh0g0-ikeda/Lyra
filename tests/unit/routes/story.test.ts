import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
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

  public async collaborate(
    userId: string,
    input: {
      layer: 'work' | 'chapter' | 'episode';
      targetId: string;
      instruction: string;
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
      yield '前半';
      yield '後半';
    })();
  }
}

class FakePageSkeletonService implements PageSkeletonServicePort {
  public requestedEpisodeId: string | null = null;

  public async generateForEpisode(_userId: string, requestedEpisodeId: string): Promise<{
    pagesCreated: number;
    panelsCreated: number;
  }> {
    this.requestedEpisodeId = requestedEpisodeId;

    return {
      pagesCreated: 16,
      panelsCreated: 80,
    };
  }
}

describe('story routes', () => {
  it('works 一覧を返す', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request('/api/works', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      works: [
        expect.objectContaining({
          id: workId,
          user_id: user.id,
        }),
      ],
    });
  });

  it('JWT が正しい場合に作品を作成できる', async () => {
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
    await expect(response.json()).resolves.toMatchObject({
      id: workId,
      user_id: user.id,
      title: '作品',
      version: 1,
    });
  });

  it('作品作成で不正な入力は 422 になる', async () => {
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
  });

  it('章を作成できる', async () => {
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

  it('話を作成できる', async () => {
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

  it('認証なしでは 401 になる', async () => {
    const app = createTestApp();

    const response = await app.request(`/api/chapters/${chapterId}/episodes`);

    expect(response.status).toBe(401);
  });

  it('story collaborate は event stream を返す', async () => {
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
        instruction: '導入を少し静かに整えて',
        context: {
          current_draft: '主人公が廊下を歩いている。',
          focus_points: ['静かな導入'],
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    await expect(response.text()).resolves.toContain('"text":"前半"');
    expect(collaborationService.lastInput).toMatchObject({
      userId: user.id,
      layer: 'episode',
      targetId: episodeId,
    });
  });

  it('story collaborate で未知のキーは 422 になる', async () => {
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
        injected: true,
      }),
    });

    expect(response.status).toBe(422);
  });

  it('page skeleton 生成は 201 と件数を返す', async () => {
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
    });
    expect(pageSkeletonService.requestedEpisodeId).toBe(episodeId);
  });

  it('story CRUD でも未知のキーは 422 になる', async () => {
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
): ReturnType<typeof createApp> {
  return createApp({
    creditService: new FakeCreditService(),
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
