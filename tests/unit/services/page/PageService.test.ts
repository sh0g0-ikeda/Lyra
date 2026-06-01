import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../../src/domain/errors/index.js';
import type {
  EpisodePagePlanApplyResult,
  EpisodePagePlanContext,
  PageAutofillContext,
  PageSummary,
  UpdatePageSettingsInput,
} from '../../../../src/domain/types/page.js';
import type { Panel, UpdatePanelInput } from '../../../../src/domain/types/panel.js';
import type { PanelEntityAssignment } from '../../../../src/domain/types/panelEntityAssignment.js';
import type { PageRepository } from '../../../../src/repositories/PageRepository.js';
import type { PanelRepository } from '../../../../src/repositories/PanelRepository.js';
import type {
  CompiledEpisodePagePlan,
  EpisodePagePlanCompilerPort,
} from '../../../../src/services/page/EpisodePagePlanCompiler.js';
import type {
  CompiledPageAutofillSuggestion,
  PageAutofillCompilerPort,
} from '../../../../src/services/page/PageAutofillCompiler.js';
import type { PanelEntityAssignmentServicePort } from '../../../../src/services/page/PanelEntityAssignmentService.js';
import { PageService } from '../../../../src/services/page/PageService.js';
import type {
  CompiledStyleReference,
  StyleReferenceCompilerPort,
} from '../../../../src/services/style/StyleReferenceCompiler.js';

class FakePageRepository implements PageRepository {
  public page: PageSummary | null = buildPageSummary();
  public autofillContext: PageAutofillContext | null = buildAutofillContext();
  public episodePlanningContext: EpisodePagePlanContext | null = buildEpisodePlanningContext();
  public updatedInput: UpdatePageSettingsInput | null = null;

  public async findPagesByEpisodeIdAndUserId(): Promise<PageSummary[]> {
    return this.page === null ? [] : [this.page];
  }

  public async findPageByIdAndUserId(): Promise<PageSummary | null> {
    return this.page;
  }

  public async findGenerationContextByIdAndUserId(): Promise<never> {
    throw new Error('not implemented');
  }

  public async findPromptContextByIdAndUserId(): Promise<never> {
    throw new Error('not implemented');
  }

  public async findAutofillContextByIdAndUserId(): Promise<PageAutofillContext | null> {
    return this.autofillContext;
  }

  public async findEpisodePlanningContextByIdAndUserId(): Promise<EpisodePagePlanContext | null> {
    return this.episodePlanningContext;
  }

  public async updatePageSettings(
    _pageId: string,
    _userId: string,
    input: UpdatePageSettingsInput,
  ): Promise<PageSummary | null> {
    this.updatedInput = input;
    if (this.page !== null) {
      this.page = {
        ...this.page,
        dialogueMode: input.dialogueMode ?? this.page.dialogueMode,
        pageDialogueToggle: input.pageDialogueToggle ?? this.page.pageDialogueToggle,
        layoutConfig: input.layoutConfig ?? this.page.layoutConfig,
        storySourceSceneIds: input.storySourceSceneIds ?? this.page.storySourceSceneIds,
        storyPagePurpose: input.storyPagePurpose ?? this.page.storyPagePurpose,
        storyContinuityNote: input.storyContinuityNote ?? this.page.storyContinuityNote,
      };
    }
    return this.page;
  }

  public async updateGenerationState(): Promise<never> {
    throw new Error('not implemented');
  }

  public async updateGeneratedImageAndState(): Promise<never> {
    throw new Error('not implemented');
  }
}

class FakePanelRepository implements PanelRepository {
  public panels: Panel[] = [buildPanel()];
  public updatedPanels: Array<{ panelId: string; input: UpdatePanelInput }> = [];

  public async findPageContextByIdAndUserId(): Promise<never> {
    throw new Error('not implemented');
  }

  public async findPanelContextByIdAndUserId(): Promise<never> {
    throw new Error('not implemented');
  }

  public async createPanel(): Promise<never> {
    throw new Error('not implemented');
  }

