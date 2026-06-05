import { describe, expect, it } from 'vitest';
import type { StoryRepository } from '../../../../src/repositories/StoryRepository.js';
import { PageSkeletonService } from '../../../../src/services/story/PageSkeletonService.js';
import type { StoryAiClientPort, StoryAiModelRequest } from '../../../../src/services/story/StoryAiClientPort.js';
import type {
  EpisodePageSkeletonContext,
  PageSkeletonPageDraft,
  PageSkeletonPersistResult,
  StoryCollaborationLayer,
  StoryCollaborationTarget,
  StoryEpisodeImprovementContext,
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
        aliases: [],
        entityType: 'character',
        freeDescription: 'Black-haired swordswoman',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Rin',
        aliases: [],
        entityType: 'character',
        freeDescription: 'Calm silver-haired rival',
      },
    ],
    sceneSummaries: ['Scene 1: Rooftop / night / tense'],
  };

  public createdPages: PageSkeletonPageDraft[] = [];
  public lastCreateOptions: { overwriteExisting?: boolean } | undefined;

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
  public async findEpisodeImprovementContextByIdAndUserId(): Promise<StoryEpisodeImprovementContext | null> {
    throw new Error('not implemented');
  }
  public async createPageSkeleton(
    _episodeId: string,
    _userId: string,
    pages: PageSkeletonPageDraft[],
    options?: { overwriteExisting?: boolean },
  ): Promise<PageSkeletonPersistResult | null> {
    this.createdPages = pages;
    this.lastCreateOptions = options;
    return {
      pagesCreated: pages.length,
      panelsCreated: pages.reduce((sum, page) => sum + page.panels.length, 0),
      replacedExisting: options?.overwriteExisting === true,
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

  public async improveEpisodeDraft(): Promise<never> {
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
      replacedExisting: false,
    });
    expect(repository.createdPages).toHaveLength(2);
    expect(client.lastRequest?.systemPrompt).toContain(
      'Treat the episode draft and scene list as the primary source of truth for page content.',
    );
    expect(client.lastRequest?.systemPrompt).toContain('Return exactly 2 pages');
    expect(client.lastRequest?.userPrompt).toContain('Scene 1: Rooftop / night / tense');
    expect(client.lastRequest?.userPrompt).toContain('Chapter consistency note: Chapter 1 / Set the stakes');
    expect(client.lastRequest?.userPrompt).not.toContain('Chapter purpose:');
  });

  it('fallback skeleton は同じ導入を複数ページにそのまま貼らずページごとの beat に分ける', async () => {
    const repository = new FakeStoryRepository();
    repository.skeletonContext = {
      ...repository.skeletonContext!,
      estimatedPages: 4,
      introduction: [
        '澪は宿舎の窓から中庭を見る。',
        '',
        '訓練する隊員たちの動きが目に入る。',
        '',
        '工房と医療班も朝から動いている。',
        '',
        'エロイーズが澪を迎えに来る。',
      ].join('\n'),
      middle: null,
      climax: null,
      endingHook: null,
      episodePurpose: '神木の朝の異質な日常を澪の視点でつかませる。',
    };
    const client = new FakeStoryAiClient();
    client.errorToThrow = new Error('forced fallback');
    const service = new PageSkeletonService(repository, client);

    await service.generateForEpisode('user-1', '33333333-3333-4333-8333-333333333333');

    expect(repository.createdPages).toHaveLength(4);
    expect(repository.createdPages.map((page) => page.purpose)).toEqual([
      expect.stringContaining('宿舎'),
      expect.stringContaining('訓練'),
      expect.stringContaining('工房'),
      expect.stringContaining('エロイーズ'),
    ]);
    expect(new Set(repository.createdPages.map((page) => page.purpose)).size).toBe(4);
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

  it('repairs suggested panel count and layout from the actual panel array length when uniquely resolvable', async () => {
    const repository = new FakeStoryRepository();
    const client = new FakeStoryAiClient();
    client.generatedPages[0] = {
      ...client.generatedPages[0],
      suggestedPanelCount: 3,
      suggestedLayout: 'top_wide_3',
    };
    const service = new PageSkeletonService(repository, client);

    await service.generateForEpisode('user-1', '33333333-3333-4333-8333-333333333333');

    expect(repository.createdPages[0]?.suggestedPanelCount).toBe(4);
    expect(repository.createdPages[0]?.suggestedLayout).toBe('standard_4');
    expect(repository.createdPages[0]?.panels).toHaveLength(4);
  });

  it('falls back to a deterministic skeleton when the model payload is invalid', async () => {
    const client = new FakeStoryAiClient();
    client.errorToThrow = new SyntaxError('Unexpected token');
    const repository = new FakeStoryRepository();
    const service = new PageSkeletonService(repository, client);

    const result = await service.generateForEpisode(
      'user-1',
      '33333333-3333-4333-8333-333333333333',
    );

    expect(result).toEqual({
      pagesCreated: 2,
      panelsCreated: 7,
      replacedExisting: false,
    });
    expect(repository.createdPages[0]?.suggestedLayout).toBe('standard_4');
    expect(repository.createdPages[1]?.suggestedLayout).toBe('top_wide_3');
    expect(repository.createdPages[0]?.panels.map((panel) => panel.panelRole)).toEqual([
      'establish',
      'action',
      'reaction',
      'impact',
    ]);
    expect(repository.createdPages[0]?.panels.some((panel) => panel.suggestedDialogueHint !== null)).toBe(true);
  });

  it('fallback skeleton infers relevant entities from story text even when structured involved ids are empty', async () => {
    const client = new FakeStoryAiClient();
    client.errorToThrow = new SyntaxError('Unexpected token');
    const repository = new FakeStoryRepository();
    if (repository.skeletonContext !== null) {
      repository.skeletonContext.entities = [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: '澪',
          aliases: [],
          entityType: 'character',
          freeDescription: 'A wary girl pulled into the organization.',
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'エミール',
          aliases: [],
          entityType: 'character',
          freeDescription: 'A calm guide from another era.',
        },
      ];
      repository.skeletonContext.entitiesInvolved = repository.skeletonContext.entities.map((entity) => entity.id);
      repository.skeletonContext.introduction = '澪が白い部屋で目を覚まし、エミールに導かれる。';
      repository.skeletonContext.middle = 'エミールが組織の仕組みを説明し、澪は違和感を覚える。';
      repository.skeletonContext.climax = '澪はここに来た理由を知り、エミールは適性の話をする。';
      repository.skeletonContext.endingHook =
        '澪はまだ帰れるか分からないまま、本部の実像を見せつけられていく。';
      repository.skeletonContext.sceneSummaries = [
        'Scene 1: 医務室 / 朝 / 静かだが緊張がある',
        'Scene 2: 本部回廊 / 朝 / 違和感がある',
      ];
    }
    const service = new PageSkeletonService(repository, client);

    await service.generateForEpisode('user-1', '33333333-3333-4333-8333-333333333333');

    expect(repository.createdPages).toHaveLength(2);
    expect(repository.createdPages.some((page) => page.purpose.includes('澪'))).toBe(true);
    expect(
      repository.createdPages.some((page) =>
        page.panels.some((panel) =>
          panel.suggestedEntities.includes('11111111-1111-4111-8111-111111111111'),
        ),
      ),
    ).toBe(true);
    expect(
      repository.createdPages.some((page) =>
        page.panels.some((panel) =>
          panel.suggestedEntities.includes('22222222-2222-4222-8222-222222222222'),
        ),
      ),
    ).toBe(true);
  });

  it('resolves canonical entities from aliases when the story text uses only the alias', async () => {
    const client = new FakeStoryAiClient();
    client.errorToThrow = new SyntaxError('Unexpected token');
    const repository = new FakeStoryRepository();
    if (repository.skeletonContext !== null) {
      repository.skeletonContext.entities = [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: '深見澪',
          aliases: ['澪'],
          entityType: 'character',
          freeDescription: 'A high school girl dragged into a temporal organization.',
        },
      ];
      repository.skeletonContext.entitiesInvolved = [];
      repository.skeletonContext.introduction = '澪が見知らぬ医務室で目を覚ます。';
      repository.skeletonContext.middle = '澪は自分が別の世界に来たのではないかと疑う。';
      repository.skeletonContext.climax = '澪はここで生きるか戻るかの選択を意識し始める。';
      repository.skeletonContext.endingHook = '澪の選択はまだ保留されたまま先延ばしになる。';
    }
    const service = new PageSkeletonService(repository, client);

    await service.generateForEpisode('user-1', '33333333-3333-4333-8333-333333333333');

    expect(
      repository.createdPages.some((page) =>
        page.panels.some((panel) =>
          panel.suggestedEntities.includes('11111111-1111-4111-8111-111111111111'),
        ),
      ),
    ).toBe(true);
  });

  it('allows overwrite mode when a skeleton already exists', async () => {
    const repository = new FakeStoryRepository();
    if (repository.skeletonContext !== null) {
      repository.skeletonContext.pageSkeletonGenerated = true;
      repository.skeletonContext.existingPageCount = 2;
    }
    const client = new FakeStoryAiClient();
    const service = new PageSkeletonService(repository, client);

    const result = await service.generateForEpisode(
      'user-1',
      '33333333-3333-4333-8333-333333333333',
      { overwriteExisting: true },
    );

    expect(result).toEqual({
      pagesCreated: 2,
      panelsCreated: 7,
      replacedExisting: true,
    });
    expect(repository.lastCreateOptions).toEqual({ overwriteExisting: true });
  });
});
