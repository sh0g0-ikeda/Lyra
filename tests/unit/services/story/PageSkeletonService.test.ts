import { describe, expect, it } from 'vitest';
import type { StoryRepository } from '../../../../src/repositories/StoryRepository.js';
import { PageSkeletonService } from '../../../../src/services/story/PageSkeletonService.js';
import type { StoryAiClientPort, StoryAiModelRequest } from '../../../../src/infrastructure/anthropic/AnthropicStoryAiClient.js';
import type {
  EpisodePageSkeletonContext,
  PageSkeletonPageDraft,
  PageSkeletonPersistResult,
  StoryCollaborationLayer,
  StoryCollaborationTarget,
} from '../../../../src/domain/types/storyAi.js';
import type {
  Chapter,
  CreateChapterInput,
  CreateEpisodeInput,
  CreateWorkInput,
  Episode,
  UpdateChapterInput,
  UpdateEpisodeInput,
  UpdateWorkInput,
  Work,
} from '../../../../src/repositories/StoryRepository.js';

class FakeStoryRepository implements StoryRepository {
  public skeletonContext: EpisodePageSkeletonContext | null = {
    episodeId: '33333333-3333-4333-8333-333333333333',
    chapterId: 'chapter-1',
    workId: 'work-1',
    workTitle: '作品',
    workGenre: 'fantasy',
    worldSetting: '都市',
    theme: '希望',
    chapterTitle: '第一章',
    chapterPurpose: '導入',
    episodeTitle: '第一話',
    episodePurpose: '主人公の登場',
    introduction: '朝の駅前',
    middle: '異変の気配',
    climax: '敵の出現',
    endingHook: '次回へ続く',
    estimatedPages: 2,
    entitiesInvolved: [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ],
    pageSkeletonGenerated: false,
    existingPageCount: 0,
    entities: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: '主人公',
        entityType: 'character',
        freeDescription: '冷静',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: '相棒',
        entityType: 'character',
        freeDescription: '快活',
      },
    ],
  };

  public createdPages: PageSkeletonPageDraft[] = [];

  public async createWork(_userId: string, _input: CreateWorkInput): Promise<Work> {
    throw new Error('not implemented');
  }
  public async findWorkByIdAndUserId(_id: string, _userId: string): Promise<Work | null> {
    throw new Error('not implemented');
  }
  public async updateWork(_id: string, _userId: string, _input: UpdateWorkInput): Promise<Work | null> {
    throw new Error('not implemented');
  }
  public async createChapter(_workId: string, _input: CreateChapterInput): Promise<Chapter> {
    throw new Error('not implemented');
  }
  public async findChaptersByWorkIdAndUserId(_workId: string, _userId: string): Promise<Chapter[]> {
    throw new Error('not implemented');
  }
  public async findChapterByIdAndUserId(_id: string, _userId: string): Promise<Chapter | null> {
    throw new Error('not implemented');
  }
  public async updateChapter(_id: string, _userId: string, _input: UpdateChapterInput): Promise<Chapter | null> {
    throw new Error('not implemented');
  }
  public async deleteChapter(_id: string, _userId: string): Promise<boolean> {
    throw new Error('not implemented');
  }
  public async createEpisode(_chapterId: string, _input: CreateEpisodeInput): Promise<Episode> {
    throw new Error('not implemented');
  }
  public async findEpisodesByChapterIdAndUserId(_chapterId: string, _userId: string): Promise<Episode[]> {
    throw new Error('not implemented');
  }
  public async findEpisodeByIdAndUserId(_id: string, _userId: string): Promise<Episode | null> {
    throw new Error('not implemented');
  }
  public async updateEpisode(_id: string, _userId: string, _input: UpdateEpisodeInput): Promise<Episode | null> {
    throw new Error('not implemented');
  }
  public async deleteEpisode(_id: string, _userId: string): Promise<boolean> {
    throw new Error('not implemented');
  }
  public async findCollaborationTargetByIdAndUserId(
    _layer: StoryCollaborationLayer,
    _targetId: string,
    _userId: string,
  ): Promise<StoryCollaborationTarget | null> {
    throw new Error('not implemented');
  }
  public async findEpisodePageSkeletonContextByIdAndUserId(
    _episodeId: string,
    _userId: string,
  ): Promise<EpisodePageSkeletonContext | null> {
    return this.skeletonContext;
  }
  public async createPageSkeleton(
    _episodeId: string,
    _userId: string,
    pages: PageSkeletonPageDraft[],
  ): Promise<PageSkeletonPersistResult | null> {
    this.createdPages = pages;
    return {
      pagesCreated: pages.length,
      panelsCreated: pages.reduce((sum, page) => sum + page.panels.length, 0),
    };
  }
}

