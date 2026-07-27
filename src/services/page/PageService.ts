import {
  ConfigurationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../domain/errors/index.js';
import { distributeStoryBeats } from '../../domain/storyBeatDistribution.js';
import {
  canonicalizeEntityMentionsInText,
  extractEntityAliases,
  inferEntityIdsFromTexts,
} from '../../domain/entityAliases.js';
import type { AppLanguage } from '../../domain/types/language.js';
import { STORY_PROMPT_CONTEXT_LIMITS } from '../../domain/storyPromptCompaction.js';
import { STORY_AI_LIMITS } from '../../domain/constants/storyAi.js';
import {
  packEpisodeBeatPlanLedgerPages,
  packEpisodePlanPages,
} from '../../domain/episodePlanPacking.js';
import {
  buildPanelFrameTemplateInputs,
  resolveDefaultPanelFrameTemplateId,
} from '../../domain/constants/panelFrameTemplates.js';
import type {
  EpisodePagePlanApplyResult,
  EpisodePagePlanContext,
  EpisodePagePlanPageSuggestion,
  EpisodePagePlanSuggestion,
  PageAutofillContext,
  PageAutofillPanelContext,
  PageAutofillPanelSuggestion,
  PageAutofillResult,
  PageAutofillSuggestion,
  PageSummary,
  UpdatePageSettingsInput,
} from '../../domain/types/page.js';
import type { PanelComposition, PanelDialogueLine, UpdatePanelInput } from '../../domain/types/panel.js';
import type { PanelEntityAssignment } from '../../domain/types/panelEntityAssignment.js';
import type { PageRepository } from '../../repositories/PageRepository.js';
import type { PanelRepository } from '../../repositories/PanelRepository.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';
import type { StyleReferenceCompilerPort } from '../style/StyleReferenceCompiler.js';
import { resolveStyleReferenceForPersistence } from '../style/styleReferencePersistence.js';
import type { PanelEntityAssignmentServicePort } from './PanelEntityAssignmentService.js';
import type { PageAutofillCompilerPort } from './PageAutofillCompiler.js';
import type { EpisodePagePlanCompilerPort } from './EpisodePagePlanCompiler.js';
import {
  EpisodeBeatPlanOutputLimitError,
  type CompiledEpisodeBeatPlan,
  type EpisodeBeatPlanCompilerPort,
  type EpisodeBeatPlanOutline,
  type EpisodeBeatPlanOutlineCompilerPort,
  type EpisodeBeatPlanPage,
} from './EpisodeBeatPlanCompiler.js';
import type {
  EpisodePlanPersistencePort,
  EpisodePlanPersistenceResources,
} from './EpisodePlanPersistence.js';
import type {
  EpisodePlanAudit,
  EpisodePlanAuditIssue,
  EpisodePlanAuditCompilerPort,
} from './EpisodePlanAuditCompiler.js';
import {
  applyEpisodePlanAuditRepairs,
  hasBlockingEpisodePlanAuditIssues,
} from './EpisodePlanReviewRepair.js';
import {
  buildEpisodeBeatPlanCompilerBrief,
  buildEpisodeBeatPlanOutlineCompilerBrief,
  buildEpisodeBeatPlanSegmentCompilerBrief,
  buildEpisodeDetailContinuitySupplement,
  buildEpisodePlanAuditBrief,
  detectDeterministicContinuityIssues,
  fingerprintEpisodePlanningContext,
  mergeEpisodePlanAuditIssues,
  validateEpisodeBeatPlanCoverage,
  validateEpisodeBeatPlanOutlineCoverage,
} from './EpisodePlanContinuity.js';

export interface PageServicePort {
  updatePageSettings(
    userId: string,
    pageId: string,
    input: UpdatePageSettingsInput,
    organizationId?: string | null,
  ): Promise<PageSummary>;
  autofillFromScenes(
    userId: string,
    pageId: string,
    language: AppLanguage,
    organizationId?: string | null,
  ): Promise<PageAutofillResult>;
  autofillEpisodeFromStory(
    userId: string,
    episodeId: string,
    language: AppLanguage,
    progressReporter?: EpisodePagePlanProgressReporter,
    organizationId?: string | null,
    executionControl?: EpisodePagePlanExecutionControl,
  ): Promise<EpisodePagePlanApplyResult>;
}

export interface EpisodePagePlanExecutionControl {
  checkpoint(): Promise<void>;
  beginCommit(): Promise<void>;
}

export interface EpisodePagePlanProgress {
  stage:
    | 'planning_episode'
    | 'compiling_chunk'
    | 'compiled_chunk'
    | 'auditing_episode'
    | 'repairing_chunk'
    | 'applying';
  message: string;
  currentChunk: number | null;
  totalChunks: number | null;
}

export type EpisodePagePlanProgressReporter =
  (progress: EpisodePagePlanProgress) => Promise<void> | void;

export interface EpisodePlanReliabilityOptions {
  adaptivePackingEnabled?: boolean;
  inlineRepairEnabled?: boolean;
}

interface AutofillExecutionResult {
  suggestion: PageAutofillSuggestion;
  compilerUsed: boolean;
  compilerProvider: 'openai' | 'fallback';
  compilerModel: string | null;
  compilerPromptVersion: string | null;
  compilerError: string | null;
}

interface EpisodePlanExecutionResult {
  suggestion: EpisodePagePlanSuggestion;
  compilerUsed: boolean;
  compilerProvider: 'openai' | 'fallback';
  compilerModel: string | null;
  compilerPromptVersion: string | null;
  compilerError: string | null;
}

interface PanelMergeResult {
  panelUpdate: UpdatePanelInput | null;
  assignments: PanelEntityAssignment[] | null;
  filledFieldCount: number;
}

const EPISODE_PAGE_PLAN_COMPILER_PAGE_CHUNK_SIZE = 3;

/**
 * Handles page-level editing concerns so the UI can update page behavior and
 * ask for scene-derived panel autofill without leaking orchestration into the
 * routes layer.
 */
export class PageService implements PageServicePort {
  public constructor(
    private readonly pageRepository: PageRepository,
    private readonly panelRepository?: PanelRepository,
    private readonly panelEntityAssignmentService?: PanelEntityAssignmentServicePort,
    private readonly pageAutofillCompiler?: PageAutofillCompilerPort,
    private readonly episodePagePlanCompiler?: EpisodePagePlanCompilerPort,
    private readonly styleReferenceCompiler?: StyleReferenceCompilerPort,
    private readonly episodeBeatPlanCompiler?:
      EpisodeBeatPlanCompilerPort & Partial<EpisodeBeatPlanOutlineCompilerPort>,
    private readonly episodePlanAuditCompiler?: EpisodePlanAuditCompilerPort,
    private readonly episodePlanContinuityV3Enabled = false,
    private readonly episodePlanReliabilityOptions: EpisodePlanReliabilityOptions = {},
    private readonly episodePlanPersistence?: EpisodePlanPersistencePort,
  ) {}

  public async updatePageSettings(
    userId: string,
    pageId: string,
    input: UpdatePageSettingsInput,
    organizationId: string | null = null,
  ): Promise<PageSummary> {
    return this.updatePageSettingsWithRepository(
      this.pageRepository,
      userId,
      pageId,
      input,
      organizationId,
    );
  }

  private async updatePageSettingsWithRepository(
    pageRepository: PageRepository,
    userId: string,
    pageId: string,
    input: UpdatePageSettingsInput,
    organizationId: string | null,
  ): Promise<PageSummary> {
    const page = await pageRepository.findPageByIdAndUserId(pageId, userId, organizationId);
    if (page === null) {
      throw new NotFoundError('Page not found');
    }

    ensurePageEditable(page.status, 'page settings');

    const nextStyleReference =
      input.styleReference === undefined
        ? undefined
        : await resolveStyleReferenceForPersistence({
            nextStyleReference:
              input.styleReference === null ? null : toRecord(input.styleReference),
            currentStyleReference: page.layoutConfig.style_reference,
            target: 'manga_page',
            compiler: this.styleReferenceCompiler,
          });

    const nextInput: UpdatePageSettingsInput =
      nextStyleReference === undefined ? input : { ...input, styleReference: nextStyleReference };

    const nextLayoutConfig = buildNextPageLayoutConfig(page, nextInput);
    const persistedInput: UpdatePageSettingsInput =
      nextLayoutConfig === undefined
        ? nextInput
        : {
            ...nextInput,
            layoutConfig: nextLayoutConfig,
          };

    const updatedPage = await pageRepository.updatePageSettings(pageId, userId, persistedInput, organizationId);
    if (updatedPage === null) {
      throw new NotFoundError('Page not found');
    }

    return updatedPage;
  }

  public async autofillFromScenes(
    userId: string,
    pageId: string,
    language: AppLanguage,
    organizationId: string | null = null,
  ): Promise<PageAutofillResult> {
    if (
      this.panelRepository === undefined ||
      this.panelEntityAssignmentService === undefined ||
      this.pageAutofillCompiler === undefined
    ) {
      throw new ConfigurationError('Page autofill service is not fully configured');
    }

    const context = await this.pageRepository.findAutofillContextByIdAndUserId(pageId, userId, organizationId);
    if (context === null) {
      throw new NotFoundError('Page not found');
    }

    ensurePageEditable(context.status, 'scene autofill');
    if (context.frameCount === 0) {
      throw new ValidationError('Page must have frames before scene autofill can run');
    }
    if (context.panels.length !== context.frameCount) {
      throw new ValidationError('Page panel count must match frame count before scene autofill can run');
    }

    const compiled = await this.compileAutofillSafely(context, language);
    const fallbackSuggestion = compiled.compilerUsed
      ? buildFallbackAutofillSuggestion(context, language)
      : { panels: [] };

    let updatedPanelCount = 0;
    let filledFieldCount = 0;

    if (
      compiled.suggestion.page?.dialogueMode !== undefined ||
      compiled.suggestion.page?.pageDialogueToggle !== undefined
    ) {
      const nextPageSettings = mergePageSettings(context, compiled.suggestion.page);
      if (nextPageSettings !== null) {
        await this.updatePageSettings(userId, pageId, nextPageSettings, organizationId);
      }
    }

    const suggestionsByOrder = new Map(
      compiled.suggestion.panels.map((suggestion) => [suggestion.order, suggestion] as const),
    );
    const fallbackSuggestionsByOrder = new Map(
      fallbackSuggestion.panels.map((suggestion) => [suggestion.order, suggestion] as const),
    );
    const entityLookup = new Map(context.entities.map((entity) => [entity.id, entity] as const));
    const storyLeadEntityId =
      inferFallbackEntityIds(
        context.entities,
        Array.from(new Set(context.scenes.flatMap((scene) => scene.involvedEntityIds))),
        [
          context.episodePurpose,
          context.introduction,
          context.middle,
          context.climax,
          context.endingHook,
          ...context.scenes.flatMap((scene) => [scene.location, scene.time, scene.atmosphere]),
        ],
        4,
      )[0] ?? null;
    const pageLeadEntityId = inferPageLeadEntityIdFromPanelSuggestions(
      compiled.suggestion.panels,
      inferFallbackEntityIds(
        context.entities,
        Array.from(new Set(context.scenes.flatMap((scene) => scene.involvedEntityIds))),
        [
          context.episodePurpose,
          context.introduction,
          context.middle,
          context.climax,
          context.endingHook,
          ...context.scenes.flatMap((scene) => [scene.location, scene.time, scene.atmosphere]),
        ],
        4,
      ),
    );

    for (const panel of context.panels) {
      const rawSuggestion = suggestionsByOrder.get(panel.order);
      const fallbackPanelSuggestion = fallbackSuggestionsByOrder.get(panel.order);
      const sourceScene = resolvePageAutofillSceneForPanel(context, panel.order);
      const suggestion =
        rawSuggestion === undefined && fallbackPanelSuggestion === undefined
          ? undefined
          : enrichPanelSuggestionForGeneration(
              panel,
              completePanelSuggestionWithFallback(rawSuggestion, fallbackPanelSuggestion, {
                includeFallbackCreativeFields: false,
              }),
              {
                scene: sourceScene,
                entityLookup,
                pagePurpose: context.episodePurpose ?? context.middle ?? context.introduction,
                continuityNote: context.endingHook,
                storyLeadEntityId,
                pageLeadEntityId,
                language,
                fillMissingCreativeFields: false,
              },
            );
      if (suggestion === undefined) {
        continue;
      }

      const merge = mergePanelSuggestion(panel, suggestion);
      if (merge.panelUpdate !== null) {
        const updated = await this.panelRepository.updatePanel(panel.id, userId, merge.panelUpdate, organizationId);
        if (updated === null) {
          throw new NotFoundError('Panel not found');
        }
      }

      if (merge.assignments !== null) {
        await this.panelEntityAssignmentService.replacePanelEntityAssignments(
          userId,
          panel.id,
          merge.assignments,
          organizationId,
        );
      }

      if (merge.panelUpdate !== null || merge.assignments !== null) {
        updatedPanelCount += 1;
        filledFieldCount += merge.filledFieldCount;
      }
    }

    return {
      updatedPanelCount,
      filledFieldCount,
      compilerUsed: compiled.compilerUsed,
      compilerProvider: compiled.compilerProvider,
      compilerModel: compiled.compilerModel,
      compilerPromptVersion: compiled.compilerPromptVersion,
      compilerError: compiled.compilerError,
    };
  }

  public async autofillEpisodeFromStory(
    userId: string,
    episodeId: string,
    language: AppLanguage,
    progressReporter?: EpisodePagePlanProgressReporter,
    organizationId: string | null = null,
    executionControl?: EpisodePagePlanExecutionControl,
  ): Promise<EpisodePagePlanApplyResult> {
    await executionControl?.checkpoint();
    if (
      this.panelRepository === undefined ||
      this.panelEntityAssignmentService === undefined
    ) {
      throw new ConfigurationError('Episode page planning service is not fully configured');
    }

    const context = await this.pageRepository.findEpisodePlanningContextByIdAndUserId(
      episodeId,
      userId,
      organizationId,
    );
    if (context === null) {
      throw new NotFoundError('Episode not found');
    }
    if (context.pages.length === 0) {
      throw new ValidationError('Episode must have pages before story autofill can run');
    }
    if (context.pages.length > STORY_AI_LIMITS.maxSkeletonPages) {
      throw new ValidationError(
        `Episode story autofill supports at most ${STORY_AI_LIMITS.maxSkeletonPages} pages`,
      );
    }
    await executionControl?.checkpoint();

    const controlledProgressReporter = createCheckpointedEpisodePlanProgressReporter(
      progressReporter,
      executionControl,
    );

    const deferLayoutPersistence =
      executionControl !== undefined ||
      this.episodePlanReliabilityOptions.adaptivePackingEnabled === true ||
      this.episodePlanReliabilityOptions.inlineRepairEnabled === true;
    const episodePlanPersistence = this.episodePlanPersistence;
    const shouldUseAtomicPersistence =
      deferLayoutPersistence && episodePlanPersistence !== undefined;
    const initialContextFingerprint =
      (this.episodePlanContinuityV3Enabled || shouldUseAtomicPersistence) &&
      deferLayoutPersistence
        ? fingerprintEpisodePlanningContext(context)
        : null;
    const deferredLayouts = await this.repairEpisodePlanLayoutMetadataBeforeCompile(
      userId,
      context,
      organizationId,
      deferLayoutPersistence,
    );

    if (this.episodePagePlanCompiler === undefined) {
      return buildSkippedEpisodePlanApplyResult('Episode page plan compiler is not configured');
    }

    const contextFingerprint =
      this.episodePlanContinuityV3Enabled || shouldUseAtomicPersistence
      ? initialContextFingerprint ?? fingerprintEpisodePlanningContext(context)
      : null;
    const compiled = await this.compileEpisodePlanForContextSafely(
      context,
      language,
      controlledProgressReporter,
    );
    await executionControl?.checkpoint();
    if (!compiled.compilerUsed) {
      return buildSkippedEpisodePlanApplyResult(compiled.compilerError);
    }

    if (
      contextFingerprint !== null &&
      shouldUseAtomicPersistence
    ) {
      await executionControl?.checkpoint();
      return episodePlanPersistence.withLockedEpisodePlan(
        { episodeId, userId, organizationId },
        async (lockedContext, resources) => {
          if (fingerprintEpisodePlanningContext(lockedContext) !== contextFingerprint) {
            throw new ConflictError(
              'The episode changed while the story plan was being compiled. Run the operation again.',
            );
          }

          applyDeferredEpisodePlanLayouts(lockedContext, deferredLayouts);
          await executionControl?.beginCommit();
          await reportEpisodePlanProgress(progressReporter, {
            stage: 'applying',
            message: 'Saving story plan to pages and panels. This process can take around 20 minutes.',
            currentChunk: null,
            totalChunks: null,
          });
          return this.applyEpisodePlanSuggestion(
            lockedContext,
            userId,
            compiled,
            language,
            organizationId,
            deferredLayouts,
            resources,
          );
        },
      );
    }

    const contextForApply =
      contextFingerprint === null
        ? context
        : await this.refetchUnchangedEpisodePlanContext(
            userId,
            episodeId,
            organizationId,
            contextFingerprint,
          );
    await executionControl?.checkpoint();
    applyDeferredEpisodePlanLayouts(contextForApply, deferredLayouts);

    await executionControl?.beginCommit();

    await reportEpisodePlanProgress(progressReporter, {
      stage: 'applying',
      message: 'Saving story plan to pages and panels. This process can take around 20 minutes.',
      currentChunk: null,
      totalChunks: null,
    });

    return this.applyEpisodePlanSuggestion(
      contextForApply,
      userId,
      compiled,
      language,
      organizationId,
      deferredLayouts,
    );
  }

  private async refetchUnchangedEpisodePlanContext(
    userId: string,
    episodeId: string,
    organizationId: string | null,
    initialFingerprint: string,
  ): Promise<EpisodePagePlanContext> {
    const currentContext = await this.pageRepository.findEpisodePlanningContextByIdAndUserId(
      episodeId,
      userId,
      organizationId,
    );
    if (
      currentContext === null ||
      fingerprintEpisodePlanningContext(currentContext) !== initialFingerprint
    ) {
      throw new ConflictError(
        'The episode changed while the story plan was being compiled. Run the operation again.',
      );
    }

    return currentContext;
  }

  private async repairEpisodePlanLayoutMetadataBeforeCompile(
    userId: string,
    context: EpisodePagePlanContext,
    organizationId: string | null,
    deferPersistence = false,
  ): Promise<ReadonlyMap<string, UpdatePageSettingsInput['layoutConfig']>> {
    const deferredLayouts = new Map<string, UpdatePageSettingsInput['layoutConfig']>();
    for (const page of context.pages) {
      ensurePageEditable(page.status, 'story autofill');
      if (page.frameCount === 0) {
        throw new ValidationError('All pages must have frames before story autofill can run');
      }
      if (page.panels.length !== page.frameCount) {
        throw new ValidationError('コマ割りを先に合わせてください');
      }

      const repairedLayoutConfig = buildRepairedEpisodePageLayoutConfig(
        page.layoutConfig,
        page.panels.length,
        page.frameCount,
      );
      if (repairedLayoutConfig !== null) {
        if (deferPersistence) {
          deferredLayouts.set(page.pageId, repairedLayoutConfig);
        } else {
          await this.updatePageSettings(userId, page.pageId, {
            layoutConfig: repairedLayoutConfig,
          }, organizationId);
        }
        page.layoutConfig = repairedLayoutConfig;
        continue;
      }

      if (!isEpisodePageLayoutMetadataConsistent(page.layoutConfig, page.panels.length)) {
        throw new ValidationError('コマ割りを先に合わせてください');
      }
    }

    return deferredLayouts;
  }

  private async compileEpisodePlanForContextSafely(
    context: EpisodePagePlanContext,
    language: AppLanguage,
    progressReporter?: EpisodePagePlanProgressReporter,
  ): Promise<EpisodePlanExecutionResult> {
    if (this.episodePlanContinuityV3Enabled) {
      try {
        return await this.compileEpisodePlanWithContinuityV3(
          context,
          language,
          progressReporter,
        );
      } catch (error) {
        if (!(error instanceof ConfigurationError)) {
          throw error;
        }

        const compilerError = sanitizePersistedErrorMessage(
          error,
          'Episode continuity planning failed',
        );
        console.warn('episode_page_plan_continuity_v3_rejected', {
          episodeId: context.episodeId,
          reason: compilerError,
        });
        return {
          suggestion: { pages: [] },
          compilerUsed: false,
          compilerProvider: 'fallback',
          compilerModel: null,
          compilerPromptVersion: null,
          compilerError,
        };
      }
    }

    const pageChunks = this.buildEpisodePlanPagePacks(context);
    if (pageChunks.length === 1) {
      await reportEpisodePlanProgress(progressReporter, {
        stage: 'compiling_chunk',
        message: 'Compiling story plan chunks. This process can take around 20 minutes.',
        currentChunk: 1,
        totalChunks: 1,
      });
      const compiled = await this.compileEpisodePlanSafely(context, language);
      if (compiled.compilerUsed) {
        await reportEpisodePlanProgress(progressReporter, {
          stage: 'compiled_chunk',
          message: 'Compiling story plan chunks. This process can take around 20 minutes.',
          currentChunk: 1,
          totalChunks: 1,
        });
      }
      return compiled;
    }

    console.info('episode_page_plan_compiler_chunked', {
      episodeId: context.episodeId,
      pageCount: context.pages.length,
      chunkCount: pageChunks.length,
      strategy: this.episodePlanReliabilityOptions.adaptivePackingEnabled === true
        ? 'adaptive_output_weight'
        : 'fixed_page_count',
    });

    const compiledChunks: EpisodePlanExecutionResult[] = [];
    for (const [chunkIndex, pages] of pageChunks.entries()) {
      await reportEpisodePlanProgress(progressReporter, {
        stage: 'compiling_chunk',
        message: 'Compiling story plan chunks. This process can take around 20 minutes.',
        currentChunk: chunkIndex + 1,
        totalChunks: pageChunks.length,
      });
      const chunkContext = buildEpisodePlanChunkContext(context, pages);
      const compiled = await this.compileEpisodePlanSafely(chunkContext, language);
      if (!compiled.compilerUsed) {
        return compiled;
      }
      await reportEpisodePlanProgress(progressReporter, {
        stage: 'compiled_chunk',
        message: 'Compiling story plan chunks. This process can take around 20 minutes.',
        currentChunk: chunkIndex + 1,
        totalChunks: pageChunks.length,
      });
      compiledChunks.push(compiled);
    }

    return combineEpisodePlanExecutionResults(compiledChunks);
  }

  private buildEpisodePlanPagePacks(
    context: EpisodePagePlanContext,
  ): EpisodePagePlanContext['pages'][] {
    if (this.episodePlanReliabilityOptions.adaptivePackingEnabled === true) {
      return packEpisodePlanPages(context.pages);
    }
    return chunkEpisodePlanPages(
      context.pages,
      EPISODE_PAGE_PLAN_COMPILER_PAGE_CHUNK_SIZE,
    );
  }

  private async compileEpisodePlanWithContinuityV3(
    context: EpisodePagePlanContext,
    language: AppLanguage,
    progressReporter?: EpisodePagePlanProgressReporter,
  ): Promise<EpisodePlanExecutionResult> {
    if (this.episodeBeatPlanCompiler === undefined || this.episodePlanAuditCompiler === undefined) {
      throw new ConfigurationError('Episode continuity v3 compilers are not configured');
    }

    await reportEpisodePlanProgress(progressReporter, {
      stage: 'planning_episode',
      message: 'Planning story beats across the full episode. This process can take around 20 minutes.',
      currentChunk: null,
      totalChunks: null,
    });
    const compiledBeatPlan = await this.compileEpisodeBeatPlanWithCapacity(
      context,
      language,
      progressReporter,
    );
    validateEpisodeBeatPlanCoverage(context, compiledBeatPlan.plan);

    const pageChunks = this.buildEpisodePlanPagePacks(context);
    console.info('episode_page_plan_continuity_v3_started', {
      episodeId: context.episodeId,
      pageCount: context.pages.length,
      chunkCount: pageChunks.length,
    });

    const compiledChunks: EpisodePlanExecutionResult[] = [];
    for (const [chunkIndex, pages] of pageChunks.entries()) {
      await reportEpisodePlanProgress(progressReporter, {
        stage: 'compiling_chunk',
        message: 'Compiling story plan chunks. This process can take around 20 minutes.',
        currentChunk: chunkIndex + 1,
        totalChunks: pageChunks.length,
      });
      const chunkContext = buildEpisodePlanChunkContext(context, pages);
      const compiled = await this.compileEpisodePlanSafely(
        chunkContext,
        language,
        buildEpisodeDetailContinuitySupplement({
          context,
          plan: compiledBeatPlan.plan,
          currentPageIds: new Set(pages.map((page) => page.pageId)),
          completedPages: compiledChunks.flatMap((result) => result.suggestion.pages),
        }),
      );
      if (!compiled.compilerUsed) {
        return compiled;
      }
      compiledChunks.push(compiled);
      await reportEpisodePlanProgress(progressReporter, {
        stage: 'compiled_chunk',
        message: 'Compiling story plan chunks. This process can take around 20 minutes.',
        currentChunk: chunkIndex + 1,
        totalChunks: pageChunks.length,
      });
    }

    let combined = combineEpisodePlanExecutionResults(compiledChunks);
    if (this.episodePlanReliabilityOptions.inlineRepairEnabled === true) {
      return this.reviewAndRepairEpisodePlanInline(
        context,
        compiledBeatPlan.plan,
        combined,
        language,
        progressReporter,
      );
    }

    let audit = await this.auditEpisodePlanWithContinuityV3(
      context,
      compiledBeatPlan.plan,
      combined.suggestion,
      language,
      progressReporter,
      1,
      2,
    );
    let blockingIssues = audit.issues.filter((issue) => issue.severity === 'error');
    if (blockingIssues.length === 0) {
      return combined;
    }

    const affectedChunkIndexes = resolveAffectedEpisodePlanChunkIndexes(
      pageChunks,
      blockingIssues,
    );
    for (const chunkIndex of affectedChunkIndexes) {
      const pages = pageChunks[chunkIndex];
      if (pages === undefined) {
        throw new ConfigurationError('Episode continuity repair selected an unknown chunk');
      }
      const currentPageIds = new Set(pages.map((page) => page.pageId));
      const chunkIssues = blockingIssues.filter((issue) =>
        issue.pageIds.some((pageId) => currentPageIds.has(pageId)),
      );
      const repairTargetPageIds = new Set(
        chunkIssues.flatMap((issue) =>
          issue.pageIds.filter((pageId) => currentPageIds.has(pageId)),
        ),
      );
      const currentDraftPages = combined.suggestion.pages.filter((page) =>
        currentPageIds.has(page.pageId),
      );
      await reportEpisodePlanProgress(progressReporter, {
        stage: 'repairing_chunk',
        message: 'Repairing page continuity. This process can take around 20 minutes.',
        currentChunk: null,
        totalChunks: null,
      });
      const repaired = await this.compileEpisodePlanSafely(
        buildEpisodePlanChunkContext(context, pages),
        language,
        buildEpisodeDetailContinuitySupplement({
          context,
          plan: compiledBeatPlan.plan,
          currentPageIds,
          completedPages: combined.suggestion.pages.filter(
            (page) => !currentPageIds.has(page.pageId),
          ),
          currentDraftPages,
          repairIssues: chunkIssues,
        }),
      );
      if (!repaired.compilerUsed) {
        return repaired;
      }
      compiledChunks[chunkIndex] = preserveUnreportedRepairPages(
        currentDraftPages,
        repaired,
        repairTargetPageIds,
      );
      combined = combineEpisodePlanExecutionResults(compiledChunks);
    }

    combined = combineEpisodePlanExecutionResults(compiledChunks);
    audit = await this.auditEpisodePlanWithContinuityV3(
      context,
      compiledBeatPlan.plan,
      combined.suggestion,
      language,
      progressReporter,
      2,
      2,
    );
    blockingIssues = audit.issues.filter((issue) => issue.severity === 'error');
    if (blockingIssues.length > 0) {
      throw new ConfigurationError(
        `Episode continuity audit still found ${blockingIssues.length} issue(s) after bounded repair`,
      );
    }

    return combined;
  }

  private async compileEpisodeBeatPlanWithCapacity(
    context: EpisodePagePlanContext,
    language: AppLanguage,
    progressReporter: EpisodePagePlanProgressReporter | undefined,
  ): Promise<CompiledEpisodeBeatPlan> {
    const packs = packEpisodeBeatPlanLedgerPages(context.pages);
    if (packs.length > 1) {
      return this.compileSegmentedEpisodeBeatPlan(
        context,
        language,
        packs,
        progressReporter,
      );
    }

    try {
      return await this.episodeBeatPlanCompiler!.compileBeatPlan({
        compilerBrief: buildEpisodeBeatPlanCompilerBrief(context, language),
        language,
      });
    } catch (error) {
      if (!(error instanceof EpisodeBeatPlanOutputLimitError) || context.pages.length <= 1) {
        throw error;
      }

      console.info('episode_beat_plan_capacity_fallback_started', {
        episodeId: context.episodeId,
        pageCount: context.pages.length,
        reason: 'structured_output_limit',
      });
      return this.compileSegmentedEpisodeBeatPlan(
        context,
        language,
        splitEpisodeBeatPlanPages(context.pages),
        progressReporter,
      );
    }
  }

  private async compileSegmentedEpisodeBeatPlan(
    context: EpisodePagePlanContext,
    language: AppLanguage,
    initialPacks: EpisodePagePlanContext['pages'][],
    progressReporter: EpisodePagePlanProgressReporter | undefined,
  ): Promise<CompiledEpisodeBeatPlan> {
    const outlineCompiler = this.episodeBeatPlanCompiler?.compileOutline;
    if (outlineCompiler === undefined) {
      throw new ConfigurationError('Episode beat plan outline compiler is not configured');
    }

    await reportEpisodePlanProgress(progressReporter, {
      stage: 'planning_episode',
      message: 'Planning a compact outline for the full episode. This process can take around 20 minutes.',
      currentChunk: null,
      totalChunks: initialPacks.length,
    });
    const compiledOutline = await outlineCompiler.call(this.episodeBeatPlanCompiler, {
      compilerBrief: buildEpisodeBeatPlanOutlineCompilerBrief(context, language),
      language,
    });
    validateEpisodeBeatPlanOutlineCoverage(context, compiledOutline.outline);

    console.info('episode_beat_plan_segmented_started', {
      episodeId: context.episodeId,
      pageCount: context.pages.length,
      packCount: initialPacks.length,
    });

    const compiledPacks: CompiledEpisodeBeatPlan[] = [];
    let completedPages: EpisodeBeatPlanPage[] = [];
    for (const [packIndex, pages] of initialPacks.entries()) {
      const compiledSegments = await this.compileEpisodeBeatPlanSegmentWithFallback({
        context,
        language,
        outline: compiledOutline.outline,
        pages,
        completedPages,
        progressReporter,
        currentChunk: packIndex + 1,
        totalChunks: initialPacks.length,
      });
      compiledPacks.push(...compiledSegments);
      completedPages = compiledPacks.flatMap((compiled) => compiled.plan.pages);
    }

    return combineCompiledEpisodeBeatPlans(compiledPacks);
  }

  private async compileEpisodeBeatPlanSegmentWithFallback(input: {
    context: EpisodePagePlanContext;
    language: AppLanguage;
    outline: EpisodeBeatPlanOutline;
    pages: EpisodePagePlanContext['pages'];
    completedPages: EpisodeBeatPlanPage[];
    progressReporter: EpisodePagePlanProgressReporter | undefined;
    currentChunk: number | null;
    totalChunks: number | null;
  }): Promise<CompiledEpisodeBeatPlan[]> {
    await reportEpisodePlanProgress(input.progressReporter, {
      stage: 'planning_episode',
      message: 'Planning story beats across the episode. This process can take around 20 minutes.',
      currentChunk: input.currentChunk,
      totalChunks: input.totalChunks,
    });

    try {
      const compiled = await this.episodeBeatPlanCompiler!.compileBeatPlan({
        compilerBrief: buildEpisodeBeatPlanSegmentCompilerBrief({
          context: input.context,
          language: input.language,
          outline: input.outline,
          targetPages: input.pages,
          completedPages: input.completedPages,
        }),
        language: input.language,
      });
      validateEpisodeBeatPlanCoverage(
        buildEpisodePlanChunkContext(input.context, input.pages),
        compiled.plan,
      );
      return [compiled];
    } catch (error) {
      if (!(error instanceof EpisodeBeatPlanOutputLimitError) || input.pages.length <= 1) {
        throw error;
      }

      const [firstPages, secondPages] = splitEpisodeBeatPlanPages(input.pages);
      console.info('episode_beat_plan_segment_split_for_capacity', {
        episodeId: input.context.episodeId,
        originalPageCount: input.pages.length,
        firstPageCount: firstPages.length,
        secondPageCount: secondPages.length,
      });
      const firstSegments = await this.compileEpisodeBeatPlanSegmentWithFallback({
        ...input,
        pages: firstPages,
        currentChunk: null,
        totalChunks: null,
      });
      const firstCompletedPages = [
        ...input.completedPages,
        ...firstSegments.flatMap((compiled) => compiled.plan.pages),
      ];
      const secondSegments = await this.compileEpisodeBeatPlanSegmentWithFallback({
        ...input,
        pages: secondPages,
        completedPages: firstCompletedPages,
        currentChunk: null,
        totalChunks: null,
      });
      return [...firstSegments, ...secondSegments];
    }
  }

  private async reviewAndRepairEpisodePlanInline(
    context: EpisodePagePlanContext,
    plan: Awaited<ReturnType<EpisodeBeatPlanCompilerPort['compileBeatPlan']>>['plan'],
    combined: EpisodePlanExecutionResult,
    language: AppLanguage,
    progressReporter?: EpisodePagePlanProgressReporter,
  ): Promise<EpisodePlanExecutionResult> {
    const firstAudit = await this.auditEpisodePlanWithContinuityV3(
      context,
      plan,
      combined.suggestion,
      language,
      progressReporter,
      1,
      2,
    );
    logEpisodePlanAuditSummary(context.episodeId, 1, firstAudit);
    if (!hasBlockingEpisodePlanAuditIssues(firstAudit.issues)) {
      return combined;
    }

    if ((firstAudit.pageRepairs?.length ?? 0) + (firstAudit.panelRepairs?.length ?? 0) === 0) {
      throw new ConfigurationError(
        'Episode continuity audit returned errors without a field-level repair',
      );
    }

    await reportEpisodePlanProgress(progressReporter, {
      stage: 'repairing_chunk',
      message: 'Applying targeted continuity repairs. This process can take around 20 minutes.',
      currentChunk: null,
      totalChunks: null,
    });
    const normalizedSuggestion = this.applyValidatedEpisodePlanAuditRepairs(
      context,
      combined.suggestion,
      firstAudit,
      language,
    );
    const repairedCombined: EpisodePlanExecutionResult = {
      ...combined,
      suggestion: normalizedSuggestion,
    };

    let finalAudit: EpisodePlanAudit;
    try {
      finalAudit = await this.auditEpisodePlanWithContinuityV3(
        context,
        plan,
        repairedCombined.suggestion,
        language,
        progressReporter,
        2,
        2,
      );
    } catch (error) {
      if (!(error instanceof ConfigurationError)) {
        throw error;
      }
      this.assertDeterministicallyValidEpisodePlan(context, repairedCombined.suggestion);
      console.warn('episode_page_plan_continuity_v3_second_audit_unavailable', {
        episodeId: context.episodeId,
        reason: sanitizePersistedErrorMessage(
          error,
          'Episode continuity verification unavailable',
        ),
      });
      return repairedCombined;
    }
    logEpisodePlanAuditSummary(context.episodeId, 2, finalAudit);
    if (!hasBlockingEpisodePlanAuditIssues(finalAudit.issues)) {
      return repairedCombined;
    }

    const reportedErrors = finalAudit.issues.filter(
      (issue) => issue.severity === 'error',
    );
    const finalRepairCount =
      (finalAudit.pageRepairs?.length ?? 0) + (finalAudit.panelRepairs?.length ?? 0);
    let finalSuggestion = repairedCombined.suggestion;

    if (finalRepairCount > 0) {
      const repairPageIds = new Set([
        ...(finalAudit.pageRepairs ?? []).map((repair) => repair.pageId),
        ...(finalAudit.panelRepairs ?? []).map((repair) => repair.pageId),
      ]);
      finalSuggestion = this.applyValidatedEpisodePlanAuditRepairs(
        context,
        finalSuggestion,
        {
          ...finalAudit,
          issues: finalAudit.issues.filter(
            (issue) =>
              issue.severity !== 'error' ||
              issue.pageIds.some((pageId) => repairPageIds.has(pageId)),
          ),
        },
        language,
      );
      console.info('episode_page_plan_continuity_v3_final_repairs_applied', {
        episodeId: context.episodeId,
        pageRepairCount: finalAudit.pageRepairs?.length ?? 0,
        panelRepairCount: finalAudit.panelRepairs?.length ?? 0,
      });
    }

    this.assertDeterministicallyValidEpisodePlan(context, finalSuggestion);

    console.warn('episode_page_plan_continuity_v3_bounded_review_completed', {
      episodeId: context.episodeId,
      repairPassCount: finalRepairCount > 0 ? 2 : 1,
      secondAuditReportedErrorCount: reportedErrors.length,
      issueCodes: reportedErrors.map((issue) => issue.code),
      affectedPageIds: Array.from(
        new Set(reportedErrors.flatMap((issue) => issue.pageIds)),
      ),
    });
    return {
      ...repairedCombined,
      suggestion: finalSuggestion,
    };
  }

  private assertDeterministicallyValidEpisodePlan(
    context: EpisodePagePlanContext,
    suggestion: EpisodePagePlanSuggestion,
  ): void {
    validateEpisodePlanAgainstContext(context, suggestion);
    const deterministicErrors = detectDeterministicContinuityIssues(suggestion).filter(
      (issue) => issue.severity === 'error',
    );
    if (deterministicErrors.length === 0) {
      return;
    }

    console.warn('episode_page_plan_continuity_v3_deterministic_rejected', {
      episodeId: context.episodeId,
      deterministicErrorCount: deterministicErrors.length,
      issueCodes: deterministicErrors.map((issue) => issue.code),
      affectedPageIds: Array.from(
        new Set(deterministicErrors.flatMap((issue) => issue.pageIds)),
      ),
    });
    throw new ConfigurationError(
      `Episode continuity deterministic verification found ${deterministicErrors.length} unresolved issue(s) after bounded repair`,
    );
  }

  private applyValidatedEpisodePlanAuditRepairs(
    context: EpisodePagePlanContext,
    suggestion: EpisodePagePlanSuggestion,
    audit: EpisodePlanAudit,
    language: AppLanguage,
  ): EpisodePagePlanSuggestion {
    const repairedSuggestion = applyEpisodePlanAuditRepairs({
      suggestion,
      audit,
      knownPanelOrdersByPageId: new Map(
        context.pages.map((page) => [
          page.pageId,
          new Set(page.panels.map((panel) => panel.order)),
        ] as const),
      ),
    });
    const normalizedSuggestion = normalizeEpisodePlanToContext(
      context,
      repairedSuggestion,
      language,
    );
    validateEpisodePlanAgainstContext(context, normalizedSuggestion);
    return normalizedSuggestion;
  }

  private async auditEpisodePlanWithContinuityV3(
    context: EpisodePagePlanContext,
    plan: Awaited<ReturnType<EpisodeBeatPlanCompilerPort['compileBeatPlan']>>['plan'],
    suggestion: EpisodePagePlanSuggestion,
    language: AppLanguage,
    progressReporter: EpisodePagePlanProgressReporter | undefined,
    auditPass: number,
    totalAuditPasses: number,
  ): Promise<EpisodePlanAudit> {
    console.info('episode_page_plan_continuity_v3_audit_started', {
      episodeId: context.episodeId,
      auditPass,
      totalAuditPasses,
    });
    await reportEpisodePlanProgress(progressReporter, {
      stage: 'auditing_episode',
      message: 'Checking continuity across all pages. This process can take around 20 minutes.',
      currentChunk: null,
      totalChunks: null,
    });
    const compiledAudit = await this.episodePlanAuditCompiler!.auditPlan({
      compilerBrief: buildEpisodePlanAuditBrief({ context, plan, suggestion, language }),
      language,
      pageIds: context.pages.map((page) => page.pageId),
      beforeRetry: async () => {
        await reportEpisodePlanProgress(progressReporter, {
          stage: 'auditing_episode',
          message: 'Retrying the continuity audit safely. This process can take around 20 minutes.',
          currentChunk: null,
          totalChunks: null,
        });
      },
    });
    if (!compiledAudit.audit.accepted && compiledAudit.audit.issues.length === 0) {
      throw new ConfigurationError('Episode continuity audit rejected the plan without repair instructions');
    }

    const knownPageIds = new Set(context.pages.map((page) => page.pageId));
    return {
      ...compiledAudit.audit,
      issues: mergeEpisodePlanAuditIssues(
        detectDeterministicContinuityIssues(suggestion),
        compiledAudit.audit.issues,
        knownPageIds,
      ),
    };
  }

  private async compileAutofillSafely(
    context: PageAutofillContext,
    language: AppLanguage,
  ): Promise<AutofillExecutionResult> {
    const compilerBrief = buildAutofillCompilerBrief(context, language);
    const fallbackSuggestion = buildFallbackAutofillSuggestion(context, language);

    try {
      const compiled = await this.pageAutofillCompiler!.compileSuggestions({ compilerBrief, language });
      return {
        suggestion: repairAutofillSuggestionAgainstContext(
          context,
          compiled.suggestion,
          fallbackSuggestion,
          language,
        ),
        compilerUsed: true,
        compilerProvider: compiled.compilerProvider,
        compilerModel: compiled.compilerModel,
        compilerPromptVersion: compiled.compilerPromptVersion,
        compilerError: null,
      };
    } catch (error) {
      if (!(error instanceof ConfigurationError)) {
        throw error;
      }

      const compilerError = sanitizePersistedErrorMessage(error, 'Page autofill compiler failed');
      console.warn('page_autofill_compiler_fallback', {
        pageId: context.pageId,
        episodeId: context.episodeId,
        reason: compilerError,
      });

      return {
        suggestion: { panels: [] },
        compilerUsed: false,
        compilerProvider: 'fallback',
        compilerModel: null,
        compilerPromptVersion: null,
        compilerError,
      };
    }
  }

  private async compileEpisodePlanSafely(
    context: EpisodePagePlanContext,
    language: AppLanguage,
    continuitySupplement?: string,
  ): Promise<EpisodePlanExecutionResult> {
    const baseCompilerBrief = buildEpisodePlanCompilerBrief(context, language);
    const compilerBrief = continuitySupplement === undefined
      ? baseCompilerBrief
      : `${baseCompilerBrief}\n${continuitySupplement}`;
    const fallbackSuggestion = buildFallbackEpisodePlanSuggestion(context, language);

    try {
      const compiled = await this.episodePagePlanCompiler!.compilePlan({ compilerBrief, language });
      return {
        suggestion: repairEpisodePlanSuggestionAgainstContext(
          context,
          compiled.suggestion,
          fallbackSuggestion,
          language,
        ),
        compilerUsed: true,
        compilerProvider: compiled.compilerProvider,
        compilerModel: compiled.compilerModel,
        compilerPromptVersion: compiled.compilerPromptVersion,
        compilerError: null,
      };
    } catch (error) {
      if (!(error instanceof ConfigurationError)) {
        throw error;
      }

      const compilerError = sanitizePersistedErrorMessage(error, 'Episode page plan compiler failed');
      console.warn('episode_page_plan_compiler_fallback', {
        episodeId: context.episodeId,
        reason: compilerError,
      });

      return {
        suggestion: { pages: [] },
        compilerUsed: false,
        compilerProvider: 'fallback',
        compilerModel: null,
        compilerPromptVersion: null,
        compilerError,
      };
    }
  }

  private async applyEpisodePlanSuggestion(
    context: EpisodePagePlanContext,
    userId: string,
    compiled: EpisodePlanExecutionResult,
    language: AppLanguage,
    organizationId: string | null,
    deferredLayouts: ReadonlyMap<string, UpdatePageSettingsInput['layoutConfig']> = new Map(),
    resources?: EpisodePlanPersistenceResources,
  ): Promise<EpisodePagePlanApplyResult> {
    const pageRepository = resources?.pageRepository ?? this.pageRepository;
    const panelRepository = resources?.panelRepository ?? this.panelRepository;
    const panelEntityAssignmentService =
      resources?.panelEntityAssignmentService ?? this.panelEntityAssignmentService;
    if (panelRepository === undefined || panelEntityAssignmentService === undefined) {
      throw new ConfigurationError('Episode page planning service is not fully configured');
    }

    const normalizedSuggestion = normalizeEpisodePlanToContext(context, compiled.suggestion, language);
    validateEpisodePlanAgainstContext(context, normalizedSuggestion);

    const pagesById = new Map(context.pages.map((page) => [page.pageId, page] as const));
    const entityLookup = new Map(context.entities.map((entity) => [entity.id, entity] as const));
    const storyLeadEntityId =
      inferFallbackEntityIds(
        context.entities,
        Array.from(new Set(context.scenes.flatMap((scene) => scene.involvedEntityIds))),
        [
          context.episode.purpose,
          context.episode.introduction,
          context.episode.middle,
          context.episode.climax,
          context.episode.endingHook,
          ...context.scenes.flatMap((scene) => [scene.location, scene.time, scene.atmosphere]),
        ],
        4,
      )[0] ?? null;
    let updatedPageCount = 0;
    let updatedPanelCount = 0;
    let updatedAssignmentCount = 0;
    let filledFieldCount = 0;

    for (const [pageIndex, pageSuggestion] of normalizedSuggestion.pages.entries()) {
      const page = pagesById.get(pageSuggestion.pageId);
      if (page === undefined) {
        throw new ValidationError('Episode page plan referenced an unknown page');
      }

      const sourceSceneIds = normalizeEpisodePlanSourceSceneIds(context, pageSuggestion.sourceSceneIds);
      const pageContext = buildPageScopedAutofillContext(context, pageIndex);
      const mergedPageSettings = mergePageSettings(pageContext, pageSuggestion.page, {
        overwriteExisting: true,
        storySourceSceneIds: sourceSceneIds,
        storyPagePurpose: pageSuggestion.pagePurpose,
        storyContinuityNote: pageSuggestion.continuityNote,
      });
      const deferredLayout = deferredLayouts.get(page.pageId);
      const nextPageSettings = deferredLayout === undefined
        ? mergedPageSettings
        : {
            ...(mergedPageSettings ?? {}),
            layoutConfig: deferredLayout,
          };
      if (nextPageSettings !== null) {
        await this.updatePageSettingsWithRepository(
          pageRepository,
          userId,
          page.pageId,
          nextPageSettings,
          organizationId,
        );
        updatedPageCount += 1;
        filledFieldCount += Object.keys(nextPageSettings).length;
      }

      const panelsByOrder = new Map(page.panels.map((panel) => [panel.order, panel] as const));
      const pageScenes = resolveEpisodePlanScenesForPage(
        context,
        { ...pageSuggestion, sourceSceneIds },
        pageIndex,
      );
      const pageLeadEntityId = inferPageLeadEntityIdFromPanelSuggestions(
        pageSuggestion.panels,
        inferFallbackEntityIds(
          context.entities,
          Array.from(new Set(pageScenes.flatMap((scene) => scene.involvedEntityIds))),
          [
            pageSuggestion.pagePurpose,
            pageSuggestion.continuityNote,
            ...pageScenes.flatMap((scene) => [scene.location, scene.time, scene.atmosphere]),
          ],
          4,
        ),
      );
      for (const panelSuggestion of pageSuggestion.panels) {
        const panel = panelsByOrder.get(panelSuggestion.order);
        if (panel === undefined) {
          throw new ValidationError('Episode page plan referenced an unknown panel order');
        }

        const normalizedSuggestion = enrichPanelSuggestionForGeneration(
          panel,
          withPageLevelPanelNotes(panel, panelSuggestion, pageSuggestion),
          {
            scene: resolveSceneForPanelOrder(pageScenes, panelSuggestion.order, pageSuggestion.panels.length),
            entityLookup,
            pagePurpose: pageSuggestion.pagePurpose,
            continuityNote: pageSuggestion.continuityNote,
            storyLeadEntityId,
            pageLeadEntityId,
            language,
            fillMissingCreativeFields: false,
          },
        );
        const merge = mergePanelSuggestion(panel, normalizedSuggestion, {
          overwriteExisting: true,
        });

        if (merge.panelUpdate !== null) {
          const updated = await panelRepository.updatePanel(panel.id, userId, merge.panelUpdate, organizationId);
          if (updated === null) {
            throw new NotFoundError('Panel not found');
          }
        }

        if (merge.assignments !== null) {
          await panelEntityAssignmentService.replacePanelEntityAssignments(
            userId,
            panel.id,
            merge.assignments,
            organizationId,
          );
          updatedAssignmentCount += merge.assignments.length;
        }

        if (merge.panelUpdate !== null || merge.assignments !== null) {
          updatedPanelCount += 1;
          filledFieldCount += merge.filledFieldCount;
        }
      }
    }

    return {
      updatedPageCount,
      updatedPanelCount,
      updatedAssignmentCount,
      filledFieldCount,
      compilerUsed: compiled.compilerUsed,
      compilerProvider: compiled.compilerProvider,
      compilerModel: compiled.compilerModel,
      compilerPromptVersion: compiled.compilerPromptVersion,
      compilerError: compiled.compilerError,
    };
  }
}

function ensurePageEditable(status: PageSummary['status'], actionLabel: string): void {
  if (status === 'confirmed') {
    throw new ConflictError(`Confirmed pages must be reopened before ${actionLabel}`);
  }

  if (status === 'generating') {
    throw new ConflictError(`Pages cannot ${actionLabel} while generation is in progress`);
  }
}

async function reportEpisodePlanProgress(
  reporter: EpisodePagePlanProgressReporter | undefined,
  progress: EpisodePagePlanProgress,
): Promise<void> {
  if (reporter === undefined) {
    return;
  }

  await reporter(progress);
}

function createCheckpointedEpisodePlanProgressReporter(
  reporter: EpisodePagePlanProgressReporter | undefined,
  executionControl: EpisodePagePlanExecutionControl | undefined,
): EpisodePagePlanProgressReporter | undefined {
  if (reporter === undefined && executionControl === undefined) {
    return undefined;
  }

  return async (progress) => {
    await executionControl?.checkpoint();
    await reporter?.(progress);
  };
}

function buildSkippedEpisodePlanApplyResult(
  compilerError: string | null,
): EpisodePagePlanApplyResult {
  return {
    updatedPageCount: 0,
    updatedPanelCount: 0,
    updatedAssignmentCount: 0,
    filledFieldCount: 0,
    compilerUsed: false,
    compilerProvider: 'fallback',
    compilerModel: null,
    compilerPromptVersion: null,
    compilerError,
  };
}

function chunkEpisodePlanPages(
  pages: EpisodePagePlanContext['pages'],
  chunkSize: number,
): EpisodePagePlanContext['pages'][] {
  const chunks: EpisodePagePlanContext['pages'][] = [];
  for (let index = 0; index < pages.length; index += chunkSize) {
    chunks.push(pages.slice(index, index + chunkSize));
  }
  return chunks;
}

function applyDeferredEpisodePlanLayouts(
  context: EpisodePagePlanContext,
  deferredLayouts: ReadonlyMap<string, UpdatePageSettingsInput['layoutConfig']>,
): void {
  if (deferredLayouts.size === 0) {
    return;
  }

  const pagesById = new Map(context.pages.map((page) => [page.pageId, page] as const));
  for (const [pageId, layoutConfig] of deferredLayouts) {
    const page = pagesById.get(pageId);
    if (page === undefined || layoutConfig === undefined) {
      throw new ConflictError('The episode layout changed while the story plan was being compiled');
    }
    page.layoutConfig = layoutConfig;
  }
}

function logEpisodePlanAuditSummary(
  episodeId: string,
  auditPass: number,
  audit: EpisodePlanAudit,
): void {
  console.info('episode_page_plan_continuity_v3_audit_completed', {
    episodeId,
    auditPass,
    errorCount: audit.issues.filter((issue) => issue.severity === 'error').length,
    warningCount: audit.issues.filter((issue) => issue.severity === 'warning').length,
    issueCodes: audit.issues.map((issue) => issue.code),
    affectedPageIds: Array.from(new Set(audit.issues.flatMap((issue) => issue.pageIds))),
    pageRepairCount: audit.pageRepairs?.length ?? 0,
    panelRepairCount: audit.panelRepairs?.length ?? 0,
  });
}

function buildEpisodePlanChunkContext(
  context: EpisodePagePlanContext,
  pages: EpisodePagePlanContext['pages'],
): EpisodePagePlanContext {
  return {
    ...context,
    pages,
  };
}

function resolveAffectedEpisodePlanChunkIndexes(
  pageChunks: EpisodePagePlanContext['pages'][],
  issues: EpisodePlanAuditIssue[],
): number[] {
  const chunkByPageId = new Map<string, number>();
  for (const [chunkIndex, pages] of pageChunks.entries()) {
    for (const page of pages) {
      chunkByPageId.set(page.pageId, chunkIndex);
    }
  }

  const indexes = new Set<number>();
  for (const issue of issues) {
    for (const pageId of issue.pageIds) {
      const chunkIndex = chunkByPageId.get(pageId);
      if (chunkIndex === undefined) {
        throw new ConfigurationError('Episode continuity audit referenced an unknown page');
      }
      indexes.add(chunkIndex);
    }
  }

  return Array.from(indexes).sort((left, right) => left - right);
}

function combineEpisodePlanExecutionResults(
  results: EpisodePlanExecutionResult[],
): EpisodePlanExecutionResult {
  const first = results[0];
  if (first === undefined) {
    return {
      suggestion: { pages: [] },
      compilerUsed: false,
      compilerProvider: 'fallback',
      compilerModel: null,
      compilerPromptVersion: null,
      compilerError: 'Episode page plan compiler returned no chunks',
    };
  }

  return {
    suggestion: {
      pages: results.flatMap((result) => result.suggestion.pages),
    },
    compilerUsed: true,
    compilerProvider: 'openai',
    compilerModel: mergeCompilerMetadata(results.map((result) => result.compilerModel)),
    compilerPromptVersion: mergeCompilerMetadata(
      results.map((result) => result.compilerPromptVersion),
    ),
    compilerError: null,
  };
}

function combineCompiledEpisodeBeatPlans(
  results: CompiledEpisodeBeatPlan[],
): CompiledEpisodeBeatPlan {
  const first = results[0];
  if (first === undefined) {
    throw new ConfigurationError('Episode beat plan compiler returned no packs');
  }

  return {
    plan: {
      pages: results.flatMap((result) => result.plan.pages),
    },
    compilerProvider: 'openai',
    compilerModel: mergeCompilerMetadata(results.map((result) => result.compilerModel)) ?? first.compilerModel,
    compilerPromptVersion:
      mergeCompilerMetadata(results.map((result) => result.compilerPromptVersion)) ??
      first.compilerPromptVersion,
  };
}

function splitEpisodeBeatPlanPages<TPage>(pages: readonly TPage[]): [TPage[], TPage[]] {
  if (pages.length < 2) {
    throw new ConfigurationError('Episode beat plan pack cannot be split');
  }
  const midpoint = Math.ceil(pages.length / 2);
  return [pages.slice(0, midpoint), pages.slice(midpoint)];
}

function preserveUnreportedRepairPages(
  currentDraftPages: EpisodePagePlanPageSuggestion[],
  repaired: EpisodePlanExecutionResult,
  repairTargetPageIds: ReadonlySet<string>,
): EpisodePlanExecutionResult {
  const currentDraftByPageId = new Map(
    currentDraftPages.map((page) => [page.pageId, page] as const),
  );

  return {
    ...repaired,
    suggestion: {
      pages: repaired.suggestion.pages.map((page) => {
        if (repairTargetPageIds.has(page.pageId)) {
          return page;
        }

        const currentDraft = currentDraftByPageId.get(page.pageId);
        if (currentDraft === undefined) {
          throw new ConfigurationError(
            'Episode continuity repair returned an unexpected page',
          );
        }
        return currentDraft;
      }),
    },
  };
}

function mergeCompilerMetadata(values: Array<string | null>): string | null {
  const uniqueValues = Array.from(
    new Set(values.filter((value): value is string => isMeaningfulText(value))),
  );
  if (uniqueValues.length === 0) {
    return null;
  }
  return uniqueValues.join(' + ');
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function buildNextPageLayoutConfig(
  page: PageSummary,
  input: UpdatePageSettingsInput,
): Record<string, unknown> | undefined {
  if (
    input.styleReference === undefined &&
    input.storySourceSceneIds === undefined &&
    input.storyPagePurpose === undefined &&
    input.storyContinuityNote === undefined
  ) {
    return undefined;
  }

  const nextLayoutConfig = { ...page.layoutConfig };

  if (input.styleReference !== undefined) {
    if (input.styleReference === null) {
      delete nextLayoutConfig.style_reference;
    } else {
      nextLayoutConfig.style_reference = input.styleReference;
    }
  }

  if (input.storySourceSceneIds !== undefined) {
    nextLayoutConfig.story_source_scene_ids = input.storySourceSceneIds;
  }

  if (input.storyPagePurpose !== undefined) {
    if (input.storyPagePurpose === null) {
      delete nextLayoutConfig.story_page_purpose;
    } else {
      nextLayoutConfig.story_page_purpose = input.storyPagePurpose;
    }
  }

  if (input.storyContinuityNote !== undefined) {
    if (input.storyContinuityNote === null) {
      delete nextLayoutConfig.story_continuity_note;
    } else {
      nextLayoutConfig.story_continuity_note = input.storyContinuityNote;
    }
  }

  return nextLayoutConfig;
}

function buildRepairedEpisodePageLayoutConfig(
  layoutConfig: Record<string, unknown>,
  panelCount: number,
  frameCount: number,
): Record<string, unknown> | null {
  if (panelCount !== frameCount) {
    return null;
  }

  const nextLayoutConfig = { ...layoutConfig };
  let changed = false;
  let shouldRefreshTemplateFrames = false;

  if (nextLayoutConfig.panel_count !== panelCount) {
    nextLayoutConfig.panel_count = panelCount;
    changed = true;
  }

  const expectedTemplateId = resolveDefaultPanelFrameTemplateId(panelCount);
  const layoutType = typeof nextLayoutConfig.type === 'string' ? nextLayoutConfig.type : null;

  if (expectedTemplateId !== null && (layoutType === null || layoutType === 'template')) {
    if (nextLayoutConfig.type !== 'template') {
      nextLayoutConfig.type = 'template';
      changed = true;
      shouldRefreshTemplateFrames = true;
    }
    if (nextLayoutConfig.template_id !== expectedTemplateId) {
      nextLayoutConfig.template_id = expectedTemplateId;
      changed = true;
      shouldRefreshTemplateFrames = true;
    }
    if (
      Array.isArray(nextLayoutConfig.frame_definitions) &&
      nextLayoutConfig.frame_definitions.length !== panelCount
    ) {
      changed = true;
      shouldRefreshTemplateFrames = true;
    }
    if (shouldRefreshTemplateFrames) {
      nextLayoutConfig.frame_definitions = buildPanelFrameTemplateInputs(expectedTemplateId);
    }
  } else if (layoutType === 'template') {
    nextLayoutConfig.type = 'custom';
    delete nextLayoutConfig.template_id;
    changed = true;
  }

  return changed ? nextLayoutConfig : null;
}

function isEpisodePageLayoutMetadataConsistent(
  layoutConfig: Record<string, unknown>,
  panelCount: number,
): boolean {
  if (layoutConfig.panel_count !== panelCount) {
    return false;
  }

  const layoutType = typeof layoutConfig.type === 'string' ? layoutConfig.type : null;
  if (layoutType !== 'template') {
    return true;
  }

  const templateId = typeof layoutConfig.template_id === 'string' ? layoutConfig.template_id : null;
  if (templateId === null) {
    return false;
  }

  const expectedTemplateId = resolveDefaultPanelFrameTemplateId(panelCount);
  return expectedTemplateId === null || templateId === expectedTemplateId;
}

function buildPageScopedAutofillContext(
  context: EpisodePagePlanContext,
  pageIndex: number,
): PageAutofillContext {
  const page = context.pages[pageIndex];
  const sourceScenes = pickScenesForPage(context.scenes, context.pages.length, pageIndex);

  return {
    pageId: page.pageId,
    workId: context.workId,
    episodeId: context.episodeId,
    chapterId: context.chapter.id,
    pageNumber: page.pageNumber,
    totalPagesInEpisode: context.pages.length,
    frameCount: page.frameCount,
    status: page.status,
    dialogueMode: page.dialogueMode,
    pageDialogueToggle: page.pageDialogueToggle,
    chapterTitle: context.chapter.title,
    chapterPurpose: context.chapter.purpose,
    chapterStartingState: context.chapter.startingState,
    chapterEndingState: context.chapter.endingState,
    chapterEmotionCurve: context.chapter.emotionCurve,
    chapterKeyBeats: context.chapter.keyBeats,
    episodePurpose: context.episode.purpose,
    introduction: context.episode.introduction,
    middle: context.episode.middle,
    climax: context.episode.climax,
    endingHook: context.episode.endingHook,
    scenes: sourceScenes,
    entities: context.entities,
    panels: page.panels,
  };
}

function inferPageLeadEntityIdFromPanelSuggestions(
  panelSuggestions: PageAutofillPanelSuggestion[],
  fallbackEntityIds: string[],
): string | null {
  const scores = new Map<string, number>();
  const firstSeen = new Map<string, number>();

  const touch = (entityId: string, weight: number, order: number): void => {
    scores.set(entityId, (scores.get(entityId) ?? 0) + weight);
    if (!firstSeen.has(entityId)) {
      firstSeen.set(entityId, order);
    }
  };

  panelSuggestions.forEach((panel, panelIndex) => {
    panel.entities?.forEach((assignment) => {
      const weight =
        assignment.role === 'primary' ? 3 : assignment.role === 'secondary' ? 2 : 1;
      touch(assignment.entityId, weight, panelIndex);
    });
    panel.dialogue?.forEach((line) => {
      if (line.entityId !== null) {
        touch(line.entityId, 1, panelIndex);
      }
    });
  });

  fallbackEntityIds.forEach((entityId, index) => {
    touch(entityId, Math.max(1, fallbackEntityIds.length - index), Number.MAX_SAFE_INTEGER - index);
  });

  const ranked = Array.from(scores.entries()).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }
    return (firstSeen.get(left[0]) ?? Number.MAX_SAFE_INTEGER) - (firstSeen.get(right[0]) ?? Number.MAX_SAFE_INTEGER);
  });

  return ranked[0]?.[0] ?? null;
}

