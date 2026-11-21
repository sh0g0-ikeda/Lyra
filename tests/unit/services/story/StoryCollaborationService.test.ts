import { describe, expect, it } from 'vitest';
import type { StoryRepository } from '../../../../src/repositories/StoryRepository.js';
import { parseStoryManuscript } from '../../../../packages/api-contract/src/storyManuscript.js';
import { StoryCollaborationService } from '../../../../src/services/story/StoryCollaborationService.js';
import type { StoryAiClientPort, StoryAiModelRequest } from '../../../../src/services/story/StoryAiClientPort.js';
import type {
  EpisodePageSkeletonContext,
  PageSkeletonPageDraft,
  PageSkeletonPersistResult,
  StoryEpisodeImprovementContext,
  StoryCollaborationLayer,
  StoryCollaborationTarget,
} from '../../../../src/domain/types/storyAi.js';
import type {
  AuditStoryEpisodeImprovementInput,
  CompiledStoryEpisodeImprovementAudit,
  CompiledStoryEpisodeImprovementPlan,
  PlanStoryEpisodeImprovementInput,
  StoryEpisodeImprovementPlannerPort,
} from '../../../../src/services/story/StoryEpisodeImprovementPlanner.js';
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
  public episode: Episode | null = {
    id: '33333333-3333-4333-8333-333333333333',
    chapterId: 'chapter-1',
    order: 1,
    title: 'Episode 1',
    purpose: null,
    storyInputMode: 'structured',
    storyFullDraft: null,
    introduction: null,
    middle: null,
    climax: null,
    endingHook: null,
    estimatedPages: 1,
    entitiesInvolved: [],
    pageSkeletonGenerated: false,
    version: 1,
    editHistory: [],
    status: 'draft',
    createdAt: new Date('2026-11-21T00:00:00.000Z'),
    updatedAt: new Date('2026-11-21T00:00:00.000Z'),
  };
  public collaborationTarget: StoryCollaborationTarget | null = {
    layer: 'episode',
    targetId: '33333333-3333-4333-8333-333333333333',
    workId: 'work-1',
    workTitle: 'Lyra',
    chapterTitle: 'Chapter 1',
    episodeTitle: 'Episode 1',
    payload: {
      purpose: 'Introduce the rivalry',
      estimated_pages: 16,
    },
    entities: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Aki',
        aliases: [],
        entityType: 'character',
        freeDescription: 'Black-haired swordswoman',
      },
    ],
    sceneSummaries: ['Scene 1: Rooftop / night / tense'],
  };
  public improvementContext: StoryEpisodeImprovementContext = {
    episodeId: '33333333-3333-4333-8333-333333333333',
    chapterId: 'chapter-1',
    workId: 'work-1',
    workTitle: 'Lyra',
    workGenre: 'dark fantasy',
    worldSetting: 'Time fractures spread from the sacred tree.',
    theme: 'Responsibility and delay',
    overallFlow: 'A reluctant girl joins a time-repair organization.',
    chapterTitle: 'Chapter 1',
    chapterPurpose: 'Pull Mio into 辯ｦ.',
    chapterStartingState: 'Mio is alone.',
    chapterEndingState: 'Mio sees the organization.',
    chapterEmotionCurve: 'fear -> disorientation -> resolve',
    episodeTitle: 'Episode 1',
    episodePurpose: 'Introduce the rivalry',
    introduction: 'Current intro',
    middle: 'Current middle',
    climax: 'Current climax',
    endingHook: 'Current hook',
    estimatedPages: 16,
    entities: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Aki',
        aliases: [],
        entityType: 'character',
        freeDescription: 'Black-haired swordswoman',
      },
    ],
    sceneSummaries: ['Scene 1: Rooftop / night / tense'],
    chapterSummaries: ['Chapter 2: Aftermath / new responsibilities'],
    siblingEpisodeSummaries: ['Chapter 1 Episode 2: Arrival / Mio sees the headquarters'],
  };

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
  public async moveChapter(): Promise<Chapter | null> {
    throw new Error('not implemented');
  }
  public async createEpisode(_chapterId: string, _input: CreateEpisodeInput): Promise<Episode> {
    throw new Error('not implemented');
  }
  public async findEpisodesByChapterIdAndUserId(_chapterId: string, _userId: string): Promise<Episode[]> {
    throw new Error('not implemented');
  }
  public async findEpisodeByIdAndUserId(_id: string, _userId: string): Promise<Episode | null> {
    return this.episode;
  }
  public async updateEpisode(_id: string, _userId: string, _input: UpdateEpisodeInput): Promise<Episode | null> {
    throw new Error('not implemented');
  }
  public async deleteEpisode(_id: string, _userId: string): Promise<boolean> {
    throw new Error('not implemented');
  }
  public async moveEpisode(): Promise<Episode | null> {
    throw new Error('not implemented');
  }
  public async findCollaborationTargetByIdAndUserId(
    _layer: StoryCollaborationLayer,
    _targetId: string,
    _userId: string,
  ): Promise<StoryCollaborationTarget | null> {
    return this.collaborationTarget;
  }
  public async findEpisodePageSkeletonContextByIdAndUserId(
    _episodeId: string,
    _userId: string,
  ): Promise<EpisodePageSkeletonContext | null> {
    throw new Error('not implemented');
  }
  public async findEpisodeImprovementContextByIdAndUserId(): Promise<StoryEpisodeImprovementContext | null> {
    return {
      episodeId: '33333333-3333-4333-8333-333333333333',
      chapterId: 'chapter-1',
      workId: 'work-1',
      workTitle: 'Lyra',
      workGenre: 'dark fantasy',
      worldSetting: 'Time fractures spread from the sacred tree.',
      theme: 'Responsibility and delay',
      overallFlow: 'A reluctant girl joins a time-repair organization.',
      chapterTitle: 'Chapter 1',
      chapterPurpose: 'Pull Mio into 燦.',
      chapterStartingState: 'Mio is alone.',
      chapterEndingState: 'Mio sees the organization.',
      chapterEmotionCurve: 'fear -> disorientation -> resolve',
      episodeTitle: 'Episode 1',
      episodePurpose: 'Introduce the rivalry',
      introduction: 'Current intro',
      middle: 'Current middle',
      climax: 'Current climax',
      endingHook: 'Current hook',
      estimatedPages: 16,
      entities: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Aki',
          aliases: [],
          entityType: 'character',
          freeDescription: 'Black-haired swordswoman',
        },
      ],
      sceneSummaries: ['Scene 1: Rooftop / night / tense'],
      chapterSummaries: ['Chapter 2: Aftermath / new responsibilities'],
      siblingEpisodeSummaries: ['Chapter 1 Episode 2: Arrival / Mio sees the headquarters'],
    };
  }
  public async createPageSkeleton(
    _episodeId: string,
    _userId: string,
    _pages: PageSkeletonPageDraft[],
    _options?: { overwriteExisting?: boolean },
  ): Promise<PageSkeletonPersistResult | null> {
    throw new Error('not implemented');
  }

  public async rollbackFreshPageSkeleton(): Promise<boolean> {
    throw new Error('not implemented');
  }
}

