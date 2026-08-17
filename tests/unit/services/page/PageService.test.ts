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
  CompiledEpisodeBeatPlan,
  CompileEpisodeBeatPlanInput,
  EpisodeBeatPlanCompilerPort,
} from '../../../../src/services/page/EpisodeBeatPlanCompiler.js';
import type {
  CompiledEpisodePlanAudit,
  CompileEpisodePlanAuditInput,
  EpisodePlanAuditCompilerPort,
} from '../../../../src/services/page/EpisodePlanAuditCompiler.js';
import type {
  CompiledPageAutofillSuggestion,
  CompilePageAutofillInput,
  PageAutofillCompilerPort,
} from '../../../../src/services/page/PageAutofillCompiler.js';
import type { PanelEntityAssignmentServicePort } from '../../../../src/services/page/PanelEntityAssignmentService.js';
import type {
  EpisodePlanPersistencePort,
  EpisodePlanPersistenceResources,
  EpisodeSkeletonPlanPersistenceResources,
} from '../../../../src/services/page/EpisodePlanPersistence.js';
import {
  PageService,
  type EpisodePagePlanProgress,
} from '../../../../src/services/page/PageService.js';
import {
  fingerprintPageSkeletonSource,
  type PreparedPageSkeleton,
} from '../../../../src/services/story/PageSkeletonService.js';
import type { StoryRepository } from '../../../../src/repositories/StoryRepository.js';
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
  public episodePlanningContextReadCount = 0;
  public episodePlanningContextReadHook:
    | ((readCount: number, context: EpisodePagePlanContext | null) => EpisodePagePlanContext | null)
    | null = null;

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
    this.episodePlanningContextReadCount += 1;
    return this.episodePlanningContextReadHook === null
      ? this.episodePlanningContext
      : this.episodePlanningContextReadHook(
          this.episodePlanningContextReadCount,
          this.episodePlanningContext,
        );
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

class FakeEpisodePlanPersistence implements EpisodePlanPersistencePort {
  public calls: Array<{ episodeId: string; userId: string; organizationId: string | null }> = [];
  public skeletonResources: EpisodeSkeletonPlanPersistenceResources | null = null;

  public constructor(
    private readonly context: EpisodePagePlanContext,
    private readonly resources: EpisodePlanPersistenceResources,
  ) {}

  public async withLockedEpisodePlan<T>(
    input: { episodeId: string; userId: string; organizationId: string | null },
    work: (
      context: EpisodePagePlanContext,
      resources: EpisodePlanPersistenceResources,
    ) => Promise<T>,
  ): Promise<T> {
    this.calls.push(input);
    return work(this.context, this.resources);
  }

  public async withLockedEpisodeSkeletonPlan<T>(
    input: { episodeId: string; userId: string; organizationId: string | null },
    work: (resources: EpisodeSkeletonPlanPersistenceResources) => Promise<T>,
  ): Promise<T> {
    this.calls.push(input);
    if (this.skeletonResources === null) {
      throw new Error('skeleton resources not configured');
    }
    return work(this.skeletonResources);
  }
}

class FourPanelEpisodePagePlanCompiler extends ChunkAwareEpisodePagePlanCompiler {
  public override async compilePlan(
    input: CompileEpisodePagePlanInput,
  ): Promise<CompiledEpisodePagePlan> {
    const compiled = await super.compilePlan(input);
    return {
      ...compiled,
      suggestion: {
        pages: compiled.suggestion.pages.map((page) => ({
          ...page,
          panels: Array.from({ length: 4 }, (_value, index) => ({
            ...page.panels[0]!,
            order: index + 1,
            situationText: `Unique situation on page ${page.pageNumber}, panel ${index + 1}.`,
            composition: {
              ...page.panels[0]!.composition!,
              compositionPrompt: `Unique composition on page ${page.pageNumber}, panel ${index + 1}.`,
            },
            dialogue: [
              {
                entityId: '11111111-1111-4111-8111-111111111111',
                text: `Unique line on page ${page.pageNumber}, panel ${index + 1}.`,
                type: 'speech',
                position: 'top',
              },
            ],
            backgroundNote: `Unique background on page ${page.pageNumber}, panel ${index + 1}.`,
          })),
        })),
      },
    };
  }
}