function normalizeEpisodePlanToContext(
  context: EpisodePagePlanContext,
  suggestion: EpisodePagePlanSuggestion,
  language: AppLanguage,
): EpisodePagePlanSuggestion {
  const fallback = buildFallbackEpisodePlanSuggestion(context, language);
  const usedPageIndexes = new Set<number>();

  return {
    pages: context.pages.map((existingPage, pageIndex) => {
      const matchingPageIndex = suggestion.pages.findIndex(
        (candidate, candidateIndex) =>
          !usedPageIndexes.has(candidateIndex) &&
          (candidate.pageId === existingPage.pageId || candidate.pageNumber === existingPage.pageNumber),
      );
      const sourcePage =
        matchingPageIndex === -1 ? undefined : suggestion.pages[matchingPageIndex];
      if (matchingPageIndex !== -1) {
        usedPageIndexes.add(matchingPageIndex);
      }

      const fallbackPage = fallback.pages[pageIndex];
      const panelsByOrder = new Map((sourcePage?.panels ?? []).map((panel) => [panel.order, panel] as const));
      const fallbackPanelsByOrder = new Map(
        fallbackPage.panels.map((panel) => [panel.order, panel] as const),
      );

      return {
        pageId: existingPage.pageId,
        pageNumber: existingPage.pageNumber,
        sourceSceneIds: normalizeEpisodePlanSourceSceneIds(
          context,
          coalesceStringArray(sourcePage?.sourceSceneIds, fallbackPage.sourceSceneIds),
        ),
        pagePurpose: sourcePage?.pagePurpose,
        continuityNote: sourcePage?.continuityNote,
        page: completePageSettingsSuggestion(sourcePage?.page, fallbackPage.page),
        panels: existingPage.panels.map((existingPanel) => {
          const sourcePanel = panelsByOrder.get(existingPanel.order);
          const fallbackPanel = fallbackPanelsByOrder.get(existingPanel.order);
          if (sourcePanel === undefined && fallbackPanel === undefined) {
            throw new ValidationError('Episode page plan could not be normalized to existing panels');
          }

          return {
            ...completePanelSuggestionWithFallback(sourcePanel, fallbackPanel, {
              includeFallbackCreativeFields: false,
            }),
            order: existingPanel.order,
          };
        }),
      };
    }),
  };
}