class FakeStoryAiClient implements StoryAiClientPort {
  public lastRequest: StoryAiModelRequest | null = null;
  public lastManuscriptRequest: StoryAiModelRequest | null = null;
  public collaborationChunks = ['chunk-one', 'chunk-two'];
  public estimatedPanelCounts = [5];
  public estimateCalls = 0;

  public async estimateEpisodePanelCount(request: StoryAiModelRequest) {
    this.lastRequest = request;
    this.estimateCalls += 1;
    const parsed = JSON.parse(request.userPrompt) as { blocks: Array<{ block_id: string }> };
    return parsed.blocks.map((block, index) => ({
      blockId: block.block_id,
      panelCount: this.estimatedPanelCounts[index] ?? 1,
    }));
  }

  public streamCollaboration(request: StoryAiModelRequest): AsyncIterable<string> {
    this.lastRequest = request;
    const chunks = this.collaborationChunks;

    return (async function* streamChunks(): AsyncGenerator<string, void, void> {
      for (const chunk of chunks) {
        yield chunk;
      }
    })();
  }

  public async generatePageSkeleton(_request: StoryAiModelRequest): Promise<PageSkeletonPageDraft[]> {
    throw new Error('not implemented');
  }

  public async improveEpisodeDraft(request: StoryAiModelRequest) {
    this.lastRequest = request;
    return {
      introduction: 'Improved introduction',
      middle: 'Improved middle',
      climax: 'Improved climax',
      endingHook: 'Improved hook',
    };
  }

  public async improveEpisodeManuscript(request: StoryAiModelRequest) {
    this.lastManuscriptRequest = request;
    const input = JSON.parse(request.userPrompt) as {
      editable_fragments: Array<{ id: string; text: string }>;
    };
    return input.editable_fragments.map((fragment) => ({
      id: fragment.id,
      text: fragment.text.replaceAll('旧', '新').trim(),
    }));
  }
}

class FakeStoryEpisodeImprovementPlanner implements StoryEpisodeImprovementPlannerPort {
  public lastPlanInput: PlanStoryEpisodeImprovementInput | null = null;
  public lastAuditInput: AuditStoryEpisodeImprovementInput | null = null;
  public auditVerdict: CompiledStoryEpisodeImprovementAudit['audit']['verdict'] = 'pass';

