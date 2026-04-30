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
    workTitle: 'Lyra',
    workGenre: 'fantasy',
    worldSetting: 'A military academy above the clouds.',
    theme: 'rivalry',
    chapterTitle: 'Chapter 1',
    chapterPurpose: 'Set the stakes',
    episodeTitle: 'Episode 1',
    episodePurpose: 'The hero confronts the rival.',
    introduction: 'Aki reaches the rooftop.',
    middle: 'The rival blocks the path.',
    climax: 'Both draw their blades.',
    endingHook: 'A flash splits the sky.',
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
        name: 'Aki',
        entityType: 'character',
        freeDescription: 'Black-haired swordswoman',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Rin',
        entityType: 'character',
        freeDescription: 'Calm silver-haired rival',
      },
    ],
    sceneSummaries: ['Scene 1: Rooftop / night / tense'],
  };

  public createdPages: PageSkeletonPageDraft[] = [];

  public async findWorksByUserId(): Promise<Work[]> {
    return [];
  }

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
      purpose: 'Set the confrontation',
      suggestedPanelCount: 4,
      suggestedLayout: 'standard_4',
      panels: [
        {
          order: 1,
          panelRole: 'establish',
          suggestedSize: 'large',
          situationHint: 'Wide rooftop at night.',
          suggestedEntities: ['11111111-1111-4111-8111-111111111111'],
          suggestedDialogueHint: null,
        },
        {
          order: 2,
          panelRole: 'action',
          suggestedSize: 'standard',
          situationHint: 'Aki advances.',
          suggestedEntities: ['11111111-1111-4111-8111-111111111111'],
          suggestedDialogueHint: null,
        },
        {
          order: 3,
          panelRole: 'reaction',
          suggestedSize: 'standard',
          situationHint: 'Rin answers.',
          suggestedEntities: ['22222222-2222-4222-8222-222222222222'],
          suggestedDialogueHint: '...you are late.',
        },
        {
          order: 4,
          panelRole: 'transition',
          suggestedSize: 'standard',
          situationHint: 'Wind gathers.',
          suggestedEntities: [],
          suggestedDialogueHint: null,
        },
      ],
    },
    {
      pageNumber: 2,
      purpose: 'Build toward impact',
      suggestedPanelCount: 3,
      suggestedLayout: 'top_wide_3',
      panels: [
        {
          order: 1,
          panelRole: 'action',
          suggestedSize: 'large',
          situationHint: 'Both charge.',
          suggestedEntities: ['11111111-1111-4111-8111-111111111111'],
          suggestedDialogueHint: null,
        },
        {
          order: 2,
          panelRole: 'reaction',
          suggestedSize: 'standard',
          situationHint: 'Rin holds ground.',
          suggestedEntities: ['22222222-2222-4222-8222-222222222222'],
          suggestedDialogueHint: 'Not enough.',
        },
        {
          order: 3,
          panelRole: 'impact',
          suggestedSize: 'standard',
          situationHint: 'Blades collide.',
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
  it('persists a generated page skeleton and includes scene context in the prompt', async () => {
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
    expect(client.lastRequest?.userPrompt).toContain('Scene 1: Rooftop / night / tense');
  });

  it('rejects when a skeleton already exists', async () => {
    const repository = new FakeStoryRepository();
    if (repository.skeletonContext !== null) {
      repository.skeletonContext.pageSkeletonGenerated = true;
    }
    const service = new PageSkeletonService(repository, new FakeStoryAiClient());

    await expect(
      service.generateForEpisode('user-1', '33333333-3333-4333-8333-333333333333'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects when pages already exist', async () => {
    const repository = new FakeStoryRepository();
    if (repository.skeletonContext !== null) {
      repository.skeletonContext.existingPageCount = 1;
    }
    const service = new PageSkeletonService(repository, new FakeStoryAiClient());

    await expect(
      service.generateForEpisode('user-1', '33333333-3333-4333-8333-333333333333'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a skeleton that references an entity outside the episode', async () => {
    const client = new FakeStoryAiClient();
    client.generatedPages[0].panels[0].suggestedEntities = ['99999999-9999-4999-8999-999999999999'];
    const service = new PageSkeletonService(new FakeStoryRepository(), client);

    await expect(
      service.generateForEpisode('user-1', '33333333-3333-4333-8333-333333333333'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('converts invalid model payload failures into VALIDATION_ERROR', async () => {
    const client = new FakeStoryAiClient();
    client.errorToThrow = new SyntaxError('Unexpected token');
    const service = new PageSkeletonService(new FakeStoryRepository(), client);

    await expect(
      service.generateForEpisode('user-1', '33333333-3333-4333-8333-333333333333'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