function validateEpisodePlanAgainstContext(
  context: EpisodePagePlanContext,
  suggestion: EpisodePagePlanSuggestion,
): void {
  if (suggestion.pages.length !== context.pages.length) {
    throw new ValidationError('Episode page plan must return exactly the existing page count');
  }

  const sceneIds = new Set(context.scenes.map((scene) => scene.id));
  const pageIds = new Set(context.pages.map((page) => page.pageId));
  const entityIds = new Set(context.entities.map((entity) => entity.id));
  const stateIds = new Set(
    context.scenes.flatMap((scene) =>
      scene.entityStates.map((state) => state.stateId),
    ),
  );

  const seenPageIds = new Set<string>();
  for (const page of suggestion.pages) {
    if (!pageIds.has(page.pageId) || seenPageIds.has(page.pageId)) {
      throw new ValidationError('Episode page plan must reference each existing page exactly once');
    }
    seenPageIds.add(page.pageId);

    const sourceSceneIds = page.sourceSceneIds ?? [];
    for (const sceneId of sourceSceneIds) {
      if (!sceneIds.has(sceneId)) {
        throw new ValidationError('Episode page plan referenced a scene outside the episode');
      }
    }

    const existingPage = context.pages.find((candidate) => candidate.pageId === page.pageId);
    if (existingPage === undefined) {
      throw new ValidationError('Episode page plan referenced an unknown page');
    }
    if (page.pageNumber !== existingPage.pageNumber) {
      throw new ValidationError('Episode page plan changed page numbering');
    }
    if (page.panels.length !== existingPage.panels.length) {
      throw new ValidationError('Episode page plan changed panel count for an existing page');
    }

    const seenOrders = new Set<number>();
    for (const panel of page.panels) {
      if (seenOrders.has(panel.order)) {
        throw new ValidationError('Episode page plan contains duplicate panel orders');
      }
      seenOrders.add(panel.order);

      const existingPanel = existingPage.panels.find((candidate) => candidate.order === panel.order);
      if (existingPanel === undefined) {
        throw new ValidationError('Episode page plan referenced a panel order that does not exist');
      }

      for (const line of panel.dialogue ?? []) {
        if (line.entityId !== null && !entityIds.has(line.entityId)) {
          throw new ValidationError('Episode page plan dialogue referenced an entity outside the episode');
        }
      }

      for (const assignment of panel.entities ?? []) {
        if (!entityIds.has(assignment.entityId)) {
          throw new ValidationError('Episode page plan assignment referenced an entity outside the episode');
        }
        if (assignment.stateId !== null && !stateIds.has(assignment.stateId)) {
          throw new ValidationError('Episode page plan assignment referenced a scene entity state outside the episode');
        }
      }
    }

    for (const existingPanel of existingPage.panels) {
      if (!seenOrders.has(existingPanel.order)) {
        throw new ValidationError('Episode page plan panel orders must exactly match the existing page');
      }
    }
  }
}