  public async findPanelsByPageIdAndUserId(): Promise<Panel[]> {
    return this.panels;
  }

  public async updatePanel(panelId: string, _userId: string, input: UpdatePanelInput): Promise<Panel | null> {
    this.updatedPanels.push({ panelId, input });
    return buildPanel();
  }

  public async deletePanel(): Promise<never> {
    throw new Error('not implemented');
  }
}

class FakePanelEntityAssignmentService implements PanelEntityAssignmentServicePort {
  public updates: Array<{ panelId: string; assignments: PanelEntityAssignment[] }> = [];

  public async replacePanelEntityAssignments(
    _userId: string,
    panelId: string,
    assignments: PanelEntityAssignment[],
  ): Promise<PanelEntityAssignment[]> {
    this.updates.push({ panelId, assignments });
    return assignments;
  }
}

class FakePageAutofillCompiler implements PageAutofillCompilerPort {
  public error: Error | null = null;

  public async compileSuggestions(): Promise<CompiledPageAutofillSuggestion> {
    if (this.error !== null) {
      throw this.error;
    }

    return {
      suggestion: {
        panels: [
          {
            order: 1,
            panelRole: 'establish',
            panelSize: 'large',
            situationText: 'Moonlit rooftop confrontation.',
            composition: {
              source: 'custom',
              shotType: 'wide',
              angle: 'front',
              compositionPrompt: 'Show both rivals with rooftop space around them.',
              customNote: 'Keep the tension restrained.',
            },
            dialogueInPanel: false,
            backgroundNote: 'School rooftop at night.',
            entities: [
              {
                entityId: '11111111-1111-4111-8111-111111111111',
                role: 'primary',
                expression: 'calm',
                customExpression: null,
                action: 'standing_firm',
                customAction: null,
                position: 'center',
                facingDirection: 'front',
                effectNote: null,
                stateId: null,
              },
            ],
          },
        ],
      },
      compilerProvider: 'openai',
      compilerModel: 'gpt-5.4-mini',
      compilerPromptVersion: 'page_autofill_v2',
    };
  }
}

class FakeEpisodePagePlanCompiler implements EpisodePagePlanCompilerPort {
  public error: Error | null = null;

  public async compilePlan(): Promise<CompiledEpisodePagePlan> {
    if (this.error !== null) {
      throw this.error;
    }

    return {
      suggestion: {
        pages: [
          {
            pageId: 'page-1',
            pageNumber: 1,
            sourceSceneIds: ['scene-1'],
            pagePurpose: 'This page quietly escalates the rooftop confrontation.',
            continuityNote: 'Keep the mood restrained and unsettling.',
            page: {
              dialogueMode: 'mixed',
              pageDialogueToggle: true,
            },
            panels: [
              {
                order: 1,
                panelRole: 'establish',
                panelSize: 'large',
                situationText: 'Moonlit rooftop confrontation.',
                composition: {
                  source: 'custom',
                  shotType: 'wide',
                  angle: 'front',
                  compositionPrompt: 'Show both rivals with rooftop space around them.',
                  customNote: 'Keep the tension restrained.',
                },
                dialogueInPanel: false,
                backgroundNote: 'School rooftop at night.',
                entities: [
                  {
                    entityId: '11111111-1111-4111-8111-111111111111',
                    role: 'primary',
                    expression: 'calm',
                    customExpression: null,
                    action: 'standing_firm',
                    customAction: null,
                    position: 'center',
                    facingDirection: 'front',
                    effectNote: null,
                    stateId: null,
                  },
                ],
              },
            ],
          },
        ],
      },
      compilerProvider: 'openai',
      compilerModel: 'gpt-5.4-mini',
      compilerPromptVersion: 'page_autofill_v2',
    };
  }
}

