import {
  ConfigurationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../domain/errors/index.js';
import type { AppLanguage } from '../../domain/types/language.js';
import type {
  EpisodePagePlanApplyResult,
  EpisodePagePlanContext,
  EpisodePagePlanSuggestion,
  PageAutofillContext,
  PageAutofillPanelContext,
  PageAutofillPanelSuggestion,
  PageAutofillResult,
  PageAutofillSuggestion,
  PageSummary,
  UpdatePageSettingsInput,
} from '../../domain/types/page.js';
import type { PanelComposition, UpdatePanelInput } from '../../domain/types/panel.js';
import type { PanelEntityAssignment } from '../../domain/types/panelEntityAssignment.js';
import type { PageRepository } from '../../repositories/PageRepository.js';
import type { PanelRepository } from '../../repositories/PanelRepository.js';
import type { StyleReferenceCompilerPort } from '../style/StyleReferenceCompiler.js';
import { resolveStyleReferenceForPersistence } from '../style/styleReferencePersistence.js';
import type { PanelEntityAssignmentServicePort } from './PanelEntityAssignmentService.js';
import type { PageAutofillCompilerPort } from './PageAutofillCompiler.js';
import type { EpisodePagePlanCompilerPort } from './EpisodePagePlanCompiler.js';

export interface PageServicePort {
  updatePageSettings(userId: string, pageId: string, input: UpdatePageSettingsInput): Promise<PageSummary>;
  autofillFromScenes(userId: string, pageId: string, language: AppLanguage): Promise<PageAutofillResult>;
  autofillEpisodeFromStory(
    userId: string,
    episodeId: string,
    language: AppLanguage,
  ): Promise<EpisodePagePlanApplyResult>;
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
  ) {}

  public async updatePageSettings(
    userId: string,
    pageId: string,
    input: UpdatePageSettingsInput,
  ): Promise<PageSummary> {
    const page = await this.pageRepository.findPageByIdAndUserId(pageId, userId);
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

    const updatedPage = await this.pageRepository.updatePageSettings(pageId, userId, persistedInput);
    if (updatedPage === null) {
      throw new NotFoundError('Page not found');
    }

    return updatedPage;
  }

  public async autofillFromScenes(
    userId: string,
    pageId: string,
    language: AppLanguage,
  ): Promise<PageAutofillResult> {
    if (
      this.panelRepository === undefined ||
      this.panelEntityAssignmentService === undefined ||
      this.pageAutofillCompiler === undefined
    ) {
      throw new ConfigurationError('Page autofill service is not fully configured');
    }

    const context = await this.pageRepository.findAutofillContextByIdAndUserId(pageId, userId);
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
    if (context.scenes.length === 0) {
      throw new ValidationError('Episode must have at least one scene before page autofill can run');
    }

    const compiled = await this.compileAutofillSafely(context, language);

    let updatedPanelCount = 0;
    let filledFieldCount = 0;

    if (
      compiled.suggestion.page?.dialogueMode !== undefined ||
      compiled.suggestion.page?.pageDialogueToggle !== undefined
    ) {
      const nextPageSettings = mergePageSettings(context, compiled.suggestion.page);
      if (nextPageSettings !== null) {
        await this.updatePageSettings(userId, pageId, nextPageSettings);
      }
    }

    const suggestionsByOrder = new Map(
      compiled.suggestion.panels.map((suggestion) => [suggestion.order, suggestion] as const),
    );
    const entityLookup = new Map(context.entities.map((entity) => [entity.id, entity] as const));

    for (const panel of context.panels) {
      const rawSuggestion = suggestionsByOrder.get(panel.order);
      const sourceScene = resolvePageAutofillSceneForPanel(context, panel.order);
      const suggestion =
        rawSuggestion === undefined
          ? undefined
          : enrichPanelSuggestionForGeneration(panel, rawSuggestion, {
              scene: sourceScene,
              entityLookup,
              pagePurpose: context.episodePurpose ?? context.middle ?? context.introduction,
              continuityNote: context.endingHook,
              language,
            });
      if (suggestion === undefined) {
        continue;
      }

      const merge = mergePanelSuggestion(panel, suggestion);
      if (merge.panelUpdate !== null) {
        const updated = await this.panelRepository.updatePanel(panel.id, userId, merge.panelUpdate);
        if (updated === null) {
          throw new NotFoundError('Panel not found');
        }
      }

      if (merge.assignments !== null) {
        await this.panelEntityAssignmentService.replacePanelEntityAssignments(userId, panel.id, merge.assignments);
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
  ): Promise<EpisodePagePlanApplyResult> {
    if (
      this.panelRepository === undefined ||
      this.panelEntityAssignmentService === undefined
    ) {
      throw new ConfigurationError('Episode page planning service is not fully configured');
    }

    const context = await this.pageRepository.findEpisodePlanningContextByIdAndUserId(episodeId, userId);
    if (context === null) {
      throw new NotFoundError('Episode not found');
    }
    if (context.pages.length === 0) {
      throw new ValidationError('Episode must have pages before story autofill can run');
    }
    if (context.scenes.length === 0) {
      throw new ValidationError('Episode must have at least one scene before story autofill can run');
    }

    for (const page of context.pages) {
      ensurePageEditable(page.status, 'story autofill');
      if (page.frameCount === 0) {
        throw new ValidationError('All pages must have frames before story autofill can run');
      }
      if (page.panels.length !== page.frameCount) {
        throw new ValidationError('All pages must have matching panel and frame counts before story autofill can run');
      }
    }

    if (this.episodePagePlanCompiler === undefined) {
      return this.applyEpisodePlanSuggestion(context, userId, {
        suggestion: buildFallbackEpisodePlanSuggestion(context, language),
        compilerUsed: false,
        compilerProvider: 'fallback',
        compilerModel: null,
        compilerPromptVersion: null,
        compilerError: 'Episode page plan compiler is not configured',
      }, language);
    }

    const compiled = await this.compileEpisodePlanSafely(context, language);
    return this.applyEpisodePlanSuggestion(context, userId, compiled, language);
  }

  private async compileAutofillSafely(
    context: PageAutofillContext,
    language: AppLanguage,
  ): Promise<AutofillExecutionResult> {
    const compilerBrief = buildAutofillCompilerBrief(context, language);

    try {
      const compiled = await this.pageAutofillCompiler!.compileSuggestions({ compilerBrief, language });
      return {
        suggestion: compiled.suggestion,
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

      return {
        suggestion: buildFallbackAutofillSuggestion(context, language),
        compilerUsed: false,
        compilerProvider: 'fallback',
        compilerModel: null,
        compilerPromptVersion: null,
        compilerError: error.message,
      };
    }
  }

  private async compileEpisodePlanSafely(
    context: EpisodePagePlanContext,
    language: AppLanguage,
  ): Promise<EpisodePlanExecutionResult> {
    const compilerBrief = buildEpisodePlanCompilerBrief(context, language);

    try {
      const compiled = await this.episodePagePlanCompiler!.compilePlan({ compilerBrief, language });
      return {
        suggestion: compiled.suggestion,
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

      return {
        suggestion: buildFallbackEpisodePlanSuggestion(context, language),
        compilerUsed: false,
        compilerProvider: 'fallback',
        compilerModel: null,
        compilerPromptVersion: null,
        compilerError: error.message,
      };
    }
  }

  private async applyEpisodePlanSuggestion(
    context: EpisodePagePlanContext,
    userId: string,
    compiled: EpisodePlanExecutionResult,
    language: AppLanguage,
  ): Promise<EpisodePagePlanApplyResult> {
    const normalizedSuggestion = normalizeEpisodePlanToContext(context, compiled.suggestion, language);
    validateEpisodePlanAgainstContext(context, normalizedSuggestion);

    const pagesById = new Map(context.pages.map((page) => [page.pageId, page] as const));
    const entityLookup = new Map(context.entities.map((entity) => [entity.id, entity] as const));
    let updatedPageCount = 0;
    let updatedPanelCount = 0;
    let updatedAssignmentCount = 0;
    let filledFieldCount = 0;

    for (const [pageIndex, pageSuggestion] of normalizedSuggestion.pages.entries()) {
      const page = pagesById.get(pageSuggestion.pageId);
      if (page === undefined) {
        throw new ValidationError('Episode page plan referenced an unknown page');
      }

      const pageContext = buildPageScopedAutofillContext(context, pageIndex);
      const nextPageSettings = mergePageSettings(pageContext, pageSuggestion.page, {
        overwriteExisting: true,
        storySourceSceneIds: pageSuggestion.sourceSceneIds,
        storyPagePurpose: pageSuggestion.pagePurpose,
        storyContinuityNote: pageSuggestion.continuityNote,
      });
      if (nextPageSettings !== null) {
        await this.updatePageSettings(userId, page.pageId, nextPageSettings);
        updatedPageCount += 1;
        filledFieldCount += Object.keys(nextPageSettings).length;
      }

      const panelsByOrder = new Map(page.panels.map((panel) => [panel.order, panel] as const));
      const pageScenes = resolveEpisodePlanScenesForPage(context, pageSuggestion, pageIndex);
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
            language,
          },
        );
        const merge = mergePanelSuggestion(panel, normalizedSuggestion, {
          overwriteExisting: true,
        });

        if (merge.panelUpdate !== null) {
          const updated = await this.panelRepository!.updatePanel(panel.id, userId, merge.panelUpdate);
          if (updated === null) {
            throw new NotFoundError('Panel not found');
          }
        }

        if (merge.assignments !== null) {
          await this.panelEntityAssignmentService!.replacePanelEntityAssignments(
            userId,
            panel.id,
            merge.assignments,
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
        matchingPageIndex === -1 ? fallback.pages[pageIndex] : suggestion.pages[matchingPageIndex];
      if (matchingPageIndex !== -1) {
        usedPageIndexes.add(matchingPageIndex);
      }

      const fallbackPage = fallback.pages[pageIndex];
      const panelsByOrder = new Map(sourcePage.panels.map((panel) => [panel.order, panel] as const));
      const fallbackPanelsByOrder = new Map(
        fallbackPage.panels.map((panel) => [panel.order, panel] as const),
      );

      return {
        pageId: existingPage.pageId,
        pageNumber: existingPage.pageNumber,
        sourceSceneIds: sourcePage.sourceSceneIds,
        pagePurpose: sourcePage.pagePurpose,
        continuityNote: sourcePage.continuityNote,
        page: sourcePage.page,
        panels: existingPage.panels.map((existingPanel) => {
          const panel =
            panelsByOrder.get(existingPanel.order) ??
            fallbackPanelsByOrder.get(existingPanel.order);
          if (panel === undefined) {
            throw new ValidationError('Episode page plan could not be normalized to existing panels');
          }

          return {
            ...panel,
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
  panel: PageAutofillPanelContext,
  suggestion: PageAutofillPanelSuggestion,
  pageSuggestion: EpisodePagePlanSuggestion['pages'][number],
): PageAutofillPanelSuggestion {
  if (suggestion.panelNotes !== undefined) {
    return suggestion;
  }

  if (panel.order !== 1) {
    return suggestion;
  }

  const notes = [pageSuggestion.pagePurpose, pageSuggestion.continuityNote].filter(isMeaningfulText);
  if (notes.length === 0) {
    return suggestion;
  }

  return {
    ...suggestion,
    panelNotes: notes.join(' '),
  };
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

  if ((overwriteExisting || isBlank(panel.situationText)) && isMeaningfulText(suggestion.situationText)) {
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
    (overwriteExisting || panel.dialogue.length === 0)
  ) {
    update.dialogue = suggestion.dialogue;
    filledFieldCount += 1;
  }

  if ((overwriteExisting || isBlank(panel.sfxText)) && isMeaningfulText(suggestion.sfxText)) {
    update.sfxText = suggestion.sfxText;
    filledFieldCount += 1;
  }

  if ((overwriteExisting || isBlank(panel.backgroundNote)) && isMeaningfulText(suggestion.backgroundNote)) {
    update.backgroundNote = suggestion.backgroundNote;
    filledFieldCount += 1;
  }

  if ((overwriteExisting || isBlank(panel.panelNotes)) && isMeaningfulText(suggestion.panelNotes)) {
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
      (overwriteExisting || isBlank(current.compositionPrompt)) &&
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
      (overwriteExisting || isBlank(current.customNote)) &&
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

function enrichPanelSuggestionForGeneration(
  panel: PageAutofillPanelContext,
  suggestion: PageAutofillPanelSuggestion,
  context: {
    scene: PageAutofillContext['scenes'][number] | EpisodePagePlanContext['scenes'][number] | undefined;
    entityLookup: Map<string, PageAutofillContext['entities'][number]>;
    pagePurpose: string | null | undefined;
    continuityNote: string | null | undefined;
    language: AppLanguage;
  },
): PageAutofillPanelSuggestion {
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
  const situationText = normalizeSituationText(
    suggestion.situationText,
    leadEntityNames,
    sceneSummary,
    role,
    context.pagePurpose,
    context.language,
  );
  const compositionPrompt = normalizeCompositionPrompt(
    suggestion.composition?.compositionPrompt,
    leadEntityNames,
    shotType,
    angle,
    situationText,
    role,
    context.language,
  );
  const customNote = normalizeCameraDirectionNote(
    suggestion.composition?.customNote,
    leadEntityNames,
    shotType,
    angle,
    role,
    entityAssignments,
    context.language,
  );
  const backgroundNote = normalizeBackgroundNote(
    suggestion.backgroundNote,
    context.scene,
    context.language,
  );
  const panelNotes = normalizePanelNotes(
    suggestion.panelNotes,
    context.pagePurpose,
    context.continuityNote,
    context.language,
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
  const base = summarizeCompilerText(value, 220) ?? fallback;
  if (base === null) {
    return null;
  }

  let result = ensureSentence(base);
  if (entityNames.length > 0 && !mentionsAnyEntity(result, entityNames)) {
    result = ensureSentence(
      language === 'en'
        ? `${formatEntitySubject(entityNames, language)} ${stripTerminalPunctuation(result)}`
        : `${formatEntitySubject(entityNames, language)}が${stripTerminalPunctuation(result)}`,
    );
  }
  if (sceneSummary !== null && !includesLooseFragment(result, sceneSummary)) {
    result =
      language === 'en'
        ? `${result} The setting and atmosphere are ${sceneSummary}.`
        : `${result} 場所と空気感は${sceneSummary}。`;
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

  let result = ensureSentence(base);
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
  return base === null ? null : ensureSentence(base);
}

function normalizeBackgroundNote(
  value: string | null | undefined,
  scene: PageAutofillContext['scenes'][number] | EpisodePagePlanContext['scenes'][number] | undefined,
  language: AppLanguage,
): string | null {
  const base =
    summarizeCompilerText(value, 140) ??
    buildFallbackBackground(scene, language);
  return base === null ? null : ensureSentence(base);
}

function normalizePanelNotes(
  value: string | null | undefined,
  pagePurpose: string | null | undefined,
  continuityNote: string | null | undefined,
  _language: AppLanguage,
): string | null {
  const base = summarizeCompilerText(value, 180);
  if (base !== null) {
    return ensureSentence(base);
  }

  const parts = [summarizeCompilerText(pagePurpose, 100), summarizeCompilerText(continuityNote, 100)].filter(
    isMeaningfulText,
  );
  return parts.length === 0 ? null : ensureSentence(parts.join(' '));
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
    ? `Show ${subject} in a ${shot}-leaning frame from a ${cameraAngle}-leaning angle. ${ensureSentence(beat)}`
    : `${subject}を${shot}寄りで、${cameraAngle}気味の視点から見せる。${ensureSentence(beat)}`;
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

function includesLooseFragment(target: string, fragment: string): boolean {
  const normalizedTarget = target.toLowerCase();
  return fragment
    .split('/')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 3)
    .some((part) => normalizedTarget.includes(part));
}

function ensureSentence(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) {
    return normalized;
  }
  if (/[.!?。！？]$/u.test(normalized)) {
    return normalized;
  }
  return `${normalized}。`;
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
  const entityLookup = new Map(context.entities.map((entity) => [entity.id, entity]));
  const sceneLines = context.scenes
    .map((scene) => {
      const people =
        scene.involvedEntityIds
          .map((entityId) => entityLookup.get(entityId)?.name ?? entityId)
          .join(', ') || 'none';

      return [
        `Scene ${scene.order}`,
        `location=${scene.location ?? '(none)'}`,
        `time=${scene.time ?? '(none)'}`,
        `atmosphere=${scene.atmosphere ?? '(none)'}`,
        `people=${people}`,
      ].join(' | ');
    })
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
        `situation=${summarizeCompilerText(panel.situationText) ?? '(blank)'}`,
        `shot=${panel.composition.shotType ?? '(blank)'}`,
        `angle=${panel.composition.angle ?? '(blank)'}`,
        `background=${summarizeCompilerText(panel.backgroundNote) ?? '(blank)'}`,
        `dialogue_count=${panel.dialogue.length}`,
        `assignments=${assignments}`,
      ].join(' | ');
    })
    .join('\n');

  const entityLines = context.entities
    .map((entity) =>
      [
        `${entity.id}: ${entity.name} (${entity.entityType})`,
        summarizeCompilerText(entity.freeDescription, 120) ?? '',
        summarizeCompilerText(entity.promptSupplement, 120) ?? '',
      ]
        .filter((part) => part.trim().length > 0)
        .join(' | '),
    )
    .join('\n');

  return [
    '[TASK]',
    `Fill editable page and panel draft fields for page ${context.pageNumber} of ${context.totalPagesInEpisode}.`,
    `Return suggestions for exactly ${context.frameCount} panels with orders 1 through ${context.frameCount}.`,
    'Decide what each panel should show so the page faithfully expresses the supplied episode and scene information without inventing a new episode event.',
    'Only provide fields that are useful as editable defaults.',
    `Write every free-text field in natural ${outputLanguage} suitable for direct editing in the Lyra UI.`,
    '',
    '[CHAPTER CONSISTENCY]',
    `Chapter title: ${context.chapterTitle ?? '(none)'}`,
    `Chapter purpose: ${context.chapterPurpose ?? '(none)'}`,
    `Chapter starting state: ${context.chapterStartingState ?? '(none)'}`,
    `Chapter ending state: ${context.chapterEndingState ?? '(none)'}`,
    `Chapter emotion curve: ${context.chapterEmotionCurve ?? '(none)'}`,
    `Chapter key beats: ${context.chapterKeyBeats.join(' / ') || '(none)'}`,
    '',
    '[PAGE]',
    `Episode purpose: ${context.episodePurpose ?? '(none)'}`,
    `Introduction: ${context.introduction ?? '(none)'}`,
    `Middle: ${context.middle ?? '(none)'}`,
    `Climax: ${context.climax ?? '(none)'}`,
    `Ending hook: ${context.endingHook ?? '(none)'}`,
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
    '',
    '[DIALOGUE GUIDANCE]',
    'Dialogue and narration should be sufficient for story clarity without becoming chatty or repetitive.',
    'Some panels may remain silent, but if this page clearly contains conversation, confrontation, explanation, or inner realization, provide concise dialogue or thought in the relevant panels instead of leaving the whole page empty.',
    'Prefer character speech or thought for interpersonal beats. Use narration sparingly for setup, transition, or inner realization that cannot be shown clearly through staging alone.',
    'Do not repeat the same narration across multiple panels and do not overload every panel with text.',
    '',
    '[ALLOWED ENUMS]',
    'panel_role: establish | action | reaction | emphasis | transition | pause | impact',
    'panel_size: standard | large | wide | narrow | splash',
    'composition.shot_type: full_body | half_body | close_up | wide | extreme_close_up',
    'composition.angle: front | side | three_quarter | bird_eye | worm_eye | dutch_angle',
    'entity.role: primary | secondary | background',
    'entity.expression: determined | calm | angry | sad | surprised | custom',
    'entity.action: standing_firm | attacking | defending | running | custom',
    'entity.position: left | center | right | background',
    'entity.facing_direction: front | left | right | away | three_quarter_left | three_quarter_right',
    '',
    '[OUTPUT JSON SHAPE]',
    '{',
    '  "page": { "dialogue_mode"?: "image_baked"|"balloon_only"|"mixed", "page_dialogue_toggle"?: boolean },',
    '  "panels": [',
    '    {',
    '      "order": number,',
    '      "panel_role"?: string,',
    '      "panel_size"?: string,',
    '      "situation_text"?: string | null,',
    '      "composition"?: {',
    '        "source"?: "custom"|"ai_auto"|"gallery",',
    '        "gallery_item_id"?: string | null,',
    '        "composition_prompt"?: string | null,',
    '        "shot_type"?: string | null,',
    '        "angle"?: string | null,',
    '        "custom_note"?: string | null',
    '      },',
    '      "dialogue_in_panel"?: boolean,',
    '      "dialogue"?: [{ "entity_id": uuid | null, "text": string, "type": "speech"|"thought"|"narration"|"shout"|"whisper", "position": "top"|"bottom"|"left"|"right"|"center" }],',
    '      "sfx_text"?: string | null,',
    '      "background_note"?: string | null,',
    '      "panel_notes"?: string | null,',
    '      "entities"?: [{ "entity_id": uuid, "role": string, "expression": string, "custom_expression"?: string | null, "action": string, "custom_action"?: string | null, "position": string, "facing_direction"?: string | null, "effect_note"?: string | null, "state_id"?: uuid | null }]',
    '    }',
    '  ]',
    '}',
    '',
    '[RULES]',
    'Use only provided entity IDs.',
    'Do not add extra characters, props, weapons, or dramatic background details that are not supported by the scenes.',
    'Use the chapter arc only to keep continuity and avoid contradictions across the broader chapter.',
    'Convert scene mood into visible composition, posture, and expression cues.',
    'Prefer grounded camera and staging choices over flashy ones.',
    'Keep each suggestion concise and editable.',
  ].join('\n');
}

function buildEpisodePlanCompilerBrief(
  context: EpisodePagePlanContext,
  language: AppLanguage,
): string {
  const outputLanguage = language === 'en' ? 'English' : 'Japanese';
  const entityLookup = new Map(context.entities.map((entity) => [entity.id, entity]));

  const sceneLines = context.scenes
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
        `location=${summarizeCompilerText(scene.location, 80) ?? '(none)'}`,
        `time=${summarizeCompilerText(scene.time, 40) ?? '(none)'}`,
        `atmosphere=${summarizeCompilerText(scene.atmosphere, 80) ?? '(none)'}`,
        `people=${people}`,
        `state_notes=${summarizeCompilerText(stateNotes, 180) ?? 'none'}`,
      ].join(' | ');
    })
    .join('\n');

  const entityLines = context.entities
    .map((entity) =>
      [
        `${entity.id}: ${entity.name} (${entity.entityType})`,
        summarizeCompilerText(entity.freeDescription, 120) ?? '',
        summarizeCompilerText(entity.promptSupplement, 120) ?? '',
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
    'Plan editable page and panel draft fields for the entire episode.',
    `Return suggestions for exactly ${context.pages.length} existing pages, preserving each page_id, page_number, frame_count, and panel order.`,
    'Assign the existing scenes across the existing pages in a grounded, contiguous order.',
    'You may add natural connective reaction or transition shots when they help readability, but do not invent new episode events, hidden subplots, props, or twists.',
    `Write every free-text field in natural ${outputLanguage} suitable for direct editing in the Lyra UI.`,
    '',
    '[CHAPTER ARC]',
    `Title: ${context.chapter.title ?? '(none)'}`,
    `Purpose: ${context.chapter.purpose ?? '(none)'}`,
    `Starting state: ${context.chapter.startingState ?? '(none)'}`,
    `Ending state: ${context.chapter.endingState ?? '(none)'}`,
    `Emotion curve: ${context.chapter.emotionCurve ?? '(none)'}`,
    `Key beats: ${context.chapter.keyBeats.join(' / ') || '(none)'}`,
    '',
    '[EPISODE ARC]',
    `Title: ${context.episode.title ?? '(none)'}`,
    `Purpose: ${context.episode.purpose ?? '(none)'}`,
    `Introduction: ${context.episode.introduction ?? '(none)'}`,
    `Middle: ${context.episode.middle ?? '(none)'}`,
    `Climax: ${context.episode.climax ?? '(none)'}`,
    `Ending hook: ${context.episode.endingHook ?? '(none)'}`,
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
    '',
    '[DIALOGUE GUIDANCE]',
    'Dialogue and narration should be sufficient for story clarity without becoming chatty or repetitive.',
    'Some panels may remain silent, but pages built around conversation, confrontation, explanation, or inner realization should receive concise dialogue or thought in the relevant panels instead of staying wholly silent.',
    'Prefer character speech or thought for interpersonal beats. Use narration sparingly for setup, transition, or inner realization that cannot be shown clearly through staging alone.',
    'Do not repeat the same narration across multiple panels and do not overload every panel with text.',
    '',
    '[OUTPUT JSON SHAPE]',
    '{',
    '  "pages": [',
    '    {',
    '      "page_id": uuid,',
    '      "page_number": number,',
    '      "source_scene_ids"?: [uuid],',
    '      "page_purpose"?: string | null,',
    '      "continuity_note"?: string | null,',
    '      "page"?: { "dialogue_mode"?: "image_baked"|"balloon_only"|"mixed", "page_dialogue_toggle"?: boolean },',
    '      "panels": [',
    '        {',
    '          "order": number,',
    '          "panel_role"?: "establish"|"action"|"reaction"|"emphasis"|"transition"|"pause"|"impact",',
    '          "panel_size"?: "standard"|"large"|"wide"|"narrow"|"splash",',
    '          "situation_text"?: string | null,',
    '          "composition"?: {',
    '            "source"?: "custom"|"ai_auto"|"gallery",',
    '            "gallery_item_id"?: string | null,',
    '            "composition_prompt"?: string | null,',
    '            "shot_type"?: "full_body"|"half_body"|"close_up"|"wide"|"extreme_close_up" | null,',
    '            "angle"?: "front"|"side"|"three_quarter"|"bird_eye"|"worm_eye"|"dutch_angle" | null,',
    '            "custom_note"?: string | null',
    '          },',
    '          "dialogue_in_panel"?: boolean,',
    '          "dialogue"?: [{ "entity_id": uuid | null, "text": string, "type": "speech"|"thought"|"narration"|"shout"|"whisper", "position": "top"|"bottom"|"left"|"right"|"center" }],',
    '          "sfx_text"?: string | null,',
    '          "background_note"?: string | null,',
    '          "panel_notes"?: string | null,',
    '          "entities"?: [{ "entity_id": uuid, "role": "primary"|"secondary"|"background", "expression": "determined"|"calm"|"angry"|"sad"|"surprised"|"custom", "custom_expression"?: string | null, "action": "standing_firm"|"attacking"|"defending"|"running"|"custom", "custom_action"?: string | null, "position": "left"|"center"|"right"|"background", "facing_direction"?: "front"|"left"|"right"|"away"|"three_quarter_left"|"three_quarter_right" | null, "effect_note"?: string | null, "state_id"?: uuid | null }]',
    '        }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '',
    '[RULES]',
    'Do not contradict the chapter arc, episode arc, or scene order.',
    'Keep the page plan readable and not flashy or quirky for its own sake.',
    'Use chapter emotion curve and episode structure to decide pacing and shot intensity.',
    'Convert scene mood and personality implications into visible but restrained cues in posture, gaze, spacing, and camera distance.',
    'Do not add unsupported violence, props, weapons, locations, or surprise plot events.',
    'Silent panels are allowed, but do not leave the page plan underwritten when the story clearly implies speech, thought, or brief narration.',
  ].join('\n');
}

function buildFallbackEpisodePlanSuggestion(
  context: EpisodePagePlanContext,
  language: AppLanguage,
): EpisodePagePlanSuggestion {
  const roleSequence: Array<PageAutofillPanelSuggestion['panelRole']> = [
    'establish',
    'action',
    'reaction',
    'transition',
    'action',
    'reaction',
    'impact',
    'pause',
  ];
  const sizeSequence: Array<PageAutofillPanelSuggestion['panelSize']> = [
    'large',
    'standard',
    'standard',
    'wide',
    'standard',
    'standard',
    'large',
    'narrow',
  ];

  return {
    pages: context.pages.map((page, pageIndex) => {
      const sourceScenes = pickScenesForPage(context.scenes, context.pages.length, pageIndex);
      const leadScene = sourceScenes[0];
      const sceneIds = sourceScenes.map((scene) => scene.id);

      return {
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        sourceSceneIds: sceneIds,
        pagePurpose: buildFallbackPagePurpose(context, sourceScenes, page.pageNumber, language),
        continuityNote: buildFallbackContinuityNote(context, sourceScenes, page.pageNumber, language),
        page: {
          dialogueMode: page.dialogueMode,
          pageDialogueToggle: page.pageDialogueToggle,
        },
        panels: page.panels.map((panel, panelIndex) => {
          const role = roleSequence[Math.min(panelIndex, roleSequence.length - 1)];
          const size = sizeSequence[Math.min(panelIndex, sizeSequence.length - 1)];
          const scene =
            sourceScenes[Math.min(sourceScenes.length - 1, Math.floor((panelIndex * sourceScenes.length) / Math.max(sourceScenes.length, 1)))] ??
            leadScene;

          return {
            order: panel.order,
            panelRole: role,
            panelSize: size,
            situationText: buildFallbackEpisodeSituationText(context, scene, panel.order, language),
            composition: {
              source: 'custom',
              shotType: fallbackShotTypeForRole(role ?? 'action'),
              angle: fallbackAngleForRole(role ?? 'action'),
              compositionPrompt: buildFallbackCompositionPrompt(scene, language),
              customNote: buildFallbackCustomNote(scene, language),
            },
            dialogueInPanel: page.dialogueMode !== 'balloon_only',
            backgroundNote: buildFallbackBackground(scene, language),
            panelNotes:
              panelIndex === 0
                ? [
                    buildFallbackPagePurpose(context, sourceScenes, page.pageNumber, language),
                    buildFallbackContinuityNote(context, sourceScenes, page.pageNumber, language),
                  ]
                    .filter((value): value is string => isMeaningfulText(value))
                    .join(' ')
                : null,
            entities: buildFallbackAssignments(scene?.involvedEntityIds ?? []),
          };
        }),
      };
    }),
  };
}

function buildFallbackEpisodeSituationText(
  context: EpisodePagePlanContext,
  scene: EpisodePagePlanContext['scenes'][number] | undefined,
  panelOrder: number,
  language: AppLanguage,
): string {
  const parts = [scene?.location, scene?.time, scene?.atmosphere].filter(
    (value): value is string => isMeaningfulText(value),
  );
  const arcSegments = [
    context.episode.introduction,
    context.episode.middle,
    context.episode.climax,
    context.episode.endingHook,
    context.episode.purpose,
  ].filter((value): value is string => isMeaningfulText(value));
  const segment =
    arcSegments[Math.min(panelOrder - 1, arcSegments.length - 1)] ??
    (language === 'en' ? 'Advance the current page beat clearly.' : 'このページの主な流れを明確に進める。');

  return [
    parts.length > 0 ? parts.join(' / ') : fallbackLabel(language, 'Episode beat', '話の進行'),
    summarizeCompilerText(segment, 120) ??
      fallbackLabel(language, 'Advance the current page beat clearly.', 'このページの主な流れを明確に進める。'),
    fallbackPanelBeatDirective(panelOrder, language),
  ].join('. ');
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
  pageNumber: number,
  language: AppLanguage,
): string {
  const sceneSummary =
    sourceScenes
      .map((scene) => [scene.location, scene.time, scene.atmosphere].filter(Boolean).join(' / '))
      .filter((value) => value.length > 0)
      .join(' | ') ||
    fallbackLabel(language, 'episode progression', '話の流れ');

  if (language === 'en') {
    return `${summarizeCompilerText(context.episode.purpose ?? context.chapter.purpose, 120) ?? 'Advance the story clearly.'} Focus this page on ${summarizeCompilerText(sceneSummary, 120) ?? 'the current scene'}. (Page ${pageNumber})`;
  }

  return `${summarizeCompilerText(context.episode.purpose ?? context.chapter.purpose, 120) ?? '物語を明確に前へ進める。'} このページでは${summarizeCompilerText(sceneSummary, 120) ?? '現在の場面'}に焦点を当てる。（${pageNumber}ページ目）`;
}

function buildFallbackContinuityNote(
  context: EpisodePagePlanContext,
  sourceScenes: EpisodePagePlanContext['scenes'],
  pageNumber: number,
  language: AppLanguage,
): string {
  const mood = sourceScenes.map((scene) => scene.atmosphere).filter((value): value is string => isMeaningfulText(value)).join(' / ');
  const curve = context.chapter.emotionCurve;
  const parts = [
    curve !== null
      ? language === 'en'
        ? `Keep the chapter emotion curve visible: ${curve}.`
        : `章全体の感情曲線として ${curve} を見失わない。`
      : null,
    mood.length > 0
      ? language === 'en'
        ? `Maintain the scene mood: ${mood}.`
        : `場面の空気感として ${mood} を保つ。`
      : null,
    language === 'en'
      ? `Page ${pageNumber} should read naturally into the next page without adding a new event.`
      : `${pageNumber}ページ目から次ページへ、新しい出来事を足さず自然につなぐ。`,
  ].filter((value): value is string => value !== null);

  return parts.join(' ');
}

function buildFallbackAutofillSuggestion(
  context: PageAutofillContext,
  language: AppLanguage,
): PageAutofillSuggestion {
  const roleSequence: Array<PageAutofillPanelSuggestion['panelRole']> = [
    'establish',
    'action',
    'reaction',
    'transition',
    'action',
    'reaction',
    'impact',
    'pause',
  ];
  const sizeSequence: Array<PageAutofillPanelSuggestion['panelSize']> = [
    'large',
    'standard',
    'standard',
    'wide',
    'standard',
    'standard',
    'large',
    'narrow',
  ];

  return {
    panels: context.panels.map((panel, index) => {
      const scene = context.scenes[Math.min(context.scenes.length - 1, Math.floor((index * context.scenes.length) / context.panels.length))];
      const involvedEntityIds = scene?.involvedEntityIds ?? [];

      return {
        order: panel.order,
        panelRole: roleSequence[Math.min(index, roleSequence.length - 1)],
        panelSize: sizeSequence[Math.min(index, sizeSequence.length - 1)],
        situationText: buildFallbackSituationText(context, scene, panel.order, language),
        composition: {
          source: 'custom',
          shotType: fallbackShotTypeForRole(roleSequence[Math.min(index, roleSequence.length - 1)] ?? 'action'),
          angle: fallbackAngleForRole(roleSequence[Math.min(index, roleSequence.length - 1)] ?? 'action'),
          compositionPrompt: buildFallbackCompositionPrompt(scene, language),
          customNote: buildFallbackCustomNote(scene, language),
        },
        dialogueInPanel: context.dialogueMode !== 'balloon_only',
        backgroundNote: buildFallbackBackground(scene, language),
        entities: buildFallbackAssignments(involvedEntityIds),
      };
    }),
  };
}

function buildFallbackSituationText(
  context: PageAutofillContext,
  scene: PageAutofillContext['scenes'][number] | undefined,
  panelOrder: number,
  language: AppLanguage,
): string {
  const parts = [
    scene?.location,
    scene?.time,
    scene?.atmosphere,
  ].filter((value): value is string => isMeaningfulText(value));

  return [
    parts.length > 0 ? parts.join(' / ') : fallbackLabel(language, 'Episode beat', '話の進行'),
    context.episodePurpose ??
      context.middle ??
      context.introduction ??
      fallbackLabel(language, 'Advance the current page beat.', 'このページの主な流れを進める。'),
    language === 'en'
      ? `Panel ${panelOrder} should carry this beat clearly.`
      : `${panelOrder}コマ目でこの流れを明確に見せる。`,
  ].join('. ');
}

function buildFallbackCompositionPrompt(
  scene: PageAutofillContext['scenes'][number] | undefined,
  language: AppLanguage,
): string | null {
  if (scene === undefined) {
    return null;
  }

  const parts = [
    scene.location !== null
      ? language === 'en'
        ? `Stage the main subject clearly within ${scene.location}`
        : `${scene.location}の中で主役が分かるように見せる`
      : null,
    scene.time !== null
      ? language === 'en'
        ? `Let the sense of ${scene.time} read immediately`
        : `${scene.time}の時間感が伝わるようにする`
      : null,
    scene.atmosphere !== null
      ? language === 'en'
        ? `Let the atmosphere of ${scene.atmosphere} read from the image`
        : `${scene.atmosphere}の空気が画面から伝わるようにする`
      : null,
  ].filter((value): value is string => value !== null);

  return parts.length === 0 ? null : parts.join('. ');
}

function buildFallbackCustomNote(
  scene: PageAutofillContext['scenes'][number] | undefined,
  language: AppLanguage,
): string | null {
  if (scene === undefined) {
    return null;
  }

  if (scene.atmosphere !== null) {
    return language === 'en'
      ? `Do not overcrowd the frame; let ${scene.atmosphere} land first.`
      : `画面を詰め込みすぎず、${scene.atmosphere}の空気が最初に伝わる見せ方にする。`;
  }

  return null;
}

function buildFallbackBackground(
  scene: PageAutofillContext['scenes'][number] | undefined,
  _language: AppLanguage,
): string | null {
  if (scene === undefined) {
    return null;
  }

  return [scene.location, scene.time].filter((value): value is string => isMeaningfulText(value)).join(' / ') || null;
}

function buildFallbackAssignments(entityIds: string[]): PanelEntityAssignment[] | undefined {
  if (entityIds.length === 0) {
    return undefined;
  }

  return entityIds.slice(0, 3).map((entityId, index) => ({
    entityId,
    role: index === 0 ? 'primary' : index === 1 ? 'secondary' : 'background',
    expression: index === 0 ? 'calm' : 'determined',
    customExpression: null,
    action: index === 0 ? 'standing_firm' : 'running',
    customAction: null,
    position: index === 0 ? 'center' : index === 1 ? 'left' : 'background',
    facingDirection: index === 0 ? 'front' : 'three_quarter_right',
    effectNote: null,
    stateId: null,
  }));
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

function fallbackPanelBeatDirective(panelOrder: number, language: AppLanguage): string {
  if (language === 'ja') {
    switch (panelOrder) {
      case 1:
        return '場所と緊張感が一目で分かるようにする';
      case 2:
        return '最初の具体的な変化や気づきを見せる';
      case 3:
        return '感情の反応や危うさを強めて見せる';
      case 4:
        return '次の流れへ移る準備をつくる';
      default:
        return `${panelOrder}コマ目の要点を読み取りやすく見せる`;
    }
  }

  switch (panelOrder) {
    case 1:
      return 'Establish the location and tension clearly';
    case 2:
      return 'Show the first concrete change or realization';
    case 3:
      return 'Emphasize the emotional reaction or danger';
    case 4:
      return 'Set up the transition into the next beat';
    default:
      return `Carry beat ${panelOrder} in a clear, readable way`;
  }
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
