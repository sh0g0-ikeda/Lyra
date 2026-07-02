import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../../src/domain/errors/index.js';
import { STORY_AI_LIMITS } from '../../../../src/domain/constants/storyAi.js';
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
  CompileEpisodePagePlanInput,
  EpisodePagePlanCompilerPort,
} from '../../../../src/services/page/EpisodePagePlanCompiler.js';
import type {
  CompiledPageAutofillSuggestion,
  CompilePageAutofillInput,
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
  public updatedInputs: UpdatePageSettingsInput[] = [];

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
    this.updatedInputs.push(input);
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

  public async compactPanelOrdersAfterDelete(): Promise<never> {
    throw new Error('not implemented');
  }

  public async reorderPanels(): Promise<never> {
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
  public lastInput: CompilePageAutofillInput | null = null;

  public async compileSuggestions(input: CompilePageAutofillInput): Promise<CompiledPageAutofillSuggestion> {
    this.lastInput = input;
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
  public lastInput: CompileEpisodePagePlanInput | null = null;
  public inputs: CompileEpisodePagePlanInput[] = [];

  public async compilePlan(input: CompileEpisodePagePlanInput): Promise<CompiledEpisodePagePlan> {
    this.lastInput = input;
    this.inputs.push(input);
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

class ChunkAwareEpisodePagePlanCompiler implements EpisodePagePlanCompilerPort {
  public inputs: CompileEpisodePagePlanInput[] = [];
  public failOnCall: number | null = null;

  public async compilePlan(input: CompileEpisodePagePlanInput): Promise<CompiledEpisodePagePlan> {
    this.inputs.push(input);
    if (this.failOnCall === this.inputs.length) {
      throw new ConfigurationError('chunk planner unavailable');
    }

    const pages = extractCompilerBriefPageRefs(input.compilerBrief);
    return {
      suggestion: {
        pages: pages.map((page) => ({
          pageId: page.pageId,
          pageNumber: page.pageNumber,
          sourceSceneIds: ['scene-1'],
          pagePurpose: `Plan page ${page.pageNumber}.`,
          continuityNote: `Continue into page ${page.pageNumber + 1}.`,
          page: {
            dialogueMode: 'mixed',
            pageDialogueToggle: true,
          },
          panels: [
            {
              order: 1,
              panelRole: 'action',
              panelSize: 'standard',
              situationText: `Minerva advances the beat on page ${page.pageNumber}.`,
              composition: {
                source: 'custom',
                shotType: 'half_body',
                angle: 'front',
                compositionPrompt: `Frame Minerva clearly for page ${page.pageNumber}.`,
                customNote: `Keep page ${page.pageNumber} readable.`,
              },
              dialogueInPanel: true,
              dialogue: [
                {
                  entityId: '11111111-1111-4111-8111-111111111111',
                  text: `Page ${page.pageNumber} line.`,
                  type: 'speech',
                  position: 'top',
                },
              ],
              backgroundNote: `Rooftop detail for page ${page.pageNumber}.`,
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
        })),
      },
      compilerProvider: 'openai',
      compilerModel: 'gpt-5',
      compilerPromptVersion: 'episode_page_plan_v2',
    };
  }
}

function extractCompilerBriefPageRefs(
  compilerBrief: string,
): Array<{ pageId: string; pageNumber: number }> {
  return Array.from(compilerBrief.matchAll(/^Page (\d+) \(([^)]+)\)$/gmu)).map((match) => ({
    pageNumber: Number(match[1]),
    pageId: match[2] ?? '',
  }));
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
    const styleReference = (page.layoutConfig as { style_reference?: Record<string, unknown> }).style_reference;
    expect(styleReference?.title).toBe('AKIRA');
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
    expect(compiler.lastInput?.compilerBrief).toContain('[OUTPUT CONTRACT]');
    expect(compiler.lastInput?.compilerBrief).toContain('matching the supplied page_autofill schema');
    expect(compiler.lastInput?.compilerBrief).toContain('[CURRENT PANELS]');
    expect(compiler.lastInput?.compilerBrief).not.toContain('[OUTPUT JSON SHAPE]');
    expect(compiler.lastInput?.compilerBrief).not.toContain('[ALLOWED ENUMS]');
    const updatedPanel = panelRepository.updatedPanels[0];
    expect(updatedPanel?.panelId).toBe('panel-1');
    expect(updatedPanel?.input.panelRole).toBeTruthy();
    expect(updatedPanel?.input.panelSize).toBeTruthy();
    expect(updatedPanel?.input.situationText).toContain('Minerva');
    expect(updatedPanel?.input.dialogueInPanel).toBe(false);
    expect(updatedPanel?.input.backgroundNote).toContain('School rooftop');
    expect(updatedPanel?.input.composition).toEqual(
      expect.objectContaining({
        source: 'custom',
        shotType: expect.any(String),
        angle: expect.any(String),
      }),
    );
    expect(updatedPanel?.input.panelNotes ?? null).toBeNull();
    expect(updatedPanel?.input.dialogue).toBeUndefined();
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

  it('scene autofill compiler brief compacts long story context', async () => {
    const pageRepository = new FakePageRepository();
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler = new FakePageAutofillCompiler();
    const longIntroduction = 'page-autofill-overflow-intro '.repeat(80).trim();
    const longKeyBeat = 'page-autofill-overflow-keybeat '.repeat(80).trim();
    pageRepository.autofillContext = {
      ...pageRepository.autofillContext!,
      introduction: longIntroduction,
      chapterKeyBeats: [longKeyBeat],
      scenes: Array.from({ length: 60 }, (_unused, index) => ({
        id: `scene-${index + 1}`,
        order: index + 1,
        location: `Long corridor ${index + 1}`,
        time: 'Night',
        atmosphere: `page-autofill-overflow-scene ${index + 1}`,
        involvedEntityIds: ['11111111-1111-4111-8111-111111111111'],
        entityStates: [],
      })),
    };
    const service = new PageService(pageRepository, panelRepository, assignmentService, compiler);

    await service.autofillFromScenes('user-1', 'page-1', 'ja');

    const compilerBrief = compiler.lastInput?.compilerBrief ?? '';
    expect(compilerBrief).toContain('page-autofill-overflow-intro');
    expect(compilerBrief).not.toContain(longIntroduction);
    expect(compilerBrief).toContain('page-autofill-overflow-keybeat');
    expect(compilerBrief).not.toContain(longKeyBeat);
    expect(compilerBrief).not.toContain('Scene 60');
  });

  it('scene autofill は compiler が出していない creative 欄を補完保存しない', async () => {
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
          composition: expect.objectContaining({
            compositionPrompt: null,
            customNote: null,
            shotType: 'half_body',
            angle: 'side',
          }),
        }),
      },
    ]);
  });

  it('scene autofill は引用符付き dialogue を正規化する', async () => {
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
                situationText: 'Minerva turns toward the voice behind her.',
                dialogue: [
                  {
                    entityId: null,
                    text: '「新人？」',
                    type: 'speech',
                    position: 'top',
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

    expect(panelRepository.updatedPanels[0]?.input.dialogue).toEqual([
      expect.objectContaining({
        text: '新人？',
      }),
    ]);
  });

  it('scene autofill は sparse compiler suggestion に fallback creative text を混ぜない', async () => {
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
                situationText: 'The rooftop meeting begins in silence.',
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

    const updatedPanel = panelRepository.updatedPanels[0];
    expect(updatedPanel?.panelId).toBe('panel-1');
    expect(updatedPanel?.input.situationText).toBe('The rooftop meeting begins in silence.');
    expect(updatedPanel?.input.backgroundNote).toBeUndefined();
    expect(updatedPanel?.input.composition).toEqual(
      expect.objectContaining({
        source: 'custom',
        shotType: expect.any(String),
        angle: expect.any(String),
      }),
    );
    expect(updatedPanel?.input.composition?.compositionPrompt).toBeNull();
    expect(updatedPanel?.input.composition?.customNote).toBeNull();
    expect(assignmentService.updates).toHaveLength(0);
  });

  it('scene autofill は compiler 成功でも generic な構図文と空 assignment を fallback 保存しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.autofillContext = {
      ...buildAutofillContext(),
      episodePurpose: 'Mio and Emil cross the corridor while Mio questions what she has seen.',
      introduction: 'Mio wakes up and Emil offers water.',
      middle: 'Emil explains the organization while Mio keeps probing.',
      entities: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: '深見澪',
          entityType: 'character',
          freeDescription: 'A wary new arrival.',
          promptSupplement: null,
          structuredFields: { character_identity: { aliases: ['Mio', '澪'] } },
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'エミール',
          entityType: 'character',
          freeDescription: 'A calm guide from another era.',
          promptSupplement: null,
          structuredFields: { character_identity: { aliases: ['Emil'] } },
        },
      ],
    };
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler: PageAutofillCompilerPort = {
      async compileSuggestions(): Promise<CompiledPageAutofillSuggestion> {
        return {
          suggestion: {
            panels: [
              {
                order: 1,
                situationText: 'Mio pauses in the corridor as Emil keeps speaking.',
                composition: {
                  source: 'custom',
                  compositionPrompt: 'Readable composition.',
                  shotType: 'wide',
                  angle: 'front',
                  customNote: 'Current setting.',
                },
                backgroundNote: 'Current setting.',
                entities: [],
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

    await service.autofillFromScenes('user-1', 'page-1', 'en');

    const updatedPanel = panelRepository.updatedPanels[0];
    expect(updatedPanel?.panelId).toBe('panel-1');
    expect(updatedPanel?.input.situationText).toBe('Mio pauses in the corridor as Emil keeps speaking.');
    expect(updatedPanel?.input.composition).toEqual(
      expect.objectContaining({
        source: 'custom',
        shotType: expect.any(String),
        angle: expect.any(String),
      }),
    );
    expect(updatedPanel?.input.composition?.compositionPrompt).toBeNull();
    expect(updatedPanel?.input.composition?.customNote).toBeNull();
    expect(updatedPanel?.input.backgroundNote).toBeUndefined();
    expect(assignmentService.updates).toHaveLength(0);
  });

  it('episode story plan は pages と panels に一括適用する', async () => {
    const pageRepository = new FakePageRepository();
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const episodeCompiler = new FakeEpisodePagePlanCompiler();
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      episodeCompiler,
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
    expect(episodeCompiler.lastInput?.compilerBrief).toContain('[OUTPUT CONTRACT]');
    expect(episodeCompiler.lastInput?.compilerBrief).toContain('matching the supplied episode_page_plan schema');
    expect(episodeCompiler.lastInput?.compilerBrief).toContain('[CURRENT PAGES]');
    expect(episodeCompiler.lastInput?.compilerBrief).not.toContain('[OUTPUT JSON SHAPE]');
    expect(panelRepository.updatedPanels).toHaveLength(1);
    expect(panelRepository.updatedPanels[0]).toMatchObject({
      panelId: 'panel-1',
      input: {
        panelRole: expect.any(String),
        panelSize: expect.any(String),
        situationText: expect.any(String),
        backgroundNote: 'School rooftop at night.',
        dialogueInPanel: false,
        composition: expect.objectContaining({
          source: 'custom',
          shotType: 'wide',
          angle: 'front',
          compositionPrompt: expect.any(String),
          customNote: 'Keep the tension restrained.',
        }),
      },
    });
    expect(panelRepository.updatedPanels[0]?.input.panelNotes ?? null).toBeNull();
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

  it('episode story plan は scene がなくても episode text から pages と panels に反映する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = { ...buildEpisodePlanningContext(), scenes: [] };
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const episodeCompiler = new FakeEpisodePagePlanCompiler();
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      episodeCompiler,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result).toMatchObject({
      updatedPageCount: 1,
      updatedPanelCount: 1,
      updatedAssignmentCount: 1,
      compilerUsed: true,
    });
    const compilerBrief = episodeCompiler.lastInput?.compilerBrief ?? '';
    expect(compilerBrief).toContain('[SCENES]');
    expect(compilerBrief).toContain('(none)');
    expect(compilerBrief).toContain('When [SCENES] is (none), source_scene_ids must be empty.');
    expect(pageRepository.updatedInput).toMatchObject({
      storySourceSceneIds: [],
      storyPagePurpose: 'This page quietly escalates the rooftop confrontation.',
      storyContinuityNote: 'Keep the mood restrained and unsettling.',
    });
  });

  it('episode story plan は compiler 実行前に page layout metadata を panel 数へ修復する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = {
      ...buildEpisodePlanningContext(),
      pages: [
        {
          pageId: 'page-1',
          pageNumber: 1,
          frameCount: 5,
          layoutConfig: { type: 'template', template_id: 'standard_4', panel_count: 4 },
          status: 'editing',
          dialogueMode: 'mixed',
          pageDialogueToggle: true,
          panels: Array.from({ length: 5 }, (_value, index) => ({
            ...buildAutofillPanelContext(),
            id: `panel-${index + 1}`,
            order: index + 1,
          })),
        },
      ],
    };
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const episodeCompiler = new FakeEpisodePagePlanCompiler();
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      episodeCompiler,
    );

    await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(episodeCompiler.lastInput).not.toBeNull();
    expect(pageRepository.updatedInputs[0]).toMatchObject({
      layoutConfig: {
        type: 'template',
        template_id: 'action_5',
        panel_count: 5,
      },
    });
    const frameDefinitions = pageRepository.updatedInputs[0]?.layoutConfig?.frame_definitions;
    expect(Array.isArray(frameDefinitions) ? frameDefinitions : []).toHaveLength(5);
  });

  it('episode story plan は frame 数と panel 数がずれていると compiler を呼ばず拒否する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = {
      ...buildEpisodePlanningContext(),
      pages: [
        {
          pageId: 'page-1',
          pageNumber: 1,
          frameCount: 4,
          layoutConfig: { type: 'template', template_id: 'standard_4', panel_count: 4 },
          status: 'editing',
          dialogueMode: 'mixed',
          pageDialogueToggle: true,
          panels: Array.from({ length: 5 }, (_value, index) => ({
            ...buildAutofillPanelContext(),
            id: `panel-${index + 1}`,
            order: index + 1,
          })),
        },
      ],
    };
    const episodeCompiler = new FakeEpisodePagePlanCompiler();
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      episodeCompiler,
    );

    await expect(service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja')).rejects.toThrow(
      'コマ割りを先に合わせてください',
    );
    expect(episodeCompiler.lastInput).toBeNull();
    expect(pageRepository.updatedInputs).toHaveLength(0);
  });

  it('episode story plan は大きい episode をページ単位の chunk に分けてから一括保存する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(7);
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const episodeCompiler = new ChunkAwareEpisodePagePlanCompiler();
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      episodeCompiler,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result).toMatchObject({
      updatedPageCount: 7,
      updatedPanelCount: 7,
      updatedAssignmentCount: 7,
      compilerUsed: true,
      compilerProvider: 'openai',
      compilerModel: 'gpt-5',
      compilerPromptVersion: 'episode_page_plan_v2',
    });
    expect(episodeCompiler.inputs).toHaveLength(3);
    expect(episodeCompiler.inputs[0]?.compilerBrief).toContain('Page 1 (page-1)');
    expect(episodeCompiler.inputs[0]?.compilerBrief).toContain('Page 3 (page-3)');
    expect(episodeCompiler.inputs[0]?.compilerBrief).not.toContain('Page 4 (page-4)');
    expect(episodeCompiler.inputs[1]?.compilerBrief).toContain('Page 4 (page-4)');
    expect(episodeCompiler.inputs[1]?.compilerBrief).toContain('Page 6 (page-6)');
    expect(episodeCompiler.inputs[2]?.compilerBrief).toContain('Page 7 (page-7)');
    expect(panelRepository.updatedPanels).toHaveLength(7);
    expect(assignmentService.updates).toHaveLength(7);
  });

  it('episode story plan は chunk の一部が失敗した場合に何も保存しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(7);
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const episodeCompiler = new ChunkAwareEpisodePagePlanCompiler();
    episodeCompiler.failOnCall = 2;
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      episodeCompiler,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(result.compilerError).toBe('chunk planner unavailable');
    expect(episodeCompiler.inputs).toHaveLength(2);
    expect(pageRepository.updatedInput).toBeNull();
    expect(panelRepository.updatedPanels).toHaveLength(0);
    expect(assignmentService.updates).toHaveLength(0);
  });

  it('episode story plan compiler brief compacts long story context', async () => {
    const pageRepository = new FakePageRepository();
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const episodeCompiler = new FakeEpisodePagePlanCompiler();
    const longIntroduction = 'episode-plan-overflow-intro '.repeat(80).trim();
    const longKeyBeat = 'episode-plan-overflow-keybeat '.repeat(80).trim();
    pageRepository.episodePlanningContext = {
      ...pageRepository.episodePlanningContext!,
      chapter: {
        ...pageRepository.episodePlanningContext!.chapter,
        keyBeats: [longKeyBeat],
      },
      episode: {
        ...pageRepository.episodePlanningContext!.episode,
        introduction: longIntroduction,
      },
      scenes: Array.from({ length: 60 }, (_unused, index) => ({
        id: `scene-${index + 1}`,
        order: index + 1,
        location: `Episode corridor ${index + 1}`,
        time: 'Night',
        atmosphere: `episode-plan-overflow-scene ${index + 1}`,
        involvedEntityIds: ['11111111-1111-4111-8111-111111111111'],
        entityStates: [],
      })),
    };
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      episodeCompiler,
    );

    await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    const compilerBrief = episodeCompiler.lastInput?.compilerBrief ?? '';
    expect(compilerBrief).toContain('episode-plan-overflow-intro');
    expect(compilerBrief).not.toContain(longIntroduction);
    expect(compilerBrief).toContain('episode-plan-overflow-keybeat');
    expect(compilerBrief).not.toContain(longKeyBeat);
    expect(compilerBrief).not.toContain('Scene 60');
  });

  it('episode story plan は sparse compiler suggestion を story fallback で field-level 補完する', async () => {
    const pageRepository = new FakePageRepository();
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler: EpisodePagePlanCompilerPort = {
      async compilePlan(): Promise<CompiledEpisodePagePlan> {
        return {
          suggestion: {
            pages: [
              {
                pageId: 'page-1',
                pageNumber: 1,
                panels: [
                  {
                    order: 1,
                    situationText: 'A quiet rooftop beat before the conflict sharpens.',
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
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      compiler,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result).toMatchObject({
      updatedPageCount: 1,
      updatedPanelCount: 1,
      updatedAssignmentCount: 1,
    });
    expect(pageRepository.updatedInput).toMatchObject({
      storySourceSceneIds: ['scene-1'],
    });
    expect(pageRepository.updatedInput?.storyPagePurpose).toEqual(expect.any(String));
    expect(pageRepository.updatedInput?.storyContinuityNote).toEqual(expect.any(String));
    const updatedPanel = panelRepository.updatedPanels[0];
    expect(updatedPanel?.panelId).toBe('panel-1');
    expect(updatedPanel?.input.situationText).toEqual(expect.stringContaining('quiet rooftop beat'));
    expect(updatedPanel?.input.backgroundNote).toEqual(expect.any(String));
    expect(updatedPanel?.input.composition).toEqual(
      expect.objectContaining({
        source: 'custom',
        shotType: expect.any(String),
        angle: expect.any(String),
        compositionPrompt: expect.any(String),
        customNote: expect.any(String),
      }),
    );
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
  });

  it('episode story plan は generic な compiler 成功項目を story fallback で置き換える', async () => {
    const pageRepository = new FakePageRepository();
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler: EpisodePagePlanCompilerPort = {
      async compilePlan(): Promise<CompiledEpisodePagePlan> {
        return {
          suggestion: {
            pages: [
              {
                pageId: 'page-1',
                pageNumber: 1,
                pagePurpose: 'Page progression',
                continuityNote: 'Current scene',
                panels: [
                  {
                    order: 1,
                    situationText: 'The rooftop meeting begins in silence.',
                    composition: {
                      source: 'custom',
                      compositionPrompt: 'Readable composition.',
                      shotType: 'wide',
                      angle: 'front',
                      customNote: 'Current setting.',
                    },
                    backgroundNote: 'Current setting.',
                    entities: [],
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
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      compiler,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'en');

    expect(result.compilerUsed).toBe(true);
    expect(pageRepository.updatedInput?.storyPagePurpose).not.toBe('Page progression');
    expect(pageRepository.updatedInput?.storyContinuityNote).not.toBe('Current scene');
    const updatedPanel = panelRepository.updatedPanels[0];
    expect(updatedPanel?.input.situationText).toEqual(
      expect.stringContaining('The rooftop meeting begins in silence'),
    );
    expect(updatedPanel?.input.situationText).not.toContain('。');
    expect(updatedPanel?.input.backgroundNote).toEqual(expect.any(String));
    expect(updatedPanel?.input.backgroundNote).not.toBe('Current setting.');
    expect(updatedPanel?.input.backgroundNote).not.toContain('。');
    expect(updatedPanel?.input.composition).toEqual(
      expect.objectContaining({
        source: 'custom',
        shotType: 'wide',
        angle: 'front',
        compositionPrompt: expect.any(String),
        customNote: expect.any(String),
      }),
    );
    expect(updatedPanel?.input.composition?.compositionPrompt).not.toBe('Readable composition.');
    expect(updatedPanel?.input.composition?.customNote).not.toBe('Current setting.');
    expect(updatedPanel?.input.composition?.compositionPrompt).not.toContain('。');
    expect(updatedPanel?.input.composition?.customNote).not.toContain('。');
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
  });

  it('episode story plan の field-level 補完は一般名詞の影をキャラとして割り当てない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = {
      ...buildEpisodePlanningContext(),
      episode: {
        ...buildEpisodePlanningContext().episode,
        purpose: '澪が影を見る能力を持つことをエミールが説明する。',
        introduction: '澪は自分だけが影を見ていることに戸惑う。',
        middle: '影は人に取り憑くが、ここではまだ正体を断定しない。',
        climax: 'エミールは影に関わる危険性を話す。',
        endingHook: '澪はまだ理解しきれないまま話を聞く。',
      },
      scenes: [
        {
          id: 'scene-1',
          order: 1,
          location: 'Corridor',
          time: 'Morning',
          atmosphere: 'Tense',
          involvedEntityIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
          entityStates: [],
        },
      ],
      entities: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: '澪',
          entityType: 'character',
          freeDescription: 'A wary new arrival.',
          promptSupplement: null,
          structuredFields: {},
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'エミール',
          entityType: 'character',
          freeDescription: 'A calm guide from another era.',
          promptSupplement: null,
          structuredFields: {},
        },
        {
          id: 'shadow-entity',
          name: '影',
          entityType: 'character',
          freeDescription: 'A generic label that should not be inferred from prose alone.',
          promptSupplement: null,
          structuredFields: {},
        },
      ],
    };
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler: EpisodePagePlanCompilerPort = {
      async compilePlan(): Promise<CompiledEpisodePagePlan> {
        return {
          suggestion: {
            pages: [
              {
                pageId: 'page-1',
                pageNumber: 1,
                panels: [
                  {
                    order: 1,
                    situationText: '澪が影の話を聞いて戸惑う。',
                  },
                ],
              },
            ],
          },
          compilerProvider: 'openai',
          compilerModel: 'gpt-5',
          compilerPromptVersion: 'episode_page_plan_v2',
        };
      },
    };
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      compiler,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(assignmentService.updates).toHaveLength(1);
    const assignedEntityIds = assignmentService.updates.flatMap((update) =>
      update.assignments.map((assignment) => assignment.entityId),
    );
    expect(assignedEntityIds).toContain('11111111-1111-4111-8111-111111111111');
    expect(assignedEntityIds).not.toContain('shadow-entity');
  });

  it('episode story plan は話者付きセリフの entityId 欠落や未登場話者を visible primary に補正する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = {
      ...buildEpisodePlanningContext(),
      entities: [
        ...buildEpisodePlanningContext().entities,
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Emile',
          entityType: 'character',
          freeDescription: 'Quiet white-haired boy.',
          promptSupplement: 'Soft face, careful eyes.',
          structuredFields: { character_identity: { aliases: [] } },
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Eloise',
          entityType: 'character',
          freeDescription: 'Calm team lead.',
          promptSupplement: 'Measured posture and composed eyes.',
          structuredFields: { character_identity: { aliases: [] } },
        },
      ],
    };
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler: EpisodePagePlanCompilerPort = {
      async compilePlan(): Promise<CompiledEpisodePagePlan> {
        return {
          suggestion: {
            pages: [
              {
                pageId: 'page-1',
                pageNumber: 1,
                sourceSceneIds: ['scene-1'],
                pagePurpose: 'Hold on Minerva as she absorbs the answer.',
                continuityNote: 'Keep the page quiet.',
                panels: [
                  {
                    order: 1,
                    situationText: 'Minerva lowers her eyes and tries to sort out what she just heard.',
                    entities: [
                      {
                        entityId: '11111111-1111-4111-8111-111111111111',
                        role: 'primary',
                        action: 'standing_firm',
                        position: 'center',
                        facingDirection: 'front',
                        expression: 'calm',
                        customAction: null,
                        customExpression: null,
                        effectNote: null,
                        stateId: null,
                      },
                    ],
                    dialogue: [
                      {
                        entityId: null,
                        text: 'ここで立ち止まるわけにはいかない。',
                        type: 'speech',
                        position: 'top',
                      },
                      {
                        entityId: '22222222-2222-4222-8222-222222222222',
                        text: '……まだ整理しきれない。',
                        type: 'thought',
                        position: 'top',
                      },
                      {
                        entityId: '33333333-3333-4333-8333-333333333333',
                        text: '前を見て！',
                        type: 'shout',
                        position: 'bottom',
                      },
                      {
                        entityId: null,
                        text: '声を落として。',
                        type: 'whisper',
                        position: 'left',
                      },
                      {
                        entityId: '22222222-2222-4222-8222-222222222222',
                        text: '朝の空気だけが静かだった。',
                        type: 'narration',
                        position: 'center',
                      },
                      {
                        entityId: null,
                        text: 'Minerva「ここで決める。」',
                        type: 'narration',
                        position: 'bottom',
                      },
                    ],
                  },
                ],
              },
            ],
          },
          compilerProvider: 'openai',
          compilerModel: 'gpt-5',
          compilerPromptVersion: 'episode_page_plan_v2',
        };
      },
    };
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      compiler,
    );

    await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(panelRepository.updatedPanels[0]?.input.dialogue).toEqual([
      expect.objectContaining({
        type: 'speech',
        entityId: '11111111-1111-4111-8111-111111111111',
        text: 'ここで立ち止まるわけにはいかない。',
      }),
      expect.objectContaining({
        type: 'thought',
        entityId: '11111111-1111-4111-8111-111111111111',
        text: '……まだ整理しきれない。',
      }),
      expect.objectContaining({
        type: 'shout',
        entityId: '11111111-1111-4111-8111-111111111111',
        text: '前を見て！',
      }),
      expect.objectContaining({
        type: 'whisper',
        entityId: '11111111-1111-4111-8111-111111111111',
        text: '声を落として。',
      }),
      expect.objectContaining({
        type: 'narration',
        entityId: null,
        text: '朝の空気だけが静かだった。',
      }),
      expect.objectContaining({
        type: 'speech',
        entityId: '11111111-1111-4111-8111-111111111111',
        text: 'ここで決める。',
      }),
    ]);
  });

  it('episode story plan は story lead がそのコマにいない場合は visible な page lead へ話者を補正する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = {
      ...buildEpisodePlanningContext(),
      entities: [
        ...buildEpisodePlanningContext().entities,
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Emile',
          entityType: 'character',
          freeDescription: 'Quiet white-haired boy.',
          promptSupplement: 'Soft face, careful eyes.',
          structuredFields: { character_identity: { aliases: [] } },
        },
      ],
    };
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler: EpisodePagePlanCompilerPort = {
      async compilePlan(): Promise<CompiledEpisodePagePlan> {
        return {
          suggestion: {
            pages: [
              {
                pageId: 'page-1',
                pageNumber: 1,
                sourceSceneIds: ['scene-1'],
                pagePurpose: 'Emile explains the next step while Minerva is off panel.',
                continuityNote: 'Keep the explanation focused on the visible speaker.',
                panels: [
                  {
                    order: 1,
                    situationText: 'Emile stands alone by the window and gives a quiet answer.',
                    entities: [
                      {
                        entityId: '22222222-2222-4222-8222-222222222222',
                        role: 'primary',
                        action: 'standing_firm',
                        position: 'center',
                        facingDirection: 'front',
                        expression: 'calm',
                        customAction: null,
                        customExpression: null,
                        effectNote: null,
                        stateId: null,
                      },
                    ],
                    dialogue: [
                      {
                        entityId: null,
                        text: 'ここから先は、君が選ぶことだ。',
                        type: 'speech',
                        position: 'top',
                      },
                    ],
                  },
                ],
              },
            ],
          },
          compilerProvider: 'openai',
          compilerModel: 'gpt-5',
          compilerPromptVersion: 'episode_page_plan_v2',
        };
      },
    };
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      compiler,
    );

    await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(panelRepository.updatedPanels[0]?.input.dialogue).toEqual([
      expect.objectContaining({
        type: 'speech',
        entityId: '22222222-2222-4222-8222-222222222222',
        text: 'ここから先は、君が選ぶことだ。',
      }),
    ]);
  });

  it('episode story plan は skeleton 上限を超えるページ数を compiler に渡さない', async () => {
    const pageRepository = new FakePageRepository();
    const compiler = new FakeEpisodePagePlanCompiler();
    const baseContext = buildEpisodePlanningContext();
    pageRepository.episodePlanningContext = {
      ...baseContext,
      pages: Array.from({ length: STORY_AI_LIMITS.maxSkeletonPages + 1 }, (_value, index) => ({
        ...baseContext.pages[0]!,
        pageId: `page-${index + 1}`,
        pageNumber: index + 1,
      })),
    };
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      compiler,
    );

    await expect(service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(compiler.lastInput).toBeNull();
  });

  it('episode story plan は page 主役が別にいる時 thought を visible primary ではなく page lead へ寄せる', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = {
      ...buildEpisodePlanningContext(),
      entities: [
        ...buildEpisodePlanningContext().entities,
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Emile',
          entityType: 'character',
          freeDescription: 'Quiet white-haired boy.',
          promptSupplement: 'Soft face, careful eyes.',
          structuredFields: { character_identity: { aliases: [] } },
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Eloise',
          entityType: 'character',
          freeDescription: 'Calm team lead.',
          promptSupplement: 'Measured posture and composed eyes.',
          structuredFields: { character_identity: { aliases: [] } },
        },
      ],
      pages: [
        {
          ...buildEpisodePlanningContext().pages[0],
          frameCount: 2,
          panels: [
            { ...buildAutofillPanelContext(), id: 'panel-1', order: 1 },
            { ...buildAutofillPanelContext(), id: 'panel-2', order: 2 },
          ],
        },
      ],
    };
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler: EpisodePagePlanCompilerPort = {
      async compilePlan(): Promise<CompiledEpisodePagePlan> {
        return {
          suggestion: {
            pages: [
              {
                pageId: 'page-1',
                pageNumber: 1,
                sourceSceneIds: ['scene-1'],
                pagePurpose: 'Keep Minerva as the point-of-view anchor.',
                continuityNote: 'Stay inside her reaction.',
                panels: [
                  {
                    order: 1,
                    situationText: 'Minerva listens in silence.',
                    entities: [
                      {
                        entityId: '11111111-1111-4111-8111-111111111111',
                        role: 'primary',
                        action: 'standing_firm',
                        position: 'center',
                        facingDirection: 'front',
                        expression: 'calm',
                        customAction: null,
                        customExpression: null,
                        effectNote: null,
                        stateId: null,
                      },
                    ],
                  },
                  {
                    order: 2,
                    situationText: 'Emile speaks while Minerva keeps absorbing the answer.',
                    entities: [
                      {
                        entityId: '22222222-2222-4222-8222-222222222222',
                        role: 'primary',
                        action: 'standing_firm',
                        position: 'left',
                        facingDirection: 'right',
                        expression: 'calm',
                        customAction: null,
                        customExpression: null,
                        effectNote: null,
                        stateId: null,
                      },
                      {
                        entityId: '11111111-1111-4111-8111-111111111111',
                        role: 'secondary',
                        action: 'standing_firm',
                        position: 'right',
                        facingDirection: 'left',
                        expression: 'calm',
                        customAction: null,
                        customExpression: null,
                        effectNote: null,
                        stateId: null,
                      },
                    ],
                    dialogue: [
                      {
                        entityId: '33333333-3333-4333-8333-333333333333',
                        text: '……まだ整理しきれない。',
                        type: 'thought',
                        position: 'top',
                      },
                    ],
                  },
                ],
              },
            ],
          },
          compilerProvider: 'openai',
          compilerModel: 'gpt-5',
          compilerPromptVersion: 'episode_page_plan_v2',
        };
      },
    };
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      compiler,
    );

    await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(panelRepository.updatedPanels[1]?.input.dialogue).toEqual([
      expect.objectContaining({
        type: 'thought',
        entityId: '11111111-1111-4111-8111-111111111111',
        text: '……まだ整理しきれない。',
      }),
    ]);
  });

  it('scene autofill は compiler failure 時に fallback 内容を保存しない', async () => {
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
    expect(result.updatedPanelCount).toBe(0);
    expect(result.filledFieldCount).toBe(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
    expect(assignmentService.updates).toHaveLength(0);
  });

  it('scene autofill は scene entity ids が空でも compiler failure 時に fallback 推定を保存しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.autofillContext = {
      ...buildAutofillContext(),
      episodePurpose: '澪 and エミール walk through headquarters while she questions what she has seen.',
      introduction: '澪 wakes up and エミール offers water.',
      middle: 'エミール explains the organization and 澪 keeps probing.',
      climax: '澪 asks why she was brought here, and エミール answers plainly.',
      endingHook: '澪 is still unsettled by what エミール implies.',
      scenes: [
        {
          id: 'scene-1',
          order: 1,
          location: 'Headquarters corridor',
          time: 'Morning',
          atmosphere: 'Tense and restrained',
          involvedEntityIds: [],
          entityStates: [],
        },
      ],
      entities: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: '澪',
          entityType: 'character',
          freeDescription: 'A wary new arrival.',
          promptSupplement: null,
          structuredFields: {},
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'エミール',
          entityType: 'character',
          freeDescription: 'A calm guide from another era.',
          promptSupplement: null,
          structuredFields: {},
        },
      ],
    };
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler = new FakePageAutofillCompiler();
    compiler.error = new ConfigurationError('compiler unavailable');
    const service = new PageService(pageRepository, panelRepository, assignmentService, compiler);

    const result = await service.autofillFromScenes('user-1', 'page-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(result.updatedPanelCount).toBe(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
    expect(assignmentService.updates).toHaveLength(0);
  });

  it('episode story plan は compiler failure 時に fallback 内容を保存しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = {
      ...buildEpisodePlanningContext(),
      episode: {
        title: '時の教条',
        purpose: '澪 is led through headquarters by エミール while she slowly grasps what 燦 is.',
        introduction: '澪 wakes up in a white room and エミール offers water.',
        middle: 'エミール guides 澪 through headquarters and explains the organization.',
        climax: '澪 challenges the idea of protecting history, and エミール answers without flinching.',
        endingHook: '澪 remains unsettled as エロイーズ finally steps in.',
        estimatedPages: 2,
      },
      scenes: [
        {
          id: 'scene-1',
          order: 1,
          location: 'Medical room',
          time: 'Morning',
          atmosphere: 'Quiet and uneasy',
          involvedEntityIds: [],
          entityStates: [],
        },
        {
          id: 'scene-2',
          order: 2,
          location: 'Headquarters corridor',
          time: 'Morning',
          atmosphere: 'Busy and tense',
          involvedEntityIds: [],
          entityStates: [],
        },
      ],
      entities: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: '澪',
          entityType: 'character',
          freeDescription: 'A wary new arrival.',
          promptSupplement: null,
          structuredFields: {},
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'エミール',
          entityType: 'character',
          freeDescription: 'A calm guide from another era.',
          promptSupplement: null,
          structuredFields: {},
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'エロイーズ',
          entityType: 'character',
          freeDescription: 'A composed squad leader.',
          promptSupplement: null,
          structuredFields: {},
        },
      ],
      pages: [
        {
          pageId: 'page-1',
          pageNumber: 1,
          frameCount: 1,
          layoutConfig: { type: 'template', template_id: 'splash_1', panel_count: 1 },
          status: 'editing',
          dialogueMode: 'mixed',
          pageDialogueToggle: true,
          panels: [buildAutofillPanelContext()],
        },
        {
          pageId: 'page-2',
          pageNumber: 2,
          frameCount: 1,
          layoutConfig: { type: 'template', template_id: 'splash_1', panel_count: 1 },
          status: 'editing',
          dialogueMode: 'mixed',
          pageDialogueToggle: true,
          panels: [buildAutofillPanelContext()],
        },
      ],
    };
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler: EpisodePagePlanCompilerPort = {
      async compilePlan(): Promise<CompiledEpisodePagePlan> {
        throw new ConfigurationError('episode planner unavailable');
      },
    };
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      compiler,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(result.compilerError).toBe('episode planner unavailable');
    expect(result.updatedPageCount).toBe(0);
    expect(result.updatedPanelCount).toBe(0);
    expect(result.updatedAssignmentCount).toBe(0);
    expect(result.filledFieldCount).toBe(0);
    expect(pageRepository.updatedInput).toBeNull();
    expect(panelRepository.updatedPanels).toHaveLength(0);
    expect(assignmentService.updates).toHaveLength(0);
  });

  it('episode story plan は compiler failure 時に既存 panel notes を上書きしない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = {
      ...buildEpisodePlanningContext(),
      pages: [
        {
          pageId: 'page-1',
          pageNumber: 1,
          frameCount: 1,
          layoutConfig: { type: 'template', template_id: 'splash_1', panel_count: 1 },
          status: 'editing',
          dialogueMode: 'mixed',
          pageDialogueToggle: true,
          panels: [
            {
              ...buildAutofillPanelContext(),
              panelNotes:
                'Focus this page on the current scene. Maintain the scene mood. Page 1 should read naturally into the next page.',
            },
          ],
        },
      ],
    };
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler: EpisodePagePlanCompilerPort = {
      async compilePlan(): Promise<CompiledEpisodePagePlan> {
        throw new ConfigurationError('episode planner unavailable');
      },
    };
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      compiler,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(result.updatedPanelCount).toBe(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
  });

  it('episode story plan は compiler failure 時に story beat fallback を保存しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = {
      ...buildEpisodePlanningContext(),
      episode: {
        title: '神木の朝',
        purpose: '澪が神木の朝を見て、この場所の日常の異質さを理解し始める。',
        introduction:
          '澪は宿舎の窓から中庭を見下ろす。 訓練する隊員たちや朝から動く工房が見える。 学校とは違う日常に息をのむ。 エロイーズが迎えに来る。',
        middle: null,
        climax: null,
        endingHook: null,
        estimatedPages: 1,
      },
      entities: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: '澪',
          entityType: 'character',
          freeDescription: 'A wary new arrival.',
          promptSupplement: null,
          structuredFields: {},
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'エロイーズ',
          entityType: 'character',
          freeDescription: 'A composed squad leader.',
          promptSupplement: null,
          structuredFields: {},
        },
      ],
      pages: [
        {
          pageId: 'page-1',
          pageNumber: 1,
          frameCount: 4,
          layoutConfig: { type: 'template', template_id: 'standard_4', panel_count: 4 },
          status: 'editing',
          dialogueMode: 'mixed',
          pageDialogueToggle: true,
          panels: [
            { ...buildAutofillPanelContext(), id: 'panel-1', order: 1 },
            { ...buildAutofillPanelContext(), id: 'panel-2', order: 2 },
            { ...buildAutofillPanelContext(), id: 'panel-3', order: 3 },
            { ...buildAutofillPanelContext(), id: 'panel-4', order: 4 },
          ],
        },
      ],
    };
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler: EpisodePagePlanCompilerPort = {
      async compilePlan(): Promise<CompiledEpisodePagePlan> {
        throw new ConfigurationError('episode planner unavailable');
      },
    };
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      compiler,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(result.updatedPanelCount).toBe(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
    expect(assignmentService.updates).toHaveLength(0);
  });

  it('episode story plan は compiler failure 時に暗黙の二人目 assignment を保存しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = {
      ...buildEpisodePlanningContext(),
      episode: {
        title: '神木の朝',
        purpose: '澪が神木の日常を見て、自分の立ち位置を理解し始める。',
        introduction:
          '澪は宿舎の窓から中庭を見下ろす。 訓練する隊員たちや朝から動く工房が見える。 学校とは違う日常に息をのむ。 澪はまだ何も分からないまま、神木の一日が始まるのを見ている。',
        middle: null,
        climax: null,
        endingHook: null,
        estimatedPages: 1,
      },
      entities: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: '澪',
          entityType: 'character',
          freeDescription: 'A wary new arrival.',
          promptSupplement: null,
          structuredFields: {},
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'エミール',
          entityType: 'character',
          freeDescription: 'A calm guide from another era.',
          promptSupplement: null,
          structuredFields: {},
        },
      ],
      pages: [
        {
          pageId: 'page-1',
          pageNumber: 1,
          frameCount: 4,
          layoutConfig: { type: 'template', template_id: 'standard_4', panel_count: 4 },
          status: 'editing',
          dialogueMode: 'mixed',
          pageDialogueToggle: true,
          panels: [
            { ...buildAutofillPanelContext(), id: 'panel-1', order: 1 },
            { ...buildAutofillPanelContext(), id: 'panel-2', order: 2 },
            { ...buildAutofillPanelContext(), id: 'panel-3', order: 3 },
            { ...buildAutofillPanelContext(), id: 'panel-4', order: 4 },
          ],
        },
      ],
    };
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler: EpisodePagePlanCompilerPort = {
      async compilePlan(): Promise<CompiledEpisodePagePlan> {
        throw new ConfigurationError('episode planner unavailable');
      },
    };
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      compiler,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(panelRepository.updatedPanels).toHaveLength(0);
    expect(assignmentService.updates).toHaveLength(0);
  });

  it('episode story plan は compiler failure 時に quoted noun 由来 dialogue を保存しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = {
      ...buildEpisodePlanningContext(),
      episode: {
        ...buildEpisodePlanningContext().episode,
        purpose: '「燦」と「影」という言葉だけが頭に残る。',
        introduction: '澪は「燦」という名を聞く。',
        middle: 'エミールは「影」に触れる。',
        climax: 'まだ全貌は見えない。',
        endingHook: '澪は無言のまま立ち尽くす。',
      },
    };
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler: EpisodePagePlanCompilerPort = {
      async compilePlan(): Promise<CompiledEpisodePagePlan> {
        throw new ConfigurationError('episode planner unavailable');
      },
    };
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      compiler,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(panelRepository.updatedPanels).toHaveLength(0);
    expect(assignmentService.updates).toHaveLength(0);
  });

  it('episode story plan は compiler failure 時に一般名詞の 影 assignment を保存しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = {
      ...buildEpisodePlanningContext(),
      episode: {
        ...buildEpisodePlanningContext().episode,
        purpose: '澪が影を見る能力を持つことをエミールが説明する。',
        introduction: '澪は自分だけが影を見ていることに戸惑う。',
        middle: '影は人に取り憑くが、ここではまだ正体を断定しない。',
        climax: 'エミールは影に関わる危険性を話す。',
        endingHook: '澪はまだ理解しきれないまま話を聞く。',
      },
      scenes: [
        {
          id: 'scene-1',
          order: 1,
          location: 'Corridor',
          time: 'Morning',
          atmosphere: 'Tense',
          involvedEntityIds: [],
          entityStates: [],
        },
      ],
      entities: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: '澪',
          entityType: 'character',
          freeDescription: 'A wary new arrival.',
          promptSupplement: null,
          structuredFields: {},
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'エミール',
          entityType: 'character',
          freeDescription: 'A calm guide from another era.',
          promptSupplement: null,
          structuredFields: {},
        },
        {
          id: 'shadow-entity',
          name: '影',
          entityType: 'character',
          freeDescription: 'A generic label that should not be inferred from prose alone.',
          promptSupplement: null,
          structuredFields: {},
        },
      ],
      pages: [
        {
          pageId: 'page-1',
          pageNumber: 1,
          frameCount: 1,
          layoutConfig: { type: 'template', template_id: 'splash_1', panel_count: 1 },
          status: 'editing',
          dialogueMode: 'mixed',
          pageDialogueToggle: true,
          panels: [buildAutofillPanelContext()],
        },
      ],
    };
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler: EpisodePagePlanCompilerPort = {
      async compilePlan(): Promise<CompiledEpisodePagePlan> {
        throw new ConfigurationError('episode planner unavailable');
      },
    };
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      compiler,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(panelRepository.updatedPanels).toHaveLength(0);
    expect(assignmentService.updates).toHaveLength(0);
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

  it('scene がなくても page autofill を実行する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.autofillContext = { ...buildAutofillContext(), scenes: [] };
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const compiler = new FakePageAutofillCompiler();
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      compiler,
    );

    const result = await service.autofillFromScenes('user-1', 'page-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(panelRepository.updatedPanels).toHaveLength(1);
    expect(assignmentService.updates).toHaveLength(1);
    const compilerBrief = compiler.lastInput?.compilerBrief ?? '';
    expect(compilerBrief).toContain('[SCENES]');
    expect(compilerBrief).toContain('(none)');
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
        structuredFields: { character_identity: { aliases: [] } },
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
        structuredFields: { character_identity: { aliases: [] } },
      },
    ],
    pages: [
      {
        pageId: 'page-1',
        pageNumber: 1,
        frameCount: 1,
        layoutConfig: { type: 'template', template_id: 'splash_1', panel_count: 1 },
        status: 'editing',
        dialogueMode: 'mixed',
        pageDialogueToggle: true,
        panels: [buildAutofillPanelContext()],
      },
    ],
  };
}

function buildMultiPageEpisodePlanningContext(pageCount: number): EpisodePagePlanContext {
  const base = buildEpisodePlanningContext();
  return {
    ...base,
    episode: {
      ...base.episode,
      estimatedPages: pageCount,
    },
    pages: Array.from({ length: pageCount }, (_value, index) => {
      const pageNumber = index + 1;
      return {
        ...base.pages[0]!,
        pageId: `page-${pageNumber}`,
        pageNumber,
        frameCount: 1,
        panels: [
          {
            ...buildAutofillPanelContext(),
            id: `panel-${pageNumber}`,
            order: 1,
          },
        ],
      };
    }),
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