  public async planEpisodeImprovement(
    input: PlanStoryEpisodeImprovementInput,
  ): Promise<CompiledStoryEpisodeImprovementPlan> {
    this.lastPlanInput = input;
    return {
      plan: {
        storyObjective: 'Mio understands the organization and starts choosing her relation to it.',
        mustPreserve: ['Mio wakes in the facility', 'Emile guides her through headquarters'],
        continuityGuards: ['Do not contradict Chapter 2 setup'],
        pageAdaptationNotes: ['Keep each section adaptable into concrete scene beats'],
        introduction: buildSectionPlan('Introduction anchor'),
        middle: buildSectionPlan('Middle anchor'),
        climax: buildSectionPlan('Climax anchor'),
        endingHook: buildSectionPlan('Ending hook anchor'),
      },
      compilerProvider: 'openai',
      compilerModel: 'gpt-5.4-mini',
      compilerPromptVersion: 'story_episode_improve_plan_v1',
    };
  }

  public async auditEpisodeImprovement(
    input: AuditStoryEpisodeImprovementInput,
  ): Promise<CompiledStoryEpisodeImprovementAudit> {
    this.lastAuditInput = input;
    return {
      audit: {
        verdict: this.auditVerdict,
        globalIssues: this.auditVerdict === 'revise' ? ['Clarify the handoff into the headquarters reveal.'] : [],
        introduction: [],
        middle: [],
        climax: [],
        endingHook: [],
      },
      compilerProvider: 'openai',
      compilerModel: 'gpt-5.4-mini',
      compilerPromptVersion: 'story_episode_improve_audit_v1',
    };
  }
}

function buildSectionPlan(objective: string) {
  return {
    objective,
    mustInclude: ['Named subject and clear causal beat'],
    visualBeats: ['Character acts', 'Environment reacts'],
    narrationHints: ['Use short framing narration when image alone is not enough'],
    continuityGuards: ['Stay within existing chapter facts'],
    avoid: ['Do not introduce a new location'],
  };
}