function withPageLevelPanelNotes(
  _panel: PageAutofillPanelContext,
  suggestion: PageAutofillPanelSuggestion,
  _pageSuggestion: EpisodePagePlanSuggestion['pages'][number],
): PageAutofillPanelSuggestion {
  return suggestion;
}

function completePageSettingsSuggestion(
  source: PageAutofillSuggestion['page'] | EpisodePagePlanSuggestion['pages'][number]['page'] | undefined,
  fallback: PageAutofillSuggestion['page'] | EpisodePagePlanSuggestion['pages'][number]['page'] | undefined,
): PageAutofillSuggestion['page'] | EpisodePagePlanSuggestion['pages'][number]['page'] | undefined {
  if (source === undefined && fallback === undefined) {
    return undefined;
  }

  return {
    dialogueMode: source?.dialogueMode ?? fallback?.dialogueMode,
    pageDialogueToggle: source?.pageDialogueToggle ?? fallback?.pageDialogueToggle,
  };
}

function completePanelSuggestionWithFallback(
  source: PageAutofillPanelSuggestion | undefined,
  fallback: PageAutofillPanelSuggestion | undefined,
  options?: { includeFallbackCreativeFields?: boolean },
): PageAutofillPanelSuggestion {
  if (source === undefined && fallback === undefined) {
    throw new ValidationError('Panel suggestion fallback could not be resolved');
  }

  const sourceComposition = source?.composition;
  const fallbackComposition = fallback?.composition;
  const includeFallbackCreativeFields = options?.includeFallbackCreativeFields !== false;
  const fallbackCreative = includeFallbackCreativeFields ? fallback : undefined;
  const fallbackCreativeComposition = includeFallbackCreativeFields ? fallbackComposition : undefined;

  return {
    order: source?.order ?? fallback?.order ?? 1,
    panelRole: source?.panelRole ?? fallback?.panelRole,
    panelSize: source?.panelSize ?? fallback?.panelSize,
    situationText: coalesceText(source?.situationText, fallbackCreative?.situationText),
    composition:
      sourceComposition === undefined && fallbackComposition === undefined
        ? undefined
        : {
            source: sourceComposition?.source ?? fallbackComposition?.source,
            galleryItemId: sourceComposition?.galleryItemId ?? fallbackComposition?.galleryItemId ?? null,
            compositionPrompt: coalesceText(
              sourceComposition?.compositionPrompt,
              fallbackCreativeComposition?.compositionPrompt,
            ),
            shotType: sourceComposition?.shotType ?? fallbackComposition?.shotType ?? null,
            angle: sourceComposition?.angle ?? fallbackComposition?.angle ?? null,
            customNote: coalesceText(sourceComposition?.customNote, fallbackCreativeComposition?.customNote),
          },
    dialogueInPanel: source?.dialogueInPanel ?? fallback?.dialogueInPanel,
    dialogue: coalesceDialogue(source?.dialogue, fallbackCreative?.dialogue),
    sfxText: coalesceText(source?.sfxText, fallbackCreative?.sfxText),
    backgroundNote: coalesceText(source?.backgroundNote, fallbackCreative?.backgroundNote),
    panelNotes: coalesceText(source?.panelNotes, fallbackCreative?.panelNotes),
    entities: coalesceAssignments(source?.entities, fallbackCreative?.entities),
  };
}

function repairAutofillSuggestionAgainstContext(
  context: PageAutofillContext,
  suggestion: PageAutofillSuggestion,
  fallback: PageAutofillSuggestion,
  language: AppLanguage,
): PageAutofillSuggestion {
  const fallbackSuggestionsByOrder = new Map(
    fallback.panels.map((panel) => [panel.order, panel] as const),
  );

  return {
    page: completePageSettingsSuggestion(suggestion.page, fallback.page),
    panels: context.panels.map((panel) => {
      const sourcePanel = suggestion.panels.find((candidate) => candidate.order === panel.order);
      const fallbackPanel = fallbackSuggestionsByOrder.get(panel.order);
      return repairPanelSuggestionAgainstFallback(
        context.entities,
        context.scenes,
        context.episodePurpose,
        context.introduction,
        context.middle,
        context.climax,
        context.endingHook,
        panel,
        sourcePanel,
        fallbackPanel,
        resolvePageAutofillSceneForPanel(context, panel.order),
        language,
      );
    }),
  };
}

function repairEpisodePlanSuggestionAgainstContext(
  context: EpisodePagePlanContext,
  suggestion: EpisodePagePlanSuggestion,
  fallback: EpisodePagePlanSuggestion,
  language: AppLanguage,
): EpisodePagePlanSuggestion {
  return {
    pages: context.pages.map((page, pageIndex) => {
      const sourcePage = suggestion.pages.find(
        (candidate) => candidate.pageId === page.pageId || candidate.pageNumber === page.pageNumber,
      );
      const fallbackPage = fallback.pages[pageIndex];
      const sourceScenes = sourcePage === undefined ? [] : resolveEpisodePlanScenesForPage(context, sourcePage, pageIndex);
      const fallbackScenes = resolveEpisodePlanScenesForPage(context, fallbackPage, pageIndex);

      return {
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        sourceSceneIds:
          Array.isArray(sourcePage?.sourceSceneIds) && sourcePage.sourceSceneIds.length > 0
            ? sourcePage.sourceSceneIds
            : fallbackPage.sourceSceneIds,
        pagePurpose: shouldRepairGenericCompilerText(sourcePage?.pagePurpose)
          ? fallbackPage.pagePurpose
          : coalesceText(sourcePage?.pagePurpose, fallbackPage.pagePurpose),
        continuityNote: shouldRepairGenericCompilerText(sourcePage?.continuityNote)
          ? fallbackPage.continuityNote
          : coalesceText(sourcePage?.continuityNote, fallbackPage.continuityNote),
        page: completePageSettingsSuggestion(sourcePage?.page, fallbackPage.page),
        panels: page.panels.map((existingPanel, panelIndex) => {
          const sourcePanel = sourcePage?.panels.find((candidate) => candidate.order === existingPanel.order);
          const fallbackPanel = fallbackPage.panels.find((candidate) => candidate.order === existingPanel.order);
          const pageScene =
            sourceScenes[Math.min(sourceScenes.length - 1, Math.floor((panelIndex * Math.max(sourceScenes.length, 1)) / Math.max(page.panels.length, 1)))] ??
            fallbackScenes[Math.min(fallbackScenes.length - 1, Math.floor((panelIndex * Math.max(fallbackScenes.length, 1)) / Math.max(page.panels.length, 1)))];

          return repairPanelSuggestionAgainstFallback(
            context.entities,
            context.scenes,
            context.episode.purpose,
            context.episode.introduction,
            context.episode.middle,
            context.episode.climax,
            context.episode.endingHook,
            existingPanel,
            sourcePanel,
            fallbackPanel,
            pageScene,
            language,
            { includeFallbackCreativeFields: true },
          );
        }),
      };
    }),
  };
}

function repairPanelSuggestionAgainstFallback(
  _entities: PageAutofillContext['entities'],
  _scenes: PageAutofillContext['scenes'] | EpisodePagePlanContext['scenes'],
  _episodePurpose: string | null | undefined,
  _introduction: string | null | undefined,
  _middle: string | null | undefined,
  _climax: string | null | undefined,
  _endingHook: string | null | undefined,
  _panel: PageAutofillPanelContext,
  source: PageAutofillPanelSuggestion | undefined,
  fallback: PageAutofillPanelSuggestion | undefined,
  _panelScene: PageAutofillContext['scenes'][number] | EpisodePagePlanContext['scenes'][number] | undefined,
  _language: AppLanguage,
  options?: { includeFallbackCreativeFields?: boolean },
): PageAutofillPanelSuggestion {
  const completed = completePanelSuggestionWithFallback(source, fallback, {
    includeFallbackCreativeFields: options?.includeFallbackCreativeFields === true,
  });
  const allowFallbackCreativeRepair = options?.includeFallbackCreativeFields === true;
  const repairedEntities = shouldRepairEmptyEntityAssignments(source, fallback, allowFallbackCreativeRepair)
    ? fallback?.entities
    : completed.entities;
  const fallbackComposition = fallback?.composition;
  const repairedSituation = shouldRepairGenericCompilerText(completed.situationText)
    ? repairCreativeText(undefined, fallback?.situationText, [], allowFallbackCreativeRepair)
    : completed.situationText;
  const repairedBackground = shouldRepairRedundantFieldText(completed.backgroundNote, [
    repairedSituation,
    completed.composition?.compositionPrompt,
  ]) || shouldRepairGenericCompilerText(completed.backgroundNote)
    ? repairCreativeText(
        undefined,
        fallback?.backgroundNote,
        [repairedSituation, completed.composition?.compositionPrompt],
        allowFallbackCreativeRepair,
      )
    : completed.backgroundNote;
  const repairedCompositionPrompt = shouldRepairGenericCompilerText(completed.composition?.compositionPrompt) ||
    shouldRepairRedundantFieldText(
    completed.composition?.compositionPrompt,
    [repairedSituation, repairedBackground],
  )
    ? repairCreativeText(
        undefined,
        fallbackComposition?.compositionPrompt,
        [repairedSituation, repairedBackground],
        allowFallbackCreativeRepair,
      )
    : completed.composition?.compositionPrompt ?? null;
  const repairedCustomNote = shouldRepairGenericCompilerText(completed.composition?.customNote) ||
    shouldRepairRedundantFieldText(completed.composition?.customNote, [
      repairedSituation,
      repairedCompositionPrompt,
      repairedBackground,
    ])
    ? repairCreativeText(
        undefined,
        fallbackComposition?.customNote,
        [repairedSituation, repairedCompositionPrompt, repairedBackground],
        allowFallbackCreativeRepair,
      )
    : completed.composition?.customNote ?? null;
  const repairedPanelNotes = shouldRepairGenericCompilerText(completed.panelNotes) ||
    shouldRepairRedundantFieldText(completed.panelNotes, [
      repairedSituation,
      repairedCompositionPrompt,
      repairedCustomNote,
      repairedBackground,
    ])
    ? repairCreativeText(
        undefined,
        fallback?.panelNotes,
        [repairedSituation, repairedCompositionPrompt, repairedCustomNote, repairedBackground],
        allowFallbackCreativeRepair,
      )
    : completed.panelNotes;

  return {
    ...completed,
    situationText: repairedSituation,
    composition:
      completed.composition === undefined && fallbackComposition === undefined
        ? undefined
        : {
            source: completed.composition?.source ?? fallbackComposition?.source,
            galleryItemId: completed.composition?.galleryItemId ?? fallbackComposition?.galleryItemId ?? null,
            shotType: completed.composition?.shotType ?? fallbackComposition?.shotType ?? null,
            angle: completed.composition?.angle ?? fallbackComposition?.angle ?? null,
            compositionPrompt: repairedCompositionPrompt,
            customNote: repairedCustomNote,
          },
    backgroundNote: repairedBackground,
    panelNotes: repairedPanelNotes,
    entities: repairedEntities,
  };
}

function shouldRepairEmptyEntityAssignments(
  source: PageAutofillPanelSuggestion | undefined,
  fallback: PageAutofillPanelSuggestion | undefined,
  allowFallbackCreativeRepair: boolean,
): boolean {
  if (!allowFallbackCreativeRepair || !Array.isArray(source?.entities) || source.entities.length > 0) {
    return false;
  }
  if (!Array.isArray(fallback?.entities) || fallback.entities.length === 0) {
    return false;
  }

  return (
    shouldRepairGenericCompilerText(source.backgroundNote) ||
    shouldRepairGenericCompilerText(source.composition?.compositionPrompt) ||
    shouldRepairGenericCompilerText(source.composition?.customNote) ||
    shouldRepairRedundantFieldText(source.backgroundNote, [
      source.situationText,
      source.composition?.compositionPrompt,
    ])
  );
}

function repairCreativeText(
  source: string | null | undefined,
  fallback: string | null | undefined,
  comparisons: Array<string | null | undefined>,
  allowFallback: boolean,
): string | null | undefined {
  if (!allowFallback) {
    return source;
  }
  if (
    isMeaningfulText(fallback) &&
    !shouldRepairGenericCompilerText(fallback) &&
    !shouldRepairRedundantFieldText(fallback, comparisons)
  ) {
    return fallback;
  }
  return source;
}

function coalesceText(
  source: string | null | undefined,
  fallback: string | null | undefined,
): string | null | undefined {
  if (isMeaningfulText(source)) {
    return source;
  }
  if (isMeaningfulText(fallback)) {
    return fallback;
  }
  if (source === null || fallback === null) {
    return null;
  }
  return undefined;
}

function coalesceStringArray(source: string[] | undefined, fallback: string[] | undefined): string[] | undefined {
  if (Array.isArray(source) && source.length > 0) {
    return source;
  }
  if (Array.isArray(fallback) && fallback.length > 0) {
    return fallback;
  }
  if (Array.isArray(source)) {
    return source;
  }
  return fallback;
}

function normalizeEpisodePlanSourceSceneIds(
  context: EpisodePagePlanContext,
  sourceSceneIds: string[] | undefined,
): string[] {
  if (context.scenes.length === 0) {
    return [];
  }
  return sourceSceneIds ?? [];
}

function coalesceDialogue(
  source: PageAutofillPanelSuggestion['dialogue'],
  fallback: PageAutofillPanelSuggestion['dialogue'],
): PageAutofillPanelSuggestion['dialogue'] {
  if (Array.isArray(source)) {
    return source;
  }
  if (Array.isArray(fallback) && fallback.length > 0) {
    return fallback;
  }
  return fallback;
}

function coalesceAssignments(
  source: PageAutofillPanelSuggestion['entities'],
  fallback: PageAutofillPanelSuggestion['entities'],
): PageAutofillPanelSuggestion['entities'] {
  if (Array.isArray(source)) {
    return source;
  }
  if (Array.isArray(fallback) && fallback.length > 0) {
    return fallback;
  }
  return fallback;
}

function mergePageSettings(
  context: PageAutofillContext,
  suggestion: PageAutofillSuggestion['page'],
  options?: {
    overwriteExisting?: boolean;
    storySourceSceneIds?: string[];
    storyPagePurpose?: string | null;
    storyContinuityNote?: string | null;
  },
): UpdatePageSettingsInput | null {
  if (suggestion === undefined) {
    if (
      options?.storySourceSceneIds === undefined &&
      options?.storyPagePurpose === undefined &&
      options?.storyContinuityNote === undefined
    ) {
      return null;
    }
  }

  const overwriteExisting = options?.overwriteExisting === true;
  const update: UpdatePageSettingsInput = {};
  if (
    suggestion !== undefined &&
    suggestion.dialogueMode !== undefined &&
    (overwriteExisting || context.dialogueMode === 'mixed') &&
    suggestion.dialogueMode !== context.dialogueMode
  ) {
    update.dialogueMode = suggestion.dialogueMode;
  }

  if (
    suggestion !== undefined &&
    suggestion.pageDialogueToggle !== undefined &&
    (overwriteExisting || context.pageDialogueToggle === true) &&
    suggestion.pageDialogueToggle !== context.pageDialogueToggle
  ) {
    update.pageDialogueToggle = suggestion.pageDialogueToggle;
  }

  if (options?.storySourceSceneIds !== undefined) {
    update.storySourceSceneIds = options.storySourceSceneIds;
  }

  if (options?.storyPagePurpose !== undefined) {
    update.storyPagePurpose = options.storyPagePurpose;
  }

  if (options?.storyContinuityNote !== undefined) {
    update.storyContinuityNote = options.storyContinuityNote;
  }

  return Object.keys(update).length === 0 ? null : update;
}

function mergePanelSuggestion(
  panel: PageAutofillPanelContext,
  suggestion: PageAutofillPanelSuggestion,
  options?: { overwriteExisting?: boolean },
): PanelMergeResult {
  const update: UpdatePanelInput = {};
  let filledFieldCount = 0;
  const panelMostlyEmpty = isPanelMostlyEmpty(panel);
  const overwriteExisting = options?.overwriteExisting === true;

  if (
    suggestion.panelRole !== undefined &&
    (overwriteExisting || (panel.panelRole === 'action' && panelMostlyEmpty)) &&
    suggestion.panelRole !== panel.panelRole
  ) {
    update.panelRole = suggestion.panelRole;
    filledFieldCount += 1;
  }

  if (
    suggestion.panelSize !== undefined &&
    (overwriteExisting || (panel.panelSize === 'standard' && panelMostlyEmpty)) &&
    suggestion.panelSize !== panel.panelSize
  ) {
    update.panelSize = suggestion.panelSize;
    filledFieldCount += 1;
  }

  if (
    canReplaceStoredText(
      panel.situationText,
      overwriteExisting,
      [
        panel.composition.compositionPrompt,
        panel.composition.customNote,
        panel.backgroundNote,
        panel.panelNotes,
      ],
    ) &&
    isMeaningfulText(suggestion.situationText)
  ) {
    update.situationText = suggestion.situationText;
    filledFieldCount += 1;
  }

  const mergedComposition = mergeComposition(panel, suggestion, { overwriteExisting });
  if (mergedComposition !== null) {
    update.composition = mergedComposition;
    filledFieldCount += mergedCompositionFieldCount(panel, mergedComposition);
  }

  if (
    suggestion.dialogueInPanel !== undefined &&
    (overwriteExisting || panel.dialogue.length === 0) &&
    suggestion.dialogueInPanel !== panel.dialogueInPanel
  ) {
    update.dialogueInPanel = suggestion.dialogueInPanel;
    filledFieldCount += 1;
  }

  if (
    Array.isArray(suggestion.dialogue) &&
    suggestion.dialogue.length > 0 &&
    (overwriteExisting || panel.dialogue.length === 0 || dialogueLooksLowQuality(panel.dialogue))
  ) {
    update.dialogue = suggestion.dialogue;
    filledFieldCount += 1;
  }

  if (canReplaceStoredText(panel.sfxText, overwriteExisting) && isMeaningfulText(suggestion.sfxText)) {
    update.sfxText = suggestion.sfxText;
    filledFieldCount += 1;
  }

  if (
    canReplaceStoredText(
      panel.backgroundNote,
      overwriteExisting,
      [panel.situationText, panel.composition.compositionPrompt, panel.composition.customNote, panel.panelNotes],
    ) &&
    isMeaningfulText(suggestion.backgroundNote)
  ) {
    update.backgroundNote = suggestion.backgroundNote;
    filledFieldCount += 1;
  }

  if (
    canReplaceStoredText(
      panel.panelNotes,
      overwriteExisting,
      [panel.situationText, panel.composition.compositionPrompt, panel.composition.customNote, panel.backgroundNote],
    ) &&
    isMeaningfulText(suggestion.panelNotes)
  ) {
    update.panelNotes = suggestion.panelNotes;
    filledFieldCount += 1;
  }

  const assignments =
    (overwriteExisting || panel.entities.length === 0) &&
    Array.isArray(suggestion.entities) &&
    suggestion.entities.length > 0
      ? suggestion.entities
      : null;
  if (assignments !== null) {
    filledFieldCount += 1;
  }

  return {
    panelUpdate: Object.keys(update).length === 0 ? null : update,
    assignments,
    filledFieldCount,
  };
}