class InvalidEntityEpisodePagePlanCompiler extends ChunkAwareEpisodePagePlanCompiler {
  public override async compilePlan(
    input: CompileEpisodePagePlanInput,
  ): Promise<CompiledEpisodePagePlan> {
    const compiled = await super.compilePlan(input);
    return {
      ...compiled,
      suggestion: {
        pages: compiled.suggestion.pages.map((page) => ({
          ...page,
          panels: page.panels.map((panel) => ({
            ...panel,
            entities: [
              {
                entityId: '99999999-9999-4999-8999-999999999999',
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
          })),
        })),
      },
    };
  }
}

class FakeEpisodeBeatPlanCompiler implements EpisodeBeatPlanCompilerPort {
  public inputs: CompileEpisodeBeatPlanInput[] = [];
  public pagesToReturn: CompiledEpisodeBeatPlan['plan']['pages'] | null = null;

  public async compileBeatPlan(
    input: CompileEpisodeBeatPlanInput,
  ): Promise<CompiledEpisodeBeatPlan> {
    this.inputs.push(input);
    const pageRefs = extractCompilerBriefPageRefs(input.compilerBrief);
    const pages =
      this.pagesToReturn ??
      pageRefs.map((page) => ({
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        storyBeats: [`Advance the unique story beat assigned to page ${page.pageNumber}.`],
        entryState: `State entering page ${page.pageNumber}.`,
        exitState: `State leaving page ${page.pageNumber}.`,
        newInformation: [`New information for page ${page.pageNumber}.`],
        dialogueIntent: `Dialogue intent for page ${page.pageNumber}.`,
        handoff: `Handoff from page ${page.pageNumber}.`,
      }));

    return {
      plan: { pages },
      compilerProvider: 'openai',
      compilerModel: 'gpt-5',
      compilerPromptVersion: 'episode_beat_plan_v1',
    };
  }
}

class FakeEpisodePlanAuditCompiler implements EpisodePlanAuditCompilerPort {
  public inputs: CompileEpisodePlanAuditInput[] = [];
  public audits: CompiledEpisodePlanAudit['audit'][] = [];
  public error: Error | null = null;
  public errors: Array<Error | null> = [];

  public async auditPlan(
    input: CompileEpisodePlanAuditInput,
  ): Promise<CompiledEpisodePlanAudit> {
    this.inputs.push(input);
    const callError = this.errors.shift();
    if (callError !== undefined && callError !== null) {
      throw callError;
    }
    if (this.error !== null) {
      throw this.error;
    }
    return {
      audit: this.audits.shift() ?? { accepted: true, issues: [] },
      compilerProvider: 'openai',
      compilerModel: 'gpt-5',
      compilerPromptVersion: 'episode_plan_audit_v1',
    };
  }
}

class DuplicateDialogueEpisodePagePlanCompiler extends ChunkAwareEpisodePagePlanCompiler {
  public repairDuplicate = true;

  public override async compilePlan(
    input: CompileEpisodePagePlanInput,
  ): Promise<CompiledEpisodePagePlan> {
    const compiled = await super.compilePlan(input);
    const isRepair = input.compilerBrief.includes('[REPAIR REQUIRED]');

    return {
      ...compiled,
      suggestion: {
        pages: compiled.suggestion.pages.map((page) => ({
          ...page,
          panels: page.panels.map((panel) => ({
            ...panel,
            dialogue: [
              {
                entityId: '11111111-1111-4111-8111-111111111111',
                text:
                  page.pageNumber === 1 || page.pageNumber === 4
                    ? isRepair && this.repairDuplicate
                      ? 'Page four now advances with a distinct response.'
                      : 'This repeated dialogue should be detected globally.'
                    : `Unique dialogue for page ${page.pageNumber}.`,
                type: 'speech',
                position: 'top',
              },
            ],
          })),
        })),
      },
    };
  }
}

class RepairTraceEpisodePagePlanCompiler extends ChunkAwareEpisodePagePlanCompiler {
  public override async compilePlan(
    input: CompileEpisodePagePlanInput,
  ): Promise<CompiledEpisodePagePlan> {
    const compiled = await super.compilePlan(input);
    if (!input.compilerBrief.includes('[REPAIR REQUIRED]')) {
      return compiled;
    }

    return {
      ...compiled,
      suggestion: {
        pages: compiled.suggestion.pages.map((page) => ({
          ...page,
          panels: page.panels.map((panel) => ({
            ...panel,
            situationText: `Repaired situation for page ${page.pageNumber}.`,
          })),
        })),
      },
    };
  }
}

function extractCompilerBriefPageRefs(
  compilerBrief: string,
): Array<{ pageId: string; pageNumber: number }> {
  return Array.from(
    compilerBrief.matchAll(/^Page (\d+) \(([^)]+)\)(?: \| frame_count=\d+)?$/gmu),
  ).map((match) => ({
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

  it('continuity v3 は全話台帳を一度作り、後続 chunk に既出ページを渡す', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(7);
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const episodeCompiler = new ChunkAwareEpisodePagePlanCompiler();
    const beatPlanCompiler = new FakeEpisodeBeatPlanCompiler();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    const progressEvents: EpisodePagePlanProgress[] = [];
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      beatPlanCompiler,
      auditCompiler,
      true,
    );

    const result = await service.autofillEpisodeFromStory(
      'user-1',
      'episode-1',
      'ja',
      async (progress) => {
        progressEvents.push(progress);
      },
    );

    expect(result.compilerUsed).toBe(true);
    expect(beatPlanCompiler.inputs).toHaveLength(1);
    expect(episodeCompiler.inputs).toHaveLength(3);
    expect(episodeCompiler.inputs[0]?.compilerBrief).toContain('[GLOBAL EPISODE LEDGER]');
    expect(episodeCompiler.inputs[1]?.compilerBrief).toContain('[ALREADY COMPILED PAGES]');
    expect(episodeCompiler.inputs[1]?.compilerBrief).toContain('Page 1 (page-1)');
    expect(episodeCompiler.inputs[1]?.compilerBrief).toContain('[FUTURE RESERVED BEATS]');
    expect(auditCompiler.inputs).toHaveLength(1);
    expect(auditCompiler.inputs[0]?.pageIds).toEqual([
      'page-1',
      'page-2',
      'page-3',
      'page-4',
      'page-5',
      'page-6',
      'page-7',
    ]);
    expect(progressEvents.find((progress) => progress.stage === 'auditing_episode')).toMatchObject({
      currentChunk: null,
      totalChunks: null,
    });
    expect(pageRepository.episodePlanningContextReadCount).toBe(2);
    expect(panelRepository.updatedPanels).toHaveLength(7);
  });

  it('continuity v3 の監査応答が回復不能な場合はページとコマを保存しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.error = new ConfigurationError(
      'OpenAI episode plan audit compiler returned invalid JSON',
    );
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      new ChunkAwareEpisodePagePlanCompiler(),
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true },
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(result.compilerError).toContain('returned invalid JSON');
    expect(pageRepository.updatedInputs).toHaveLength(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
    expect(assignmentService.updates).toHaveLength(0);
  });