describe('StoryCollaborationService', () => {
  it('新形式の作画指示を含む全文改善は指示と区切りを同じ位置にbyte単位で保持する', async () => {
    const client = new FakeStoryAiClient();
    const service = new StoryCollaborationService(new FakeStoryRepository(), client);
    const source = '旧前置き\n---\n旧固定前＃寄りで描く＃旧固定後\n---\n旧末尾\n===\n旧次ページ';

    const result = await service.improveEpisodeDraft('user-1', {
      includeProductionNotes: true,
      episodeId: '33333333-3333-4333-8333-333333333333',
      instruction: '読みやすくする', language: 'ja',
      baseDraft: {
        title: '題', purpose: '目的', storyInputMode: 'full', storyFullDraft: source,
        introduction: null, middle: null, climax: null, endingHook: null,
      },
    });

    expect(result.compilerProvider).toBe('openai');
    expect(result.draft.storyInputMode).toBe('full');
    expect(result.draft.storyFullDraft).toBe(source.replaceAll('旧', '新'));
    expect(result.draft.storyFullDraft).toContain('\n---\n');
    expect(result.draft.storyFullDraft).toContain('\n===\n');
    const originalStructure = parseStoryManuscript(source, true).pages.map((page) => ({
      fixedPage: page.fixedPage,
      blocks: page.blocks.map((block) => block.fixedPanel),
    }));
    const improvedStructure = parseStoryManuscript(result.draft.storyFullDraft ?? '', true).pages.map((page) => ({
      fixedPage: page.fixedPage,
      blocks: page.blocks.map((block) => block.fixedPanel),
    }));
    expect(improvedStructure).toEqual(originalStructure);
    expect(result.draft.title).toBe('題');
    expect(result.draft.purpose).toBe('目的');
    expect(client.lastManuscriptRequest?.userPrompt).toContain('＃寄りで描く＃');
    expect(client.lastRequest).toBeNull();
  });

  it('structured改善でも各fieldの===・---・inline指示を保持する', async () => {
    const client = new FakeStoryAiClient();
    const service = new StoryCollaborationService(new FakeStoryRepository(), client);
    const introduction = '旧導入＃俯瞰＃\n===\n旧場面';
    const middle = '旧前\n---\n旧中\n---\n旧後';

    const result = await service.improveEpisodeDraft('user-1', {
      includeProductionNotes: true,
      episodeId: '33333333-3333-4333-8333-333333333333',
      instruction: '整える', language: 'ja',
      baseDraft: {
        title: null, purpose: null, storyInputMode: 'structured', storyFullDraft: null,
        introduction, middle, climax: '旧山場', endingHook: null,
      },
    });

    expect(result.draft).toMatchObject({
      storyInputMode: 'structured', storyFullDraft: null,
      introduction: introduction.replaceAll('旧', '新'),
      middle: middle.replaceAll('旧', '新'),
      climax: '新山場', endingHook: null,
    });
  });

  it('新形式指示がなければ既存writer APIを変えず、利用OFFなら指示文字列も既存経路へ渡す', async () => {
    const client = new FakeStoryAiClient();
    const service = new StoryCollaborationService(new FakeStoryRepository(), client);
    await service.improveEpisodeDraft('user-1', {
      includeProductionNotes: true,
      episodeId: '33333333-3333-4333-8333-333333333333', instruction: '整える', language: 'ja',
      baseDraft: {
        title: null, purpose: null, storyInputMode: 'full', storyFullDraft: '通常本文',
        introduction: null, middle: null, climax: null, endingHook: null,
      },
    });
    expect(client.lastRequest).not.toBeNull();
    expect(client.lastManuscriptRequest).toBeNull();

    const secondClient = new FakeStoryAiClient();
    const secondService = new StoryCollaborationService(new FakeStoryRepository(), secondClient);
    await secondService.improveEpisodeDraft('user-1', {
      includeProductionNotes: false,
      episodeId: '33333333-3333-4333-8333-333333333333', instruction: '整える', language: 'ja',
      baseDraft: {
        title: null, purpose: null, storyInputMode: 'full', storyFullDraft: '本文＃指示＃',
        introduction: null, middle: null, climax: null, endingHook: null,
      },
    });
    expect(secondClient.lastRequest).not.toBeNull();
    expect(secondClient.lastManuscriptRequest).toBeNull();
  });

  it('指示保持writerのID不整合では旧writerへ落とさず元原稿をfallback返却する', async () => {
    const client = new class extends FakeStoryAiClient {
      public override async improveEpisodeManuscript(): Promise<Array<{ id: string; text: string }>> {
        return [{ id: 'unknown', text: '指示を失った本文' }];
      }
    }();
    const service = new StoryCollaborationService(new FakeStoryRepository(), client);
    const source = '本文＃固定指示＃続き';
    const result = await service.improveEpisodeDraft('user-1', {
      includeProductionNotes: true,
      episodeId: '33333333-3333-4333-8333-333333333333', instruction: '整える', language: 'ja',
      baseDraft: {
        title: null, purpose: null, storyInputMode: 'full', storyFullDraft: source,
        introduction: null, middle: null, climax: null, endingHook: null,
      },
    });

    expect(result.compilerProvider).toBe('fallback');
    expect(result.draft.storyFullDraft).toBe(source);
    expect(result.compilerError).not.toBeNull();
    expect(client.lastRequest).toBeNull();
  });

  it('指示保持writerが新しいcommandを混入またはIDを重複した場合も元原稿へ戻す', async () => {
    const source = '前＃固定指示＃後';
    const input = {
      includeProductionNotes: true as const,
      episodeId: '33333333-3333-4333-8333-333333333333', instruction: '整える', language: 'ja' as const,
      baseDraft: {
        title: null, purpose: null, storyInputMode: 'full' as const, storyFullDraft: source,
        introduction: null, middle: null, climax: null, endingHook: null,
      },
    };
    const injectingClient = new class extends FakeStoryAiClient {
      public override async improveEpisodeManuscript() {
        return [
          { id: 'storyFullDraft-1', text: '改善前\n---\n混入' },
          { id: 'storyFullDraft-2', text: '改善後' },
        ];
      }
    }();
    const injected = await new StoryCollaborationService(
      new FakeStoryRepository(), injectingClient,
    ).improveEpisodeDraft('user-1', input);
    expect(injected.compilerProvider).toBe('fallback');
    expect(injected.draft.storyFullDraft).toBe(source);

    const duplicateClient = new class extends FakeStoryAiClient {
      public override async improveEpisodeManuscript() {
        return [
          { id: 'storyFullDraft-1', text: '改善前' },
          { id: 'storyFullDraft-1', text: '重複' },
        ];
      }
    }();
    const duplicated = await new StoryCollaborationService(
      new FakeStoryRepository(), duplicateClient,
    ).improveEpisodeDraft('user-1', input);
    expect(duplicated.compilerProvider).toBe('fallback');
    expect(duplicated.draft.storyFullDraft).toBe(source);
  });

  it('指示保持改善も所有contextが見つからない場合はproviderを呼ばない', async () => {
    const repository = new FakeStoryRepository();
    repository.findEpisodeImprovementContextByIdAndUserId = async () => null;
    const client = new FakeStoryAiClient();
    const service = new StoryCollaborationService(repository, client);

    await expect(service.improveEpisodeDraft('user-1', {
      includeProductionNotes: true,
      episodeId: '33333333-3333-4333-8333-333333333333', instruction: '整える', language: 'ja',
      baseDraft: {
        title: null, purpose: null, storyInputMode: 'full', storyFullDraft: '前＃固定＃後',
        introduction: null, middle: null, climax: null, endingHook: null,
      },
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(client.lastManuscriptRequest).toBeNull();
    expect(client.lastRequest).toBeNull();
  });

  it('5コマは2ページ、8コマも2ページとして切り上げる', async () => {
    const repository = new FakeStoryRepository();
    const client = new FakeStoryAiClient();
    const service = new StoryCollaborationService(repository, client);
    const input = {
      episodeId: '33333333-3333-4333-8333-333333333333',
      productionNotesEnabled: true,
      language: 'ja' as const,
      baseDraft: {
        title: '話', purpose: null, storyInputMode: 'full' as const,
        storyFullDraft: 'ミオが扉を開ける。驚いて立ち止まる。',
        introduction: null, middle: null, climax: null, endingHook: null,
      },
    };

    await expect(service.estimateEpisodePages('user-1', input)).resolves.toMatchObject({
      panel_count: 5, calculated_pages: 2, estimated_pages: 2, explicit_page_count: null,
    });
    client.estimatedPanelCounts = [8];
    await expect(service.estimateEpisodePages('user-1', input)).resolves.toMatchObject({
      panel_count: 8, calculated_pages: 2, estimated_pages: 2, explicit_page_count: null,
    });
    client.estimatedPanelCounts = [81];
    await expect(service.estimateEpisodePages('user-1', input)).resolves.toMatchObject({
      panel_count: 81, calculated_pages: 21, estimated_pages: 21, explicit_page_count: null,
    });
  });

  it('保存flagが無効でも単独行のページ区切りは明示ページ数を最終見積もりに使う', async () => {
    const client = new FakeStoryAiClient();
    client.estimatedPanelCounts = [2, 2, 1];
    const service = new StoryCollaborationService(new FakeStoryRepository(), client);

    await expect(service.estimateEpisodePages('user-1', {
      episodeId: '33333333-3333-4333-8333-333333333333',
      productionNotesEnabled: false,
      language: 'ja',
      baseDraft: {
        title: null, purpose: null, storyInputMode: 'full',
        storyFullDraft: '===\n扉を開ける。\n===\n廊下を走る。\n===\n屋上へ出る。\n===',
        introduction: null, middle: null, climax: null, endingHook: null,
      },
    })).resolves.toEqual({
      panel_count: 5,
      calculated_pages: 2,
      estimated_pages: 3,
      explicit_page_count: 3,
    });
  });

  it('固定ページの推定が8コマを超える場合は1ページとして返さない', async () => {
    const client = new FakeStoryAiClient();
    client.estimatedPanelCounts = [9];
    const service = new StoryCollaborationService(new FakeStoryRepository(), client);

    await expect(service.estimateEpisodePages('user-1', {
      episodeId: '33333333-3333-4333-8333-333333333333',
      productionNotesEnabled: true,
      language: 'ja',
      baseDraft: {
        title: null, purpose: null, storyInputMode: 'full',
        storyFullDraft: '===\n長い固定ページ。\n===',
        introduction: null, middle: null, climax: null, endingHook: null,
      },
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(client.lastRequest?.userPrompt).toContain('"fixed_page":true');
    expect(client.lastRequest?.userPrompt).toContain('"page_index":1');
  });

  it('演出指示を本文としてモデルへ送らず、区切り由来の最低コマ数を下回らない', async () => {
    const client = new FakeStoryAiClient();
    client.estimatedPanelCounts = [1, 1, 1];
    const service = new StoryCollaborationService(new FakeStoryRepository(), client);

    const result = await service.estimateEpisodePages('user-1', {
      episodeId: '33333333-3333-4333-8333-333333333333',
      productionNotesEnabled: true,
      language: 'ja',
      baseDraft: {
        title: null, purpose: null, storyInputMode: 'full',
        storyFullDraft: '扉を開ける。\n# 「扉を開ける」と「驚く」は別のコマにする。\n---\n驚く。\n---\n走り出す。',
        introduction: null, middle: null, climax: null, endingHook: null,
      },
    });

    expect(result.panel_count).toBe(3);
    expect(client.lastRequest?.userPrompt).not.toContain('別のコマにする');
  });

  it('部分的なページ指定は固定ページと前後の自由領域を別々に切り上げる', async () => {
    const client = new FakeStoryAiClient();
    client.estimatedPanelCounts = [5, 4, 5];
    const service = new StoryCollaborationService(new FakeStoryRepository(), client);

    await expect(service.estimateEpisodePages('user-1', {
      episodeId: '33333333-3333-4333-8333-333333333333',
      productionNotesEnabled: true,
      language: 'ja',
      baseDraft: {
        title: null, purpose: null, storyInputMode: 'full',
        storyFullDraft: '前置き。\n===\n固定ページ。\n===\n後続。',
        introduction: null, middle: null, climax: null, endingHook: null,
      },
    })).resolves.toEqual({
      panel_count: 14,
      calculated_pages: 4,
      estimated_pages: 5,
      explicit_page_count: null,
    });
  });

  it('所有対象が見つからない場合はモデルを呼ばない', async () => {
    const repository = new FakeStoryRepository();
    repository.episode = null;
    const client = new FakeStoryAiClient();
    const service = new StoryCollaborationService(repository, client);

    await expect(service.estimateEpisodePages('user-1', {
      episodeId: '33333333-3333-4333-8333-333333333333',
      productionNotesEnabled: false,
      language: 'ja',
      baseDraft: {
        title: null, purpose: null, storyInputMode: 'structured', storyFullDraft: null,
        introduction: '導入', middle: null, climax: null, endingHook: null,
      },
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(client.estimateCalls).toBe(0);
  });

  it('空本文と不正な作画指示はモデルを呼ぶ前にvalidation errorにする', async () => {
    const client = new FakeStoryAiClient();
    const service = new StoryCollaborationService(new FakeStoryRepository(), client);
    const baseDraft = {
      title: null, purpose: null, storyInputMode: 'full' as const,
      storyFullDraft: null, introduction: null, middle: null, climax: null, endingHook: null,
    };

    await expect(service.estimateEpisodePages('user-1', {
      episodeId: '33333333-3333-4333-8333-333333333333', productionNotesEnabled: false,
      language: 'ja', baseDraft,
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.estimateEpisodePages('user-1', {
      episodeId: '33333333-3333-4333-8333-333333333333', productionNotesEnabled: false,
      language: 'ja', baseDraft: { ...baseDraft, storyFullDraft: '本文＃閉じていない指示' },
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(client.estimateCalls).toBe(0);
  });

  it('providerがblock IDを欠落・重複・改変した場合は推測で補完しない', async () => {
    const client = new class extends FakeStoryAiClient {
      public override async estimateEpisodePanelCount(): Promise<Array<{ blockId: string; panelCount: number }>> {
        this.estimateCalls += 1;
        return [{ blockId: 'unknown-block', panelCount: 1 }];
      }
    }();
    const service = new StoryCollaborationService(new FakeStoryRepository(), client);

    await expect(service.estimateEpisodePages('user-1', {
      episodeId: '33333333-3333-4333-8333-333333333333', productionNotesEnabled: false,
      language: 'ja',
      baseDraft: {
        title: null, purpose: null, storyInputMode: 'full', storyFullDraft: '本文',
        introduction: null, middle: null, climax: null, endingHook: null,
      },
    })).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });

  it('改善本文と分離して原文にある引用だけを演出指示候補にする', async () => {
    const client = new class extends FakeStoryAiClient {
      public override async improveEpisodeDraft(request: StoryAiModelRequest) {
        this.lastRequest = request;
        return { introduction: '扉を押す。隙間をのぞく。息をのむ。', middle: '', climax: '', endingHook: '' };
      }
      public async suggestEpisodeProductionNotes(): Promise<string[]> {
        return ['「扉を押す」と「隙間をのぞく」は別コマ。', '「隙間をのぞく」と「息をのむ」は別コマ。',
          '「隙間をのぞく」と「知らない台詞」は同じコマ。'];
      }
    }();
    const service = new StoryCollaborationService(new FakeStoryRepository(), client);
    const result = await service.improveEpisodeDraft('actor', {
      includeProductionNotes: true,
      episodeId: '33333333-3333-4333-8333-333333333333',
      instruction: '漫画に整理', language: 'ja',
      baseDraft: { title: '話', purpose: null, storyInputMode: 'full',
        storyFullDraft: '扉を押す。隙間をのぞく。息をのむ。',
        introduction: null, middle: null, climax: null, endingHook: null },
    });
    expect(result.draft.storyFullDraft).not.toContain('# 「隙間をのぞく」と「息をのむ」');
    expect(result.productionNotes).toEqual([
      '「扉を押す」と「隙間をのぞく」は別コマ。',
      '「隙間をのぞく」と「息をのむ」は別コマ。',
    ]);
  });
  it('builds a collaboration prompt with scenes and entity context', async () => {
    const repository = new FakeStoryRepository();
    const client = new FakeStoryAiClient();
    const service = new StoryCollaborationService(repository, client);

    const stream = await service.collaborate('user-1', {
      layer: 'episode',
      targetId: '33333333-3333-4333-8333-333333333333',
      instruction: 'Tighten the confrontation.',
      language: 'ja',
      context: {
        currentDraft: 'Aki reaches the rooftop.',
        selectedText: null,
        userNotes: 'Keep the emotional temperature high.',
        focusPoints: ['rival reveal'],
        constraints: ['preserve continuity'],
      },
    });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['chunk-one', 'chunk-two']);
    expect(client.lastRequest?.systemPrompt).toContain('Target layer: episode');
    expect(client.lastRequest?.userPrompt).toContain('Aki');
    expect(client.lastRequest?.userPrompt).toContain('Scene 1: Rooftop / night / tense');
    expect(client.lastRequest?.userPrompt).toContain('rival reveal');
  });

  it('compacts long collaboration target context before sending it to the model', async () => {
    const repository = new FakeStoryRepository();
    const longDescription = 'very-long-character-detail '.repeat(80).trim();
    repository.collaborationTarget = {
      ...repository.collaborationTarget!,
      entities: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Aki',
          aliases: [],
          entityType: 'character',
          freeDescription: longDescription,
        },
      ],
      sceneSummaries: Array.from({ length: 60 }, (_unused, index) => `Scene ${index + 1}: detail ${index + 1}`),
    };
    const client = new FakeStoryAiClient();
    const service = new StoryCollaborationService(repository, client);

    const stream = await service.collaborate('user-1', {
      layer: 'episode',
      targetId: '33333333-3333-4333-8333-333333333333',
      instruction: 'Tighten the confrontation.',
      language: 'ja',
      context: {
        currentDraft: null,
        selectedText: null,
        userNotes: null,
        focusPoints: [],
        constraints: [],
      },
    });
    for await (const _chunk of stream) {
      // drain stream
    }

    expect(client.lastRequest?.userPrompt).toContain('very-long-character-detail');
    expect(client.lastRequest?.userPrompt).not.toContain(longDescription);
    expect(client.lastRequest?.userPrompt).not.toContain('Scene 60: detail 60');
  });

  it('throws NOT_FOUND when the target does not exist', async () => {
    const repository = new FakeStoryRepository();
    repository.collaborationTarget = null;
    const service = new StoryCollaborationService(repository, new FakeStoryAiClient());

    await expect(
      service.collaborate('user-1', {
        layer: 'episode',
        targetId: '33333333-3333-4333-8333-333333333333',
        instruction: 'Revise this.',
        language: 'ja',
        context: {
          currentDraft: null,
          selectedText: null,
          userNotes: null,
          focusPoints: [],
          constraints: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects oversized input context', async () => {
    const service = new StoryCollaborationService(new FakeStoryRepository(), new FakeStoryAiClient());

    await expect(
      service.collaborate('user-1', {
        layer: 'episode',
        targetId: '33333333-3333-4333-8333-333333333333',
        instruction: 'Revise this.',
        language: 'ja',
        context: {
          currentDraft: 'a'.repeat(28000),
          selectedText: null,
          userNotes: null,
          focusPoints: [],
          constraints: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects oversized streamed output', async () => {
    const client = new FakeStoryAiClient();
    client.collaborationChunks = ['a'.repeat(25000)];
    const service = new StoryCollaborationService(new FakeStoryRepository(), client);

    const stream = await service.collaborate('user-1', {
      layer: 'episode',
      targetId: '33333333-3333-4333-8333-333333333333',
      instruction: 'Revise this.',
      language: 'ja',
      context: {
        currentDraft: null,
        selectedText: null,
        userNotes: null,
        focusPoints: [],
        constraints: [],
      },
    });

    await expect(
      (async () => {
        for await (const _chunk of stream) {
          // no-op
        }
      })(),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('improves the episode draft with continuity context and returns structured fields', async () => {
    const repository = new FakeStoryRepository();
    const client = new FakeStoryAiClient();
    const planner = new FakeStoryEpisodeImprovementPlanner();
    const service = new StoryCollaborationService(repository, client, planner);

    const result = await service.improveEpisodeDraft('user-1', {
      episodeId: '33333333-3333-4333-8333-333333333333',
      instruction: 'Make the introduction clearer and more visual.',
      language: 'ja',
      baseDraft: {
        title: 'Old title',
        purpose: 'Old purpose',
        storyInputMode: 'structured',
        storyFullDraft: null,
        introduction: 'Old intro',
        middle: 'Old middle',
        climax: 'Old climax',
        endingHook: 'Old hook',
      },
    });

    expect(result.compilerProvider).toBe('openai');
    expect(result.draft.title).toBe('Old title');
    expect(result.draft.purpose).toBe('Old purpose');
    expect(result.draft.introduction).toBe('Improved introduction');
    expect(planner.lastPlanInput?.context.siblingEpisodeSummaries).toContain(
      'Chapter 1 Episode 2: Arrival / Mio sees the headquarters',
    );
    expect(client.lastRequest?.userPrompt).toContain('Structured rewrite plan:');
    expect(planner.lastAuditInput?.draft.introduction).toBe('Improved introduction');
  });

  it('compacts long episode improvement context in the writer prompt', async () => {
    const repository = new FakeStoryRepository();
    const longDescription = 'overflow-entity-detail '.repeat(80).trim();
    repository.findEpisodeImprovementContextByIdAndUserId = async () => ({
      ...repository.improvementContext,
      entities: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Aki',
          aliases: ['Sword of the Very Long Rooftop Nickname'.repeat(4)],
          entityType: 'character',
          freeDescription: longDescription,
        },
      ],
      sceneSummaries: Array.from({ length: 60 }, (_unused, index) => `Scene ${index + 1}: long scene ${index + 1}`),
    });
    const client = new FakeStoryAiClient();
    const service = new StoryCollaborationService(repository, client);

    await service.improveEpisodeDraft('user-1', {
      episodeId: '33333333-3333-4333-8333-333333333333',
      instruction: 'Make the introduction clearer and more visual.',
      language: 'ja',
      baseDraft: {
        title: 'Old title',
        purpose: 'Old purpose',
        storyInputMode: 'structured',
        storyFullDraft: null,
        introduction: 'Old intro',
        middle: 'Old middle',
        climax: 'Old climax',
        endingHook: 'Old hook',
      },
    });

    expect(client.lastRequest?.userPrompt).toContain('overflow-entity-detail');
    expect(client.lastRequest?.userPrompt).not.toContain(longDescription);
    expect(client.lastRequest?.userPrompt).not.toContain('Scene 60: long scene 60');
  });

  it('omits duplicated stored episode body when it matches the editable draft', async () => {
    const repository = new FakeStoryRepository();
    const client = new FakeStoryAiClient();
    const service = new StoryCollaborationService(repository, client);

    await service.improveEpisodeDraft('user-1', {
      episodeId: '33333333-3333-4333-8333-333333333333',
      instruction: 'Tighten the current draft.',
      language: 'ja',
      baseDraft: {
        title: 'Episode 1',
        purpose: 'Introduce the rivalry',
        storyInputMode: 'structured',
        storyFullDraft: null,
        introduction: 'Current intro',
        middle: 'Current middle',
        climax: 'Current climax',
        endingHook: 'Current hook',
      },
    });

    expect(client.lastRequest?.userPrompt).toContain('Current stored episode: same as current editable draft.');
    expect(client.lastRequest?.userPrompt).not.toContain('Current stored episode:\nTitle: Episode 1');
  });

  it('compacts differing stored episode body before sending it to the writer', async () => {
    const repository = new FakeStoryRepository();
    const longStoredIntro = 'stored-introduction-detail '.repeat(200).trim();
    repository.findEpisodeImprovementContextByIdAndUserId = async () => ({
      ...repository.improvementContext,
      introduction: longStoredIntro,
      middle: 'Different stored middle',
      climax: 'Different stored climax',
      endingHook: 'Different stored hook',
    });
    const client = new FakeStoryAiClient();
    const service = new StoryCollaborationService(repository, client);

    await service.improveEpisodeDraft('user-1', {
      episodeId: '33333333-3333-4333-8333-333333333333',
      instruction: 'Tighten the current draft.',
      language: 'ja',
      baseDraft: {
        title: 'Editable title',
        purpose: 'Editable purpose',
        storyInputMode: 'structured',
        storyFullDraft: null,
        introduction: 'Editable intro',
        middle: 'Editable middle',
        climax: 'Editable climax',
        endingHook: 'Editable hook',
      },
    });

    expect(client.lastRequest?.userPrompt).toContain('Current stored episode:');
    expect(client.lastRequest?.userPrompt).toContain('stored-introduction-detail');
    expect(client.lastRequest?.userPrompt).not.toContain(longStoredIntro);
  });

  it('retries the final writer once when the audit requests revision', async () => {
    const repository = new FakeStoryRepository();
    const client = new FakeStoryAiClient();
    const planner = new FakeStoryEpisodeImprovementPlanner();
    planner.auditVerdict = 'revise';
    const service = new StoryCollaborationService(repository, client, planner);

    const result = await service.improveEpisodeDraft('user-1', {
      episodeId: '33333333-3333-4333-8333-333333333333',
      instruction: 'Strengthen the transition into the middle.',
      language: 'ja',
      baseDraft: {
        title: 'Old title',
        purpose: 'Old purpose',
        storyInputMode: 'structured',
        storyFullDraft: null,
        introduction: 'Old intro',
        middle: 'Old middle',
        climax: 'Old climax',
        endingHook: 'Old hook',
      },
    });

    expect(result.compilerProvider).toBe('openai');
    expect(result.compilerError).toContain('Clarify the handoff');
    expect(client.lastRequest?.userPrompt).toContain('Audit notes to resolve:');
  });
});
