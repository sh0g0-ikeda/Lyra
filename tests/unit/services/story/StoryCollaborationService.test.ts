import { describe, expect, it } from 'vitest';
import type { StoryRepository } from '../../../../src/repositories/StoryRepository.js';
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
    throw new Error('not implemented');
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
  public collaborationChunks = ['chunk-one', 'chunk-two'];

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