function mergeComposition(
  panel: PageAutofillPanelContext,
  suggestion: PageAutofillPanelSuggestion,
  options?: { overwriteExisting?: boolean },
): PanelComposition | null {
  if (suggestion.composition === undefined) {
    return null;
  }

  const current = panel.composition;
  const overwriteExisting = options?.overwriteExisting === true;
  const merged: PanelComposition = {
    source:
      suggestion.composition.source !== undefined &&
      (overwriteExisting || (current.source === 'custom' && !hasMeaningfulComposition(panel)))
        ? suggestion.composition.source
        : current.source,
    galleryItemId:
      (overwriteExisting || current.galleryItemId === null) &&
      suggestion.composition.galleryItemId !== undefined
        ? suggestion.composition.galleryItemId
        : current.galleryItemId,
    compositionPrompt:
      canReplaceStoredText(
        current.compositionPrompt,
        overwriteExisting,
        [panel.situationText, current.customNote, panel.backgroundNote, panel.panelNotes],
      ) &&
      isMeaningfulText(suggestion.composition.compositionPrompt)
        ? suggestion.composition.compositionPrompt
        : current.compositionPrompt,
    shotType:
      (overwriteExisting || current.shotType === null) &&
      suggestion.composition.shotType !== undefined
        ? suggestion.composition.shotType
        : current.shotType,
    angle:
      (overwriteExisting || current.angle === null) &&
      suggestion.composition.angle !== undefined
        ? suggestion.composition.angle
        : current.angle,
    customNote:
      canReplaceStoredText(
        current.customNote,
        overwriteExisting,
        [panel.situationText, current.compositionPrompt, panel.backgroundNote, panel.panelNotes],
      ) &&
      isMeaningfulText(suggestion.composition.customNote)
        ? suggestion.composition.customNote
        : current.customNote,
  };

  const changed =
    merged.source !== current.source ||
    merged.galleryItemId !== current.galleryItemId ||
    merged.compositionPrompt !== current.compositionPrompt ||
    merged.shotType !== current.shotType ||
    merged.angle !== current.angle ||
    merged.customNote !== current.customNote;

  return changed ? merged : null;
}

function mergedCompositionFieldCount(
  panel: PageAutofillPanelContext,
  merged: NonNullable<UpdatePanelInput['composition']>,
): number {
  let count = 0;
  if (merged.source !== panel.composition.source) {
    count += 1;
  }
  if (merged.galleryItemId !== panel.composition.galleryItemId) {
    count += 1;
  }
  if (merged.compositionPrompt !== panel.composition.compositionPrompt) {
    count += 1;
  }
  if (merged.shotType !== panel.composition.shotType) {
    count += 1;
  }
  if (merged.angle !== panel.composition.angle) {
    count += 1;
  }
  if (merged.customNote !== panel.composition.customNote) {
    count += 1;
  }
  return count;
}

function canReplaceStoredText(
  current: string | null | undefined,
  overwriteExisting: boolean,
  peerFields: Array<string | null | undefined> = [],
): boolean {
  return (
    overwriteExisting ||
    isBlank(current) ||
    shouldRepairGenericCompilerText(current) ||
    shouldRepairRedundantFieldText(current, peerFields)
  );
}

function dialogueLooksLowQuality(lines: PanelDialogueLine[]): boolean {
  if (lines.length === 0) {
    return true;
  }

  return lines.every((line) => isLowQualityDialogueText(line.text));
}

function isLowQualityDialogueText(value: string): boolean {
  const compact = value.replace(/\s+/gu, '');
  if (compact.length === 0) {
    return true;
  }
  if (compact.length <= 3 && !/[。！？…!?、,]/u.test(compact)) {
    return true;
  }
  if (/^[\p{Script=Han}\p{Script=Katakana}A-Za-z0-9]{1,4}$/u.test(compact) && !/[ぁ-ん]/u.test(compact)) {
    return true;
  }
  return false;
}

function enrichPanelSuggestionForGeneration(
  panel: PageAutofillPanelContext,
  suggestion: PageAutofillPanelSuggestion,
  context: {
    scene: PageAutofillContext['scenes'][number] | EpisodePagePlanContext['scenes'][number] | undefined;
    entityLookup: Map<string, PageAutofillContext['entities'][number]>;
    pagePurpose: string | null | undefined;
    continuityNote: string | null | undefined;
    storyLeadEntityId?: string | null;
    pageLeadEntityId?: string | null;
    language: AppLanguage;
    fillMissingCreativeFields?: boolean;
  },
): PageAutofillPanelSuggestion {
  const fillMissingCreativeFields = context.fillMissingCreativeFields !== false;
  const entityAssignments = suggestion.entities ?? panel.entities;
  const leadEntityNames = entityAssignments
    .slice()
    .sort((left, right) => assignmentRoleWeight(left.role) - assignmentRoleWeight(right.role))
    .map((assignment) => context.entityLookup.get(assignment.entityId)?.name ?? assignment.entityId)
    .filter((value, index, array) => array.indexOf(value) === index);
  const shotType = suggestion.composition?.shotType ?? panel.composition.shotType;
  const angle = suggestion.composition?.angle ?? panel.composition.angle;
  const role = suggestion.panelRole ?? panel.panelRole;
  const sceneSummary = buildSceneSummaryText(context.scene);
  const situationText = fillMissingCreativeFields
    ? normalizeSituationText(
        suggestion.situationText,
        leadEntityNames,
        sceneSummary,
        role,
        context.pagePurpose,
        context.language,
      )
    : normalizeProvidedSituationText(suggestion.situationText, leadEntityNames, context.language);
  const compositionPrompt = fillMissingCreativeFields
    ? normalizeCompositionPrompt(
        suggestion.composition?.compositionPrompt,
        leadEntityNames,
        shotType,
        angle,
        situationText ?? null,
        role,
        context.language,
      )
    : normalizeProvidedCompositionPrompt(
        suggestion.composition?.compositionPrompt,
        leadEntityNames,
        shotType,
        angle,
        context.language,
      );
  const customNote = fillMissingCreativeFields
    ? normalizeCameraDirectionNote(
        suggestion.composition?.customNote,
        leadEntityNames,
        shotType,
        angle,
        role,
        entityAssignments,
        context.language,
      )
    : normalizeProvidedText(suggestion.composition?.customNote, 180, context.language);
  const backgroundNote = fillMissingCreativeFields
    ? normalizeBackgroundNote(
        suggestion.backgroundNote,
        context.scene,
        context.language,
      )
    : normalizeProvidedText(suggestion.backgroundNote, 140, context.language);
  const panelNotes = normalizePanelNotes(
    suggestion.panelNotes,
    context.pagePurpose,
    context.continuityNote,
    context.language,
  );
  const dialogue = repairDialogueLinesForPanel(
    normalizeDialogueLines(suggestion.dialogue),
    entityAssignments,
    context.entityLookup,
    context.storyLeadEntityId ?? null,
    context.pageLeadEntityId ?? null,
  );

  return {
    ...suggestion,
    situationText,
    composition: {
      source: suggestion.composition?.source,
      galleryItemId: suggestion.composition?.galleryItemId,
      shotType,
      angle,
      compositionPrompt,
      customNote,
    },
    dialogue,
    backgroundNote,
    panelNotes,
  };
}

function assignmentRoleWeight(role: PanelEntityAssignment['role']): number {
  switch (role) {
    case 'primary':
      return 0;
    case 'secondary':
      return 1;
    default:
      return 2;
  }
}

function buildSceneSummaryText(
  scene: PageAutofillContext['scenes'][number] | EpisodePagePlanContext['scenes'][number] | undefined,
): string | null {
  if (scene === undefined) {
    return null;
  }

  const parts = [scene.location, scene.time, scene.atmosphere].filter(isMeaningfulText);
  return parts.length === 0 ? null : parts.join(' / ');
}

function normalizeSituationText(
  value: string | null | undefined,
  entityNames: string[],
  sceneSummary: string | null,
  role: PageAutofillPanelSuggestion['panelRole'] | undefined,
  pagePurpose: string | null | undefined,
  language: AppLanguage,
): string | null {
  const fallback = buildFallbackSituationSentence(entityNames, sceneSummary, role, pagePurpose, language);
  const base = summarizeCompilerText(value, 140) ?? fallback;
  if (base === null) {
    return null;
  }

  let result = ensureSentence(base, language);
  if (entityNames.length > 0 && !mentionsAnyEntity(result, entityNames)) {
    result = ensureSentence(
      language === 'en'
        ? `${formatEntitySubject(entityNames, language)} ${stripTerminalPunctuation(result)}`
        : `${formatEntitySubject(entityNames, language)}が${stripTerminalPunctuation(result)}`,
      language,
    );
  }
  return result;
}

function normalizeProvidedSituationText(
  value: string | null | undefined,
  entityNames: string[],
  language: AppLanguage,
): string | null | undefined {
  const base = summarizeCompilerText(value, 140);
  if (base === null) {
    return value === null ? null : undefined;
  }

  let result = ensureSentence(base, language);
  if (entityNames.length > 0 && !mentionsAnyEntity(result, entityNames)) {
    result = ensureSentence(
      language === 'en'
        ? `${formatEntitySubject(entityNames, language)} ${stripTerminalPunctuation(result)}`
        : `${formatEntitySubject(entityNames, language)}が${stripTerminalPunctuation(result)}`,
      language,
    );
  }
  return result;
}

function normalizeCompositionPrompt(
  value: string | null | undefined,
  entityNames: string[],
  shotType: PageAutofillPanelContext['composition']['shotType'] | undefined | null,
  angle: PageAutofillPanelContext['composition']['angle'] | undefined | null,
  situationText: string | null,
  role: PageAutofillPanelSuggestion['panelRole'] | undefined,
  language: AppLanguage,
): string | null {
  const base =
    summarizeCompilerText(value, 220) ??
    buildFallbackCompositionSentence(entityNames, shotType, angle, situationText, role, language);
  if (base === null) {
    return null;
  }

  let result = ensureSentence(base, language);
  if (entityNames.length > 0 && !mentionsAnyEntity(result, entityNames)) {
    const subject = formatEntitySubject(entityNames, language);
    const framing =
      shotType === null || shotType === undefined
        ? fallbackLabel(language, 'a readable composition', '読みやすい構図')
        : language === 'en'
          ? `a ${humanizeToken(shotType)}-leaning composition`
          : `${humanizeToken(shotType)}寄りの構図`;
    result =
      language === 'en'
        ? `Make ${subject} the visual lead in ${framing}, seen from a ${humanizeToken(angle ?? 'three_quarter')}-leaning view. ${result}`
        : `${subject}を主役に、${framing}で、${humanizeToken(angle ?? 'three_quarter')}気味の視点として見せる。${result}`;
  }

  return result;
}

function normalizeProvidedCompositionPrompt(
  value: string | null | undefined,
  entityNames: string[],
  shotType: PageAutofillPanelContext['composition']['shotType'] | undefined | null,
  angle: PageAutofillPanelContext['composition']['angle'] | undefined | null,
  language: AppLanguage,
): string | null | undefined {
  const base = summarizeCompilerText(value, 220);
  if (base === null) {
    return value === null ? null : undefined;
  }

  let result = ensureSentence(base, language);
  if (entityNames.length > 0 && !mentionsAnyEntity(result, entityNames)) {
    const subject = formatEntitySubject(entityNames, language);
    const framing =
      shotType === null || shotType === undefined
        ? fallbackLabel(language, 'a readable composition', '読みやすい構図')
        : language === 'en'
          ? `a ${humanizeToken(shotType)}-leaning composition`
          : `${humanizeToken(shotType)}寄りの構図`;
    result =
      language === 'en'
        ? `Make ${subject} the visual lead in ${framing}, seen from a ${humanizeToken(angle ?? 'three_quarter')}-leaning view. ${result}`
        : `${subject}を主役に、${framing}で、${humanizeToken(angle ?? 'three_quarter')}気味の視点として見せる。${result}`;
  }

  return result;
}

function normalizeCameraDirectionNote(
  value: string | null | undefined,
  entityNames: string[],
  shotType: PageAutofillPanelContext['composition']['shotType'] | undefined | null,
  angle: PageAutofillPanelContext['composition']['angle'] | undefined | null,
  role: PageAutofillPanelSuggestion['panelRole'] | undefined,
  assignments: PanelEntityAssignment[],
  language: AppLanguage,
): string | null {
  const base =
    summarizeCompilerText(value, 180) ??
    buildFallbackCameraDirectionNote(entityNames, shotType, angle, role, assignments, language);
  return base === null ? null : ensureSentence(base, language);
}

function normalizeProvidedText(
  value: string | null | undefined,
  maxLength: number,
  language: AppLanguage,
): string | null | undefined {
  const base = summarizeCompilerText(value, maxLength);
  if (base === null) {
    return value === null ? null : undefined;
  }
  return ensureSentence(base, language);
}

function normalizeBackgroundNote(
  value: string | null | undefined,
  scene: PageAutofillContext['scenes'][number] | EpisodePagePlanContext['scenes'][number] | undefined,
  language: AppLanguage,
): string | null {
  const base =
    summarizeCompilerText(value, 140) ??
    buildFallbackBackground(scene, { role: 'establish', size: 'wide', focus: 'setting' }, language);
  return base === null ? null : ensureSentence(base, language);
}

function normalizePanelNotes(
  value: string | null | undefined,
  _pagePurpose: string | null | undefined,
  _continuityNote: string | null | undefined,
  _language: AppLanguage,
): string | null {
  const base = summarizeCompilerText(value, 180);
  return base === null ? null : ensureSentence(base, _language);
}

function normalizeDialogueLines(
  lines: PageAutofillPanelSuggestion['dialogue'],
): PageAutofillPanelSuggestion['dialogue'] {
  if (!Array.isArray(lines)) {
    return lines;
  }

  const normalized = lines
    .map((line) => {
      const text = normalizeDialogueText(line.text);
      if (!isMeaningfulText(text)) {
        return null;
      }

      return {
        ...line,
        text,
      };
    })
    .filter((line): line is NonNullable<typeof line> => line !== null);

  return normalized;
}

function repairDialogueLinesForPanel(
  lines: PageAutofillPanelSuggestion['dialogue'],
  assignments: PanelEntityAssignment[],
  entityLookup: Map<string, PageAutofillContext['entities'][number]>,
  storyLeadEntityId: string | null,
  pageLeadEntityId: string | null,
): PageAutofillPanelSuggestion['dialogue'] {
  if (!Array.isArray(lines) || lines.length === 0) {
    return lines;
  }

  const assignmentIds = new Set(assignments.map((assignment) => assignment.entityId));
  const primaryEntityId =
    assignments.find((assignment) => assignment.role === 'primary')?.entityId ??
    assignments[0]?.entityId ??
    null;

  return lines.flatMap((line) => {
    if (line.type === 'narration') {
      return splitCharacterQuotedNarration(line, assignments, entityLookup) ?? {
        ...line,
        entityId: null,
      };
    }

    // Speaker dialogue must reference a visible panel assignment before it reaches panel validation.
    if (requiresDialogueSpeaker(line.type) && !assignmentIds.has(line.entityId ?? '')) {
      const repairedEntityId = selectVisibleDialogueSpeaker(
        assignmentIds,
        storyLeadEntityId,
        pageLeadEntityId,
        primaryEntityId,
      );
      if (repairedEntityId === null) {
        return {
          ...line,
          type: 'narration',
          entityId: null,
        };
      }
      return {
        ...line,
        entityId: repairedEntityId,
      };
    }

    return line;
  });
}

function splitCharacterQuotedNarration(
  line: PanelDialogueLine,
  assignments: PanelEntityAssignment[],
  entityLookup: Map<string, PageAutofillContext['entities'][number]>,
): PanelDialogueLine[] | null {
  const candidates = buildVisibleDialogueNameCandidates(assignments, entityLookup);
  if (candidates.length === 0) {
    return null;
  }

  const pattern = new RegExp(
    `(${candidates.map((candidate) => escapeRegExp(candidate.label)).join('|')})\\s*[：:]?\\s*[「『"“](.*?)[」』"”]`,
    'gu',
  );
  const repairedLines: PanelDialogueLine[] = [];
  let cursor = 0;
  let matched = false;

  for (const match of line.text.matchAll(pattern)) {
    const matchedLabel = match[1];
    const quotedText = normalizeDialogueText(match[2] ?? '');
    const index = match.index ?? 0;
    const candidate = candidates.find((item) => item.label === matchedLabel);
    if (candidate === undefined || !isMeaningfulText(quotedText)) {
      continue;
    }

    const leadingNarration = normalizeNarrationRemainder(line.text.slice(cursor, index));
    if (leadingNarration !== null) {
      repairedLines.push({
        ...line,
        entityId: null,
        type: 'narration',
        text: leadingNarration,
      });
    }

    repairedLines.push({
      ...line,
      entityId: candidate.entityId,
      type: 'speech',
      text: quotedText,
    });
    cursor = index + match[0].length;
    matched = true;
  }

  if (!matched) {
    return null;
  }

  const trailingNarration = normalizeNarrationRemainder(line.text.slice(cursor));
  if (trailingNarration !== null) {
    repairedLines.push({
      ...line,
      entityId: null,
      type: 'narration',
      text: trailingNarration,
    });
  }

  return repairedLines.length === 0 ? null : repairedLines;
}

function buildVisibleDialogueNameCandidates(
  assignments: PanelEntityAssignment[],
  entityLookup: Map<string, PageAutofillContext['entities'][number]>,
): Array<{ entityId: string; label: string }> {
  const candidates: Array<{ entityId: string; label: string }> = [];
  const seenLabels = new Set<string>();

  for (const assignment of assignments) {
    const entity = entityLookup.get(assignment.entityId);
    const labels = [entity?.name ?? null, ...(entity === undefined ? [] : extractEntityAliases(entity.structuredFields))]
      .filter((value): value is string => isMeaningfulText(value))
      .sort((left, right) => right.length - left.length);

    for (const label of labels) {
      if (seenLabels.has(label)) {
        continue;
      }
      seenLabels.add(label);
      candidates.push({ entityId: assignment.entityId, label });
    }
  }

  return candidates.sort((left, right) => right.label.length - left.label.length);
}