class FakeStyleReferenceCompiler implements StyleReferenceCompilerPort {
  public async compileStyleReference(): Promise<CompiledStyleReference> {
    return {
      title: 'AKIRA',
      notes: '硬質で密度の高い都市背景',
      compiledBrief:
        'Keep the title "AKIRA" explicit as a style constraint, with precise mechanical linework, dense urban perspective, hard-edged shadow shapes, and disciplined environment rendering.',
      anchors: {
        lineQuality: 'precise mechanical linework with confident contour control',
        shapeLanguage: 'hard-edged industrial forms with disciplined perspective',
        faceRendering: null,
        eyeRendering: null,
        hairRendering: null,
        clothingRendering: 'functional clothing folds with restrained stylization',
        backgroundRendering: 'dense urban structures with explicit depth and infrastructure detail',
        shadingRendering: 'hard-edged shadow blocks with restrained gradients',
        textureFinish: 'clean ink finish with selective grit in environments',
        motionTreatment: 'controlled action accents without abstract streak overload',
        dialogueBalloonTreatment: 'page remains readable when dialogue density rises',
        atmosphere: 'tense, heavy urban pressure',
      },
      compilerProvider: 'openai',
      compilerModel: 'gpt-5.4-mini',
      compilerPromptVersion: 'style_ref_v3',
      compiledAt: '2026-05-28T00:00:00.000Z',
    };
  }
}