class FakeStoryAiClient implements StoryAiClientPort {
  public generatedPages: PageSkeletonPageDraft[] = [
    {
      pageNumber: 1,
      purpose: '導入',
      suggestedPanelCount: 4,
      suggestedLayout: 'standard_4',
      panels: [
        {
          order: 1,
          panelRole: 'establish',
          suggestedSize: 'large',
          situationHint: '駅前の全景',
          suggestedEntities: ['11111111-1111-4111-8111-111111111111'],
          suggestedDialogueHint: null,
        },
        {
          order: 2,
          panelRole: 'action',
          suggestedSize: 'standard',
          situationHint: '主人公が歩く',
          suggestedEntities: ['11111111-1111-4111-8111-111111111111'],
          suggestedDialogueHint: null,
        },
        {
          order: 3,
          panelRole: 'reaction',
          suggestedSize: 'standard',
          situationHint: '相棒が追いつく',
          suggestedEntities: ['22222222-2222-4222-8222-222222222222'],
          suggestedDialogueHint: '急いで',
        },
        {
          order: 4,
          panelRole: 'transition',
          suggestedSize: 'standard',
          situationHint: '空気が変わる',
          suggestedEntities: [],
          suggestedDialogueHint: null,
        },
      ],
    },
    {
      pageNumber: 2,
      purpose: '異変の発生',
      suggestedPanelCount: 3,
      suggestedLayout: 'top_wide_3',
      panels: [
        {
          order: 1,
          panelRole: 'action',
          suggestedSize: 'wide',
          situationHint: '影が現れる',
          suggestedEntities: ['11111111-1111-4111-8111-111111111111'],
          suggestedDialogueHint: null,
        },
        {
          order: 2,
          panelRole: 'reaction',
          suggestedSize: 'standard',
          situationHint: '相棒が驚く',
          suggestedEntities: ['22222222-2222-4222-8222-222222222222'],
          suggestedDialogueHint: 'なにあれ',
        },
        {
          order: 3,
          panelRole: 'impact',
          suggestedSize: 'standard',
          situationHint: '敵のシルエット',
          suggestedEntities: [],
          suggestedDialogueHint: null,
        },
      ],
    },
  ];

  public lastRequest: StoryAiModelRequest | null = null;
  public errorToThrow: unknown = null;

  public streamCollaboration(_request: StoryAiModelRequest): AsyncIterable<string> {
    throw new Error('not implemented');
  }

  public async generatePageSkeleton(request: StoryAiModelRequest): Promise<PageSkeletonPageDraft[]> {
    this.lastRequest = request;
    if (this.errorToThrow !== null) {
      throw this.errorToThrow;
    }
    return this.generatedPages;
  }
}

describe('PageSkeletonService', () => {
  it('検証済みの page skeleton を保存できる', async () => {
    const repository = new FakeStoryRepository();
    const client = new FakeStoryAiClient();
    const service = new PageSkeletonService(repository, client);

    const result = await service.generateForEpisode(
      'user-1',
      '33333333-3333-4333-8333-333333333333',
    );

    expect(result).toEqual({
      pagesCreated: 2,
      panelsCreated: 7,
    });
    expect(repository.createdPages).toHaveLength(2);
    expect(client.lastRequest?.systemPrompt).toContain('Return exactly 2 pages');
  });

  it('既に page skeleton 済みなら CONFLICT になる', async () => {
    const repository = new FakeStoryRepository();
    if (repository.skeletonContext !== null) {
      repository.skeletonContext.pageSkeletonGenerated = true;
    }
    const service = new PageSkeletonService(repository, new FakeStoryAiClient());

    await expect(
      service.generateForEpisode('user-1', '33333333-3333-4333-8333-333333333333'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('既存ページがあるなら CONFLICT になる', async () => {
    const repository = new FakeStoryRepository();
    if (repository.skeletonContext !== null) {
      repository.skeletonContext.existingPageCount = 1;
    }
    const service = new PageSkeletonService(repository, new FakeStoryAiClient());

    await expect(
      service.generateForEpisode('user-1', '33333333-3333-4333-8333-333333333333'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('話外の entity を参照した skeleton は VALIDATION_ERROR になる', async () => {
    const client = new FakeStoryAiClient();
    client.generatedPages[0].panels[0].suggestedEntities = ['99999999-9999-4999-8999-999999999999'];
    const service = new PageSkeletonService(new FakeStoryRepository(), client);

    await expect(
      service.generateForEpisode('user-1', '33333333-3333-4333-8333-333333333333'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('AI が壊れた payload を返した場合は VALIDATION_ERROR になる', async () => {
    const client = new FakeStoryAiClient();
    client.errorToThrow = new SyntaxError('Unexpected token');
    const service = new PageSkeletonService(new FakeStoryRepository(), client);

    await expect(
      service.generateForEpisode('user-1', '33333333-3333-4333-8333-333333333333'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