function normalizeNarrationRemainder(value: string): string | null {
  const trimmed = value.replace(/^[\s　。．、，,.；;：:「」『』"“”]+|[\s　。．、，,.；;：:「」『』"“”]+$/gu, '').trim();
  return isMeaningfulText(trimmed) ? trimmed : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selectVisibleDialogueSpeaker(
  assignmentIds: Set<string>,
  storyLeadEntityId: string | null,
  pageLeadEntityId: string | null,
  primaryEntityId: string | null,
): string | null {
  for (const candidate of [storyLeadEntityId, pageLeadEntityId, primaryEntityId]) {
    if (candidate !== null && assignmentIds.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

function requiresDialogueSpeaker(type: PanelDialogueLine['type']): boolean {
  return type === 'speech' || type === 'thought' || type === 'shout' || type === 'whisper';
}

function normalizeDialogueText(value: string): string {
  const trimmed = value.trim();
  const unwrapped = trimmed.replace(/^[「『"“](.+)[」』"”]$/u, '$1').trim();
  return unwrapped;
}

function buildFallbackSituationSentence(
  entityNames: string[],
  sceneSummary: string | null,
  role: PageAutofillPanelSuggestion['panelRole'] | undefined,
  pagePurpose: string | null | undefined,
  language: AppLanguage,
): string | null {
  const subject =
    entityNames.length > 0
      ? formatEntitySubject(entityNames, language)
      : fallbackLabel(language, 'this panel', 'このコマ');
  const beat = fallbackRoleBeat(role, language);
  const purpose = summarizeCompilerText(pagePurpose, 100);

  const parts = [
    language === 'en' ? `${subject} should ${beat}` : `${subject}が${beat}`,
    sceneSummary === null
      ? null
      : language === 'en'
        ? `within ${sceneSummary}`
        : `${sceneSummary}の中で`,
    purpose === null
      ? null
      : language === 'en'
        ? `so it leads into ${purpose}`
        : `${purpose}に繋がる形で`,
  ].filter((value): value is string => value !== null);

  return parts.length === 0 ? null : `${parts.join(' ')}.`;
}

function buildFallbackCompositionSentence(
  entityNames: string[],
  shotType: PageAutofillPanelContext['composition']['shotType'] | undefined | null,
  angle: PageAutofillPanelContext['composition']['angle'] | undefined | null,
  situationText: string | null,
  role: PageAutofillPanelSuggestion['panelRole'] | undefined,
  language: AppLanguage,
): string | null {
  const subject =
    entityNames.length > 0
      ? formatEntitySubject(entityNames, language)
      : fallbackLabel(language, 'this moment', 'この瞬間');
  const shot = humanizeToken(shotType ?? fallbackShotTypeForRole(role ?? 'action'));
  const cameraAngle = humanizeToken(angle ?? fallbackAngleForRole(role ?? 'action'));
  const beat =
    situationText === null
      ? fallbackLabel(language, 'Make the beat readable at a glance', 'この瞬間が一目で伝わるように見せる')
      : stripTerminalPunctuation(situationText);
  return language === 'en'
    ? `Show ${subject} in a ${shot}-leaning frame from a ${cameraAngle}-leaning angle. ${ensureSentence(beat, language)}`
    : `${subject}を${shot}寄りで、${cameraAngle}気味の視点から見せる。${ensureSentence(beat, language)}`;
}

function buildFallbackCameraDirectionNote(
  entityNames: string[],
  shotType: PageAutofillPanelContext['composition']['shotType'] | undefined | null,
  angle: PageAutofillPanelContext['composition']['angle'] | undefined | null,
  role: PageAutofillPanelSuggestion['panelRole'] | undefined,
  assignments: PanelEntityAssignment[],
  language: AppLanguage,
): string | null {
  const lead = entityNames[0] ?? fallbackLabel(language, 'the lead subject', '主役');
  const shot = humanizeToken(shotType ?? fallbackShotTypeForRole(role ?? 'action'));
  const cameraAngle = humanizeToken(angle ?? fallbackAngleForRole(role ?? 'action'));
  if (assignments.length > 1) {
    const secondary = entityNames[1] ?? fallbackLabel(language, 'the counterpart', '相手');
    return language === 'en'
      ? `Make ${lead} read first while keeping the distance and eyeline relationship with ${secondary} clear in a ${shot}-leaning, ${cameraAngle}-leaning setup.`
      : `${lead}が最初に目に入るようにしつつ、${secondary}との距離と視線の関係が分かるように、${shot}寄り・${cameraAngle}気味で整理する。`;
  }

  return language === 'en'
    ? `Make ${lead} read first in a ${shot}-leaning, ${cameraAngle}-leaning composition with a clear silhouette and eyeline.`
    : `${lead}が最初に目に入るように、${shot}寄り・${cameraAngle}気味で、輪郭と視線が読み取りやすい構図にする。`;
}

function formatEntitySubject(entityNames: string[], language: AppLanguage): string {
  if (entityNames.length === 0) {
    return fallbackLabel(language, 'this scene', 'この場面');
  }
  if (entityNames.length === 1) {
    return entityNames[0];
  }
  if (entityNames.length === 2) {
    return language === 'en' ? `${entityNames[0]} and ${entityNames[1]}` : `${entityNames[0]}と${entityNames[1]}`;
  }
  return language === 'en'
    ? `${entityNames[0]}, ${entityNames[1]}, and ${entityNames[2]}`
    : `${entityNames[0]}、${entityNames[1]}、${entityNames[2]}`;
}

function fallbackRoleBeat(
  role: PageAutofillPanelSuggestion['panelRole'] | undefined,
  language: AppLanguage,
): string {
  if (language === 'en') {
    switch (role) {
      case 'establish':
        return 'make the setting and atmosphere immediately readable';
      case 'reaction':
        return 'show a readable emotional reaction';
      case 'transition':
        return 'bridge naturally into the next development';
      case 'emphasis':
        return 'focus attention on the key point of the beat';
      case 'impact':
        return 'bring out the strongest immediate change';
      case 'pause':
        return 'create a quiet pause';
      default:
        return 'show the current action or situation clearly';
    }
  }

  switch (role) {
    case 'establish':
      return '場の状況と空気をはっきり見せる';
    case 'reaction':
      return '感情の揺れが読み取れる反応を見せる';
    case 'transition':
      return '次の展開へ自然に橋渡しする';
    case 'emphasis':
      return 'この場面の要点を絞って強調する';
    case 'impact':
      return 'この瞬間の強い変化を打ち出す';
    case 'pause':
      return '静かに間を取って余韻を作る';
    default:
      return '今の動きや状況を分かりやすく見せる';
  }
}

function mentionsAnyEntity(value: string, entityNames: string[]): boolean {
  const lower = value.toLowerCase();
  return entityNames.some((name) => lower.includes(name.toLowerCase()));
}

function ensureSentence(value: string, language: AppLanguage = 'ja'): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) {
    return normalized;
  }
  if (/[.!?。！？]$/u.test(normalized)) {
    return normalized;
  }
  return language === 'en' ? `${normalized}.` : `${normalized}。`;
}

function stripTerminalPunctuation(value: string): string {
  return value.replace(/[.!?。！？]+$/u, '').trim();
}

function humanizeToken(value: string): string {
  return value.replace(/_/gu, ' ');
}

function resolvePageAutofillSceneForPanel(
  context: PageAutofillContext,
  panelOrder: number,
): PageAutofillContext['scenes'][number] | undefined {
  if (context.scenes.length === 0) {
    return undefined;
  }

  const index = Math.min(
    context.scenes.length - 1,
    Math.floor(((panelOrder - 1) * context.scenes.length) / Math.max(1, context.frameCount)),
  );
  return context.scenes[index];
}

function resolveEpisodePlanScenesForPage(
  context: EpisodePagePlanContext,
  pageSuggestion: EpisodePagePlanSuggestion['pages'][number],
  pageIndex: number,
): EpisodePagePlanContext['scenes'] {
  if (Array.isArray(pageSuggestion.sourceSceneIds) && pageSuggestion.sourceSceneIds.length > 0) {
    const sourceIds = new Set(pageSuggestion.sourceSceneIds);
    const matchedScenes = context.scenes.filter((scene) => sourceIds.has(scene.id));
    if (matchedScenes.length > 0) {
      return matchedScenes;
    }
  }

  return pickScenesForPage(context.scenes, context.pages.length, pageIndex);
}

function resolveSceneForPanelOrder<T>(
  scenes: T[],
  panelOrder: number,
  totalPanels: number,
): T | undefined {
  if (scenes.length === 0) {
    return undefined;
  }

  const index = Math.min(
    scenes.length - 1,
    Math.floor(((panelOrder - 1) * scenes.length) / Math.max(1, totalPanels)),
  );
  return scenes[index];
}

function buildAutofillCompilerBrief(
  context: PageAutofillContext,
  language: AppLanguage,
): string {
  const outputLanguage = language === 'en' ? 'English' : 'Japanese';
  const canonicalEntities = buildCanonicalCompilerEntityRefs(context.entities);
  const entityLookup = new Map(context.entities.map((entity) => [entity.id, entity]));
  const compactBriefText = (value: string | null | undefined, maxLength?: number): string =>
    summarizeCompilerText(
      canonicalizeCompilerBriefText(value, canonicalEntities),
      maxLength ?? STORY_PROMPT_CONTEXT_LIMITS.generalFieldChars,
    ) ?? '(none)';
  const compactBriefList = (values: readonly string[], maxLength = 160): string =>
    values
      .map((value) => summarizeCompilerText(canonicalizeCompilerBriefText(value, canonicalEntities), maxLength))
      .filter((value): value is string => value !== null)
      .join(' / ') || '(none)';
  const visibleScenes = context.scenes.slice(0, STORY_PROMPT_CONTEXT_LIMITS.maxSceneSummaries);
  const sceneLines = visibleScenes
    .map((scene) => {
      const people =
        scene.involvedEntityIds
          .map((entityId) => entityLookup.get(entityId)?.name ?? entityId)
          .join(', ') || 'none';

      return [
        `Scene ${scene.order}`,
        `location=${compactBriefText(scene.location, 80)}`,
        `time=${compactBriefText(scene.time, 40)}`,
        `atmosphere=${compactBriefText(scene.atmosphere, 80)}`,
        `people=${people}`,
      ].join(' | ');
    })
    .concat(context.scenes.length > visibleScenes.length ? [`... (${context.scenes.length - visibleScenes.length} more scenes)`] : [])
    .join('\n');

  const panelLines = context.panels
    .map((panel) => {
      const assignments =
        panel.entities
          .map((assignment) => {
            const entity = entityLookup.get(assignment.entityId);
            return `${entity?.name ?? assignment.entityId}:${assignment.role}/${assignment.position}/${assignment.expression}/${assignment.action}`;
          })
          .join(', ') || 'none';

      return [
        `Panel ${panel.order}`,
        `role=${panel.panelRole}`,
        `size=${panel.panelSize}`,
        `situation=${summarizeCompilerText(canonicalizeCompilerBriefText(panel.situationText, canonicalEntities)) ?? '(blank)'}`,
        `shot=${panel.composition.shotType ?? '(blank)'}`,
        `angle=${panel.composition.angle ?? '(blank)'}`,
        `background=${summarizeCompilerText(canonicalizeCompilerBriefText(panel.backgroundNote, canonicalEntities)) ?? '(blank)'}`,
        `dialogue_count=${panel.dialogue.length}`,
        `assignments=${assignments}`,
      ].join(' | ');
    })
    .join('\n');

  const entityLines = context.entities
    .map((entity) =>
      [
        `${entity.id}: ${entity.name} (${entity.entityType}${extractEntityAliases(entity.structuredFields).length === 0 ? '' : `, aliases: ${extractEntityAliases(entity.structuredFields).join(', ')}`})`,
        summarizeCompilerText(canonicalizeCompilerBriefText(entity.freeDescription, canonicalEntities), 120) ?? '',
        summarizeCompilerText(canonicalizeCompilerBriefText(entity.promptSupplement, canonicalEntities), 120) ?? '',
      ]
        .filter((part) => part.trim().length > 0)
        .join(' | '),
    )
    .join('\n');

  return [
    '[TASK]',
    `Fill editable page and panel draft fields for page ${context.pageNumber} of ${context.totalPagesInEpisode}.`,
    `Return suggestions for exactly ${context.frameCount} panels with orders 1 through ${context.frameCount}.`,
    'Work in this order: decide the page beat, split it into panel beats in Japanese manga reading order (right-to-left within a row, then top-to-bottom across rows), choose the visible subject or subjects for each panel, then fill the editable fields.',
    'Panel order numbers must match the saved layout reading order; panel 1 is the first panel a manga reader sees.',
    'Decide what each panel should show so the page faithfully expresses the supplied episode story and any scene information without inventing a new episode event.',
    'Only provide fields that are useful as editable defaults.',
    `Write every free-text field in natural ${outputLanguage} suitable for direct editing in the Lyra UI.`,
    '',
    '[CHAPTER CONSISTENCY]',
    `Chapter title: ${compactBriefText(context.chapterTitle, 160)}`,
    `Chapter purpose: ${compactBriefText(context.chapterPurpose)}`,
    `Chapter starting state: ${compactBriefText(context.chapterStartingState)}`,
    `Chapter ending state: ${compactBriefText(context.chapterEndingState)}`,
    `Chapter emotion curve: ${compactBriefText(context.chapterEmotionCurve)}`,
    `Chapter key beats: ${compactBriefList(context.chapterKeyBeats)}`,
    '',
    '[PAGE]',
    `Episode purpose: ${compactBriefText(context.episodePurpose)}`,
    `Introduction: ${compactBriefText(context.introduction)}`,
    `Middle: ${compactBriefText(context.middle)}`,
    `Climax: ${compactBriefText(context.climax)}`,
    `Ending hook: ${compactBriefText(context.endingHook)}`,
    `Current dialogue mode: ${context.dialogueMode}`,
    `Current page dialogue toggle: ${context.pageDialogueToggle ? 'on' : 'off'}`,
    '',
    '[SCENES]',
    sceneLines.length > 0 ? sceneLines : '(none)',
    '',
    '[AVAILABLE ENTITIES]',
    entityLines.length > 0 ? entityLines : '(none)',
    '',
    '[CURRENT PANELS]',
    panelLines,
    '',
    '[TEXT FIELD EXPECTATIONS]',
    'situation_text: one concrete visual sentence that names the main subject or subjects, what they are doing or feeling, and the immediate context.',
    'composition.composition_prompt: one concrete staging sentence that names the subject, framing, and spatial relationship in image-model-friendly language.',
    'composition.custom_note: one short camera or direction memo that clarifies subject priority, eyeline, spacing, silhouette, or staging intent.',
    'background_note: visible environment only, short and concrete.',
    'panel_notes: optional production note or continuity reminder; do not repeat situation_text verbatim.',
    'Do not reuse the same sentence across situation_text, composition.composition_prompt, composition.custom_note, and background_note.',
    'Do not copy the same subject list into every panel unless the same characters are genuinely visible in every panel.',
    '',
    '[DIALOGUE GUIDANCE]',
    'Dialogue and narration should be sufficient for story clarity without becoming chatty or repetitive.',
    'Some panels may remain silent, but if this page clearly contains conversation, confrontation, explanation, or inner realization, provide concise dialogue or thought in the relevant panels instead of leaving the whole page empty.',
    'Prefer character speech or thought for interpersonal beats. Use narration sparingly for setup, transition, or inner realization that cannot be shown clearly through staging alone.',
    'Do not repeat the same narration across multiple panels and do not overload every panel with text.',
    '',
    '[OUTPUT CONTRACT]',
    'Return one JSON object matching the supplied page_autofill schema.',
    'Use only existing panel orders from [CURRENT PANELS], and use only enum values allowed by the schema.',
    'Prefer null or omission over invented IDs, enum values, characters, or unsupported details.',
    '',
    '[RULES]',
    'Use only provided entity IDs.',
    'Do not add extra characters, props, weapons, or dramatic background details that are not supported by the episode story or provided scenes.',
    'Use the chapter arc only to keep continuity and avoid contradictions across the broader chapter.',
    'Use scene mood for visible composition, posture, and expression cues when scenes are provided; otherwise infer restrained cues from the episode story.',
    'Prefer grounded camera and staging choices over flashy ones.',
    'Keep each suggestion concise and editable.',
  ].join('\n');
}

function buildEpisodePlanCompilerBrief(
  context: EpisodePagePlanContext,
  language: AppLanguage,
): string {
  const outputLanguage = language === 'en' ? 'English' : 'Japanese';
  const canonicalEntities = buildCanonicalCompilerEntityRefs(context.entities);
  const entityLookup = new Map(context.entities.map((entity) => [entity.id, entity]));
  const compactBriefText = (value: string | null | undefined, maxLength?: number): string =>
    summarizeCompilerText(
      canonicalizeCompilerBriefText(value, canonicalEntities),
      maxLength ?? STORY_PROMPT_CONTEXT_LIMITS.generalFieldChars,
    ) ?? '(none)';
  const compactBriefList = (values: readonly string[], maxLength = 160): string =>
    values
      .map((value) => summarizeCompilerText(canonicalizeCompilerBriefText(value, canonicalEntities), maxLength))
      .filter((value): value is string => value !== null)
      .join(' / ') || '(none)';

  const visibleScenes = context.scenes.slice(0, STORY_PROMPT_CONTEXT_LIMITS.maxSceneSummaries);
  const sceneLines = visibleScenes
    .map((scene) => {
      const people =
        scene.involvedEntityIds
          .map((entityId) => entityLookup.get(entityId)?.name ?? entityId)
          .join(', ') || 'none';
      const stateNotes =
        scene.entityStates
          .map((state) => {
            const entityName = entityLookup.get(state.entityId)?.name ?? state.entityId;
            const details = [
              state.costumeNote,
              state.conditionNote,
              state.hairNote,
              state.expressionDefault,
              state.extraNote,
            ].filter((value): value is string => isMeaningfulText(value));

            if (details.length === 0) {
              return null;
            }

            return `${entityName}: ${details.join(' / ')}`;
          })
          .filter((value): value is string => value !== null)
          .join(' ; ') || 'none';

      return [
        `Scene ${scene.order} (${scene.id})`,
        `location=${compactBriefText(scene.location, 80)}`,
        `time=${compactBriefText(scene.time, 40)}`,
        `atmosphere=${compactBriefText(scene.atmosphere, 80)}`,
        `people=${people}`,
        `state_notes=${summarizeCompilerText(canonicalizeCompilerBriefText(stateNotes, canonicalEntities), 180) ?? 'none'}`,
      ].join(' | ');
    })
    .concat(context.scenes.length > visibleScenes.length ? [`... (${context.scenes.length - visibleScenes.length} more scenes)`] : [])
    .join('\n');

  const entityLines = context.entities
    .map((entity) =>
      [
        `${entity.id}: ${entity.name} (${entity.entityType}${extractEntityAliases(entity.structuredFields).length === 0 ? '' : `, aliases: ${extractEntityAliases(entity.structuredFields).join(', ')}`})`,
        summarizeCompilerText(canonicalizeCompilerBriefText(entity.freeDescription, canonicalEntities), 120) ?? '',
        summarizeCompilerText(canonicalizeCompilerBriefText(entity.promptSupplement, canonicalEntities), 120) ?? '',
      ]
        .filter((part) => part.trim().length > 0)
        .join(' | '),
    )
    .join('\n');

  const pageLines = context.pages
    .map((page) => {
      const panelLines = page.panels
        .map((panel) => {
          return [
            `Panel ${panel.order}`,
            `role=${panel.panelRole}`,
            `size=${panel.panelSize}`,
            `draft_state=${describePanelDraftState(panel)}`,
          ].join(' | ');
        })
        .join('\n');

      return [
        `Page ${page.pageNumber} (${page.pageId})`,
        `frame_count=${page.frameCount}`,
        `dialogue_mode=${page.dialogueMode}`,
        `page_dialogue_toggle=${page.pageDialogueToggle ? 'on' : 'off'}`,
        panelLines,
      ].join('\n');
    })
    .join('\n\n');

  return [
    '[TASK]',
    'Plan editable page and panel draft fields for the given existing pages within the episode.',
    `Return suggestions for exactly ${context.pages.length} existing pages, preserving each page_id, page_number, frame_count, and panel order.`,
    'This brief may contain only a contiguous chunk of pages. Use page_number and estimated pages to place these beats in the full episode instead of restarting the whole story inside the chunk.',
    'Work in this order: locate these pages within the full episode story, use scene entries when provided, split each page into panel beats, choose the visible subject or subjects for each panel, then fill the editable fields.',
    'If scenes are provided, assign them across the existing pages in a grounded, contiguous order. If no scenes are provided, leave source_scene_ids empty and use the episode story itself.',
    'You may add natural connective reaction or transition shots when they help readability, but do not invent new episode events, hidden subplots, props, or twists.',
    `Write every free-text field in natural ${outputLanguage} suitable for direct editing in the Lyra UI.`,
    '',
    '[CHAPTER ARC]',
    `Title: ${compactBriefText(context.chapter.title, 160)}`,
    `Purpose: ${compactBriefText(context.chapter.purpose)}`,
    `Starting state: ${compactBriefText(context.chapter.startingState)}`,
    `Ending state: ${compactBriefText(context.chapter.endingState)}`,
    `Emotion curve: ${compactBriefText(context.chapter.emotionCurve)}`,
    `Key beats: ${compactBriefList(context.chapter.keyBeats)}`,
    '',
    '[EPISODE ARC]',
    `Title: ${compactBriefText(context.episode.title, 160)}`,
    `Purpose: ${compactBriefText(context.episode.purpose)}`,
    `Introduction: ${compactBriefText(context.episode.introduction)}`,
    `Middle: ${compactBriefText(context.episode.middle)}`,
    `Climax: ${compactBriefText(context.episode.climax)}`,
    `Ending hook: ${compactBriefText(context.episode.endingHook)}`,
    `Estimated pages: ${context.episode.estimatedPages}`,
    '',
    '[SCENES]',
    sceneLines.length > 0 ? sceneLines : '(none)',
    '',
    '[AVAILABLE ENTITIES]',
    entityLines.length > 0 ? entityLines : '(none)',
    '',
    '[CURRENT PAGES]',
    pageLines,
    '',
    '[TEXT FIELD EXPECTATIONS]',
    'situation_text: one concrete visual sentence that names the main subject or subjects, what they are doing or feeling, and the immediate context.',
    'composition.composition_prompt: one concrete staging sentence that names the subject, framing, and spatial relationship in image-model-friendly language.',
    'composition.custom_note: one short camera or direction memo that clarifies subject priority, eyeline, spacing, silhouette, or staging intent.',
    'background_note: visible environment only, short and concrete.',
    'panel_notes: optional production note or continuity reminder; do not repeat situation_text verbatim.',
    'Do not reuse the same sentence across situation_text, composition.composition_prompt, composition.custom_note, and background_note.',
    'Do not copy the same subject list into every panel unless the same characters are genuinely visible in every panel.',
    '',
    '[DIALOGUE GUIDANCE]',
    'Dialogue and narration should be sufficient for story clarity without becoming chatty or repetitive.',
    'Some panels may remain silent, but pages built around conversation, confrontation, explanation, or inner realization should receive concise dialogue or thought in the relevant panels instead of staying wholly silent.',
    'Prefer character speech or thought for interpersonal beats. Use narration sparingly for setup, transition, or inner realization that cannot be shown clearly through staging alone.',
    'Do not repeat the same narration across multiple panels and do not overload every panel with text.',
    '',
    '[OUTPUT CONTRACT]',
    'Return one JSON object matching the supplied episode_page_plan schema.',
    'Use only existing page_id, page_number, panel order, scene ID, and entity ID values from this brief. When [SCENES] is (none), source_scene_ids must be empty.',
    'Use only enum values allowed by the schema, and prefer null or omission over invented values or unsupported details.',
    '',
    '[RULES]',
    'Do not contradict the chapter arc, episode arc, or scene order when scenes exist.',
    'Keep the page plan readable and not flashy or quirky for its own sake.',
    'Use chapter emotion curve and episode structure to decide pacing and shot intensity.',
    'Convert scene mood and personality implications into visible but restrained cues in posture, gaze, spacing, and camera distance when scenes are provided; otherwise infer those cues from the episode text.',
    'Do not add unsupported violence, props, weapons, locations, or surprise plot events.',
    'Silent panels are allowed, but do not leave the page plan underwritten when the story clearly implies speech, thought, or brief narration.',
  ].join('\n');
}

function buildFallbackEpisodePlanSuggestion(
  context: EpisodePagePlanContext,
  language: AppLanguage,
): EpisodePagePlanSuggestion {
  const distributedPageBeats = buildDistributedEpisodeBeats(
    [
      context.episode.introduction,
      context.episode.middle,
      context.episode.climax,
      context.episode.endingHook,
      context.episode.purpose,
    ],
    context.pages.length,
    language,
  );

  return {
    pages: context.pages.map((page, pageIndex) => {
      const sourceScenes = pickScenesForPage(context.scenes, context.pages.length, pageIndex);
      const leadScene = sourceScenes[0];
      const sceneIds = sourceScenes.map((scene) => scene.id);
      const pageBeat = distributedPageBeats[pageIndex] ?? distributedPageBeats[distributedPageBeats.length - 1];
      const pagePurpose = buildFallbackPagePurpose(context, sourceScenes, page.pageNumber, language, pageBeat);
      const continuityNote = buildFallbackContinuityNote(context, sourceScenes, page.pageNumber, language, pageBeat);
      const sceneEntityIds = Array.from(
        new Set(sourceScenes.flatMap((scene) => scene.involvedEntityIds)),
      );
      const pageEntityIds = inferFallbackEntityIds(
        context.entities,
        sceneEntityIds,
        [
          pagePurpose,
          continuityNote,
          pageBeat,
          context.episode.introduction,
          context.episode.middle,
          context.episode.climax,
          context.episode.endingHook,
          ...sourceScenes.flatMap((scene) => [scene.location, scene.time, scene.atmosphere]),
        ],
        4,
      );
      const panelPlans = buildFallbackPanelPlans(page.panels.length);
      const panelBeats = buildDistributedPanelBeats([pageBeat], panelPlans, language);

      return {
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        sourceSceneIds: sceneIds,
        pagePurpose,
        continuityNote,
        page: {
          dialogueMode: page.dialogueMode,
          pageDialogueToggle: page.pageDialogueToggle,
        },
        panels: page.panels.map((panel, panelIndex) => {
          const panelPlan = panelPlans[Math.min(panelIndex, panelPlans.length - 1)];
          const scene =
            resolveSceneForPanelOrder(sourceScenes, panel.order, page.panels.length) ??
            leadScene;
          const panelBeat =
            panelBeats[panelIndex] ??
            buildFallbackPanelBeat(pagePurpose, continuityNote, panel.order, page.panels.length, language);
          const sceneScopedEntityIds = inferFallbackEntityIds(
            context.entities,
            Array.from(new Set([...(scene?.involvedEntityIds ?? []), ...pageEntityIds])),
            [
              pageBeat,
              panelBeat,
              pagePurpose,
              continuityNote,
              scene?.location,
              scene?.time,
              scene?.atmosphere,
              context.episode.introduction,
              context.episode.middle,
              context.episode.climax,
              context.episode.endingHook,
            ],
            4,
          );
          const panelCandidateEntityIds = inferFallbackEntityIds(
            context.entities,
            sceneScopedEntityIds.length > 0 ? sceneScopedEntityIds : pageEntityIds,
            [
              panelBeat,
              pageBeat,
              pagePurpose,
              continuityNote,
              scene?.location,
              scene?.time,
              scene?.atmosphere,
            ],
            4,
          );
          const panelMentionedEntityIds = inferFallbackEntityIds(
            context.entities,
            [],
            [panelBeat],
            4,
          );
          const pageMentionedEntityIds = inferFallbackEntityIds(
            context.entities,
            [],
            [pageBeat, pagePurpose, continuityNote],
            4,
          );
          const entitySelectionBasis =
            panelMentionedEntityIds.length > 0
              ? panelMentionedEntityIds
              : pageMentionedEntityIds.length > 0
                ? pageMentionedEntityIds
                : panelCandidateEntityIds.length > 0
                  ? panelCandidateEntityIds
                  : sceneScopedEntityIds.length > 0
                    ? sceneScopedEntityIds
                    : pageEntityIds;
          const panelEntityIds = selectFallbackPanelEntityIds(
            entitySelectionBasis,
            panelPlan.focus,
            {
              explicitEntityCount:
                panelMentionedEntityIds.length > 0
                  ? panelMentionedEntityIds.length
                  : pageMentionedEntityIds.length,
            },
          );
          const entityNames = panelEntityIds
            .map((entityId) => context.entities.find((entity) => entity.id === entityId)?.name ?? entityId)
            .filter((value, index, array) => array.indexOf(value) === index);
          const shotType = fallbackShotTypeForRole(panelPlan.role ?? 'action');
          const angle = fallbackAngleForRole(panelPlan.role ?? 'action');
          const dialogue = buildFallbackDialogueLines(
            [
              panelBeat,
              pageBeat,
              pagePurpose,
              continuityNote,
              scene?.location,
              scene?.time,
              scene?.atmosphere,
            ],
            context.entities,
            panelEntityIds,
            panelPlan,
            panel.order,
            language,
          );

          return {
            order: panel.order,
            panelRole: panelPlan.role,
            panelSize: panelPlan.size,
            situationText: buildFallbackEpisodeSituationText(
              scene,
              panelBeat,
              panel.order,
              panelPlan,
              entityNames,
              pagePurpose,
              language,
            ),
            composition: {
              source: 'custom',
              shotType,
              angle,
              compositionPrompt: buildFallbackCompositionPrompt(
                scene,
                panelBeat,
                panelPlan,
                entityNames,
                shotType,
                angle,
                language,
              ),
              customNote: buildFallbackCustomNote(
                scene,
                continuityNote,
                panelPlan,
                entityNames,
                language,
              ),
            },
            dialogueInPanel:
              page.dialogueMode !== 'balloon_only' && panelPlan.focus !== 'setting',
            dialogue,
            backgroundNote: buildFallbackBackground(scene, panelPlan, language),
            panelNotes:
              panelPlan.focus === 'setting'
                ? fallbackLabel(language, 'Establish the place before detail.', '描き込みより先に場所を読ませる。')
                : panelPlan.focus === 'impact'
                  ? fallbackLabel(language, 'Land the page turn or turning point cleanly.', '転換点を明確に着地させる。')
                  : null,
            entities: buildFallbackAssignments(panelEntityIds, panelPlan),
          };
        }),
      };
    }),
  };
}

function buildFallbackEpisodeSituationText(
  scene: EpisodePagePlanContext['scenes'][number] | undefined,
  panelBeat: string,
  _panelOrder: number,
  panelPlan: FallbackPanelPlan,
  entityNames: string[],
  _pagePurpose: string,
  language: AppLanguage,
): string {
  const sceneSetting =
    [scene?.location, scene?.time, scene?.atmosphere]
      .filter((value): value is string => isMeaningfulText(value))
      .join(' / ') || fallbackLabel(language, 'current scene', '現在の場面');
  const subject = formatEntitySubject(entityNames, language);
  const beatHint = summarizeCompilerText(panelBeat, 72);
  const directBeat = buildFallbackSituationClause(beatHint, entityNames, language);

  switch (panelPlan.focus) {
    case 'setting':
      return language === 'en'
        ? `${sceneSetting}. ${directBeat ?? `${subject} takes in the place before the page narrows to detail.`}`
        : `${sceneSetting}。${directBeat ?? `${subject}が場の情報を受け取り、空気の違いをつかむ。`}`;
    case 'exchange':
      return language === 'en'
        ? `${sceneSetting}. ${directBeat ?? `${subject} turns the beat into a direct exchange.`}`
        : `${sceneSetting}。${directBeat ?? `${subject}が向き合い、この流れを具体的なやり取りへ移す。`}`;
    case 'reaction':
      return language === 'en'
        ? `${sceneSetting}. ${directBeat ?? `${subject} lets the emotional aftershock of the beat show on their face.`}`
        : `${sceneSetting}。${directBeat ?? `${subject}が直前の流れを受け、反応を表情に出す。`}`;
    case 'impact':
      return language === 'en'
        ? `${sceneSetting}. ${directBeat ?? `${subject} lands the decisive shift of the page in a single clear beat.`}`
        : `${sceneSetting}。${directBeat ?? `${subject}がこのページの決定的な変化を受け止め、その重みが画面に出る。`}`;
    case 'transition':
      return language === 'en'
        ? `${sceneSetting}. ${directBeat ?? `${subject} turns the beat toward the next development without breaking the scene flow.`}`
        : `${sceneSetting}。${directBeat ?? `${subject}が今の流れを次の展開へ渡していく。`}`;
    case 'pause':
      return language === 'en'
        ? `${sceneSetting}. ${directBeat ?? `${subject} holds a short pause so the page tension can breathe before the next move.`}`
        : `${sceneSetting}。${directBeat ?? `${subject}が短く立ち止まり、次の動きの前に余韻をつくる。`}`;
    case 'lead':
    default:
      return language === 'en'
        ? `${sceneSetting}. ${directBeat ?? `${subject} takes the lead and pushes the page into its next visible beat.`}`
        : `${sceneSetting}。${directBeat ?? `${subject}が動きを先導し、このページの次の一歩を作る。`}`;
  }
}

function pickScenesForPage<T extends { id: string }>(
  scenes: T[],
  totalPages: number,
  pageIndex: number,
): T[] {
  if (scenes.length === 0) {
    return [];
  }

  const start = Math.floor((pageIndex * scenes.length) / totalPages);
  const end = Math.floor(((pageIndex + 1) * scenes.length) / totalPages);
  const slice = scenes.slice(start, Math.max(start + 1, end));
  return slice.length > 0 ? slice : [scenes[Math.min(pageIndex, scenes.length - 1)]];
}

function buildFallbackPagePurpose(
  context: EpisodePagePlanContext,
  sourceScenes: EpisodePagePlanContext['scenes'],
  _pageNumber: number,
  language: AppLanguage,
  pageBeat?: string,
): string {
  const beat =
    summarizeCompilerText(pageBeat, 70) ??
    summarizeCompilerText(context.episode.purpose ?? context.chapter.purpose, 70) ??
    fallbackLabel(language, 'Advance the story clearly.', '物語を明確に前へ進める。');
  const sceneSummary =
    sourceScenes
      .map((scene) => [scene.location, scene.time].filter(isMeaningfulText).join(' / '))
      .filter((value) => value.length > 0)
      .join(' | ') || null;

  if (sceneSummary === null) {
    return beat;
  }

  return language === 'en'
    ? `${beat} Keep the page grounded in ${sceneSummary}.`
    : `${beat} 舞台は${sceneSummary}に置く。`;
}

function buildFallbackContinuityNote(
  _context: EpisodePagePlanContext,
  sourceScenes: EpisodePagePlanContext['scenes'],
  pageNumber: number,
  language: AppLanguage,
  _pageBeat?: string,
): string {
  const mood = sourceScenes
    .map((scene) => scene.atmosphere)
    .filter((value): value is string => isMeaningfulText(value))
    .join(' / ');
  const setting = sourceScenes
    .map((scene) => [scene.location, scene.time].filter(isMeaningfulText).join(' / '))
    .filter((value) => value.length > 0)
    .join(' | ');

  if (language === 'en') {
    return [
      mood.length > 0 ? `Keep the mood ${mood}.` : null,
      setting.length > 0 ? `Keep the page grounded in ${setting}.` : null,
      `Carry page ${pageNumber} into the next page without inventing a new event or replaying the exact same beat.`,
    ]
      .filter((value): value is string => value !== null)
      .join(' ');
  }

  return [
    mood.length > 0 ? `空気感は${mood}のまま保つ。` : null,
    setting.length > 0 ? `舞台は${setting}から逸らさない。` : null,
    `${pageNumber}ページ目から次ページへ、新しい出来事を足さず、同じ見せ場をそのまま繰り返さずにつなぐ。`,
  ]
    .filter((value): value is string => value !== null)
    .join(' ');
}

function buildFallbackAutofillSuggestion(
  context: PageAutofillContext,
  language: AppLanguage,
): PageAutofillSuggestion {
  const pageBeat = buildFallbackAutofillPageBeat(context, language);
  const pageEntityIds = inferFallbackEntityIds(
    context.entities,
    Array.from(new Set(context.scenes.flatMap((scene) => scene.involvedEntityIds))),
    [
      pageBeat,
      context.episodePurpose,
      context.introduction,
      context.middle,
      context.climax,
      context.endingHook,
      ...context.scenes.flatMap((scene) => [scene.location, scene.time, scene.atmosphere]),
    ],
    4,
  );
  const panelPlans = buildFallbackPanelPlans(context.panels.length);
  const panelBeats = buildDistributedPanelBeats([pageBeat], panelPlans, language);

  return {
    panels: context.panels.map((panel, index) => {
      const panelPlan = panelPlans[Math.min(index, panelPlans.length - 1)];
      const scene = resolveSceneForPanelOrder(context.scenes, panel.order, context.panels.length);
      const panelBeat =
        panelBeats[index] ??
        buildFallbackPanelBeat(
          context.episodePurpose ?? context.middle ?? context.introduction ?? context.endingHook ?? fallbackLabel(language, 'Advance the current page beat.', 'このページの主な流れを進める。'),
          context.endingHook,
          panel.order,
          context.panels.length,
          language,
        );
      const sceneScopedEntityIds = inferFallbackEntityIds(
        context.entities,
        Array.from(new Set([...(scene?.involvedEntityIds ?? []), ...pageEntityIds])),
        [
          panelBeat,
          pageBeat,
          context.episodePurpose,
          context.introduction,
          context.middle,
          context.climax,
          context.endingHook,
          scene?.location,
          scene?.time,
          scene?.atmosphere,
        ],
        4,
      );
      const panelCandidateEntityIds = inferFallbackEntityIds(
        context.entities,
        sceneScopedEntityIds.length > 0 ? sceneScopedEntityIds : pageEntityIds,
        [
          panelBeat,
          pageBeat,
          scene?.location,
          scene?.time,
          scene?.atmosphere,
        ],
        4,
      );
      const panelMentionedEntityIds = inferFallbackEntityIds(
        context.entities,
        [],
        [panelBeat],
        4,
      );
      const pageMentionedEntityIds = inferFallbackEntityIds(
        context.entities,
        [],
        [
          pageBeat,
          context.episodePurpose,
          context.introduction,
          context.middle,
          context.climax,
          context.endingHook,
        ],
        4,
      );
      const entitySelectionBasis =
        panelMentionedEntityIds.length > 0
          ? panelMentionedEntityIds
          : pageMentionedEntityIds.length > 0
            ? pageMentionedEntityIds
            : panelCandidateEntityIds.length > 0
              ? panelCandidateEntityIds
              : sceneScopedEntityIds.length > 0
                ? sceneScopedEntityIds
                : pageEntityIds;
      const panelEntityIds = selectFallbackPanelEntityIds(
        entitySelectionBasis,
        panelPlan.focus,
        {
          explicitEntityCount:
            panelMentionedEntityIds.length > 0
              ? panelMentionedEntityIds.length
              : pageMentionedEntityIds.length,
        },
      );
      const entityNames = panelEntityIds
        .map((entityId) => context.entities.find((entity) => entity.id === entityId)?.name ?? entityId)
        .filter((value, entityIndex, array) => array.indexOf(value) === entityIndex);
      const shotType = fallbackShotTypeForRole(panelPlan.role ?? 'action');
      const angle = fallbackAngleForRole(panelPlan.role ?? 'action');
      const dialogue = buildFallbackDialogueLines(
        [
          panelBeat,
          pageBeat,
          context.episodePurpose,
          context.introduction,
          context.middle,
          context.climax,
          context.endingHook,
          scene?.location,
          scene?.time,
          scene?.atmosphere,
        ],
        context.entities,
        panelEntityIds,
        panelPlan,
        panel.order,
        language,
      );

      return {
        order: panel.order,
        panelRole: panelPlan.role,
        panelSize: panelPlan.size,
        situationText: buildFallbackSituationText(
          scene,
          panelBeat,
          panel.order,
          panelPlan,
          entityNames,
          language,
        ),
        composition: {
          source: 'custom',
          shotType,
          angle,
          compositionPrompt: buildFallbackCompositionPrompt(
            scene,
            panelBeat,
            panelPlan,
            entityNames,
            shotType,
            angle,
            language,
          ),
          customNote: buildFallbackCustomNote(
            scene,
            context.endingHook,
            panelPlan,
            entityNames,
            language,
          ),
        },
        dialogueInPanel:
          context.dialogueMode !== 'balloon_only' && panelPlan.focus !== 'setting',
        dialogue,
        backgroundNote: buildFallbackBackground(scene, panelPlan, language),
        entities: buildFallbackAssignments(panelEntityIds, panelPlan),
      };
    }),
  };
}

function buildFallbackSituationText(
  scene: PageAutofillContext['scenes'][number] | undefined,
  panelBeat: string,
  panelOrder: number,
  panelPlan: FallbackPanelPlan,
  entityNames: string[],
  language: AppLanguage,
): string {
  const sceneSetting =
    [scene?.location, scene?.time, scene?.atmosphere]
      .filter((value): value is string => isMeaningfulText(value))
      .join(' / ') || fallbackLabel(language, 'current scene', '現在の場面');
  const subject = formatEntitySubject(entityNames, language);
  const beatHint = summarizeCompilerText(panelBeat, 72);
  const directBeat = buildFallbackSituationClause(beatHint, entityNames, language);

  switch (panelPlan.focus) {
    case 'setting':
      return language === 'en'
        ? `${sceneSetting}. ${directBeat ?? `${subject} is introduced so the setting and page tension read at once.`}`
        : `${sceneSetting}。${directBeat ?? `${subject}を導入し、場の状況とページの緊張感が一度で伝わるようにする。`}`;
    case 'exchange':
      return language === 'en'
        ? `${sceneSetting}. ${directBeat ?? `${subject} turns the current beat into direct interaction.`}`
        : `${sceneSetting}。${directBeat ?? `${subject}が向き合い、この流れを具体的なやり取りへ進める。`}`;
    case 'reaction':
      return language === 'en'
        ? `${sceneSetting}. ${directBeat ?? `${subject} shows the emotional reaction to the preceding beat while the place remains readable.`}`
        : `${sceneSetting}。${directBeat ?? `${subject}が直前の出来事への反応を見せ、場所の情報も読み取れる状態を保つ。`}`;
    case 'impact':
      return language === 'en'
        ? `${sceneSetting}. ${directBeat ?? `${subject} lands the clearest change of the page so the turning point is easy to read.`}`
        : `${sceneSetting}。${directBeat ?? `${subject}がこのページで最も大きい変化を受け持ち、転換点がすぐ分かるようにする。`}`;
    case 'transition':
      return language === 'en'
        ? `${sceneSetting}. ${directBeat ?? `${subject} turns the current beat toward the next development without breaking the scene flow.`}`
        : `${sceneSetting}。${directBeat ?? `${subject}が今の流れを次の展開へつなぎ、場面の流れを途切れさせない。`}`;
    case 'pause':
      return language === 'en'
        ? `${sceneSetting}. ${directBeat ?? `${subject} creates a short pause so the page can breathe before the next move.`}`
        : `${sceneSetting}。${directBeat ?? `${subject}が短い間をつくり、このページに呼吸を与える。`}`;
    case 'lead':
    default:
      return language === 'en'
        ? `${sceneSetting}. ${directBeat ?? `${subject} drives panel ${panelOrder} and advances the active beat.`}`
        : `${sceneSetting}。${directBeat ?? `${subject}が${panelOrder}コマ目を動かし、主な流れを前へ進める。`}`;
  }
}

function buildFallbackCompositionPrompt(
  scene: PageAutofillContext['scenes'][number] | EpisodePagePlanContext['scenes'][number] | undefined,
  panelBeat: string,
  panelPlan: FallbackPanelPlan,
  entityNames: string[],
  shotType: NonNullable<NonNullable<PageAutofillPanelSuggestion['composition']>['shotType']>,
  angle: NonNullable<NonNullable<PageAutofillPanelSuggestion['composition']>['angle']>,
  language: AppLanguage,
): string | null {
  const subject = formatEntitySubject(entityNames, language);
  const environment =
    [scene?.location, scene?.time].filter((value): value is string => isMeaningfulText(value)).join(' / ') ||
    fallbackLabel(language, 'the current environment', '現在の環境');
  const shot = humanizeToken(shotType);
  const cameraAngle = humanizeToken(angle);
  const beatHint = summarizeCompilerText(stripFallbackRoleCueText(panelBeat, language), 90);
  const hasPair = entityNames.length >= 2;

  switch (panelPlan.focus) {
    case 'setting':
      return language === 'en'
        ? `Frame ${subject} in a ${shot} ${cameraAngle} view so ${environment} and ${beatHint ?? 'the scene layout'} read at once.`
        : `${subject}を${shot}寄り・${cameraAngle}気味で捉え、${environment}と${beatHint ?? '場の配置'}が一度で読める構図にする。`;
    case 'exchange':
      return language === 'en'
        ? hasPair
          ? `Keep ${subject} in the same frame with readable spacing and eyelines, using a ${shot} ${cameraAngle} composition that supports ${beatHint ?? 'the exchange'}.`
          : `Stage ${subject}'s posture and eyeline in a ${shot} ${cameraAngle} composition that supports ${beatHint ?? 'the internal beat'}.`
        : hasPair
          ? `${subject}を同じ画面の中に置き、${beatHint ?? 'やり取り'}が読めるように距離と視線を${shot}寄り・${cameraAngle}気味で整理する。`
          : `${subject}の立ち位置と視線を、${beatHint ?? '内面の変化'}が読めるように${shot}寄り・${cameraAngle}気味で整理する。`;
    case 'reaction':
      return language === 'en'
        ? `Use a ${shot} ${cameraAngle} framing that favors ${subject}'s expression while keeping a trace of ${environment} and ${beatHint ?? 'the emotional reaction'}.`
        : `${subject}の表情を優先しつつ${environment}と${beatHint ?? '感情の揺れ'}の気配も残るように、${shot}寄り・${cameraAngle}気味で寄せる。`;
    case 'impact':
      return language === 'en'
        ? `Use a ${shot} ${cameraAngle} composition that places ${beatHint ?? subject} at the visual center of the panel.`
        : `${beatHint ?? subject}が画面の中心に見えるように、${shot}寄り・${cameraAngle}気味で重心を作る。`;
    case 'transition':
      return language === 'en'
        ? `Stage ${subject} in a ${shot} ${cameraAngle} composition that visibly points ${beatHint ?? 'the page'} toward the next beat.`
        : `${subject}が${beatHint ?? '次の流れ'}を指し示すように、${shot}寄り・${cameraAngle}気味で方向性を持たせる。`;
    case 'pause':
      return language === 'en'
        ? `Give ${subject} a cleaner ${shot} ${cameraAngle} frame with more breathing room than the surrounding panels so ${beatHint ?? 'the pause'} can land.`
        : `${subject}に前後のコマより少し余白のある${shot}寄り・${cameraAngle}気味の構図を与え、${beatHint ?? '間'}が着地するようにする。`;
    case 'lead':
    default:
      return language === 'en'
        ? `Make ${subject} read first in a ${shot} ${cameraAngle} composition so ${beatHint ?? 'the next visible beat'} starts cleanly.`
        : `${subject}が最初に読めるように、${shot}寄り・${cameraAngle}気味で${beatHint ?? '次の動き'}が自然に始まる構図にする。`;
  }
}

function buildFallbackCustomNote(
  scene: PageAutofillContext['scenes'][number] | EpisodePagePlanContext['scenes'][number] | undefined,
  _continuityNote: string | null | undefined,
  panelPlan: FallbackPanelPlan,
  entityNames: string[],
  language: AppLanguage,
): string | null {
  const subject = formatEntitySubject(entityNames, language);
  const atmosphere = summarizeCompilerText(scene?.atmosphere, 40);

  switch (panelPlan.focus) {
    case 'setting':
      return language === 'en'
        ? `Keep the frame readable before detail; let ${atmosphere ?? 'the scene mood'} land first around ${subject}.`
        : `描き込みより先に読みやすさを優先し、${subject}の周囲に${atmosphere ?? '場の空気'}という空気を先に伝える。`;
    case 'exchange':
      return language === 'en'
        ? entityNames.length > 1
          ? `Clarify who is pressing and who is receiving by staging ${subject} with readable eyelines and distance.`
          : `Use ${subject}'s posture and eyeline to make the internal shift readable.`
        : entityNames.length > 1
          ? `${subject}の視線と距離で、押している側と受けている側が分かるようにする。`
          : `${subject}の立ち位置と視線で、内面の揺れが分かるようにする。`;
    case 'reaction':
      return language === 'en'
        ? `Hold on the face and upper body long enough for ${subject}'s reaction to register before the page moves on.`
        : `${subject}の反応が読み取れるように、顔から上半身の情報を先に受け取れる見せ方にする。`;
    case 'impact':
      return language === 'en'
        ? `Make the visual weight and the reader's eyeline readable in a single glance.`
        : `画面の重心と視線の流れが一目で読めるようにする。`;
    case 'transition':
      return language === 'en'
        ? `Stage the subject so the reader can feel the next move starting without introducing a new event.`
        : `新しい出来事は足さず、次の動きが始まりかけていることだけを感じさせる。`;
    case 'pause':
      return language === 'en'
        ? `Reduce clutter and let the pause breathe before the next beat.`
        : `情報を詰め込みすぎず、次の流れの前にしっかり間を取る。`;
    case 'lead':
    default:
      return language === 'en'
        ? `Keep ${subject} readable first, then let the surrounding space support the beat without stealing focus.`
        : `${subject}を先に読ませ、その後で周囲の空間が流れを支えるようにして主役を食わない。`;
  }
}

function buildFallbackBackground(
  scene: PageAutofillContext['scenes'][number] | EpisodePagePlanContext['scenes'][number] | undefined,
  panelPlan: FallbackPanelPlan,
  language: AppLanguage,
): string | null {
  if (scene === undefined) {
    return fallbackLabel(language, 'Current setting', '現在の場面');
  }

  const parts =
    panelPlan.focus === 'reaction' || panelPlan.focus === 'pause'
      ? [scene.location]
      : [scene.location, scene.time];
  return parts.filter((value): value is string => isMeaningfulText(value)).join(' / ') || null;
}

function buildFallbackAssignments(
  entityIds: string[],
  panelPlan: FallbackPanelPlan,
): PanelEntityAssignment[] | undefined {
  if (entityIds.length === 0) {
    return undefined;
  }

  return entityIds.slice(0, 3).map((entityId, index) => ({
    entityId,
    role: index === 0 ? 'primary' : index === 1 ? 'secondary' : 'background',
    expression:
      panelPlan.focus === 'reaction'
        ? index === 0
          ? 'surprised'
          : 'calm'
        : panelPlan.focus === 'impact'
          ? 'determined'
          : index === 0
            ? 'calm'
            : 'determined',
    customExpression: null,
    action:
      panelPlan.focus === 'transition'
        ? 'running'
        : 'standing_firm',
    customAction: null,
    position:
      index === 0
        ? panelPlan.focus === 'setting'
          ? 'center'
          : 'center'
        : index === 1
          ? 'left'
          : 'background',
    facingDirection:
      panelPlan.focus === 'exchange'
        ? index === 0
          ? 'right'
          : 'left'
        : panelPlan.focus === 'reaction'
          ? 'three_quarter_right'
          : index === 0
            ? 'front'
            : 'three_quarter_right',
    effectNote: null,
    stateId: null,
  }));
}

function buildFallbackDialogueLines(
  sourceTexts: Array<string | null | undefined>,
  entities: Array<{ id: string; name: string; structuredFields?: Record<string, unknown> }>,
  panelEntityIds: string[],
  panelPlan: FallbackPanelPlan,
  panelOrder: number,
  language: AppLanguage,
): PanelDialogueLine[] | undefined {
  const quoteCandidates = extractQuotedDialogueCandidates(sourceTexts, entities);
  const quoted = quoteCandidates.length === 0
    ? null
    : quoteCandidates[(Math.max(panelOrder, 1) - 1) % quoteCandidates.length];
  if (quoted !== null) {
    const visibleSpeakerId =
      quoted.entityId !== null && panelEntityIds.includes(quoted.entityId)
        ? quoted.entityId
        : panelEntityIds[0] ?? quoted.entityId;
    return [
      {
        entityId: visibleSpeakerId ?? null,
        text: quoted.text,
        type: visibleSpeakerId === null ? 'narration' : 'speech',
        position: 'top',
      },
    ];
  }

  const beatDrivenLine = buildBeatDrivenFallbackDialogueLine(
    sourceTexts[0] ?? null,
    panelPlan,
    language,
    panelEntityIds[0] ?? null,
  );
  return beatDrivenLine === null ? undefined : [beatDrivenLine];
}

type FallbackPanelPlan = {
  role: PageAutofillPanelSuggestion['panelRole'];
  size: PageAutofillPanelSuggestion['panelSize'];
  focus: 'setting' | 'lead' | 'exchange' | 'reaction' | 'transition' | 'impact' | 'pause';
};

function buildFallbackPanelPlans(panelCount: number): FallbackPanelPlan[] {
  const templates: Record<number, FallbackPanelPlan[]> = {
    1: [{ role: 'emphasis', size: 'large', focus: 'lead' }],
    2: [
      { role: 'establish', size: 'wide', focus: 'setting' },
      { role: 'impact', size: 'large', focus: 'impact' },
    ],
    3: [
      { role: 'establish', size: 'large', focus: 'setting' },
      { role: 'action', size: 'standard', focus: 'exchange' },
      { role: 'impact', size: 'standard', focus: 'reaction' },
    ],
    4: [
      { role: 'establish', size: 'large', focus: 'setting' },
      { role: 'action', size: 'standard', focus: 'lead' },
      { role: 'reaction', size: 'standard', focus: 'reaction' },
      { role: 'impact', size: 'wide', focus: 'impact' },
    ],
    5: [
      { role: 'establish', size: 'wide', focus: 'setting' },
      { role: 'action', size: 'standard', focus: 'lead' },
      { role: 'action', size: 'standard', focus: 'exchange' },
      { role: 'reaction', size: 'standard', focus: 'reaction' },
      { role: 'impact', size: 'large', focus: 'impact' },
    ],
  };

  const exact = templates[panelCount];
  if (exact !== undefined) {
    return exact;
  }

  return Array.from({ length: panelCount }, (_value, index) => {
    if (index === 0) {
      return { role: 'establish', size: 'wide', focus: 'setting' } satisfies FallbackPanelPlan;
    }
    if (index === panelCount - 1) {
      return { role: 'impact', size: 'large', focus: 'impact' } satisfies FallbackPanelPlan;
    }
    if (index === panelCount - 2) {
      return { role: 'reaction', size: 'standard', focus: 'reaction' } satisfies FallbackPanelPlan;
    }
    return { role: 'action', size: 'standard', focus: index % 2 === 0 ? 'exchange' : 'lead' } satisfies FallbackPanelPlan;
  });
}

function extractQuotedDialogueCandidates(
  texts: Array<string | null | undefined>,
  entities: Array<{ id: string; name: string; structuredFields?: Record<string, unknown> }>,
): Array<{ text: string; entityId: string | null }> {
  const canonicalEntities = entities.map((entity) => ({
    id: entity.id,
    name: entity.name,
    aliases: extractEntityAliases(entity.structuredFields ?? {}),
  }));
  const candidates: Array<{ text: string; entityId: string | null }> = [];
  const seen = new Set<string>();
  const quotePattern = /[「『"]([^」』"\n]{1,80})[」』"]/gu;

  for (const text of texts) {
    const canonicalText = canonicalizeEntityMentionsInText(text, canonicalEntities);
    if (!isMeaningfulText(canonicalText)) {
      continue;
    }

    for (const match of canonicalText.matchAll(quotePattern)) {
      const raw = match[1]?.trim();
      if (!isMeaningfulText(raw) || seen.has(raw) || !looksLikeQuotedDialogue(raw, canonicalEntities)) {
        continue;
      }
      seen.add(raw);

      const matchIndex = match.index ?? 0;
      const before = canonicalText.slice(Math.max(0, matchIndex - 48), matchIndex);
      const speaker =
        canonicalEntities
          .map((entity) => ({ entityId: entity.id, name: entity.name, index: before.lastIndexOf(entity.name) }))
          .filter((entry) => entry.index >= 0)
          .sort((left, right) => right.index - left.index)[0] ?? null;

      candidates.push({
        text: raw,
        entityId: speaker?.entityId ?? null,
      });
    }
  }

  return candidates;
}

function looksLikeQuotedDialogue(
  value: string,
  entities: Array<{ id: string; name: string; aliases: string[] }>,
): boolean {
  const compact = value.replace(/\s+/gu, '');
  if (compact.length === 0) {
    return false;
  }
  if (entities.some((entity) => entity.name === compact || entity.aliases.includes(compact))) {
    return false;
  }
  if (!/[。！？…!?、,]/u.test(compact) && compact.length < 10) {
    return false;
  }
  if (compact.length <= 3 && !/[。！？…!?、,]/u.test(compact)) {
    return false;
  }
  if (/^[\p{Script=Han}\p{Script=Katakana}A-Za-z0-9]{1,4}$/u.test(compact) && !/[ぁ-ん]/u.test(compact)) {
    return false;
  }
  return true;
}

function selectFallbackPanelEntityIds(
  pageEntityIds: string[],
  focus: FallbackPanelPlan['focus'],
  options?: { explicitEntityCount?: number },
): string[] {
  if (pageEntityIds.length === 0) {
    return [];
  }

  const canUsePair = (options?.explicitEntityCount ?? 0) >= 2;

  switch (focus) {
    case 'setting':
    case 'exchange':
    case 'impact':
      return pageEntityIds.slice(0, canUsePair ? Math.min(pageEntityIds.length, 2) : 1);
    case 'transition':
    case 'pause':
    case 'reaction':
    case 'lead':
    default:
      return pageEntityIds.slice(0, 1);
  }
}

function buildDistributedEpisodeBeats(
  segments: Array<string | null | undefined>,
  totalPages: number,
  language: AppLanguage,
): string[] {
  const distributed = distributeStoryBeats(segments, totalPages, 140);

  if (distributed.length === 0) {
    return Array.from({ length: totalPages }, (_value, pageIndex) =>
      fallbackLabel(language, `Page ${pageIndex + 1} progression`, `${pageIndex + 1}ページ目の進行`),
    );
  }

  return distributed;
}

function buildDistributedPanelBeats(
  sourceTexts: Array<string | null | undefined>,
  panelPlans: FallbackPanelPlan[],
  language: AppLanguage,
): string[] {
  const distributed = distributeStoryBeats(sourceTexts, panelPlans.length, 56);
  if (distributed.length === 0) {
    return panelPlans.map((panelPlan) => fallbackRoleBeatCue(panelPlan.focus, language));
  }

  return panelPlans.map((panelPlan, index) => {
    const beat = distributed[index] ?? distributed[distributed.length - 1] ?? null;
    if (!isMeaningfulText(beat)) {
      return fallbackRoleBeatCue(panelPlan.focus, language);
    }

    const previous = index > 0 ? distributed[index - 1] ?? null : null;
    if (previous !== null && beat === previous) {
      return `${beat} ${fallbackRoleBeatCue(panelPlan.focus, language)}`.trim();
    }

    return beat;
  });
}

function buildCanonicalCompilerEntityRefs(
  entities: Array<{ id: string; name: string; structuredFields?: Record<string, unknown> }>,
): Array<{ id: string; name: string; aliases: string[] }> {
  return entities.map((entity) => ({
    id: entity.id,
    name: entity.name,
    aliases: extractEntityAliases(entity.structuredFields ?? {}),
  }));
}

function canonicalizeCompilerBriefText(
  value: string | null | undefined,
  entities: Array<{ id: string; name: string; aliases: string[] }>,
): string | null | undefined {
  if (!isMeaningfulText(value)) {
    return value;
  }

  return canonicalizeEntityMentionsInText(value, entities);
}

function buildFallbackPanelBeat(
  pagePurpose: string | null | undefined,
  continuityNote: string | null | undefined,
  panelOrder: number,
  panelCount: number,
  language: AppLanguage,
): string {
  const cue =
    panelOrder === 1
      ? fallbackLabel(language, 'Open the page beat clearly', 'ページの主題を立ち上げる')
      : panelOrder === panelCount
        ? fallbackLabel(language, 'Land the page beat cleanly', 'ページの主題を印象づけて締める')
        : fallbackLabel(language, `Develop beat ${panelOrder}`, `${panelOrder}コマ目で流れを具体化する`);

  return [summarizeCompilerText(pagePurpose, 100), summarizeCompilerText(continuityNote, 80), cue]
    .filter((value): value is string => value !== null)
    .join('. ');
}

function buildFallbackAutofillPageBeat(
  context: PageAutofillContext,
  language: AppLanguage,
): string {
  const distributed = buildDistributedEpisodeBeats(
    [
      context.introduction,
      context.middle,
      context.climax,
      context.endingHook,
      context.episodePurpose,
    ],
    context.totalPagesInEpisode,
    language,
  );

  return (
    distributed[Math.max(0, Math.min(context.pageNumber - 1, distributed.length - 1))] ??
    fallbackLabel(language, 'Advance the current page beat.', 'このページの主な流れを進める。')
  );
}

function fallbackRoleBeatCue(
  focus: FallbackPanelPlan['focus'],
  language: AppLanguage,
): string {
  switch (focus) {
    case 'setting':
      return fallbackLabel(language, 'Set the place clearly.', '場所を先に読ませる。');
    case 'exchange':
      return fallbackLabel(language, 'Turn the beat into direct exchange.', '流れを直接のやり取りに変える。');
    case 'reaction':
      return fallbackLabel(language, 'Hold on the reaction.', '反応をはっきり見せる。');
    case 'impact':
      return fallbackLabel(language, 'Land the turning point.', '転換点を着地させる。');
    case 'transition':
      return fallbackLabel(language, 'Point toward the next move.', '次の動きを指し示す。');
    case 'pause':
      return fallbackLabel(language, 'Leave a short pause.', '短い間を置く。');
    case 'lead':
    default:
      return fallbackLabel(language, 'Push the beat forward.', '流れを前へ進める。');
  }
}

function buildFallbackSituationClause(
  beat: string | null,
  entityNames: string[],
  language: AppLanguage,
): string | null {
  const cleanedBeat = stripFallbackRoleCueText(beat, language);
  if (!isMeaningfulText(cleanedBeat)) {
    return null;
  }

  const normalized = ensureSentenceLikeText(cleanedBeat, language);
  if (!isMeaningfulText(normalized)) {
    return null;
  }

  if (entityNames.some((entityName) => normalized.includes(entityName))) {
    return normalized;
  }

  const subject = formatEntitySubject(entityNames, language);
  return language === 'en'
    ? `Center ${subject}. ${normalized}`
    : `${subject}を中心に、${normalized}`;
}

function buildBeatDrivenFallbackDialogueLine(
  panelBeat: string | null,
  panelPlan: FallbackPanelPlan,
  language: AppLanguage,
  speakerEntityId: string | null,
): PanelDialogueLine | null {
  const cleanedBeat = stripFallbackRoleCueText(panelBeat, language);
  if (!isMeaningfulText(cleanedBeat)) {
    return null;
  }

  const text = ensureSentenceLikeText(
    summarizeCompilerText(cleanedBeat, language === 'en' ? 80 : 42),
    language,
  );
  if (!isMeaningfulText(text)) {
    return null;
  }

  const shouldAttachToVisibleSubject =
    speakerEntityId !== null &&
    panelPlan.focus !== 'setting' &&
    panelPlan.focus !== 'pause';

  return {
    entityId: shouldAttachToVisibleSubject ? speakerEntityId : null,
    text,
    type: shouldAttachToVisibleSubject ? 'thought' : 'narration',
    position: panelPlan.focus === 'transition' ? 'center' : 'top',
  };
}

function stripFallbackRoleCueText(
  value: string | null | undefined,
  language: AppLanguage,
): string | null {
  if (!isMeaningfulText(value)) {
    return null;
  }

  const cueTexts: string[] =
    language === 'en'
      ? [
          'Set the place clearly.',
          'Turn the beat into direct exchange.',
          'Hold on the reaction.',
          'Land the turning point.',
          'Point toward the next move.',
          'Leave a short pause.',
          'Push the beat forward.',
        ]
      : [
          '場所を先に読ませる。',
          '流れを直接のやり取りに変える。',
          '反応をはっきり見せる。',
          '転換点を着地させる。',
          '次の動きを指し示す。',
          '短い間を置く。',
          '流れを前へ進める。',
        ];

  let cleaned = value.replace(/\s+/gu, ' ').trim();
  for (const cueText of cueTexts) {
    cleaned = cleaned.split(cueText).join(' ').replace(/\s+/gu, ' ').trim();
  }

  return cleaned.length === 0 ? null : cleaned;
}

function ensureSentenceLikeText(
  value: string | null | undefined,
  language: AppLanguage,
): string | null {
  if (!isMeaningfulText(value)) {
    return null;
  }

  const normalized = value.trim();
  if (language === 'en') {
    return /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`;
  }

  return /[。！？…]$/u.test(normalized) ? normalized : `${normalized}。`;
}

function inferFallbackEntityIds(
  entities: Array<{ id: string; name: string; structuredFields?: Record<string, unknown> }>,
  preferredEntityIds: string[],
  texts: Array<string | null | undefined>,
  limit: number,
): string[] {
  return inferEntityIdsFromTexts(
    entities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      aliases: extractEntityAliases(entity.structuredFields ?? {}),
    })),
    texts,
    limit,
    preferredEntityIds,
  );
}

function fallbackShotTypeForRole(
  role: NonNullable<PageAutofillPanelSuggestion['panelRole']>,
): NonNullable<NonNullable<PageAutofillPanelSuggestion['composition']>['shotType']> {
  switch (role) {
    case 'establish':
    case 'transition':
      return 'wide';
    case 'reaction':
    case 'emphasis':
    case 'pause':
      return 'half_body';
    case 'impact':
      return 'close_up';
    default:
      return 'full_body';
  }
}

function fallbackAngleForRole(
  role: NonNullable<PageAutofillPanelSuggestion['panelRole']>,
): NonNullable<NonNullable<PageAutofillPanelSuggestion['composition']>['angle']> {
  switch (role) {
    case 'impact':
      return 'dutch_angle';
    case 'establish':
      return 'front';
    case 'reaction':
      return 'side';
    default:
      return 'three_quarter';
  }
}

function summarizeCompilerText(value: string | null | undefined, maxLength = 160): string | null {
  if (!isMeaningfulText(value)) {
    return null;
  }

  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

const GENERIC_COMPILER_TEXT_FRAGMENTS = [
  'no explicit situation text',
  'no additional composition note',
  'no character is explicitly assigned',
  'the current action or situation',
  'readable composition',
  'current setting',
  'current scene',
  'establish the location and tension clearly',
  'show the first concrete change or realization',
  'emphasize the emotional reaction or danger',
  'set up the transition into the next beat',
  'show the active subject clearly within',
  'let the time read as',
  'keep the visible mood',
  'develop beat',
  'carry beat',
  'page progression',
  'このコマ',
  '現在の場面',
  '現在の設定',
  '読みやすい構図',
  '今の動きや状況',
  'コマ目の要点',
  'ページ目の進行',
];

function shouldRepairGenericCompilerText(value: string | null | undefined): boolean {
  if (!isMeaningfulText(value)) {
    return true;
  }

  const normalized = value.replace(/\s+/gu, ' ').trim().toLowerCase();
  return GENERIC_COMPILER_TEXT_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function shouldRepairRedundantFieldText(
  value: string | null | undefined,
  comparisons: Array<string | null | undefined>,
): boolean {
  if (!isMeaningfulText(value)) {
    return true;
  }

  return comparisons.some((comparison) => textsLookEquivalent(value, comparison));
}

function textsLookEquivalent(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!isMeaningfulText(left) || !isMeaningfulText(right)) {
    return false;
  }

  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[.!?。！？、,／/・:;()[\]{}"'`]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (normalizedLeft.length < 12 || normalizedRight.length < 12) {
    return normalizedLeft === normalizedRight;
  }

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function describePanelDraftState(panel: PageAutofillPanelContext): string {
  const states: string[] = [];

  if (isMeaningfulText(panel.situationText)) {
    states.push('has_situation');
  }
  if (panel.composition.shotType !== null || panel.composition.angle !== null) {
    states.push('has_camera');
  }
  if (isMeaningfulText(panel.backgroundNote)) {
    states.push('has_background');
  }
  if (panel.dialogue.length > 0) {
    states.push('has_dialogue');
  }
  if (panel.entities.length > 0) {
    states.push('has_assignments');
  }

  return states.length === 0 ? 'blank' : states.join(',');
}

function fallbackLabel(language: AppLanguage, english: string, japanese: string): string {
  return language === 'en' ? english : japanese;
}

function hasMeaningfulComposition(panel: PageAutofillPanelContext): boolean {
  return (
    panel.composition.source !== 'custom' ||
    !isBlank(panel.composition.compositionPrompt) ||
    panel.composition.galleryItemId !== null ||
    panel.composition.shotType !== null ||
    panel.composition.angle !== null ||
    !isBlank(panel.composition.customNote)
  );
}

function isPanelMostlyEmpty(panel: PageAutofillPanelContext): boolean {
  return (
    isBlank(panel.situationText) &&
    panel.entities.length === 0 &&
    !hasMeaningfulComposition(panel) &&
    panel.dialogue.length === 0 &&
    isBlank(panel.sfxText) &&
    isBlank(panel.backgroundNote) &&
    isBlank(panel.panelNotes)
  );
}

function isMeaningfulText(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim().length > 0;
}

function isBlank(value: string | null | undefined): boolean {
  return !isMeaningfulText(value);
}