describe('PageService', () => {
  it('ページが存在しないと 404 になる', async () => {
    const repository = new FakePageRepository();
    repository.page = null;
    const service = new PageService(repository);

    await expect(
      service.updatePageSettings('user-1', 'page-1', { dialogueMode: 'mixed' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('confirmed ページは reopen 前に更新できない', async () => {
    const repository = new FakePageRepository();
    repository.page = { ...buildPageSummary(), status: 'confirmed' };
    const service = new PageService(repository);

    await expect(
      service.updatePageSettings('user-1', 'page-1', { dialogueMode: 'mixed' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('generating ページは更新できない', async () => {
    const repository = new FakePageRepository();
    repository.page = { ...buildPageSummary(), status: 'generating' };
    const service = new PageService(repository);

    await expect(
      service.updatePageSettings('user-1', 'page-1', { dialogueMode: 'mixed' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('page settings を更新する', async () => {
    const repository = new FakePageRepository();
    const service = new PageService(repository);

    const page = await service.updatePageSettings('user-1', 'page-1', {
      dialogueMode: 'balloon_only',
      pageDialogueToggle: false,
    });

    expect(repository.updatedInput).toEqual({
      dialogueMode: 'balloon_only',
      pageDialogueToggle: false,
    });
    expect(page).toMatchObject({
      id: 'page-1',
      status: 'editing',
    });
  });

  it('page style reference を保存時にコンパイルする', async () => {
    const repository = new FakePageRepository();
    const service = new PageService(
      repository,
      undefined,
      undefined,
      undefined,
      undefined,
      new FakeStyleReferenceCompiler(),
    );

    const page = await service.updatePageSettings('user-1', 'page-1', {
      styleReference: {
        title: 'AKIRA',
        notes: '硬質で密度の高い都市背景',
      },
    });

    expect(repository.updatedInput).toMatchObject({
      styleReference: {
        title: 'AKIRA',
        notes: '硬質で密度の高い都市背景',
        compiled_brief: expect.stringContaining('AKIRA'),
        anchors: expect.any(Object),
        compiler_provider: 'openai',
        compiler_prompt_version: 'style_ref_v3',
      },
    });
    expect(page.layoutConfig).toMatchObject({
      style_reference: {
        title: 'AKIRA',
        compiled_brief: expect.stringContaining('AKIRA'),
      },
    });
  });

  it('page provenance を保存する', async () => {
    const repository = new FakePageRepository();
    const service = new PageService(repository);

    await service.updatePageSettings('user-1', 'page-1', {
      storySourceSceneIds: ['scene-1'],
      storyPagePurpose: 'This page establishes the rooftop stakes.',
      storyContinuityNote: 'Keep the tension controlled before the next escalation.',
    });

    expect(repository.updatedInput).toMatchObject({
      storySourceSceneIds: ['scene-1'],
      storyPagePurpose: 'This page establishes the rooftop stakes.',
      storyContinuityNote: 'Keep the tension controlled before the next escalation.',
      layoutConfig: expect.objectContaining({
        story_source_scene_ids: ['scene-1'],
        story_page_purpose: 'This page establishes the rooftop stakes.',
        story_continuity_note: 'Keep the tension controlled before the next escalation.',
      }),
    });
  });

  it('scene autofill は対象 panel に提案を適用する', async () => {
    const pageRepository = new FakePageRepository();
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler = new FakePageAutofillCompiler();
    const service = new PageService(pageRepository, panelRepository, assignmentService, compiler);

    const result = await service.autofillFromScenes('user-1', 'page-1', 'ja');

    expect(result).toMatchObject({
      updatedPanelCount: 1,
      compilerUsed: true,
      compilerProvider: 'openai',
      compilerModel: 'gpt-5.4-mini',
      compilerPromptVersion: 'page_autofill_v2',
      compilerError: null,
    });
    expect(panelRepository.updatedPanels).toEqual([
      {
        panelId: 'panel-1',
        input: expect.objectContaining({
          panelRole: 'establish',
          panelSize: 'large',
          situationText: expect.stringContaining('Minerva'),
          dialogueInPanel: false,
          backgroundNote: 'School rooftop at night.',
          composition: expect.objectContaining({
            source: 'custom',
            shotType: 'wide',
            angle: 'front',
          }),
          panelNotes: expect.stringContaining('Two rivals meet in secret.'),
        }),
      },
    ]);
    expect(assignmentService.updates).toEqual([
      {
        panelId: 'panel-1',
        assignments: [
          expect.objectContaining({
            entityId: '11111111-1111-4111-8111-111111111111',
            role: 'primary',
          }),
        ],
      },
    ]);
  });

  it('scene autofill は不足している situation と composition memo を補完する', async () => {
    const pageRepository = new FakePageRepository();
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler: PageAutofillCompilerPort = {
      async compileSuggestions(): Promise<CompiledPageAutofillSuggestion> {
        return {
          suggestion: {
            panels: [
              {
                order: 1,
                panelRole: 'reaction',
                panelSize: 'standard',
                composition: {
                  source: 'custom',
                  shotType: 'half_body',
                  angle: 'side',
                },
                entities: [
                  {
                    entityId: '11111111-1111-4111-8111-111111111111',
                    role: 'primary',
                    expression: 'calm',
                    customExpression: null,
                    action: 'standing_firm',
                    customAction: null,
                    position: 'center',
                    facingDirection: 'front',
                    effectNote: null,
                    stateId: null,
                  },
                ],
              },
            ],
          },
          compilerProvider: 'openai',
          compilerModel: 'gpt-5.4-mini',
          compilerPromptVersion: 'page_autofill_v2',
        };
      },
    };
    const service = new PageService(pageRepository, panelRepository, assignmentService, compiler);

    await service.autofillFromScenes('user-1', 'page-1', 'ja');

    expect(panelRepository.updatedPanels).toEqual([
      {
        panelId: 'panel-1',
        input: expect.objectContaining({
          situationText: expect.stringContaining('Minerva'),
          backgroundNote: expect.stringContaining('School rooftop'),
          composition: expect.objectContaining({
            compositionPrompt: expect.stringContaining('Minerva'),
            customNote: expect.stringContaining('Minerva'),
            shotType: 'half_body',
            angle: 'side',
          }),
        }),
      },
    ]);
  });

  it('episode story plan は pages と panels に一括適用する', async () => {
    const pageRepository = new FakePageRepository();
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      new FakeEpisodePagePlanCompiler(),
    );

    const result: EpisodePagePlanApplyResult = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result).toMatchObject({
      updatedPageCount: 1,
      updatedPanelCount: 1,
      updatedAssignmentCount: 1,
      compilerUsed: true,
      compilerProvider: 'openai',
      compilerModel: 'gpt-5.4-mini',
      compilerPromptVersion: 'page_autofill_v2',
      compilerError: null,
    });
    expect(panelRepository.updatedPanels).toEqual([
      {
        panelId: 'panel-1',
        input: expect.objectContaining({
          panelRole: 'establish',
          panelSize: 'large',
          situationText: expect.stringContaining('Minerva'),
          backgroundNote: 'School rooftop at night.',
          dialogueInPanel: false,
          panelNotes: expect.stringContaining('This page quietly escalates'),
          composition: expect.objectContaining({
            source: 'custom',
            shotType: 'wide',
            angle: 'front',
            compositionPrompt: expect.stringContaining('Minerva'),
          }),
        }),
      },
    ]);
    expect(assignmentService.updates).toEqual([
      {
        panelId: 'panel-1',
        assignments: [
          expect.objectContaining({
            entityId: '11111111-1111-4111-8111-111111111111',
          }),
        ],
      },
    ]);
    expect(pageRepository.updatedInput).toMatchObject({
      storySourceSceneIds: ['scene-1'],
      storyPagePurpose: 'This page quietly escalates the rooftop confrontation.',
      storyContinuityNote: 'Keep the mood restrained and unsettling.',
    });
  });

  it('compiler が ConfigurationError の時だけ fallback で補完する', async () => {
    const pageRepository = new FakePageRepository();
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler = new FakePageAutofillCompiler();
    compiler.error = new ConfigurationError('compiler unavailable');
    const service = new PageService(pageRepository, panelRepository, assignmentService, compiler);

    const result = await service.autofillFromScenes('user-1', 'page-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(result.compilerProvider).toBe('fallback');
    expect(result.compilerError).toBe('compiler unavailable');
    expect(panelRepository.updatedPanels).toHaveLength(1);
  });

  it('compiler の一般例外は握りつぶさず失敗させる', async () => {
    const pageRepository = new FakePageRepository();
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler = new FakePageAutofillCompiler();
    compiler.error = new Error('unexpected compiler bug');
    const service = new PageService(pageRepository, panelRepository, assignmentService, compiler);

    await expect(service.autofillFromScenes('user-1', 'page-1', 'ja')).rejects.toThrow('unexpected compiler bug');
  });

  it('scene がないと autofill を拒否する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.autofillContext = { ...buildAutofillContext(), scenes: [] };
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
    );

    await expect(service.autofillFromScenes('user-1', 'page-1', 'ja')).rejects.toBeInstanceOf(ValidationError);
  });

  it('frame 数と panel 数がずれていると autofill を拒否する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.autofillContext = { ...buildAutofillContext(), frameCount: 2 };
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
    );

    await expect(service.autofillFromScenes('user-1', 'page-1', 'ja')).rejects.toBeInstanceOf(ValidationError);
  });
});

function buildPageSummary(): PageSummary {
  return {
    id: 'page-1',
    episodeId: 'episode-1',
    pageNumber: 1,
    layoutConfig: { type: 'template', template_id: 'standard_4' },
    storySourceSceneIds: [],
    storyPagePurpose: null,
    storyContinuityNote: null,
    dialogueMode: 'mixed',
    pageDialogueToggle: true,
    generationMode: null,
    generatedImage: null,
    status: 'editing',
    panelCount: 1,
    frameCount: 1,
    balloonCount: 1,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
  };
}

function buildAutofillContext(): PageAutofillContext {
  return {
    pageId: 'page-1',
    workId: 'work-1',
    episodeId: 'episode-1',
    chapterId: 'chapter-1',
    pageNumber: 1,
    totalPagesInEpisode: 3,
    frameCount: 1,
    status: 'editing',
    dialogueMode: 'mixed',
    pageDialogueToggle: true,
    chapterTitle: 'Midnight Rooftop',
    chapterPurpose: 'Raise the stakes without breaking the secret meeting tone.',
    chapterStartingState: 'Both rivals are guarded.',
    chapterEndingState: 'They understand the conflict is now personal.',
    chapterEmotionCurve: 'quiet tension -> sharper suspicion',
    chapterKeyBeats: ['secret meeting', 'mutual probing', 'uneasy smile'],
    episodePurpose: 'Two rivals meet in secret.',
    introduction: 'A rooftop meeting begins quietly.',
    middle: 'Tension rises under the moonlight.',
    climax: 'They realize neither can back down.',
    endingHook: 'One smile makes the other uneasy.',
    scenes: [
      {
        id: 'scene-1',
        order: 1,
        location: 'School rooftop',
        time: 'Night',
        atmosphere: 'Tense and restrained',
        involvedEntityIds: ['11111111-1111-4111-8111-111111111111'],
        entityStates: [],
      },
    ],
    entities: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Minerva',
        entityType: 'character',
        freeDescription: 'Tall, stern school idol with silver hair.',
        promptSupplement: 'Sharp green eyes and a black coat.',
        structuredFields: {},
      },
    ],
    panels: [buildAutofillPanelContext()],
  };
}

function buildEpisodePlanningContext(): EpisodePagePlanContext {
  return {
    episodeId: 'episode-1',
    workId: 'work-1',
    chapter: {
      id: 'chapter-1',
      title: 'Midnight Rooftop',
      purpose: 'Raise the stakes without breaking the secret meeting tone.',
      startingState: 'Both rivals are guarded.',
      endingState: 'They understand the conflict is now personal.',
      emotionCurve: 'quiet tension -> sharper suspicion',
      keyBeats: ['secret meeting', 'mutual probing', 'uneasy smile'],
    },
    episode: {
      title: 'The Rooftop Meeting',
      purpose: 'Show the rivals testing each other in secret.',
      introduction: 'The rooftop meeting begins quietly.',
      middle: 'Tension rises under the moonlight.',
      climax: 'They realize neither can back down.',
      endingHook: 'One smile makes the other uneasy.',
      estimatedPages: 3,
    },
    scenes: [
      {
        id: 'scene-1',
        order: 1,
        location: 'School rooftop',
        time: 'Night',
        atmosphere: 'Tense and restrained',
        involvedEntityIds: ['11111111-1111-4111-8111-111111111111'],
        entityStates: [
          {
            entityId: '11111111-1111-4111-8111-111111111111',
            stateId: 'state-1',
            costumeNote: 'Long coat over school uniform',
            costumeRefId: null,
            conditionNote: 'Slightly windblown',
            hairNote: 'Hair pulled behind one ear',
            expressionDefault: 'calm',
            extraNote: 'Keeps her chin raised',
          },
        ],
      },
    ],
    entities: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Minerva',
        entityType: 'character',
        freeDescription: 'Tall, stern school idol with silver hair.',
        promptSupplement: 'Sharp green eyes and a black coat.',
        structuredFields: {},
      },
    ],
    pages: [
      {
        pageId: 'page-1',
        pageNumber: 1,
        frameCount: 1,
        status: 'editing',
        dialogueMode: 'mixed',
        pageDialogueToggle: true,
        panels: [buildAutofillPanelContext()],
      },
    ],
  };
}

function buildAutofillPanelContext() {
  return {
    id: 'panel-1',
    order: 1,
    panelRole: 'action' as const,
    panelSize: 'standard' as const,
    situationText: null,
    composition: {
      source: 'custom' as const,
      galleryItemId: null,
      compositionPrompt: null,
      shotType: null,
      angle: null,
      customNote: null,
    },
    dialogueInPanel: true,
    dialogue: [],
    sfxText: null,
    backgroundNote: null,
    panelNotes: null,
    entities: [],
  };
}

function buildPanel(): Panel {
  return {
    id: 'panel-1',
    pageId: 'page-1',
    order: 1,
    panelRole: 'action',
    panelSize: 'standard',
    situationText: null,
    entities: [],
    composition: {
      source: 'custom',
      galleryItemId: null,
      compositionPrompt: null,
      shotType: null,
      angle: null,
      customNote: null,
    },
    dialogueInPanel: true,
    dialogue: [],
    sfxText: null,
    backgroundNote: null,
    panelNotes: null,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
  };
}
