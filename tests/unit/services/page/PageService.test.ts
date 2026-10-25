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
import {
  EpisodeBeatPlanOutputLimitError,
  type CompiledEpisodeBeatPlan,
  type CompiledEpisodeBeatPlanOutline,
  type CompiledEpisodeSourceRequirements,
  type CompileEpisodeBeatPlanInput,
  type CompileEpisodeBeatPlanOutlineInput,
  type CompileEpisodeSourceRequirementsInput,
  type EpisodeBeatPlanCompilerPort,
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
  EpisodePlanPersistenceInput,
  EpisodePlanPersistencePort,
  EpisodePlanPersistenceResources,
} from '../../../../src/services/page/EpisodePlanPersistence.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIEpisodeBeatPlanCompiler } from '../../../../src/infrastructure/openai/OpenAIEpisodeBeatPlanCompiler.js';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type { CompileEpisodeStateTransitionInput } from '../../../../src/services/page/EpisodeStateTransitionCompiler.js';
import {
  PageService,
  type EpisodePagePlanProgress,
} from '../../../../src/services/page/PageService.js';
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
  public sourceSceneIds: string[] = ['scene-1'];

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
          sourceSceneIds: this.sourceSceneIds,
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
  public calls: EpisodePlanPersistenceInput[] = [];

  public constructor(
    private readonly context: EpisodePagePlanContext,
    private readonly resources: EpisodePlanPersistenceResources,
  ) {}

  public async withLockedEpisodePlan<T>(
    input: EpisodePlanPersistenceInput,
    work: (
      context: EpisodePagePlanContext,
      resources: EpisodePlanPersistenceResources,
    ) => Promise<T>,
  ): Promise<T> {
    this.calls.push(input);
    return work(this.context, this.resources);
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

class FakeEpisodeBeatPlanCompiler implements EpisodeBeatPlanCompilerPort {
  public inputs: CompileEpisodeBeatPlanInput[] = [];
  public outlineInputs: CompileEpisodeBeatPlanOutlineInput[] = [];
  public pagesToReturn: CompiledEpisodeBeatPlan['plan']['pages'] | null = null;
  public outputLimitAbovePageCount: number | null = null;
  public error: Error | null = null;
  public sourceRequirementInputs: CompileEpisodeSourceRequirementsInput[] = [];
  public omitGlobalSourceContext = false;

  public async compileBeatPlan(
    input: CompileEpisodeBeatPlanInput,
  ): Promise<CompiledEpisodeBeatPlan> {
    this.inputs.push(input);
    if (this.error !== null) {
      throw this.error;
    }
    const pageRefs = extractCompilerBriefPageRefs(input.compilerBrief);
    if (
      this.outputLimitAbovePageCount !== null &&
      pageRefs.length > this.outputLimitAbovePageCount
    ) {
      throw new EpisodeBeatPlanOutputLimitError();
    }
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

  public async compileOutline(
    input: CompileEpisodeBeatPlanOutlineInput,
  ): Promise<CompiledEpisodeBeatPlanOutline> {
    this.outlineInputs.push(input);
    const pageRefs = extractCompilerBriefPageRefs(input.compilerBrief);

    return {
      outline: {
        pages: pageRefs.map((page) => ({
          pageId: page.pageId,
          pageNumber: page.pageNumber,
          storyAnchor: `Reserve the unique story movement for page ${page.pageNumber}.`,
          reservedTransition: `Carry page ${page.pageNumber} into the next beat.`,
        })),
      },
      compilerProvider: 'openai',
      compilerModel: 'gpt-5',
      compilerPromptVersion: 'episode_beat_outline_v1',
    };
  }

  public async compileSourceRequirements(
    input: CompileEpisodeSourceRequirementsInput,
  ): Promise<CompiledEpisodeSourceRequirements> {
    this.sourceRequirementInputs.push(input);
    const firstPage = input.extraction.pages[0]!;
    const ordersByPage = new Map<string, number>();
    return {
      requirements: {
        requirements: input.extraction.units
          .filter((unit) => unit.text.trim().length > 0)
          .map((unit, index) => {
            const pageId = unit.pageId ?? firstPage.pageId;
            const pageNumber = unit.pageNumber ?? firstPage.pageNumber;
            const order = (ordersByPage.get(pageId) ?? 0) + 1;
            ordersByPage.set(pageId, order);
            const globalContext = unit.scope === 'global' && !this.omitGlobalSourceContext
              ? unit.text.trim()
              : null;
            return {
              requirementId: `req-${input.extraction.pages[0]!.pageNumber}-${index + 1}`,
              scope: unit.scope,
              pageId: unit.scope === 'global' ? null : pageId,
              pageNumber: unit.scope === 'global' ? null : pageNumber,
              sourceUnitIds: [unit.unitId],
              order: unit.scope === 'global' ? Number(unit.unitId.replace('global-u', '')) : order,
              events: unit.scope === 'global' ? [] : [unit.text.trim()], results: [], afterRequirementIds: [],
              conditionalUntil: null, requiredByEnd: unit.scope !== 'global', context: globalContext, emotion: null,
              function: null, camera: null, framing: null, quotedText: [],
            };
          }),
      },
      compilerProvider: 'openai',
      compilerModel: 'gpt-5',
      compilerPromptVersion: 'episode_source_requirements_v1',
    };
  }
}

class ActualSourceV7EpisodeBeatPlanCompiler extends FakeEpisodeBeatPlanCompiler {
  public sourceProviderCalls = 0;
  public invalidFragment = false;
  private readonly actualSourceCompiler: OpenAIEpisodeBeatPlanCompiler;

  public constructor() {
    super();
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        this.sourceProviderCalls += 1;
        const sourceRows = parseSourceV7BriefRows(payload);
        let invalidFragmentInjected = false;
        const foreignFragment = sourceRows.find((row) => row.fragments.length > 0)?.fragments[0]?.id;
        const requirements = sourceRows.flatMap((row) => {
          const sourceFragment = row.fragments[0]?.id;
          if (sourceFragment === undefined) return [];
          const eventFragment = this.invalidFragment && row.scope === 'page' && !invalidFragmentInjected &&
              foreignFragment !== undefined && !row.fragments.some((fragment) => fragment.id === foreignFragment)
            ? foreignFragment
            : sourceFragment;
          if (eventFragment === foreignFragment && eventFragment !== sourceFragment) invalidFragmentInjected = true;
          return [{
            i: row.unitOrdinal,
            u: row.unitOrdinal,
            k: row.scope === 'global' ? 'g' : 'e',
            ob: row.scope === 'global' ? [] : [{ e: eventFragment, r: null, c: null, z: true }],
            a: [],
            x: [],
            q: [],
          }];
        });
        return {
          body: { output_text: JSON.stringify({ requirements }) },
          requestId: 'req-source-v7-page-service',
        };
      },
    } as unknown as OpenAIClient;
    this.actualSourceCompiler = new OpenAIEpisodeBeatPlanCompiler(client);
  }

  public override async compileSourceRequirements(
    input: CompileEpisodeSourceRequirementsInput,
  ): Promise<CompiledEpisodeSourceRequirements> {
    this.sourceRequirementInputs.push(input);
    return this.actualSourceCompiler.compileSourceRequirements(input);
  }
}

interface SourceV7BriefRow {
  unitOrdinal: number;
  scope: 'global' | 'page';
  pageId: string;
  fragments: Array<{ id: string; text: string }>;
}