  it('adaptive packing 有効時は4コマ10ページを出力量に応じた2つのpackで処理する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = {
      ...buildMultiPageEpisodePlanningContext(10),
      pages: buildMultiPageEpisodePlanningContext(10).pages.map((page) => ({
        ...page,
        frameCount: 4,
        layoutConfig: { type: 'template', template_id: 'standard_4', panel_count: 4 },
        panels: Array.from({ length: 4 }, (_value, index) => ({
          ...buildAutofillPanelContext(),
          id: `panel-${page.pageNumber}-${index + 1}`,
          order: index + 1,
        })),
      })),
    };
    const episodeCompiler = new FourPanelEpisodePagePlanCompiler();
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      new FakeEpisodePlanAuditCompiler(),
      true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true },
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(episodeCompiler.inputs).toHaveLength(2);
    const firstCurrentPages = episodeCompiler.inputs[0]?.compilerBrief.split(
      '[TEXT FIELD EXPECTATIONS]',
    )[0] ?? '';
    const secondCurrentPages = episodeCompiler.inputs[1]?.compilerBrief.split(
      '[TEXT FIELD EXPECTATIONS]',
    )[0] ?? '';
    expect(firstCurrentPages).toContain('Page 5 (page-5)');
    expect(firstCurrentPages).not.toContain('Page 6 (page-6)');
    expect(secondCurrentPages).toContain('Page 10 (page-10)');
  });

  it('inline repair 有効時はwarningだけの監査結果を保存し再コンパイルしない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const episodeCompiler = new ChunkAwareEpisodePagePlanCompiler();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.audits = [
      {
        accepted: true,
        issues: [
          {
            code: 'duplicate_visual_beat',
            severity: 'warning',
            pageIds: ['page-4'],
            message: 'The visual rhythm could vary further.',
            repairInstruction: 'Consider a different framing later.',
          },
        ],
      },
    ];
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true },
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(episodeCompiler.inputs).toHaveLength(1);
    expect(auditCompiler.inputs).toHaveLength(1);
  });

  it('inline repair 無効時もwarningだけの監査結果を保存し再コンパイルしない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const episodeCompiler = new ChunkAwareEpisodePagePlanCompiler();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.audits = [
      {
        accepted: true,
        issues: [
          {
            code: 'duplicate_visual_beat',
            severity: 'warning',
            pageIds: ['page-4'],
            message: 'The visual rhythm could vary further.',
            repairInstruction: 'Consider a different framing later.',
          },
        ],
      },
    ];
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(episodeCompiler.inputs).toHaveLength(2);
    expect(auditCompiler.inputs).toHaveLength(1);
  });

  it('inline repair 無効時はerrorのあるchunkだけを修復してwarningのchunkを変更しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const episodeCompiler = new ChunkAwareEpisodePagePlanCompiler();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.audits = [
      {
        accepted: false,
        issues: [
          {
            code: 'timeline_discontinuity',
            severity: 'error',
            pageIds: ['page-1'],
            message: 'Page 1 starts from the wrong state.',
            repairInstruction: 'Restore the assigned entry state.',
          },
          {
            code: 'duplicate_visual_beat',
            severity: 'warning',
            pageIds: ['page-4'],
            message: 'The visual rhythm could vary further.',
            repairInstruction: 'Consider a different framing later.',
          },
        ],
      },
      { accepted: true, issues: [] },
    ];
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(episodeCompiler.inputs).toHaveLength(3);
    expect(episodeCompiler.inputs[2]?.compilerBrief).toContain('[REPAIR REQUIRED]');
    const repairInstructions =
      episodeCompiler.inputs[2]?.compilerBrief.split('[REPAIR REQUIRED]')[1] ?? '';
    expect(repairInstructions).toContain('page-1');
    expect(repairInstructions).not.toContain('page-4');
    expect(repairInstructions).not.toContain('duplicate_visual_beat');
    expect(auditCompiler.inputs).toHaveLength(2);
  });

  it('inline repair 無効時は修復後にwarningだけが残っても保存する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const episodeCompiler = new ChunkAwareEpisodePagePlanCompiler();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.audits = [
      {
        accepted: false,
        issues: [
          {
            code: 'timeline_discontinuity',
            severity: 'error',
            pageIds: ['page-1'],
            message: 'Page 1 starts from the wrong state.',
            repairInstruction: 'Restore the assigned entry state.',
          },
        ],
      },
      {
        accepted: true,
        issues: [
          {
            code: 'duplicate_visual_beat',
            severity: 'warning',
            pageIds: ['page-1'],
            message: 'The visual rhythm could vary further.',
            repairInstruction: 'Consider a different framing later.',
          },
        ],
      },
    ];
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(episodeCompiler.inputs).toHaveLength(3);
    expect(auditCompiler.inputs).toHaveLength(2);
  });

  it('inline repair 有効時は監査が指定したfieldだけを直してdetail compilerを再実行しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const episodeCompiler = new ChunkAwareEpisodePagePlanCompiler();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.audits = [
      {
        accepted: false,
        issues: [
          {
            code: 'timeline_discontinuity',
            severity: 'error',
            pageIds: ['page-2'],
            message: 'Page 2 rewinds the scene.',
            repairInstruction: 'Continue from page 1.',
          },
        ],
        panelRepairs: [
          {
            pageId: 'page-2',
            panelOrder: 1,
            changedFields: ['situationText'],
            patch: { situationText: 'Page 2 continues directly from page 1.' },
          },
        ],
      },
      { accepted: true, issues: [] },
    ];
    const service = new PageService(
      pageRepository,
      panelRepository,
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true },
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(episodeCompiler.inputs).toHaveLength(1);
    expect(auditCompiler.inputs).toHaveLength(2);
    expect(
      panelRepository.updatedPanels.find((update) => update.panelId === 'panel-2')?.input
        .situationText,
    ).toContain('Page 2 continues directly from page 1');
  });

  it('inline repair 有効時は2回目監査の修復を最後に適用し3回目監査なしで保存する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const episodeCompiler = new ChunkAwareEpisodePagePlanCompiler();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.audits = [
      {
        accepted: false,
        issues: [
          {
            code: 'duplicate_dialogue',
            severity: 'error',
            pageIds: ['page-2'],
            message: 'Page 2 repeats an earlier line.',
            repairInstruction: 'Replace the repeated line with a new response.',
          },
        ],
        panelRepairs: [
          {
            pageId: 'page-2',
            panelOrder: 1,
            changedFields: ['dialogue'],
            patch: {
              dialogue: [
                {
                  entityId: '11111111-1111-4111-8111-111111111111',
                  text: 'Page 2 now advances the conversation.',
                  type: 'speech',
                  position: 'top',
                },
              ],
            },
          },
        ],
      },
      {
        accepted: false,
        issues: [
          {
            code: 'unsupported_story_fact',
            severity: 'error',
            pageIds: ['page-3'],
            message: 'Page 3 invents an unsupported event.',
            repairInstruction: 'Restore the event described by the story ledger.',
          },
          {
            code: 'dialogue_misplacement',
            severity: 'error',
            pageIds: ['page-4'],
            message: 'Page 4 places the response before its trigger.',
            repairInstruction: 'Move the response after the trigger.',
          },
        ],
        panelRepairs: [
          {
            pageId: 'page-3',
            panelOrder: 1,
            changedFields: ['situationText'],
            patch: { situationText: 'Page 3 follows the event assigned by the story ledger.' },
          },
          {
            pageId: 'page-4',
            panelOrder: 1,
            changedFields: ['dialogue'],
            patch: {
              dialogue: [
                {
                  entityId: '11111111-1111-4111-8111-111111111111',
                  text: 'Page 4 responds after the preceding action.',
                  type: 'speech',
                  position: 'top',
                },
              ],
            },
          },
        ],
      },
    ];
    const service = new PageService(
      pageRepository,
      panelRepository,
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true },
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(episodeCompiler.inputs).toHaveLength(1);
    expect(auditCompiler.inputs).toHaveLength(2);
    expect(pageRepository.updatedInputs).toHaveLength(4);
    expect(
      panelRepository.updatedPanels.find((update) => update.panelId === 'panel-3')?.input
        .situationText,
    ).toContain('Page 3 follows the event assigned by the story ledger');
    expect(
      panelRepository.updatedPanels.find((update) => update.panelId === 'panel-4')?.input
        .dialogue?.[0]?.text,
    ).toBe('Page 4 responds after the preceding action.');
  });

  it('inline repair 有効時は2回目監査の意味的指摘だけで修復案がなければ全体を破棄しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    const finalIssue = {
      code: 'unsupported_story_fact' as const,
      severity: 'error' as const,
      pageIds: ['page-3'],
      message: 'Page 3 still invents an unsupported event.',
      repairInstruction: 'Restore the event described by the story ledger.',
    };
    auditCompiler.audits = [
      {
        accepted: false,
        issues: [
          {
            code: 'duplicate_dialogue',
            severity: 'error',
            pageIds: ['page-2'],
            message: 'Page 2 repeats an earlier line.',
            repairInstruction: 'Replace the repeated line.',
          },
        ],
        panelRepairs: [
          {
            pageId: 'page-2',
            panelOrder: 1,
            changedFields: ['dialogue'],
            patch: { dialogue: [] },
          },
        ],
      },
      {
        accepted: false,
        issues: [finalIssue],
      },
    ];
    const service = new PageService(
      pageRepository,
      panelRepository,
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      new ChunkAwareEpisodePagePlanCompiler(),
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true },
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(auditCompiler.inputs).toHaveLength(2);
    expect(pageRepository.updatedInputs).toHaveLength(4);
    expect(panelRepository.updatedPanels.length).toBeGreaterThan(0);
  });

  it('inline repair 有効時は修復後の2回目監査が壊れても決定的検証を通れば保存する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.errors = [
      null,
      new ConfigurationError('OpenAI episode plan audit compiler returned invalid JSON'),
    ];
    auditCompiler.audits = [
      {
        accepted: false,
        issues: [
          {
            code: 'timeline_discontinuity',
            severity: 'error',
            pageIds: ['page-2'],
            message: 'Page 2 rewinds the scene.',
            repairInstruction: 'Continue from page 1.',
          },
        ],
        panelRepairs: [
          {
            pageId: 'page-2',
            panelOrder: 1,
            changedFields: ['situationText'],
            patch: { situationText: 'Page 2 continues directly from page 1.' },
          },
        ],
      },
    ];
    const service = new PageService(
      pageRepository,
      panelRepository,
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      new ChunkAwareEpisodePagePlanCompiler(),
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true },
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(auditCompiler.inputs).toHaveLength(2);
    expect(pageRepository.updatedInputs).toHaveLength(4);
    expect(
      panelRepository.updatedPanels.find((update) => update.panelId === 'panel-2')?.input
        .situationText,
    ).toContain('Page 2 continues directly from page 1');
  });

  it('inline repair 有効時も有界修復後に決定的な重複が残れば保存しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.audits = [
      {
        accepted: false,
        issues: [
          {
            code: 'duplicate_dialogue',
            severity: 'error',
            pageIds: ['page-4'],
            message: 'Page 4 repeats page 1.',
            repairInstruction: 'Replace the repeated line.',
          },
        ],
        panelRepairs: [
          {
            pageId: 'page-4',
            panelOrder: 1,
            changedFields: ['dialogue'],
            patch: {
              dialogue: [
                {
                  entityId: '11111111-1111-4111-8111-111111111111',
                  text: 'This repeated dialogue should be detected globally.',
                  type: 'speech',
                  position: 'top',
                },
              ],
            },
          },
        ],
      },
      { accepted: true, issues: [] },
    ];
    const service = new PageService(
      pageRepository,
      panelRepository,
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      new DuplicateDialogueEpisodePagePlanCompiler(),
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true },
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(result.compilerError).toContain('deterministic verification');
    expect(auditCompiler.inputs).toHaveLength(2);
    expect(pageRepository.updatedInputs).toHaveLength(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
  });

  it('inline repair 有効時は2回目監査の不正な修復案を拒否する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.audits = [
      {
        accepted: false,
        issues: [
          {
            code: 'timeline_discontinuity',
            severity: 'error',
            pageIds: ['page-2'],
            message: 'Page 2 rewinds the scene.',
            repairInstruction: 'Continue from page 1.',
          },
        ],
        panelRepairs: [
          {
            pageId: 'page-2',
            panelOrder: 1,
            changedFields: ['situationText'],
            patch: { situationText: 'Page 2 continues directly from page 1.' },
          },
        ],
      },
      {
        accepted: false,
        issues: [
          {
            code: 'unsupported_story_fact',
            severity: 'error',
            pageIds: ['page-3'],
            message: 'Page 3 still invents an unsupported event.',
            repairInstruction: 'Restore the source event.',
          },
        ],
        panelRepairs: [
          {
            pageId: 'unknown-page',
            panelOrder: 1,
            changedFields: ['situationText'],
            patch: { situationText: 'This invalid repair must never be applied.' },
          },
        ],
      },
    ];
    const service = new PageService(
      pageRepository,
      panelRepository,
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      new ChunkAwareEpisodePagePlanCompiler(),
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true },
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(result.compilerError).toContain('unknown page');
    expect(auditCompiler.inputs).toHaveLength(2);
    expect(pageRepository.updatedInputs).toHaveLength(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
  });

  it('inline repair 有効時は修復情報のないerrorを保存しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.audits = [
      {
        accepted: false,
        issues: [
          {
            code: 'page_handoff_break',
            severity: 'error',
            pageIds: ['page-3'],
            message: 'Page 3 loses the prior state.',
            repairInstruction: 'Continue from page 2.',
          },
        ],
      },
    ];
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      new ChunkAwareEpisodePagePlanCompiler(),
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true },
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(result.compilerError).toContain('field-level repair');
    expect(pageRepository.updatedInputs).toHaveLength(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
    expect(assignmentService.updates).toHaveLength(0);
  });

  it('continuity v3 は全ページ重複セリフを検知して該当 chunk だけ一度修復する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const episodeCompiler = new DuplicateDialogueEpisodePagePlanCompiler();
    const beatPlanCompiler = new FakeEpisodeBeatPlanCompiler();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      beatPlanCompiler,
      auditCompiler,
      true,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(episodeCompiler.inputs).toHaveLength(3);
    expect(episodeCompiler.inputs[2]?.compilerBrief).toContain('[REPAIR REQUIRED]');
    expect(episodeCompiler.inputs[2]?.compilerBrief).toContain('[CURRENT CHUNK DRAFT TO REPAIR]');
    expect(episodeCompiler.inputs[2]?.compilerBrief).toContain('page-4');
    expect(auditCompiler.inputs).toHaveLength(2);
    const pageFourUpdate = panelRepository.updatedPanels.find(
      (update) => update.panelId === 'panel-4',
    );
    expect(pageFourUpdate?.input.dialogue?.[0]?.text).toBe(
      'Page four now advances with a distinct response.',
    );
  });

  it('continuity v3 は複数 chunk 修復時に直前の修復結果を次の chunk へ渡す', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(7);
    const episodeCompiler = new RepairTraceEpisodePagePlanCompiler();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.audits = [
      {
        accepted: false,
        issues: [
          {
            code: 'timeline_discontinuity',
            severity: 'error',
            pageIds: ['page-4'],
            message: 'Page 4 rewinds the timeline.',
            repairInstruction: 'Continue from page 3 without rewinding.',
          },
          {
            code: 'page_handoff_break',
            severity: 'error',
            pageIds: ['page-7'],
            message: 'Page 7 ignores the repaired handoff.',
            repairInstruction: 'Continue from the latest repaired state.',
          },
        ],
      },
      { accepted: true, issues: [] },
    ];
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(episodeCompiler.inputs).toHaveLength(5);
    expect(episodeCompiler.inputs[4]?.compilerBrief).toContain(
      'situation=Repaired situation for page 4.',
    );
  });

  it('continuity v3 は前半 chunk の修復時にも後続ページの確定案を参照する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const episodeCompiler = new RepairTraceEpisodePagePlanCompiler();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.audits = [
      {
        accepted: false,
        issues: [
          {
            code: 'page_handoff_break',
            severity: 'error',
            pageIds: ['page-1'],
            message: 'Page 1 does not hand off cleanly to page 4.',
            repairInstruction: 'Repair page 1 while preserving the later compiled destination.',
          },
        ],
      },
      { accepted: true, issues: [] },
    ];
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(episodeCompiler.inputs).toHaveLength(3);
    expect(episodeCompiler.inputs[2]?.compilerBrief).toContain('[ALREADY COMPILED PAGES]');
    expect(episodeCompiler.inputs[2]?.compilerBrief).toContain('Page 4 (page-4)');
    expect(episodeCompiler.inputs[2]?.compilerBrief).toContain(
      'situation=Minerva advances the beat on page 4.',
    );
  });

  it('continuity v3 は修復対象でない同一 chunk のページを変更しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const episodeCompiler = new RepairTraceEpisodePagePlanCompiler();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.audits = [
      {
        accepted: false,
        issues: [
          {
            code: 'timeline_discontinuity',
            severity: 'error',
            pageIds: ['page-2'],
            message: 'Page 2 rewinds the timeline.',
            repairInstruction: 'Continue page 2 from page 1 without changing adjacent pages.',
          },
        ],
      },
      { accepted: true, issues: [] },
    ];
    const service = new PageService(
      pageRepository,
      panelRepository,
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'en');

    expect(result.compilerUsed).toBe(true);
    expect(panelRepository.updatedPanels.find((update) => update.panelId === 'panel-1')?.input.situationText)
      .toBe('Minerva advances the beat on page 1.');
    expect(panelRepository.updatedPanels.find((update) => update.panelId === 'panel-2')?.input.situationText)
      .toContain('Repaired situation for page 2.');
    expect(panelRepository.updatedPanels.find((update) => update.panelId === 'panel-3')?.input.situationText)
      .toBe('Minerva advances the beat on page 3.');
  });

  it('continuity v3 は修復後も重複が残る場合に何も保存しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const episodeCompiler = new DuplicateDialogueEpisodePagePlanCompiler();
    episodeCompiler.repairDuplicate = false;
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      new FakeEpisodePlanAuditCompiler(),
      true,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(result.compilerError).toContain('continuity audit');
    expect(pageRepository.updatedInputs).toHaveLength(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
    expect(assignmentService.updates).toHaveLength(0);
  });

  it('continuity v3 は処理中に編集内容が変わった場合に上書きしない', async () => {
    const pageRepository = new FakePageRepository();
    const originalContext = buildMultiPageEpisodePlanningContext(4);
    pageRepository.episodePlanningContext = originalContext;
    pageRepository.episodePlanningContextReadHook = (readCount, context) =>
      readCount === 1 || context === null
        ? context
        : {
            ...context,
            episode: {
              ...context.episode,
              middle: 'The user edited this story while compilation was running.',
            },
          };
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      new ChunkAwareEpisodePagePlanCompiler(),
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      new FakeEpisodePlanAuditCompiler(),
      true,
    );

    await expect(
      service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja'),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(pageRepository.updatedInputs).toHaveLength(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
    expect(assignmentService.updates).toHaveLength(0);
  });

  it('continuity v3 は確定時のロック済みコンテキストへ全更新を委譲する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildEpisodePlanningContext();
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const transactionPageRepository = new FakePageRepository();
    transactionPageRepository.episodePlanningContext = buildEpisodePlanningContext();
    const transactionPanelRepository = new FakePanelRepository();
    const transactionAssignmentService = new FakePanelEntityAssignmentService();
    const persistence = new FakeEpisodePlanPersistence(
      buildEpisodePlanningContext(),
      {
        pageRepository: transactionPageRepository,
        panelRepository: transactionPanelRepository,
        panelEntityAssignmentService: transactionAssignmentService,
      },
    );
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      new FakeEpisodePagePlanCompiler(),
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      new FakeEpisodePlanAuditCompiler(),
      true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true },
      persistence,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(persistence.calls).toEqual([
      { episodeId: 'episode-1', userId: 'user-1', organizationId: null },
    ]);
    expect(pageRepository.updatedInputs).toHaveLength(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
    expect(assignmentService.updates).toHaveLength(0);
    expect(transactionPageRepository.updatedInputs.length).toBeGreaterThan(0);
    expect(transactionPanelRepository.updatedPanels.length).toBeGreaterThan(0);
    expect(transactionAssignmentService.updates.length).toBeGreaterThan(0);
  });

  it('キャンセル制御付きの処理は機能フラグが無効でも原子的保存へ委譲する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildEpisodePlanningContext();
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const transactionPageRepository = new FakePageRepository();
    transactionPageRepository.episodePlanningContext = buildEpisodePlanningContext();
    const persistence = new FakeEpisodePlanPersistence(
      buildEpisodePlanningContext(),
      {
        pageRepository: transactionPageRepository,
        panelRepository: new FakePanelRepository(),
        panelEntityAssignmentService: new FakePanelEntityAssignmentService(),
      },
    );
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      new FakeEpisodePagePlanCompiler(),
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      new FakeEpisodePlanAuditCompiler(),
      false,
      {},
      persistence,
    );

    await service.autofillEpisodeFromStory(
      'user-1',
      'episode-1',
      'ja',
      undefined,
      null,
      {
        checkpoint: async () => undefined,
        beginCommit: async () => undefined,
      },
    );

    expect(persistence.calls).toEqual([
      { episodeId: 'episode-1', userId: 'user-1', organizationId: null },
    ]);
    expect(pageRepository.updatedInputs).toHaveLength(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
    expect(assignmentService.updates).toHaveLength(0);
  });

  it('continuity v3 は全ページを一意に割り当てない台帳を保存しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const episodeCompiler = new ChunkAwareEpisodePagePlanCompiler();
    const beatPlanCompiler = new FakeEpisodeBeatPlanCompiler();
    beatPlanCompiler.pagesToReturn = [
      {
        pageId: 'page-1',
        pageNumber: 1,
        storyBeats: ['Only the first page was assigned.'],
        entryState: 'Start.',
        exitState: 'Still at the start.',
        newInformation: ['None.'],
        dialogueIntent: null,
        handoff: null,
      },
    ];
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      beatPlanCompiler,
      new FakeEpisodePlanAuditCompiler(),
      true,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(result.compilerError).toContain('every existing page exactly once');
    expect(episodeCompiler.inputs).toHaveLength(0);
    expect(pageRepository.updatedInputs).toHaveLength(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
  });

  it('continuity v3 は同じ story beat を複数ページへ割り当てた台帳を保存しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const beatPlanCompiler = new FakeEpisodeBeatPlanCompiler();
    beatPlanCompiler.pagesToReturn = buildMultiPageEpisodePlanningContext(4).pages.map((page) => ({
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      storyBeats: ['The exact same long story beat is assigned more than once.'],
      entryState: `Entry state ${page.pageNumber}.`,
      exitState: `Exit state ${page.pageNumber}.`,
      newInformation: [`New information ${page.pageNumber}.`],
      dialogueIntent: null,
      handoff: null,
    }));
    const episodeCompiler = new ChunkAwareEpisodePagePlanCompiler();
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      beatPlanCompiler,
      new FakeEpisodePlanAuditCompiler(),
      true,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(result.compilerError).toContain('duplicate story beat');
    expect(episodeCompiler.inputs).toHaveLength(0);
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

  it('continuity v3 の全体台帳 brief も長い story context を圧縮する', async () => {
    const pageRepository = new FakePageRepository();
    const longIntroduction = 'continuity-v3-overflow-intro '.repeat(100).trim();
    pageRepository.episodePlanningContext = {
      ...buildMultiPageEpisodePlanningContext(4),
      episode: {
        ...buildMultiPageEpisodePlanningContext(4).episode,
        introduction: longIntroduction,
      },
      scenes: Array.from({ length: 60 }, (_unused, index) => ({
        id: `scene-${index + 1}`,
        order: index + 1,
        location: `Continuity corridor ${index + 1}`,
        time: 'Night',
        atmosphere: `continuity-v3-overflow-scene ${index + 1}`,
        involvedEntityIds: ['11111111-1111-4111-8111-111111111111'],
        entityStates: [],
      })),
    };
    const beatPlanCompiler = new FakeEpisodeBeatPlanCompiler();
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      new ChunkAwareEpisodePagePlanCompiler(),
      undefined,
      beatPlanCompiler,
      new FakeEpisodePlanAuditCompiler(),
      true,
    );

    await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    const compilerBrief = beatPlanCompiler.inputs[0]?.compilerBrief ?? '';
    expect(compilerBrief).toContain('continuity-v3-overflow-intro');
    expect(compilerBrief).not.toContain(longIntroduction);
    expect(compilerBrief).toContain('Scene 40');
    expect(compilerBrief).not.toContain('Scene 41');
    expect(compilerBrief).not.toContain('Scene 60');
  });

  it('continuity v3 の全体台帳 brief は API が許可する story 区間の末尾まで保持する', async () => {
    const pageRepository = new FakePageRepository();
    const legalIntroduction = `${'導入の出来事。'.repeat(230)}末尾で主人公が鍵を拾う。`;
    expect(legalIntroduction.length).toBeLessThanOrEqual(2_000);
    pageRepository.episodePlanningContext = {
      ...buildMultiPageEpisodePlanningContext(4),
      episode: {
        ...buildMultiPageEpisodePlanningContext(4).episode,
        introduction: legalIntroduction,
      },
    };
    const beatPlanCompiler = new FakeEpisodeBeatPlanCompiler();
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      new ChunkAwareEpisodePagePlanCompiler(),
      undefined,
      beatPlanCompiler,
      new FakeEpisodePlanAuditCompiler(),
      true,
    );

    await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    const compilerBrief = beatPlanCompiler.inputs[0]?.compilerBrief ?? '';
    expect(compilerBrief).toContain('末尾で主人公が鍵を拾う。');
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

  it('未保存骨格のプランを検証後に骨格置換と設定反映を一つのatomic callbackで完了する', async () => {
    const sourceContext = {
      ...buildEpisodePlanningContext(),
      episode: { ...buildEpisodePlanningContext().episode, estimatedPages: 1 },
      pages: [],
    };
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = sourceContext;
    const transactionPageRepository = new FakePageRepository();
    transactionPageRepository.episodePlanningContext = sourceContext;
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const persistence = new FakeEpisodePlanPersistence(
      sourceContext,
      { pageRepository, panelRepository, panelEntityAssignmentService: assignmentService },
    );
    const compiler = new ChunkAwareEpisodePagePlanCompiler();
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      undefined,
      compiler,
      undefined,
      undefined,
      undefined,
      false,
      {},
      persistence,
    );
    const skeleton = buildPreparedPageSkeleton();
    const preparedPlan = await service.prepareEpisodePlanForSkeleton(
      'user-1',
      'episode-1',
      skeleton,
      'ja',
    );
    let skeletonCreateCount = 0;
    const storyRepository = {
      findEpisodePageSkeletonContextByIdAndUserId: async () => skeleton.context,
      createPageSkeleton: async () => {
        skeletonCreateCount += 1;
        transactionPageRepository.episodePlanningContext = {
          ...preparedPlan.virtualContext,
          pages: preparedPlan.virtualContext.pages.map((page) => ({
            ...page,
            pageId: `actual-${page.pageNumber}`,
            panels: page.panels.map((panel) => ({ ...panel, id: `actual-panel-${panel.order}` })),
          })),
        };
        return { pagesCreated: 1, panelsCreated: 1, replacedExisting: true };
      },
    } as unknown as StoryRepository;
    persistence.skeletonResources = {
      storyRepository,
      pageRepository: transactionPageRepository,
      panelRepository,
      panelEntityAssignmentService: assignmentService,
    };
    let beginCommitCount = 0;

    const result = await service.commitPreparedEpisodeSkeletonPlan(
      'user-1',
      skeleton,
      preparedPlan,
      true,
      null,
      {
        checkpoint: async () => undefined,
        beginCommit: async () => { beginCommitCount += 1; },
      },
    );

    expect(skeletonCreateCount).toBe(1);
    expect(beginCommitCount).toBe(1);
    expect(result.skeletonResult).toEqual({
      pagesCreated: 1,
      panelsCreated: 1,
      replacedExisting: true,
    });
    expect(result.storyPlanResult.compilerUsed).toBe(true);
    expect(panelRepository.updatedPanels[0]?.panelId).toBe('actual-panel-1');

    await expect(
      service.commitPreparedEpisodeSkeletonPlan(
        'user-1',
        skeleton,
        preparedPlan,
        true,
        null,
        {
          checkpoint: async () => undefined,
          beginCommit: async () => { beginCommitCount += 1; },
        },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(skeletonCreateCount).toBe(1);
    expect(beginCommitCount).toBe(1);
  });

  it('未保存骨格向けAI出力が不正な場合はatomic commitへ入る前に拒否する', async () => {
    const sourceContext = {
      ...buildEpisodePlanningContext(),
      episode: { ...buildEpisodePlanningContext().episode, estimatedPages: 1 },
      pages: [],
    };
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = sourceContext;
    const persistence = new FakeEpisodePlanPersistence(
      sourceContext,
      {
        pageRepository,
        panelRepository: new FakePanelRepository(),
        panelEntityAssignmentService: new FakePanelEntityAssignmentService(),
      },
    );
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      undefined,
      new InvalidEntityEpisodePagePlanCompiler(),
      undefined,
      undefined,
      undefined,
      false,
      {},
      persistence,
    );

    await expect(
      service.prepareEpisodePlanForSkeleton(
        'user-1',
        'episode-1',
        buildPreparedPageSkeleton(),
        'ja',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(persistence.calls).toEqual([]);
  });
});

function buildPreparedPageSkeleton(): PreparedPageSkeleton {
  const context: PreparedPageSkeleton['context'] = {
      episodeId: 'episode-1',
      chapterId: 'chapter-1',
      workId: 'work-1',
      workTitle: 'Lyra',
      workGenre: null,
      worldSetting: null,
      theme: null,
      chapterTitle: 'Midnight Rooftop',
      chapterPurpose: 'Raise the stakes without breaking the secret meeting tone.',
      episodeTitle: 'The Rooftop Meeting',
      episodePurpose: 'Show the rivals testing each other in secret.',
      introduction: 'The rooftop meeting begins quietly.',
      middle: 'Tension rises under the moonlight.',
      climax: 'They realize neither can back down.',
      endingHook: 'One smile makes the other uneasy.',
      estimatedPages: 1,
      entitiesInvolved: ['11111111-1111-4111-8111-111111111111'],
      pageSkeletonGenerated: false,
      existingPageCount: 0,
      entities: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Minerva',
          aliases: [],
          entityType: 'character',
          freeDescription: 'Tall, stern school idol with silver hair.',
        },
      ],
      sceneSummaries: ['Scene 1: School rooftop / Night / Tense and restrained'],
    };
  return {
    context,
    pages: [
      {
        pageNumber: 1,
        purpose: 'Begin the confrontation.',
        suggestedPanelCount: 1,
        suggestedLayout: 'splash_1',
        panels: [
          {
            order: 1,
            panelRole: 'establish',
            suggestedSize: 'splash',
            situationHint: 'Minerva waits on the rooftop.',
            suggestedEntities: ['11111111-1111-4111-8111-111111111111'],
            suggestedDialogueHint: null,
          },
        ],
      },
    ],
    sourceFingerprint: fingerprintPageSkeletonSource(context),
  };
}

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