function parseSourceV7BriefRows(payload: Record<string, unknown>): SourceV7BriefRow[] {
  const input = payload.input;
  if (!Array.isArray(input) || !isRecord(input[1])) {
    throw new Error('Source v7 request omitted user input');
  }
  const content = input[1].content;
  if (!Array.isArray(content) || !isRecord(content[0]) || typeof content[0].text !== 'string') {
    throw new Error('Source v7 request omitted compiler brief');
  }
  return content[0].text.split('\n').flatMap((line) => {
    if (!line.startsWith('{')) return [];
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed) || !Number.isSafeInteger(parsed.u) ||
        (parsed.scope !== 'global' && parsed.scope !== 'page') ||
        typeof parsed.page_id !== 'string' || !Array.isArray(parsed.fragments)) {
      throw new Error('Source v7 compiler brief row is invalid');
    }
    const fragments = parsed.fragments.map((fragment) => {
      if (!isRecord(fragment) || typeof fragment.id !== 'string' || typeof fragment.text !== 'string') {
        throw new Error('Source v7 compiler brief fragment is invalid');
      }
      return { id: fragment.id, text: fragment.text };
    });
    return [{
      unitOrdinal: parsed.u as number,
      scope: parsed.scope,
      pageId: parsed.page_id,
      fragments,
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

  it('confirmed ページへの明示更新はrepositoryの同一transactionへ委譲する', async () => {
    const repository = new FakePageRepository();
    repository.page = { ...buildPageSummary(), status: 'confirmed' };
    const service = new PageService(repository);

    await expect(
      service.updatePageSettings('user-1', 'page-1', { dialogueMode: 'mixed' }),
    ).resolves.toMatchObject({ status: 'confirmed' });
    expect(repository.updatedInput).toEqual({ dialogueMode: 'mixed' });
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

  it('episode story plan は pages と panels に一括適用し provider が省略した無音へ計画要約を補完しない', async () => {
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
    expect(panelRepository.updatedPanels[0]?.input.dialogue).toBeUndefined();
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

  it.each([
    { atomic: false, savedStateId: 'state-1', suggestedStateId: null },
    { atomic: true, savedStateId: 'state-1', suggestedStateId: null },
    { atomic: false, savedStateId: 'named-state-outside-scenes', suggestedStateId: 'state-1' },
    { atomic: true, savedStateId: 'named-state-outside-scenes', suggestedStateId: 'state-1' },
  ])('legacy autofill は既存の手動状態を保持し provider の custom pose を更新する ($atomic/$savedStateId)', async ({
    atomic, savedStateId, suggestedStateId,
  }) => {
    const context = buildEpisodePlanningContext();
    const compiler = new FakeEpisodePagePlanCompiler();
    const compiled = await compiler.compilePlan({ compilerBrief: '', language: 'ja' });
    const suggestion = compiled.suggestion.pages[0]!.panels[0]!.entities![0]!;
    suggestion.action = 'custom';
    suggestion.customAction = '窓辺に腰を下ろす';
    context.pages[0]!.panels[0]!.entities = [{
      ...suggestion,
      stateId: savedStateId,
      expression: 'angry',
      action: 'attacking',
      customAction: null,
    }];
    suggestion.stateId = suggestedStateId;
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = context;
    const panelRepository = new FakePanelRepository();
    const assignments = new FakePanelEntityAssignmentService();
    const persistence = atomic ? new FakeEpisodePlanPersistence(context, {
      pageRepository, panelRepository, panelEntityAssignmentService: assignments,
    }) : undefined;
    const service = new PageService(
      pageRepository, panelRepository, assignments, undefined,
      { compilePlan: async () => compiled }, undefined, undefined, undefined,
      false, {}, persistence,
    );

    await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja', undefined, null,
      atomic ? { checkpoint: async () => undefined, beginCommit: async () => undefined } : undefined);

    expect(assignments.updates).toHaveLength(1);
    expect(assignments.updates[0]!.assignments).toEqual([
      expect.objectContaining({
        stateId: savedStateId,
        expression: 'calm',
        action: 'custom',
        customAction: '窓辺に腰を下ろす',
      }),
    ]);
    expect(context.pages[0]!.panels[0]!.entities[0]!.expression).toBe('angry');
    expect(suggestion.stateId).toBe(suggestedStateId);
  });

  it('legacy autofill が状態付きキャラを後のコマから除外する場合は全書き込み前に拒否する', async () => {
    const context = buildMultiPageEpisodePlanningContext(2);
    const compiler = new ChunkAwareEpisodePagePlanCompiler();
    const compiled = await compiler.compilePlan({
      compilerBrief: 'Page 1 (page-1)\nPage 2 (page-2)', language: 'ja',
    });
    const assignment = compiled.suggestion.pages[1]!.panels[0]!.entities![0]!;
    const otherEntityId = '22222222-2222-4222-8222-222222222222';
    context.entities.push({ ...context.entities[0]!, id: otherEntityId, name: 'Other' });
    context.pages[1]!.panels[0]!.entities = [{
      ...assignment, entityId: otherEntityId, stateId: 'manual-state',
    }];
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = context;
    const panelRepository = new FakePanelRepository();
    const assignments = new FakePanelEntityAssignmentService();
    const service = new PageService(pageRepository, panelRepository, assignments, undefined, {
      compilePlan: async () => compiled,
    });

    await expect(service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja'))
      .rejects.toMatchObject({ code: 'STATE_ASSIGNMENT_CONFLICT' });
    expect(pageRepository.updatedInputs).toHaveLength(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
    expect(assignments.updates).toHaveLength(0);
  });

  it.each([false, true])(
    'legacy autofill の entities が未指定なら既存の手動状態を変更しない (atomic=$atomic)', async (atomic) => {
      const context = buildEpisodePlanningContext();
      const compiled = await new FakeEpisodePagePlanCompiler().compilePlan({ compilerBrief: '', language: 'ja' });
      const panelSuggestion = compiled.suggestion.pages[0]!.panels[0]!;
      context.pages[0]!.panels[0]!.entities = [{
        ...panelSuggestion.entities![0]!, stateId: 'manual-state',
      }];
      panelSuggestion.entities = undefined;
      const pageRepository = new FakePageRepository();
      pageRepository.episodePlanningContext = context;
      const panelRepository = new FakePanelRepository();
      const assignments = new FakePanelEntityAssignmentService();
      const persistence = atomic ? new FakeEpisodePlanPersistence(context, {
        pageRepository, panelRepository, panelEntityAssignmentService: assignments,
      }) : undefined;
      const service = new PageService(
        pageRepository, panelRepository, assignments, undefined,
        { compilePlan: async () => compiled }, undefined, undefined, undefined,
        false, {}, persistence,
      );

      await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja', undefined, null,
        atomic ? { checkpoint: async () => undefined, beginCommit: async () => undefined } : undefined);

      expect(assignments.updates).toHaveLength(0);
      expect(context.pages[0]!.panels[0]!.entities[0]!.stateId).toBe('manual-state');
    },
  );

  it.each([false, true])(
    'legacy autofill の明示 entities=[] は状態なし割り当てを通常・atomic保存で消去する (atomic=$atomic)', async (atomic) => {
      const context = buildEpisodePlanningContext();
      const compiled = await new FakeEpisodePagePlanCompiler().compilePlan({ compilerBrief: '', language: 'ja' });
      const panelSuggestion = compiled.suggestion.pages[0]!.panels[0]!;
      context.pages[0]!.panels[0]!.entities = [{
        ...panelSuggestion.entities![0]!, stateId: null,
      }];
      panelSuggestion.entities = [];
      // This used to make fallback repair silently put the lead character back.
      panelSuggestion.backgroundNote = 'current setting';
      const pageRepository = new FakePageRepository();
      pageRepository.episodePlanningContext = context;
      const panelRepository = new FakePanelRepository();
      const assignments = new FakePanelEntityAssignmentService();
      const persistence = atomic ? new FakeEpisodePlanPersistence(context, {
        pageRepository, panelRepository, panelEntityAssignmentService: assignments,
      }) : undefined;
      const service = new PageService(
        pageRepository, panelRepository, assignments, undefined,
        { compilePlan: async () => compiled }, undefined, undefined, undefined,
        false, {}, persistence,
      );

      await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja', undefined, null,
        atomic ? { checkpoint: async () => undefined, beginCommit: async () => undefined } : undefined);

      expect(assignments.updates).toEqual([{ panelId: 'panel-1', assignments: [] }]);
    },
  );

  it.each([false, true])(
    'legacy autofill の明示 entities=[] が手動状態を消す場合は全書き込み前に拒否する (atomic=$atomic)', async (atomic) => {
      const context = buildEpisodePlanningContext();
      const compiled = await new FakeEpisodePagePlanCompiler().compilePlan({ compilerBrief: '', language: 'ja' });
      const panelSuggestion = compiled.suggestion.pages[0]!.panels[0]!;
      context.pages[0]!.panels[0]!.entities = [{
        ...panelSuggestion.entities![0]!, stateId: 'manual-state',
      }];
      panelSuggestion.entities = [];
      const pageRepository = new FakePageRepository();
      pageRepository.episodePlanningContext = context;
      const panelRepository = new FakePanelRepository();
      const assignments = new FakePanelEntityAssignmentService();
      const persistence = atomic ? new FakeEpisodePlanPersistence(context, {
        pageRepository, panelRepository, panelEntityAssignmentService: assignments,
      }) : undefined;
      const service = new PageService(
        pageRepository, panelRepository, assignments, undefined,
        { compilePlan: async () => compiled }, undefined, undefined, undefined,
        false, {}, persistence,
      );

      await expect(service.autofillEpisodeFromStory(
        'user-1', 'episode-1', 'ja', undefined, null,
        atomic ? { checkpoint: async () => undefined, beginCommit: async () => undefined } : undefined,
      )).rejects.toMatchObject({ code: 'STATE_ASSIGNMENT_CONFLICT' });
      expect(pageRepository.updatedInputs).toHaveLength(0);
      expect(panelRepository.updatedPanels).toHaveLength(0);
      expect(assignments.updates).toHaveLength(0);
    },
  );

  it('legacy autofill は状態なしのキャラ交代と新しい旧形式の状態割り当てを維持する', async () => {
    const context = buildEpisodePlanningContext();
    const compiled = await new FakeEpisodePagePlanCompiler().compilePlan({ compilerBrief: '', language: 'ja' });
    const assignment = compiled.suggestion.pages[0]!.panels[0]!.entities![0]!;
    assignment.stateId = 'state-1';
    const otherEntityId = '22222222-2222-4222-8222-222222222222';
    context.entities.push({ ...context.entities[0]!, id: otherEntityId, name: 'Other' });
    context.pages[0]!.panels[0]!.entities = [{ ...assignment, entityId: otherEntityId, stateId: null }];
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = context;
    const assignments = new FakePanelEntityAssignmentService();
    const service = new PageService(pageRepository, new FakePanelRepository(), assignments, undefined, {
      compilePlan: async () => compiled,
    });

    await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(assignments.updates[0]!.assignments).toEqual([assignment]);
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

  it('episode story plan は既存の page layout metadata を変更せず内容だけを反映する', async () => {
    const pageRepository = new FakePageRepository();
    const originalLayoutConfig = {
      type: 'custom',
      panel_count: 5,
      frame_definitions: Array.from({ length: 5 }, (_value, index) => ({
        frame_id: `custom-frame-${index + 1}`,
      })),
    };
    pageRepository.page = {
      ...buildPageSummary(),
      panelCount: 5,
      frameCount: 5,
      layoutConfig: originalLayoutConfig,
    };
    pageRepository.episodePlanningContext = {
      ...buildEpisodePlanningContext(),
      pages: [
        {
          pageId: 'page-1',
          pageNumber: 1,
          frameCount: 5,
          layoutConfig: originalLayoutConfig,
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
    expect(pageRepository.updatedInput?.layoutConfig).toMatchObject(originalLayoutConfig);
    expect(pageRepository.episodePlanningContext.pages[0]?.layoutConfig).toEqual(originalLayoutConfig);
  });

  it('episode story plan は不整合な page layout metadata を変更せず compiler 実行前に拒否する', async () => {
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
    const legacyAudit: CompiledEpisodePlanAudit['audit'] = { accepted: true, issues: [] };
    auditCompiler.audits = [legacyAudit];
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
    expect(auditCompiler.inputs[0]?.coverageCatalog?.pages).toHaveLength(7);
    expect(auditCompiler.inputs[0]?.visualSnapshot?.panels).toHaveLength(7);
    expect(auditCompiler.inputs[0]?.visualSnapshot?.panels[0]).toEqual(
      expect.objectContaining({ pageId: 'page-1', panelOrder: 1 }),
    );
    expect(legacyAudit.sourceCoverage).toBeUndefined();
    expect(progressEvents.find((progress) => progress.stage === 'auditing_episode')).toMatchObject({
      currentChunk: null,
      totalChunks: null,
    });
    expect(pageRepository.episodePlanningContextReadCount).toBe(2);
    expect(panelRepository.updatedPanels).toHaveLength(7);
  });

  // Design invariant: routine episodes first use one full-episode beat request;
  // outline and segmented packs are reserved for a confirmed output-capacity failure.
  it('continuity v3 は通常16ページの全話台帳を1回で作り、容量分割を先回りしない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(16);
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const beatPlanCompiler = new FakeEpisodeBeatPlanCompiler();
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      new ChunkAwareEpisodePagePlanCompiler(),
      undefined,
      beatPlanCompiler,
      new FakeEpisodePlanAuditCompiler(),
      true,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(beatPlanCompiler.outlineInputs).toHaveLength(0);
    expect(beatPlanCompiler.inputs).toHaveLength(1);
    expect(extractCompilerBriefPageRefs(beatPlanCompiler.inputs[0]!.compilerBrief)).toHaveLength(16);
    expect(beatPlanCompiler.inputs[0]?.compilerBrief).toContain('Page 16 (page-16) | frame_count=1');
    expect(panelRepository.updatedPanels).toHaveLength(16);
  });

  it('状態付き16ページは抽出と監査を各1回に保ち3ページ目のREADY状態を最終ページまで保存する', async () => {
    const entityId = '11111111-1111-4111-8111-111111111111';
    const readyStateId = '22222222-2222-4222-8222-222222222222';
    const context = buildMultiPageEpisodePlanningContext(16);
    context.scenes[0]!.entityStates = [];
    context.stateLibrary = [{
      entityId,
      stateId: readyStateId,
      name: '負傷後',
      description: '左腕に包帯を巻いている',
      revision: '2026-10-15T00:00:00.000Z',
      baseRefId: 'base-ref',
      baseRefUpdatedAt: '2026-10-15T00:00:00.000Z',
      referenceReady: true,
      referenceImage: {
        refId: 'ready-ref',
        s3Key: 'private/ready.png',
        storageOwnerUserId: entityId,
        imageModel: 'gpt-image-2',
        baseRefId: 'base-ref',
        createdAt: '2026-10-15T00:00:00.000Z',
        inputFingerprint: 'ready-fingerprint',
      },
    }];
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = context;
    const transactionPageRepository = new FakePageRepository();
    const transactionPanelRepository = new FakePanelRepository();
    const transactionAssignments = new FakePanelEntityAssignmentService();
    const persistence = new FakeEpisodePlanPersistence(context, {
      pageRepository: transactionPageRepository,
      panelRepository: transactionPanelRepository,
      panelEntityAssignmentService: transactionAssignments,
      completeStoryAutofillJob: async () => true,
    });
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    let stateCompilerCalls = 0;
    const stateCompiler = {
      compileStateTransitions: async (input: CompileEpisodeStateTransitionInput) => {
        stateCompilerCalls += 1;
        expect(input.context.pages).toHaveLength(16);
        return {
          plan: {
            transitions: [{
              entityId,
              stateId: readyStateId,
              startsAtPanelId: 'panel-3',
              sourceSceneId: null,
              sourceField: 'middle' as const,
              sourceQuote: 'Tension rises',
            }],
            unresolved: [],
          },
          compilerProvider: 'openai' as const,
          compilerModel: 'test-state-model',
          compilerPromptVersion: 'episode_state_transition_v3',
        };
      },
    };
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      new ChunkAwareEpisodePagePlanCompiler(),
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
      { inlineRepairEnabled: true },
      persistence,
      stateCompiler,
    );
    let beginCommitCount = 0;

    const result = await service.autofillEpisodeFromStory(
      'user-1',
      'episode-1',
      'ja',
      undefined,
      null,
      {
        jobId: 'job-1',
        checkpoint: async () => undefined,
        beginCommit: async () => { beginCommitCount += 1; },
      },
      {
        statePlanVersion: 'episode_state_plan_v1',
        stateAssignmentPolicy: 'overwrite_existing',
      },
    );

    expect(result).toMatchObject({
      updatedPageCount: 16,
      updatedPanelCount: 16,
      updatedAssignmentCount: 16,
    });
    expect(stateCompilerCalls).toBe(1);
    expect(auditCompiler.inputs).toHaveLength(1);
    expect(beginCommitCount).toBe(1);
    expect(persistence.calls).toHaveLength(1);
    expect(transactionPageRepository.updatedInputs).toHaveLength(16);
    expect(transactionPanelRepository.updatedPanels.map((update) => update.panelId)).toEqual(
      Array.from({ length: 16 }, (_value, index) => `panel-${index + 1}`),
    );
    expect(transactionAssignments.updates).toHaveLength(16);
    expect(transactionAssignments.updates.slice(0, 2).map((update) => update.assignments[0]?.stateId ?? null))
      .toEqual([null, null]);
    expect(transactionAssignments.updates.slice(2).map((update) => update.assignments[0]?.stateId))
      .toEqual(Array.from({ length: 14 }, () => readyStateId));
  });

  it('continuity v3 は上限に達した台帳パックだけを半分に分け、成功済みパックを再生成しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(10);
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const beatPlanCompiler = new FakeEpisodeBeatPlanCompiler();
    beatPlanCompiler.outputLimitAbovePageCount = 4;
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      new ChunkAwareEpisodePagePlanCompiler(),
      undefined,
      beatPlanCompiler,
      new FakeEpisodePlanAuditCompiler(),
      true,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(beatPlanCompiler.outlineInputs).toHaveLength(1);
    expect(
      beatPlanCompiler.inputs.map(
        (input) => extractCompilerBriefPageRefs(input.compilerBrief).length,
      ),
    ).toEqual([10, 8, 4, 4, 2]);
    expect(panelRepository.updatedPanels).toHaveLength(10);
  });

  it('continuity v3 はcapacity以外の全話beat失敗を分割で隠さず保存しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(10);
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const beatPlanCompiler = new FakeEpisodeBeatPlanCompiler();
    beatPlanCompiler.error = new ConfigurationError('Episode beat compiler unavailable');
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      new ChunkAwareEpisodePagePlanCompiler(),
      undefined,
      beatPlanCompiler,
      new FakeEpisodePlanAuditCompiler(),
      true,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result).toMatchObject({
      compilerUsed: false,
      compilerError: 'Episode beat compiler unavailable',
      updatedPageCount: 0,
      updatedPanelCount: 0,
      updatedAssignmentCount: 0,
    });
    expect(beatPlanCompiler.inputs).toHaveLength(1);
    expect(beatPlanCompiler.outlineInputs).toHaveLength(0);
    expect(pageRepository.updatedInputs).toHaveLength(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
    expect(assignmentService.updates).toHaveLength(0);
  });

  it('continuity v3 は1ページまで分割した台帳が上限に達した場合に何も保存しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const assignmentService = new FakePanelEntityAssignmentService();
    const beatPlanCompiler = new FakeEpisodeBeatPlanCompiler();
    beatPlanCompiler.outputLimitAbovePageCount = 0;
    const service = new PageService(
      pageRepository,
      panelRepository,
      assignmentService,
      new FakePageAutofillCompiler(),
      new ChunkAwareEpisodePagePlanCompiler(),
      undefined,
      beatPlanCompiler,
      new FakeEpisodePlanAuditCompiler(),
      true,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(pageRepository.updatedInputs).toHaveLength(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
    expect(assignmentService.updates).toHaveLength(0);
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
    expect(auditCompiler.inputs).toHaveLength(1);
  });

  it('完全なpage原文対応をfull contextで一度判定しnormal・repair・auditへtrusted flagを渡す', async () => {
    const pageRepository = new FakePageRepository();
    const context = buildMultiPageEpisodePlanningContext(4);
    context.episode.storyFullDraft = context.pages
      .map((page) => `${page.pageNumber}ページ目：原文動作-${page.pageNumber}を最後まで行う。`)
      .join('\n');
    pageRepository.episodePlanningContext = context;
    const episodeCompiler = new ChunkAwareEpisodePagePlanCompiler();
    const beatCompiler = new FakeEpisodeBeatPlanCompiler();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.audits = [
      {
        accepted: false,
        issues: [{
          code: 'source_omission',
          severity: 'error',
          pageIds: ['page-1'],
          message: '原文動作が不足している。',
          repairInstruction: '原文どおり最後まで描く。',
        }],
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
      beatCompiler,
      auditCompiler,
      true,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(beatCompiler.inputs).toHaveLength(0);
    expect(beatCompiler.sourceRequirementInputs.length).toBeGreaterThan(0);
    expect(beatCompiler.sourceRequirementInputs.every((input) =>
      input.extraction.compilerBrief.includes('[ORIGINAL SOURCE UNITS - ONLY AUTHORITY]') &&
      !input.extraction.compilerBrief.includes('continuity_note') &&
      !input.extraction.compilerBrief.includes('handoff')
    )).toBe(true);
    expect(episodeCompiler.inputs).toHaveLength(3);
    expect(episodeCompiler.inputs.every((input) => input.sourceOwnedPageContext === true)).toBe(true);
    expect(episodeCompiler.inputs[2]?.compilerBrief).toContain('[REPAIR REQUIRED]');
    expect(episodeCompiler.inputs[2]?.compilerBrief).toContain('1ページ目：原文動作-1を最後まで行う。');
    expect(episodeCompiler.inputs.every(
      (input) => !input.compilerBrief.includes('[GLOBAL EPISODE LEDGER]'),
    )).toBe(true);
    expect(episodeCompiler.inputs.every((input) =>
      input.compilerBrief.includes('[SOURCE REQUIREMENTS - ORIGINAL ONLY]') &&
      input.sourceRequirements !== undefined
    )).toBe(true);
    expect(episodeCompiler.inputs[2]?.sourceRequirements)
      .toEqual(episodeCompiler.inputs[0]?.sourceRequirements);
    expect(auditCompiler.inputs).toHaveLength(1);
    expect(auditCompiler.inputs.every((input) => input.sourceOwnedPageContext === true)).toBe(true);
    expect(auditCompiler.inputs.every(
      (input) => input.coverageCatalog?.pages.every(
        (page) => page.sources.map((source) => source.ref).join(',') === 'source',
      ) === true,
    )).toBe(true);
  });

  it('continuity v3 ONはglobal原文全文がcontextにないsource requirementをdetail・監査・保存前に拒否する', async () => {
    const pageRepository = new FakePageRepository();
    const context = buildMultiPageEpisodePlanningContext(4);
    context.episode.storyFullDraft = [
      '全15ページの日本の漫画。',
      ...context.pages.map((page) => `${page.pageNumber}ページ目：原文動作-${page.pageNumber}を最後まで行う。`),
    ].join('\n');
    pageRepository.episodePlanningContext = context;
    const episodeCompiler = new ChunkAwareEpisodePagePlanCompiler();
    const beatCompiler = new FakeEpisodeBeatPlanCompiler();
    beatCompiler.omitGlobalSourceContext = true;
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      beatCompiler,
      auditCompiler,
      true,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(beatCompiler.sourceRequirementInputs.length).toBeGreaterThan(0);
    expect(beatCompiler.inputs).toHaveLength(0);
    expect(episodeCompiler.inputs).toHaveLength(0);
    expect(auditCompiler.inputs).toHaveLength(0);
    expect(pageRepository.updatedInputs).toHaveLength(0);
  });

  it('source v6実compilerは15ページ60コマをfake providerから原子的に保存する', async () => {
    const context = buildSourceV6FifteenPageContext();
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = context;
    const transactionPageRepository = new FakePageRepository();
    transactionPageRepository.episodePlanningContext = context;
    const transactionPanelRepository = new FakePanelRepository();
    const persistence = new FakeEpisodePlanPersistence(context, {
      pageRepository: transactionPageRepository,
      panelRepository: transactionPanelRepository,
      panelEntityAssignmentService: new FakePanelEntityAssignmentService(),
    });
    const sourceCompiler = new ActualSourceV7EpisodeBeatPlanCompiler();
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      new FourPanelEpisodePagePlanCompiler(),
      undefined,
      sourceCompiler,
      new FakeEpisodePlanAuditCompiler(),
      true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true },
      persistence,
    );
    let beginCommitCount = 0;

    const result = await service.autofillEpisodeFromStory(
      'user-1',
      'episode-1',
      'ja',
      undefined,
      null,
      {
        checkpoint: async () => undefined,
        beginCommit: async () => { beginCommitCount += 1; },
      },
    );

    expect(result.compilerUsed).toBe(true);
    expect(sourceCompiler.sourceProviderCalls).toBe(4);
    expect(sourceCompiler.sourceRequirementInputs).toHaveLength(4);
    expect(sourceCompiler.sourceRequirementInputs.every((input) =>
      input.extraction.pages.length <= 4 &&
      input.extraction.units.filter((unit) => unit.text.trim().length > 0).length <= 40)).toBe(true);
    expect(sourceCompiler.sourceRequirementInputs.every((input) =>
      input.extraction.compilerBrief.includes('"fragments"'))).toBe(true);
    expect(beginCommitCount).toBe(1);
    expect(persistence.calls).toHaveLength(1);
    expect(transactionPageRepository.updatedInputs).toHaveLength(15);
    expect(transactionPanelRepository.updatedPanels).toHaveLength(60);
  });

  it('source v6実compilerが別unit fragmentを拒否した場合はcommitと保存を開始しない', async () => {
    const context = buildSourceV6FifteenPageContext();
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = context;
    const transactionPageRepository = new FakePageRepository();
    transactionPageRepository.episodePlanningContext = context;
    const transactionPanelRepository = new FakePanelRepository();
    const persistence = new FakeEpisodePlanPersistence(context, {
      pageRepository: transactionPageRepository,
      panelRepository: transactionPanelRepository,
      panelEntityAssignmentService: new FakePanelEntityAssignmentService(),
    });
    const sourceCompiler = new ActualSourceV7EpisodeBeatPlanCompiler();
    sourceCompiler.invalidFragment = true;
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      new FourPanelEpisodePagePlanCompiler(),
      undefined,
      sourceCompiler,
      new FakeEpisodePlanAuditCompiler(),
      true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true },
      persistence,
    );
    let beginCommitCount = 0;

    const result = await service.autofillEpisodeFromStory(
      'user-1',
      'episode-1',
      'ja',
      undefined,
      null,
      {
        checkpoint: async () => undefined,
        beginCommit: async () => { beginCommitCount += 1; },
      },
    );

    expect(result.compilerUsed).toBe(false);
    expect(result.compilerError).toContain('invalid source span');
    expect(sourceCompiler.sourceProviderCalls).toBe(1);
    expect(beginCommitCount).toBe(0);
    expect(persistence.calls).toHaveLength(0);
    expect(transactionPageRepository.updatedInputs).toHaveLength(0);
    expect(transactionPanelRepository.updatedPanels).toHaveLength(0);
  });

  it('continuity v3 OFFはsource requirementを呼ばず既存v2 detail経路を保つ', async () => {
    const pageRepository = new FakePageRepository();
    const context = buildMultiPageEpisodePlanningContext(4);
    context.episode.storyFullDraft = [
      '全15ページの日本の漫画。',
      ...context.pages.map((page) => `${page.pageNumber}ページ目：原文動作-${page.pageNumber}を最後まで行う。`),
    ].join('\n');
    pageRepository.episodePlanningContext = context;
    const episodeCompiler = new ChunkAwareEpisodePagePlanCompiler();
    const beatCompiler = new FakeEpisodeBeatPlanCompiler();
    beatCompiler.omitGlobalSourceContext = true;
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      beatCompiler,
      auditCompiler,
      false,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(beatCompiler.sourceRequirementInputs).toHaveLength(0);
    expect(beatCompiler.inputs).toHaveLength(0);
    expect(episodeCompiler.inputs.length).toBeGreaterThan(0);
    expect(auditCompiler.inputs).toHaveLength(0);
  });

  it('source requirement extraction前のcheckpointでcancelされた場合はproviderと保存を開始しない', async () => {
    const pageRepository = new FakePageRepository();
    const context = buildEpisodePlanningContext();
    context.episode.storyFullDraft = '1ページ目：扉を開けて中へ入る。';
    pageRepository.episodePlanningContext = context;
    const beatCompiler = new FakeEpisodeBeatPlanCompiler();
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      new FakeEpisodePagePlanCompiler(),
      undefined,
      beatCompiler,
      new FakeEpisodePlanAuditCompiler(),
      true,
    );
    const cancellation = new Error('cancel before paid extraction');

    await expect(service.autofillEpisodeFromStory(
      'user-1', 'episode-1', 'ja', undefined, null,
      { jobId: 'job-1', checkpoint: async () => { throw cancellation; }, beginCommit: async () => undefined },
    )).rejects.toBe(cancellation);
    expect(beatCompiler.sourceRequirementInputs).toHaveLength(0);
    expect(pageRepository.updatedInputs).toHaveLength(0);
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
    expect(auditCompiler.inputs).toHaveLength(1);
  });

  it('inline repair 無効時もbounded修復後の意味的指摘だけでは保存を破棄しない', async () => {
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
            code: 'source_omission',
            severity: 'error',
            pageIds: ['page-2'],
            message: 'Page 2 omits a required story beat.',
            repairInstruction: 'Restore the required beat from the source.',
          },
        ],
      },
      {
        accepted: false,
        issues: [
          {
            code: 'ongoing_action_dropped',
            severity: 'error',
            pageIds: ['page-3'],
            message: 'Page 3 does not carry the ongoing action forward.',
            repairInstruction: 'Continue the action until its explicit resolution.',
          },
          {
            code: 'visible_entity_mismatch',
            severity: 'error',
            pageIds: ['page-4'],
            message: 'Page 4 assigns a character to a character-free cutaway.',
            repairInstruction: 'Keep the cutaway entity list empty.',
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
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(auditCompiler.inputs).toHaveLength(1);
    expect(episodeCompiler.inputs).toHaveLength(3);
    expect(pageRepository.updatedInputs).toHaveLength(4);
    expect(panelRepository.updatedPanels.length).toBeGreaterThan(0);
  });

  it('inline repair 無効時もbounded修復後の決定的な重複は保存を拒否する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    const episodeCompiler = new DuplicateDialogueEpisodePagePlanCompiler();
    episodeCompiler.repairDuplicate = false;
    auditCompiler.audits = [
      { accepted: true, issues: [] },
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

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(false);
    expect(result.compilerError).toContain('deterministic verification');
    expect(auditCompiler.inputs).toHaveLength(1);
    expect(pageRepository.updatedInputs).toHaveLength(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
  });

  // One semantic audit is the full-run invariant. Its validated repairs are
  // consumed once, then only local deterministic and persistence checks run.
  it('inline repair 有効時は初回mixed patchless errorでも1回の監査で指定fieldだけを直して保存する', async () => {
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
          {
            code: 'unsupported_story_fact',
            severity: 'error',
            pageIds: ['page-3'],
            message: 'Page 3 still requires semantic review.',
            repairInstruction: 'Review page 3 without inventing a patch.',
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
    expect(auditCompiler.inputs).toHaveLength(1);
    expect(
      panelRepository.updatedPanels.find((update) => update.panelId === 'panel-2')?.input
        .situationText,
    ).toContain('Page 2 continues directly from page 1');
  });

  it('inline repair 有効時は初回repairだけを適用し後続監査fixtureを呼ばない', async () => {
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
          {
            code: 'timeline_discontinuity',
            severity: 'error',
            pageIds: ['page-1'],
            message: 'A state boundary still needs semantic review.',
            repairInstruction: 'Keep this as a non-field state review result.',
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
    expect(auditCompiler.inputs).toHaveLength(1);
    expect(pageRepository.updatedInputs).toHaveLength(4);
    expect(
      panelRepository.updatedPanels.find((update) => update.panelId === 'panel-2')?.input
        .dialogue?.[0]?.text,
    ).toBe('Page 2 now advances the conversation.');
    expect(
      panelRepository.updatedPanels.find((update) => update.panelId === 'panel-3')?.input
        .situationText,
    ).not.toContain('Page 3 follows the event assigned by the story ledger');
    expect(
      panelRepository.updatedPanels.find((update) => update.panelId === 'panel-4')?.input
        .dialogue?.[0]?.text,
    ).not.toBe('Page 4 responds after the preceding action.');
  });

  it('inline repair 有効時は初回repair後に後続の意味的監査fixtureを呼ばない', async () => {
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
    expect(auditCompiler.inputs).toHaveLength(1);
    expect(pageRepository.updatedInputs).toHaveLength(4);
    expect(panelRepository.updatedPanels.length).toBeGreaterThan(0);
  });

  it('inline repair 有効時は初回repair後に後続の監査エラーfixtureを呼ばない', async () => {
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
    expect(auditCompiler.inputs).toHaveLength(1);
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
    expect(auditCompiler.inputs).toHaveLength(1);
    expect(pageRepository.updatedInputs).toHaveLength(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
  });

  it('inline repair 有効時は未知ページの修復案を捨てて検証済みの元結果を保存する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.audits = [
      {
        accepted: false,
        issues: [
          {
            code: 'unsupported_story_fact',
            severity: 'error',
            pageIds: ['page-3'],
            message: 'Page 3 invents an unsupported event.',
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

    expect(result.compilerUsed).toBe(true);
    expect(auditCompiler.inputs).toHaveLength(1);
    expect(pageRepository.updatedInputs).toHaveLength(4);
    expect(panelRepository.updatedPanels).toHaveLength(4);
    expect(panelRepository.updatedPanels.every((panel) => panel.input.situationText !== 'This invalid repair must never be applied.')).toBe(true);
  });

  it.each(['unknown', 'unready', 'foreign'] as const)(
    'inline repair 有効時は%s状態を入れる監査修復を捨て元の状態を保存する',
    async (mode) => {
      const entityId = '11111111-1111-4111-8111-111111111111';
      const stateId = '22222222-2222-4222-8222-222222222222';
      const context = buildMultiPageEpisodePlanningContext(4);
      context.stateLibrary = mode === 'unknown' ? [] : [{
        entityId: mode === 'foreign' ? '33333333-3333-4333-8333-333333333333' : entityId,
        stateId, name: '負傷', description: '右腕の傷',
        revision: '2026-10-14T00:00:00.000Z', baseRefId: 'base-ref',
        baseRefUpdatedAt: '2026-10-14T00:00:00.000Z',
        referenceReady: mode === 'foreign',
        referenceImage: mode === 'unready' ? null : {
          refId: 'state-ref', s3Key: 'private/state.png', storageOwnerUserId: entityId,
          imageModel: 'gpt-image-2', baseRefId: 'base-ref',
          createdAt: '2026-10-14T00:00:00.000Z', inputFingerprint: 'fingerprint',
        },
      }];
      const pageRepository = new FakePageRepository();
      pageRepository.episodePlanningContext = context;
      const panelRepository = new FakePanelRepository();
      const assignments = new FakePanelEntityAssignmentService();
      const compiler = new ChunkAwareEpisodePagePlanCompiler();
      const audit = new FakeEpisodePlanAuditCompiler();
      audit.audits = [{
        accepted: false,
        issues: [{ code: 'visible_entity_mismatch', severity: 'error', pageIds: ['page-3'],
          message: 'State should change.', repairInstruction: 'Apply the state.' }],
        panelRepairs: [{ pageId: 'page-3', panelOrder: 1, changedFields: ['entities'], patch: {
          entities: [{ entityId, role: 'primary', expression: 'calm', customExpression: null,
            action: 'standing_firm', customAction: null, position: 'center', facingDirection: 'front',
            effectNote: null, stateId }],
        } }],
      }];
      const service = new PageService(pageRepository, panelRepository, assignments, undefined,
        compiler, undefined, new FakeEpisodeBeatPlanCompiler(), audit, true,
        { adaptivePackingEnabled: true, inlineRepairEnabled: true });
      const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');
      expect(result.compilerUsed).toBe(true);
      expect(audit.inputs).toHaveLength(1);
      expect(compiler.inputs).toHaveLength(1);
      expect(pageRepository.updatedInputs).toHaveLength(4);
      expect(panelRepository.updatedPanels).toHaveLength(4);
      expect(assignments.updates).toHaveLength(4);
      expect(assignments.updates.every((update) => update.assignments.every((value) => value.stateId === null))).toBe(true);
    },
  );

  it('監査修復が新しい重複を作る場合は有効な元の台詞を1監査後に保存する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const compiler = new ChunkAwareEpisodePagePlanCompiler();
    const audit = new FakeEpisodePlanAuditCompiler();
    audit.audits = [{ accepted: false,
      issues: [{ code: 'dialogue_misplacement', severity: 'error', pageIds: ['page-4'],
        message: 'Change the line.', repairInstruction: 'Correct the dialogue.' }],
      panelRepairs: [{ pageId: 'page-4', panelOrder: 1, changedFields: ['dialogue'], patch: {
        dialogue: [{ entityId: '11111111-1111-4111-8111-111111111111', text: 'Page 1 line.', type: 'speech', position: 'top' }],
      } }],
    }];
    const service = new PageService(pageRepository, panelRepository, new FakePanelEntityAssignmentService(),
      undefined, compiler, undefined, new FakeEpisodeBeatPlanCompiler(), audit, true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true });
    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');
    expect(result.compilerUsed).toBe(true);
    expect(audit.inputs).toHaveLength(1);
    expect(compiler.inputs).toHaveLength(1);
    expect(panelRepository.updatedPanels[3]?.input.dialogue?.[0]?.text).toBe('Page 4 line.');
  });

  it('不正な監査修復を捨てても元の結果が重複している場合は保存しない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const audit = new FakeEpisodePlanAuditCompiler();
    audit.audits = [{ accepted: false,
      issues: [{ code: 'duplicate_dialogue', severity: 'error', pageIds: ['page-4'],
        message: 'Page 4 repeats page 1.', repairInstruction: 'Replace the repeated line.' }],
      panelRepairs: [{ pageId: 'unknown-page', panelOrder: 1, changedFields: ['situationText'],
        patch: { situationText: 'Invalid patch.' } }],
    }];
    const service = new PageService(pageRepository, panelRepository, new FakePanelEntityAssignmentService(),
      undefined, new DuplicateDialogueEpisodePagePlanCompiler(), undefined,
      new FakeEpisodeBeatPlanCompiler(), audit, true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true });
    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');
    expect(result.compilerUsed).toBe(false);
    expect(result.compilerError).toContain('deterministic verification');
    expect(audit.inputs).toHaveLength(1);
    expect(pageRepository.updatedInputs).toHaveLength(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
  });

  it('監査修復中の予期しない例外は元結果の保存で隠さない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildMultiPageEpisodePlanningContext(4);
    const panelRepository = new FakePanelRepository();
    const audit = new FakeEpisodePlanAuditCompiler();
    audit.audits = [{ accepted: false,
      issues: [{ code: 'unsupported_story_fact', severity: 'error', pageIds: ['page-3'],
        message: 'Replace the content.', repairInstruction: 'Correct the content.' }],
      panelRepairs: [{ pageId: 'page-3', panelOrder: 1, changedFields: ['situationText'], patch: {
        get situationText(): string {
          throw new ConfigurationError('Unexpected repair application failure');
        },
      } }],
    }];
    const service = new PageService(pageRepository, panelRepository, new FakePanelEntityAssignmentService(),
      undefined, new ChunkAwareEpisodePagePlanCompiler(), undefined,
      new FakeEpisodeBeatPlanCompiler(), audit, true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true });
    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');
    expect(result.compilerUsed).toBe(false);
    expect(result.compilerError).toContain('Unexpected repair application failure');
    expect(audit.inputs).toHaveLength(1);
    expect(pageRepository.updatedInputs).toHaveLength(0);
    expect(panelRepository.updatedPanels).toHaveLength(0);
  });

  it('inline repair 有効時は修復情報のない意味的errorだけなら決定的検証後に保存する', async () => {
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

    expect(result.compilerUsed).toBe(true);
    expect(auditCompiler.inputs).toHaveLength(1);
    expect(pageRepository.updatedInputs).toHaveLength(4);
    expect(panelRepository.updatedPanels.length).toBeGreaterThan(0);
    expect(assignmentService.updates.length).toBeGreaterThan(0);
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
    expect(auditCompiler.inputs).toHaveLength(1);
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
    expect(result.compilerError).toContain('deterministic verification');
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

  it('引用台詞の監査修復は原文全文と話者を原子的保存へ渡す', async () => {
    const context = buildEpisodePlanningContext();
    context.episode.storyFullDraft = 'ココは「道が残っていれば、きっと着ける」と言う。ナレーション「風が止んだ」。';
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = context;
    const transactionPageRepository = new FakePageRepository();
    transactionPageRepository.episodePlanningContext = context;
    const transactionPanelRepository = new FakePanelRepository();
    const persistence = new FakeEpisodePlanPersistence(context, {
      pageRepository: transactionPageRepository,
      panelRepository: transactionPanelRepository,
      panelEntityAssignmentService: new FakePanelEntityAssignmentService(),
    });
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.audits = [
      {
        accepted: false,
        issues: [{
          code: 'dialogue_misplacement',
          severity: 'error',
          pageIds: ['page-1'],
          message: 'The authored line was shortened.',
          repairInstruction: 'Restore the exact authored line and speaker.',
        }],
        panelRepairs: [{
          pageId: 'page-1',
          panelOrder: 1,
          changedFields: ['dialogue'],
          patch: {
            dialogue: [{
              entityId: '11111111-1111-4111-8111-111111111111',
              text: '道が残っていれば、きっと着ける',
              type: 'speech',
              position: 'right',
            }, {
              entityId: null,
              text: '風が止んだ',
              type: 'narration',
              position: 'left',
            }],
          },
        }],
      },
      { accepted: true, issues: [] },
    ];
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      new FakeEpisodePagePlanCompiler(),
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true },
      persistence,
    );

    await expect(service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja'))
      .resolves.toMatchObject({ compilerUsed: true });

    expect(auditCompiler.inputs).toHaveLength(1);
    expect(persistence.calls).toHaveLength(1);
    expect(transactionPanelRepository.updatedPanels).toEqual(expect.arrayContaining([
      expect.objectContaining({
        panelId: 'panel-1',
        input: expect.objectContaining({
          dialogue: [{
            entityId: '11111111-1111-4111-8111-111111111111',
            text: '道が残っていれば、きっと着ける',
            type: 'speech',
            position: 'right',
          }, {
            entityId: null,
            text: '風が止んだ',
            type: 'narration',
            position: 'left',
          }],
        }),
      }),
    ]));
  });

  it('監査の dialogue field repair は計画要約由来の表示文だけを除去して原文台詞を原子的保存へ渡す', async () => {
    const context = buildEpisodePlanningContext();
    const arcSummary = '公園で消えた灯台の光に気づいた主人公が、古い地図を頼りに出発する。';
    const authoredSpeech = 'あの光、どうしたんだろう';
    context.episode.introduction = arcSummary;
    context.episode.storyFullDraft = `主人公は「${authoredSpeech}」と小さくつぶやく。`;
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = context;
    const transactionPanelRepository = new FakePanelRepository();
    const persistence = new FakeEpisodePlanPersistence(context, {
      pageRepository: new FakePageRepository(),
      panelRepository: transactionPanelRepository,
      panelEntityAssignmentService: new FakePanelEntityAssignmentService(),
    });
    const baseDetailCompiler = new FakeEpisodePagePlanCompiler();
    const detailCompiler: EpisodePagePlanCompilerPort = {
      async compilePlan(input): Promise<CompiledEpisodePagePlan> {
        const compiled = await baseDetailCompiler.compilePlan(input);
        return {
          ...compiled,
          suggestion: {
            pages: compiled.suggestion.pages.map((page) => ({
              ...page,
              panels: page.panels.map((panel) => ({
                ...panel,
                dialogueInPanel: true,
                dialogue: [{
                  entityId: null,
                  text: arcSummary,
                  type: 'narration',
                  position: 'top',
                }, {
                  entityId: '11111111-1111-4111-8111-111111111111',
                  text: authoredSpeech,
                  type: 'speech',
                  position: 'right',
                }],
              })),
            })),
          },
        };
      },
    };
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    auditCompiler.audits = [{
      accepted: false,
      issues: [{
        code: 'dialogue_misplacement',
        severity: 'error',
        pageIds: ['page-1'],
        message: 'Planning context was rendered as narration.',
        repairInstruction: 'Remove the context summary and preserve the authored speech.',
      }],
      panelRepairs: [{
        pageId: 'page-1',
        panelOrder: 1,
        changedFields: ['dialogue'],
        patch: {
          dialogue: [{
            entityId: '11111111-1111-4111-8111-111111111111',
            text: authoredSpeech,
            type: 'speech',
            position: 'right',
          }],
        },
      }],
    }, { accepted: true, issues: [] }];
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      detailCompiler,
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true },
      persistence,
    );

    await expect(service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja'))
      .resolves.toMatchObject({ compilerUsed: true });

    expect(auditCompiler.inputs).toHaveLength(1);
    const savedDialogue = transactionPanelRepository.updatedPanels
      .find((entry) => entry.panelId === 'panel-1')?.input.dialogue;
    expect(savedDialogue).toEqual([{
      entityId: '11111111-1111-4111-8111-111111111111',
      text: authoredSpeech,
      type: 'speech',
      position: 'right',
    }]);
    expect(JSON.stringify(savedDialogue)).not.toContain(arcSummary);
  });

  it('worker経由の通常話全体反映はpage保存とjob完了を同じtransactionへ渡す', async () => {
    const context = buildEpisodePlanningContext();
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = context;
    let completedJobId: string | null = null;
    const persistence = new FakeEpisodePlanPersistence(context, {
      pageRepository: new FakePageRepository(),
      panelRepository: new FakePanelRepository(),
      panelEntityAssignmentService: new FakePanelEntityAssignmentService(),
      completeStoryAutofillJob: async (jobId) => {
        completedJobId = jobId;
        return true;
      },
    });
    const detailCompiler = new FakeEpisodePagePlanCompiler();
    const service = new PageService(
      pageRepository, new FakePanelRepository(), new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(), detailCompiler, undefined,
      new FakeEpisodeBeatPlanCompiler(), new FakeEpisodePlanAuditCompiler(), true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true }, persistence,
    );
    let retryCheckpointCount = 0;

    await expect(service.autofillEpisodeFromStory(
      'user-1', 'episode-1', 'ja', undefined, null,
      {
        jobId: 'job-1',
        checkpoint: async () => { retryCheckpointCount += 1; },
        beginCommit: async () => undefined,
      },
    )).resolves.toMatchObject({ compilerUsed: true });
    expect(completedJobId).toBe('job-1');
    expect(detailCompiler.lastInput?.beforeRetry).toBeDefined();
    const checkpointCountBeforeRetry = retryCheckpointCount;
    await detailCompiler.lastInput?.beforeRetry?.();
    expect(retryCheckpointCount).toBe(checkpointCountBeforeRetry + 1);
  });

  it('legacy claim attemptはbeginCommitとapplying進捗を外側clientへ戻さずbound transactionへ渡す', async () => {
    const context = buildEpisodePlanningContext();
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = context;
    const boundStages: string[] = [];
    const externalStages: string[] = [];
    const attempt: GenerationJob = {
      id: 'job-legacy-1', userId: 'user-1', organizationId: null,
      jobType: 'episode_story_autofill', status: 'processing', generationMode: null,
      creditCost: 0, params: { episode_id: 'episode-1', language: 'ja' }, result: null,
      sqsMessageId: null, openaiRequestId: null, errorMessage: null, retryCount: 2,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      startedAt: new Date('2026-10-01T00:00:01.123Z'), completedAt: null,
      expiresAt: null, cancelRequestedAt: null, cancelRequestedBy: null,
      cancelledAt: null, commitStartedAt: null,
    };
    const persistence = new FakeEpisodePlanPersistence(context, {
      pageRepository: new FakePageRepository(),
      panelRepository: new FakePanelRepository(),
      panelEntityAssignmentService: new FakePanelEntityAssignmentService(),
      storyAutofillCommitStarted: true,
      updateStoryAutofillProgress: async (progress) => {
        boundStages.push(progress.stage);
        return true;
      },
      completeStoryAutofillJob: async () => true,
    });
    const service = new PageService(
      pageRepository, new FakePanelRepository(), new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(), new FakeEpisodePagePlanCompiler(), undefined,
      new FakeEpisodeBeatPlanCompiler(), new FakeEpisodePlanAuditCompiler(), true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true }, persistence,
    );
    let outerBeginCommit = 0;

    await expect(service.autofillEpisodeFromStory(
      'user-1', 'episode-1', 'ja',
      async (progress) => { externalStages.push(progress.stage); },
      null,
      {
        jobId: attempt.id,
        storyAutofillAttempt: attempt,
        checkpoint: async () => undefined,
        beginCommit: async () => { outerBeginCommit += 1; },
      },
    )).resolves.toMatchObject({ jobCompletedAtomically: true });

    expect(persistence.calls[0]?.storyAutofillAttempt).toBe(attempt);
    expect(outerBeginCommit).toBe(0);
    expect(boundStages).toEqual(['applying']);
    expect(externalStages).not.toContain('applying');
  });

  it('worker経由の通常話全体反映はjob完了できなければ成功を返さない', async () => {
    const context = buildEpisodePlanningContext();
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = context;
    const persistence = new FakeEpisodePlanPersistence(context, {
      pageRepository: new FakePageRepository(),
      panelRepository: new FakePanelRepository(),
      panelEntityAssignmentService: new FakePanelEntityAssignmentService(),
      completeStoryAutofillJob: async () => false,
    });
    const service = new PageService(
      pageRepository, new FakePanelRepository(), new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(), new FakeEpisodePagePlanCompiler(), undefined,
      new FakeEpisodeBeatPlanCompiler(), new FakeEpisodePlanAuditCompiler(), true,
      { adaptivePackingEnabled: true, inlineRepairEnabled: true }, persistence,
    );

    await expect(service.autofillEpisodeFromStory(
      'user-1', 'episode-1', 'ja', undefined, null,
      { jobId: 'job-1', checkpoint: async () => undefined, beginCommit: async () => undefined },
    )).rejects.toBeInstanceOf(ConflictError);
  });

  it('worker経由の通常話全体反映は原子的保存が無ければ生成前に拒否する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = buildEpisodePlanningContext();
    const compiler = new FakeEpisodePagePlanCompiler();
    const service = new PageService(
      pageRepository, new FakePanelRepository(), new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(), compiler,
    );

    await expect(service.autofillEpisodeFromStory(
      'user-1', 'episode-1', 'ja', undefined, null,
      { jobId: 'job-1', checkpoint: async () => undefined, beginCommit: async () => undefined },
    )).rejects.toBeInstanceOf(ConfigurationError);
    expect(compiler.inputs).toHaveLength(0);
  });

  it('状態反映v1に必要な全話監査と原子的保存が無い場合は生成前に拒否する', async () => {
    const pageRepository = new FakePageRepository();
    const compiler = new FakeEpisodePagePlanCompiler();
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      compiler,
    );
    await expect(service.autofillEpisodeFromStory(
      'user-1', 'episode-1', 'ja', undefined, null, undefined,
      { statePlanVersion: 'episode_state_plan_v1', stateAssignmentPolicy: 'preserve_existing' },
    )).rejects.toBeInstanceOf(ConfigurationError);
    expect(compiler.inputs).toHaveLength(0);
  });

  it('状態反映v1で詳細生成が失敗した場合は成功扱いにせず保存しない', async () => {
    const context = buildEpisodePlanningContext();
    context.stateLibrary = [];
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = context;
    const pageCompiler = new FakeEpisodePagePlanCompiler();
    pageCompiler.error = new ConfigurationError('Episode detail compiler unavailable');
    const persistence = new FakeEpisodePlanPersistence(context, {
      pageRepository: new FakePageRepository(),
      panelRepository: new FakePanelRepository(),
      panelEntityAssignmentService: new FakePanelEntityAssignmentService(),
    });
    const service = new PageService(
      pageRepository, new FakePanelRepository(), new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(), pageCompiler, undefined,
      new FakeEpisodeBeatPlanCompiler(), new FakeEpisodePlanAuditCompiler(), true,
      { inlineRepairEnabled: true }, persistence,
      { compileStateTransitions: async () => ({
        plan: { transitions: [], unresolved: [] }, compilerProvider: 'openai',
        compilerModel: 'test', compilerPromptVersion: 'episode_state_plan_v1',
      }) },
    );
    let beginCommitCount = 0;
    await expect(service.autofillEpisodeFromStory(
      'user-1', 'episode-1', 'ja', undefined, null,
      { jobId: 'job-1', checkpoint: async () => undefined, beginCommit: async () => { beginCommitCount += 1; } },
      { statePlanVersion: 'episode_state_plan_v1', stateAssignmentPolicy: 'preserve_existing' },
    )).rejects.toBeInstanceOf(ConfigurationError);
    expect(beginCommitCount).toBe(0);
    expect(persistence.calls).toHaveLength(0);
  });

  it('状態反映v1は1回の監査後に確定状態を割り当てて原子的保存へ渡す', async () => {
    const stateId = '22222222-2222-4222-8222-222222222222';
    const context = buildEpisodePlanningContext();
    context.episode.storyFullDraft = '1ページ目：負傷状態を保ったまま前へ進む。';
    context.episode.startingEntityStates = [];
    // Explicit v1 overwrite may replace a prior manual state, unlike legacy requests.
    const legacyCompiled = await new FakeEpisodePagePlanCompiler().compilePlan({ compilerBrief: '', language: 'ja' });
    context.pages[0]!.panels[0]!.entities = [{
      ...legacyCompiled.suggestion.pages[0]!.panels[0]!.entities![0]!, stateId: 'old-manual-state',
    }];
    context.stateLibrary = [{
      entityId: '11111111-1111-4111-8111-111111111111',
      stateId, name: '負傷', description: '腕に包帯', revision: '2026-10-01T00:00:00.000Z',
      baseRefId: 'base-ref', baseRefUpdatedAt: '2026-10-01T00:00:00.000Z',
      referenceImage: {
        refId: 'state-ref', s3Key: 'private/state.png',
        storageOwnerUserId: '11111111-1111-4111-8111-111111111111',
        imageModel: 'gpt-image-2', baseRefId: 'base-ref',
        createdAt: '2026-10-01T00:00:00.000Z', inputFingerprint: 'fingerprint',
      },
      referenceReady: true,
    }];
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = context;
    const transactionAssignments = new FakePanelEntityAssignmentService();
    let atomicCompleted = 0;
    const persistence = new FakeEpisodePlanPersistence(context, {
      pageRepository: new FakePageRepository(),
      panelRepository: new FakePanelRepository(),
      panelEntityAssignmentService: transactionAssignments,
      completeStoryAutofillJob: async () => { atomicCompleted += 1; return true; },
    });
    let proposedStateTransitions = [{
      entityId: '11111111-1111-4111-8111-111111111111',
      stateId,
      startsAtPanelId: 'panel-1',
      sourceSceneId: null,
      sourceField: 'middle' as const,
      sourceQuote: 'Tension rises',
    }];
    let retryCheckpointCount = 0;
    const stateCompiler = {
      compileStateTransitions: async (input: CompileEpisodeStateTransitionInput) => {
        expect(input.beforeRetry).toBeDefined();
        await input.beforeRetry?.();
        retryCheckpointCount += 1;
        return {
          plan: { transitions: proposedStateTransitions, unresolved: [] },
          compilerProvider: 'openai' as const,
          compilerModel: 'test',
          compilerPromptVersion: 'episode_state_plan_v1',
        };
      },
    };
    const pageCompiler = new FakeEpisodePagePlanCompiler();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    const service = new PageService(
      pageRepository, new FakePanelRepository(), new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(), pageCompiler, undefined,
      new FakeEpisodeBeatPlanCompiler(), auditCompiler, true,
      { inlineRepairEnabled: true }, persistence, stateCompiler,
    );
    let beginCommitCount = 0;
    const result = await service.autofillEpisodeFromStory(
      'user-1', 'episode-1', 'ja', undefined, null,
      { jobId: 'job-1', checkpoint: async () => undefined, beginCommit: async () => { beginCommitCount += 1; } },
      { statePlanVersion: 'episode_state_plan_v1', stateAssignmentPolicy: 'overwrite_existing' },
    );
    expect(beginCommitCount).toBe(1);
    expect(transactionAssignments.updates).toHaveLength(1);
    expect(transactionAssignments.updates[0]?.assignments[0]?.stateId).toBe(stateId);
    expect(result.stateTransitions).toHaveLength(1);
    expect(atomicCompleted).toBe(1);
    expect(retryCheckpointCount).toBe(1);
    expect(pageCompiler.inputs[0]?.compilerBrief).toContain(stateId);
    expect(auditCompiler.inputs[0]?.compilerBrief).toContain(stateId);
    expect(pageCompiler.inputs[0]?.sourceOwnedPageContext).toBeUndefined();
    expect(auditCompiler.inputs[0]?.sourceOwnedPageContext).toBe(false);
    expect(auditCompiler.inputs).toHaveLength(1);
    expect(auditCompiler.inputs.every((input) => input.groundingAuthorities?.some(
      (authority) => authority.ref === 'validated_state'
        && authority.kind === 'validated_state'
        && authority.text.includes(stateId),
    ) === true)).toBe(true);
    context.pages[0]!.panels[0]!.entities = [{
      ...transactionAssignments.updates[0]!.assignments[0]!, stateId: null,
    }];
    await expect(service.autofillEpisodeFromStory(
      'user-1', 'episode-1', 'ja', undefined, null,
      { jobId: 'job-1', checkpoint: async () => undefined, beginCommit: async () => { beginCommitCount += 1; } },
      { statePlanVersion: 'episode_state_plan_v1', stateAssignmentPolicy: 'preserve_existing' },
    )).rejects.toMatchObject({ code: 'STATE_ASSIGNMENT_CONFLICT' });
    expect(beginCommitCount).toBe(1);
    expect(transactionAssignments.updates).toHaveLength(1);
    expect(atomicCompleted).toBe(1);
    const defaultFillResult = await service.autofillEpisodeFromStory(
      'user-1', 'episode-1', 'ja', undefined, null,
      { jobId: 'job-1', checkpoint: async () => undefined, beginCommit: async () => { beginCommitCount += 1; } },
      {
        statePlanVersion: 'episode_state_plan_v1',
        stateAssignmentPolicy: 'preserve_existing',
        allowUnassignedStateFill: true,
      },
    );
    expect(defaultFillResult.stateTransitions).toHaveLength(1);
    expect(transactionAssignments.updates[1]?.assignments[0]?.stateId).toBe(stateId);
    expect(beginCommitCount).toBe(2);
    expect(atomicCompleted).toBe(2);
    proposedStateTransitions = [];
    auditCompiler.errors = [
      null,
      new ConfigurationError('OpenAI episode plan audit compiler returned invalid JSON'),
    ];
    auditCompiler.audits = [{
      accepted: false,
      issues: [{
        code: 'timeline_discontinuity', severity: 'error', pageIds: ['page-1'],
        message: 'Page 1 rewinds the scene', repairInstruction: 'Continue the scene',
      }],
      panelRepairs: [{
        pageId: 'page-1',
        panelOrder: 1,
        changedFields: ['situationText'],
        patch: { situationText: 'Page 1 now continues the scene.' },
      }],
    }];
    const auditInputCountBeforeFallback = auditCompiler.inputs.length;
    const fallbackResult = await service.autofillEpisodeFromStory(
      'user-1', 'episode-1', 'ja', undefined, null,
      { jobId: 'job-1', checkpoint: async () => undefined, beginCommit: async () => { beginCommitCount += 1; } },
      { statePlanVersion: 'episode_state_plan_v1', stateAssignmentPolicy: 'overwrite_existing' },
    );
    expect(fallbackResult.stateTransitions).toEqual([]);
    expect(auditCompiler.inputs).toHaveLength(auditInputCountBeforeFallback + 1);
    expect(beginCommitCount).toBe(3);
    expect(transactionAssignments.updates).toHaveLength(3);
    expect(atomicCompleted).toBe(3);
  });

  it('continuity v3 はscene未割当でも同じentityの登録済みREADY状態を生成結果へ使用できる', async () => {
    const entityId = '11111111-1111-4111-8111-111111111111';
    const stateId = '22222222-2222-4222-8222-222222222222';
    const context = buildEpisodePlanningContext();
    context.scenes[0]!.entityStates = [];
    context.stateLibrary = [{
      entityId,
      stateId,
      name: '負傷',
      description: '腕に包帯',
      revision: '2026-10-13T00:00:00.000Z',
      baseRefId: 'base-ref',
      baseRefUpdatedAt: '2026-10-13T00:00:00.000Z',
      referenceImage: {
        refId: 'state-ref',
        s3Key: 'private/state.png',
        storageOwnerUserId: entityId,
        imageModel: 'gpt-image-2',
        baseRefId: 'base-ref',
        createdAt: '2026-10-13T00:00:00.000Z',
        inputFingerprint: 'fingerprint',
      },
      referenceReady: true,
    }];
    const baseCompiler = new FakeEpisodePagePlanCompiler();
    const pageCompiler: EpisodePagePlanCompilerPort = {
      async compilePlan(input): Promise<CompiledEpisodePagePlan> {
        const compiled = await baseCompiler.compilePlan(input);
        compiled.suggestion.pages[0]!.panels[0]!.entities![0]!.stateId = stateId;
        return compiled;
      },
    };
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = context;
    const assignmentService = new FakePanelEntityAssignmentService();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      assignmentService,
      new FakePageAutofillCompiler(),
      pageCompiler,
      undefined,
      new FakeEpisodeBeatPlanCompiler(),
      auditCompiler,
      true,
      { inlineRepairEnabled: true },
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    expect(result.compilerUsed).toBe(true);
    expect(auditCompiler.inputs).toHaveLength(1);
    expect(assignmentService.updates[0]?.assignments[0]?.stateId).toBe(stateId);
  });

  it.each([
    ['unknown', '33333333-3333-4333-8333-333333333333', null, true, null],
    ['foreign', '22222222-2222-4222-8222-222222222222',
      '22222222-2222-4222-8222-222222222222', true,
      '44444444-4444-4444-8444-444444444444'],
    ['unready', '22222222-2222-4222-8222-222222222222',
      '22222222-2222-4222-8222-222222222222', false, null],
  ] as const)(
    'continuity v3 はscene未割当の%s状態を生成結果で参照したら保存しない',
    async (_case, assignedStateId, libraryStateId, referenceReady, foreignEntityId) => {
      const entityId = '11111111-1111-4111-8111-111111111111';
      const context = buildEpisodePlanningContext();
      context.scenes[0]!.entityStates = [];
      context.stateLibrary = libraryStateId === null ? [] : [{
        entityId: foreignEntityId ?? entityId,
        stateId: libraryStateId,
        name: '負傷',
        description: '腕に包帯',
        revision: '2026-10-13T00:00:00.000Z',
        baseRefId: 'base-ref',
        baseRefUpdatedAt: '2026-10-13T00:00:00.000Z',
        referenceImage: referenceReady ? {
          refId: 'state-ref',
          s3Key: 'private/state.png',
          storageOwnerUserId: foreignEntityId ?? entityId,
          imageModel: 'gpt-image-2',
          baseRefId: 'base-ref',
          createdAt: '2026-10-13T00:00:00.000Z',
          inputFingerprint: 'fingerprint',
        } : null,
        referenceReady,
      }];
      const baseCompiler = new FakeEpisodePagePlanCompiler();
      const pageCompiler: EpisodePagePlanCompilerPort = {
        async compilePlan(input): Promise<CompiledEpisodePagePlan> {
          const compiled = await baseCompiler.compilePlan(input);
          compiled.suggestion.pages[0]!.panels[0]!.entities![0]!.stateId = assignedStateId;
          return compiled;
        },
      };
      const pageRepository = new FakePageRepository();
      pageRepository.episodePlanningContext = context;
      const panelRepository = new FakePanelRepository();
      const assignmentService = new FakePanelEntityAssignmentService();
      const service = new PageService(
        pageRepository,
        panelRepository,
        assignmentService,
        new FakePageAutofillCompiler(),
        pageCompiler,
        undefined,
        new FakeEpisodeBeatPlanCompiler(),
        new FakeEpisodePlanAuditCompiler(),
        true,
        { inlineRepairEnabled: true },
      );

      await expect(service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja'))
        .rejects.toThrow('state outside the episode');
      expect(pageRepository.updatedInputs).toHaveLength(0);
      expect(panelRepository.updatedPanels).toHaveLength(0);
      expect(assignmentService.updates).toHaveLength(0);
    },
  );

  it('通常状態への復帰は詳細生成と監査へstate_id=nullとして渡す', async () => {
    const context = buildEpisodePlanningContext();
    context.episode.startingEntityStates = [];
    context.stateLibrary = [];
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = context;
    const pageCompiler = new FakeEpisodePagePlanCompiler();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    const persistence = new FakeEpisodePlanPersistence(context, {
      pageRepository: new FakePageRepository(), panelRepository: new FakePanelRepository(),
      panelEntityAssignmentService: new FakePanelEntityAssignmentService(),
      completeStoryAutofillJob: async () => true,
    });
    const stateCompiler = {
      compileStateTransitions: async () => ({
        plan: {
          transitions: [{
            entityId: '11111111-1111-4111-8111-111111111111', stateId: null,
            startsAtPanelId: 'panel-1', sourceSceneId: null,
            sourceField: 'middle' as const, sourceQuote: 'Tension rises',
          }], unresolved: [],
        }, compilerProvider: 'openai' as const, compilerModel: 'test',
        compilerPromptVersion: 'episode_state_transition_v2',
      }),
    };
    const service = new PageService(
      pageRepository, new FakePanelRepository(), new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(), pageCompiler, undefined,
      new FakeEpisodeBeatPlanCompiler(), auditCompiler, true,
      { inlineRepairEnabled: true }, persistence, stateCompiler,
    );
    await service.autofillEpisodeFromStory(
      'user-1', 'episode-1', 'ja', undefined, null,
      { jobId: 'job-1', checkpoint: async () => undefined, beginCommit: async () => undefined },
      { statePlanVersion: 'episode_state_plan_v1', stateAssignmentPolicy: 'overwrite_existing' },
    );
    expect(pageCompiler.inputs[0]?.compilerBrief).toContain('state_id=null');
    expect(pageCompiler.inputs[0]?.compilerBrief).not.toContain('state_id=default');
    expect(auditCompiler.inputs[0]?.compilerBrief).toContain('state_id=null');
    expect(auditCompiler.inputs).toHaveLength(1);
  });

  it('自動状態反映はREADY状態を維持し未登録の負傷を視覚描写として原子的に保存する', async () => {
    const entityId = '11111111-1111-4111-8111-111111111111';
    const readyStateId = '22222222-2222-4222-8222-222222222222';
    const pendingStateId = '33333333-3333-4333-8333-333333333333';
    const context = buildEpisodePlanningContext();
    context.episode.storyFullDraft = 'Tension rises and Minerva injures her left arm.';
    context.episode.startingEntityStates = [];
    context.stateLibrary = [
      {
        entityId, stateId: readyStateId, name: '鬼', description: '登'.repeat(2_000),
        revision: '2026-10-13T00:00:00.000Z', baseRefId: 'base-ref',
        baseRefUpdatedAt: '2026-10-13T00:00:00.000Z', referenceReady: true,
        referenceImage: {
          refId: 'ready-ref', s3Key: 'private/ready.png', storageOwnerUserId: entityId,
          imageModel: 'gpt-image-2', baseRefId: 'base-ref',
          createdAt: '2026-10-13T00:00:00.000Z', inputFingerprint: 'ready-fingerprint',
        },
      },
      {
        entityId, stateId: pendingStateId, name: '負傷', description: '左腕に包帯を巻いている',
        revision: '2026-10-13T00:00:00.000Z', baseRefId: 'base-ref',
        baseRefUpdatedAt: '2026-10-13T00:00:00.000Z', referenceReady: false,
        referenceImage: null,
      },
    ];
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = context;
    const transactionPanels = new FakePanelRepository();
    const transactionAssignments = new FakePanelEntityAssignmentService();
    const persistence = new FakeEpisodePlanPersistence(context, {
      pageRepository: new FakePageRepository(), panelRepository: transactionPanels,
      panelEntityAssignmentService: transactionAssignments,
      completeStoryAutofillJob: async () => true,
    });
    const stateCompiler = {
      compileStateTransitions: async () => ({
        plan: {
          transitions: [{
            entityId, stateId: readyStateId, startsAtPanelId: 'panel-1',
            sourceSceneId: null, sourceField: 'middle' as const, sourceQuote: 'Tension rises',
          }],
          unresolved: [{
            entityId, candidateStateId: pendingStateId, startsAtPanelId: 'panel-1',
            suggestedName: '負傷', suggestedDescription: '左腕に包帯を巻いている',
            sourceSceneId: null, sourceField: 'story_full_draft' as const,
            sourceQuote: 'injures her left arm', reason: 'missing_reference' as const,
          }],
        },
        compilerProvider: 'openai' as const, compilerModel: 'test',
        compilerPromptVersion: 'episode_state_transition_v2',
      }),
    };
    const service = new PageService(
      pageRepository, new FakePanelRepository(), new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(), new FakeEpisodePagePlanCompiler(), undefined,
      new FakeEpisodeBeatPlanCompiler(), new FakeEpisodePlanAuditCompiler(), true,
      { inlineRepairEnabled: true }, persistence, stateCompiler,
    );

    await expect(service.autofillEpisodeFromStory(
      'user-1', 'episode-1', 'ja', undefined, null,
      { jobId: 'job-1', checkpoint: async () => undefined, beginCommit: async () => undefined },
      {
        statePlanVersion: 'episode_state_plan_v1', stateAssignmentPolicy: 'overwrite_existing',
        allowVisualStateFallback: true,
      },
    )).resolves.toMatchObject({ stateTransitions: [{ stateId: readyStateId }] });

    expect(transactionAssignments.updates[0]?.assignments[0]?.stateId).toBe(readyStateId);
    expect(transactionPanels.updatedPanels[0]?.input.situationText).toContain('鬼');
    expect(transactionPanels.updatedPanels[0]?.input.situationText).not.toContain('登'.repeat(2_000));
    expect(transactionPanels.updatedPanels[0]?.input.situationText).toContain('左腕に包帯');
    expect(transactionPanels.updatedPanels[0]?.input.composition?.compositionPrompt).toContain('鬼');
    expect(transactionPanels.updatedPanels[0]?.input.composition?.compositionPrompt).not.toContain('登'.repeat(2_000));
    expect(transactionPanels.updatedPanels[0]?.input.composition?.compositionPrompt).toContain('左腕に包帯');
  });

  it('複数人物の長い視覚overlayが既存panel文字数上限を超える場合は何も保存しない', async () => {
    const firstEntityId = '11111111-1111-4111-8111-111111111111';
    const secondEntityId = '44444444-4444-4444-8444-444444444444';
    const context = buildEpisodePlanningContext();
    context.episode.storyFullDraft = 'Tension rises for both characters.';
    context.entities.push({
      id: secondEntityId, name: 'Second', entityType: 'character', freeDescription: null,
      promptSupplement: null, structuredFields: {},
    });
    context.stateLibrary = [];
    const baseCompiler = new FakeEpisodePagePlanCompiler();
    const pageCompiler: EpisodePagePlanCompilerPort = {
      async compilePlan(input): Promise<CompiledEpisodePagePlan> {
        const compiled = await baseCompiler.compilePlan(input);
        const first = compiled.suggestion.pages[0]!.panels[0]!.entities![0]!;
        compiled.suggestion.pages[0]!.panels[0]!.entities = [
          first,
          { ...first, entityId: secondEntityId, role: 'secondary' },
        ];
        return compiled;
      },
    };
    const pageRepository = new FakePageRepository();
    pageRepository.episodePlanningContext = context;
    const transactionPanels = new FakePanelRepository();
    const transactionAssignments = new FakePanelEntityAssignmentService();
    const persistence = new FakeEpisodePlanPersistence(context, {
      pageRepository: new FakePageRepository(), panelRepository: transactionPanels,
      panelEntityAssignmentService: transactionAssignments,
      completeStoryAutofillJob: async () => true,
    });
    const longDescription = '視覚差分'.repeat(155);
    const stateCompiler = {
      compileStateTransitions: async () => ({
        plan: {
          transitions: [],
          unresolved: [firstEntityId, secondEntityId].map((entityId) => ({
            entityId, candidateStateId: null, startsAtPanelId: 'panel-1',
            suggestedName: '継続状態', suggestedDescription: longDescription,
            sourceSceneId: null, sourceField: 'middle' as const, sourceQuote: 'Tension rises',
            reason: 'missing_reference' as const,
          })),
        },
        compilerProvider: 'openai' as const, compilerModel: 'test',
        compilerPromptVersion: 'episode_state_transition_v2',
      }),
    };
    const service = new PageService(
      pageRepository, new FakePanelRepository(), new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(), pageCompiler, undefined,
      new FakeEpisodeBeatPlanCompiler(), new FakeEpisodePlanAuditCompiler(), true,
      { inlineRepairEnabled: true }, persistence, stateCompiler,
    );
    let beginCommitCount = 0;

    await expect(service.autofillEpisodeFromStory(
      'user-1', 'episode-1', 'ja', undefined, null,
      {
        jobId: 'job-1', checkpoint: async () => undefined,
        beginCommit: async () => { beginCommitCount += 1; },
      },
      {
        statePlanVersion: 'episode_state_plan_v1', stateAssignmentPolicy: 'overwrite_existing',
        allowVisualStateFallback: true,
      },
    )).rejects.toMatchObject({ code: 'STATE_PLAN_INVALID' });
    expect(persistence.calls).toHaveLength(0);
    expect(transactionPanels.updatedPanels).toHaveLength(0);
    expect(transactionAssignments.updates).toHaveLength(0);
    expect(beginCommitCount).toBe(0);
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

  it.each([
    ['scene なし', false],
    ['scene あり', true],
  ] as const)('continuity v3 は最大長の全文草稿を%sでも全 compiler に欠落なく渡す', async (_label, withScenes) => {
    const pageRepository = new FakePageRepository();
    const base = buildMultiPageEpisodePlanningContext(10);
    const start = 'FULL-DRAFT-BEGIN「最初の引用を保持する」';
    const middle = 'FULL-DRAFT-MIDDLE 小石を除いてから扉を押し直す。';
    const end = 'FULL-DRAFT-END「最後の引用を保持する」';
    const fillerLength = 8_000 - start.length - middle.length - end.length;
    const storyFullDraft = `${start}${'あ'.repeat(Math.floor(fillerLength / 2))}${middle}${'い'.repeat(Math.ceil(fillerLength / 2))}${end}`;
    expect(storyFullDraft).toHaveLength(8_000);
    pageRepository.episodePlanningContext = {
      ...base,
      episode: { ...base.episode, storyFullDraft },
      scenes: withScenes ? base.scenes : [],
    };
    const episodeCompiler = new ChunkAwareEpisodePagePlanCompiler();
    episodeCompiler.sourceSceneIds = withScenes ? ['scene-1'] : [];
    const beatPlanCompiler = new FakeEpisodeBeatPlanCompiler();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      beatPlanCompiler,
      auditCompiler,
      true,
    );

    await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');

    const briefs = [
      ...beatPlanCompiler.outlineInputs.map((input) => input.compilerBrief),
      ...beatPlanCompiler.inputs.map((input) => input.compilerBrief),
      ...episodeCompiler.inputs.map((input) => input.compilerBrief),
      ...auditCompiler.inputs.map((input) => input.compilerBrief),
    ];
    expect(beatPlanCompiler.outlineInputs).toHaveLength(0);
    expect(beatPlanCompiler.inputs).toHaveLength(1);
    expect(episodeCompiler.inputs.length).toBeGreaterThan(1);
    expect(auditCompiler.inputs).toHaveLength(1);
    expect(briefs.length).toBeGreaterThan(5);
    for (const brief of briefs) {
      expect(brief).toContain('[FULL STORY DRAFT - SOURCE DATA]');
      expect(brief).toContain(storyFullDraft);
      expect(brief).toContain(start);
      expect(brief).toContain(middle);
      expect(brief).toContain(end);
    }
  });

  it('continuity v3 は保存契約を超える全文草稿を切り捨てず provider 呼び出し前に拒否する', async () => {
    const pageRepository = new FakePageRepository();
    const base = buildMultiPageEpisodePlanningContext(10);
    pageRepository.episodePlanningContext = {
      ...base,
      episode: { ...base.episode, storyFullDraft: '長'.repeat(8_001) },
    };
    const episodeCompiler = new ChunkAwareEpisodePagePlanCompiler();
    const beatPlanCompiler = new FakeEpisodeBeatPlanCompiler();
    const auditCompiler = new FakeEpisodePlanAuditCompiler();
    const service = new PageService(
      pageRepository,
      new FakePanelRepository(),
      new FakePanelEntityAssignmentService(),
      new FakePageAutofillCompiler(),
      episodeCompiler,
      undefined,
      beatPlanCompiler,
      auditCompiler,
      true,
    );

    const result = await service.autofillEpisodeFromStory('user-1', 'episode-1', 'ja');
    expect(result).toMatchObject({
      compilerUsed: false,
      compilerError: 'Episode full story draft exceeds the prompt source limit',
      updatedPageCount: 0,
      updatedPanelCount: 0,
      updatedAssignmentCount: 0,
    });
    expect(beatPlanCompiler.outlineInputs).toHaveLength(0);
    expect(beatPlanCompiler.inputs).toHaveLength(0);
    expect(episodeCompiler.inputs).toHaveLength(0);
    expect(auditCompiler.inputs).toHaveLength(0);
  });

  it('episode story plan は sparse compiler suggestion の演出を補完し entities 未指定は変更しない', async () => {
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
      updatedAssignmentCount: 0,
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
    expect(assignmentService.updates).toHaveLength(0);
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
        assignments: [],
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
    expect(assignmentService.updates).toHaveLength(0);
    const assignedEntityIds = assignmentService.updates.flatMap((update) =>
      update.assignments.map((assignment) => assignment.entityId),
    );
    expect(assignedEntityIds).not.toContain('shadow-entity');
  });

  it('episode story plan は話者付きセリフの 未登場話者と不明な話者を別人へ付け替えない', async () => {
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
        entityId: null,
        text: 'ここで立ち止まるわけにはいかない。',
      }),
      expect.objectContaining({
        type: 'thought',
        entityId: '22222222-2222-4222-8222-222222222222',
        text: '……まだ整理しきれない。',
      }),
      expect.objectContaining({
        type: 'shout',
        entityId: '33333333-3333-4333-8333-333333333333',
        text: '前を見て！',
      }),
      expect.objectContaining({
        type: 'whisper',
        entityId: null,
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

  it('episode story plan は 話者未指定の音声を表示中の人物へ推測割当しない', async () => {
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
        entityId: null,
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

  it('episode story plan は off-panel thought を本人に保持する', async () => {
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
          layoutConfig: { type: 'template', template_id: 'climax_2', panel_count: 2 },
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
        entityId: '33333333-3333-4333-8333-333333333333',
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

function buildSourceV6FifteenPageContext(): EpisodePagePlanContext {
  const context = buildMultiPageEpisodePlanningContext(15);
  return {
    ...context,
    episode: {
      ...context.episode,
      storyFullDraft: [
        '全15ページで主人公の姿と道具を保つ。',
        ...context.pages.map((page) => [
          `${page.pageNumber}ページ目：場面${page.pageNumber}を始める。`,
          `道具${page.pageNumber}を確認する。`,
          `進路${page.pageNumber}を選ぶ。`,
          `障害${page.pageNumber}へ近づく。`,
          `手順${page.pageNumber}を実行する。`,
          `結果${page.pageNumber}を確かめる。`,
          `次の場面${page.pageNumber + 1}へ進む。`,
        ].join('')),
      ].join('\n'),
    },
    pages: context.pages.map((page) => ({
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
