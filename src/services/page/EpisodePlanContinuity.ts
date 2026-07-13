import { createHash } from 'node:crypto';
import { ConfigurationError } from '../../domain/errors/index.js';
import {
  canonicalizeEntityMentionsInText,
  extractEntityAliases,
  type CanonicalEntityReference,
} from '../../domain/entityAliases.js';
import {
  compactStoryPromptText,
  STORY_PROMPT_CONTEXT_LIMITS,
} from '../../domain/storyPromptCompaction.js';
import type { AppLanguage } from '../../domain/types/language.js';
import type {
  EpisodePagePlanContext,
  EpisodePagePlanPageSuggestion,
  EpisodePagePlanSuggestion,
} from '../../domain/types/page.js';
import type { EpisodeBeatPlan, EpisodeBeatPlanPage } from './EpisodeBeatPlanCompiler.js';
import type { EpisodePlanAuditIssue } from './EpisodePlanAuditCompiler.js';

const STORY_BEAT_DUPLICATE_MIN_NORMALIZED_CHARS = 8;
const DIALOGUE_DUPLICATE_MIN_NORMALIZED_CHARS = 6;
const VISUAL_DUPLICATE_MIN_NORMALIZED_CHARS = 12;
// Story/chapter API fields allow up to 2,000 characters. Keep the complete
// supported input after alias expansion while still bounding malformed data.
const EPISODE_ARC_FIELD_MAX_CHARS = 2_200;
const LEDGER_FIELD_MAX_CHARS = 120;
const RESERVED_LEDGER_FIELD_MAX_CHARS = 80;
const OWNED_STORY_BEATS_MAX_CHARS = 2_500;
const OWNED_NEW_INFORMATION_MAX_CHARS = 2_500;
const OWNED_SCALAR_MAX_CHARS = 600;
const ENTITY_NAME_MAX_CHARS = 120;
const SCENE_STATE_FIELD_MAX_CHARS = 160;
const SCENE_STATE_ENTRY_MAX_CHARS = 560;
const SCENE_STATES_MAX_CHARS = 1_200;
const COMPLETED_PAGES_TARGET_CHARS = 72_000;
const REPAIR_COMPLETED_PAGES_TARGET_CHARS = 52_000;
const REPAIR_CURRENT_DRAFT_TARGET_CHARS = 20_000;
const AUDIT_DRAFT_TARGET_CHARS = 72_000;
const MIN_PANEL_SUMMARY_CHARS = 150;
const MIN_COMPLETED_PANEL_SUMMARY_CHARS = 96;
const MIN_REPAIR_DRAFT_PANEL_SUMMARY_CHARS = 220;
const MAX_COMPLETED_PANEL_SUMMARY_CHARS = 520;
const MAX_REPAIR_DRAFT_PANEL_SUMMARY_CHARS = 420;
const MAX_AUDIT_PANEL_SUMMARY_CHARS = 700;
const PAGE_HEADER_MAX_CHARS = 320;
const MAX_DIALOGUE_LINES_IN_SUMMARY = 8;

export function buildEpisodeBeatPlanCompilerBrief(
  context: EpisodePagePlanContext,
  language: AppLanguage,
): string {
  const entities = buildCanonicalEntityReferences(context);
  const entityNames = new Map(context.entities.map((entity) => [entity.id, entity.name] as const));
  const canonicalize = (
    value: string | null | undefined,
    maxLength: number = STORY_PROMPT_CONTEXT_LIMITS.generalFieldChars,
  ): string =>
    compactStoryPromptText(
      canonicalizeEntityMentionsInText(value, entities),
      maxLength,
    ) ?? '(none)';
  const visibleScenes = context.scenes.slice(0, STORY_PROMPT_CONTEXT_LIMITS.maxSceneSummaries);
  const scenes = visibleScenes.map((scene) => {
    const involved = scene.involvedEntityIds
      .map((entityId) => canonicalize(entityNames.get(entityId) ?? entityId, ENTITY_NAME_MAX_CHARS))
      .join(', ') || 'none';
    const entityStates = formatSceneEntityStates(scene.entityStates, entityNames, canonicalize);
    return [
      `Scene ${scene.order} (${scene.id})`,
      `location=${canonicalize(scene.location, 160)}`,
      `time=${canonicalize(scene.time, 80)}`,
      `atmosphere=${canonicalize(scene.atmosphere, 220)}`,
      `entities=${involved}`,
      `states=${entityStates}`,
    ].join(' | ');
  });
  if (context.scenes.length > visibleScenes.length) {
    scenes.push(`... (${context.scenes.length - visibleScenes.length} more scenes)`);
  }
  const visibleEntities = context.entities.slice(0, STORY_PROMPT_CONTEXT_LIMITS.maxEntities);
  const availableEntities = visibleEntities.map((entity) => {
    const aliases = extractEntityAliases(entity.structuredFields)
      .slice(0, STORY_PROMPT_CONTEXT_LIMITS.maxAliasesPerEntity)
      .map((alias) => compactStoryPromptText(alias, STORY_PROMPT_CONTEXT_LIMITS.aliasChars))
      .filter((alias): alias is string => alias !== null);
    const name = canonicalize(entity.name, ENTITY_NAME_MAX_CHARS);
    return `${name} (${entity.id})${aliases.length > 0 ? ` | aliases=${aliases.join(', ')}` : ''}`;
  });
  if (context.entities.length > visibleEntities.length) {
    availableEntities.push(`... (${context.entities.length - visibleEntities.length} more entities)`);
  }
  const keyBeats = context.chapter.keyBeats
    .slice(0, STORY_PROMPT_CONTEXT_LIMITS.maxChapterSummaries)
    .map((value) => canonicalize(value, STORY_PROMPT_CONTEXT_LIMITS.summaryItemChars));
  if (context.chapter.keyBeats.length > keyBeats.length) {
    keyBeats.push(`... (${context.chapter.keyBeats.length - keyBeats.length} more beats)`);
  }
  const pageLines = [...context.pages]
    .sort(compareContextPages)
    .map((page) => `Page ${page.pageNumber} (${page.pageId}) | frame_count=${page.frameCount}`);

  return [
    '[PURPOSE]',
    'Create a single binding story-beat ledger before page chunks are compiled.',
    `Output language: ${language === 'en' ? 'English' : 'Japanese'}`,
    '',
    '[CHAPTER]',
    `Title: ${canonicalize(context.chapter.title)}`,
    `Purpose: ${canonicalize(context.chapter.purpose, EPISODE_ARC_FIELD_MAX_CHARS)}`,
    `Starting state: ${canonicalize(context.chapter.startingState, EPISODE_ARC_FIELD_MAX_CHARS)}`,
    `Ending state: ${canonicalize(context.chapter.endingState, EPISODE_ARC_FIELD_MAX_CHARS)}`,
    `Emotion curve: ${canonicalize(context.chapter.emotionCurve, EPISODE_ARC_FIELD_MAX_CHARS)}`,
    `Key beats: ${keyBeats.join(' / ') || '(none)'}`,
    '',
    '[EPISODE STORY]',
    `Title: ${canonicalize(context.episode.title)}`,
    `Purpose: ${canonicalize(context.episode.purpose, EPISODE_ARC_FIELD_MAX_CHARS)}`,
    `Introduction: ${canonicalize(context.episode.introduction, EPISODE_ARC_FIELD_MAX_CHARS)}`,
    `Middle: ${canonicalize(context.episode.middle, EPISODE_ARC_FIELD_MAX_CHARS)}`,
    `Climax: ${canonicalize(context.episode.climax, EPISODE_ARC_FIELD_MAX_CHARS)}`,
    `Ending hook: ${canonicalize(context.episode.endingHook, EPISODE_ARC_FIELD_MAX_CHARS)}`,
    '',
    '[SCENES]',
    scenes.join('\n') || '(none)',
    '',
    '[AVAILABLE ENTITIES]',
    availableEntities.join('\n') || '(none)',
    '',
    '[CURRENT PAGES]',
    pageLines.join('\n'),
    '',
    '[BINDING RULES]',
    'Return exactly one plan entry for each CURRENT PAGES reference, preserving its page ID and page number; frame_count is planning capacity and is not an output field.',
    'Assign each meaningful story event, discovery, reaction, and explanation to one page only.',
    'Entry state for page N must agree with exit state and handoff from the preceding page.',
    'Reserve later beats for later pages; do not spend climax or ending information early.',
  ].join('\n');
}

export function validateEpisodeBeatPlanCoverage(
  context: EpisodePagePlanContext,
  plan: EpisodeBeatPlan,
): void {
  const expected = new Map(
    context.pages.map((page) => [page.pageId, page.pageNumber] as const),
  );
  const seen = new Set<string>();

  for (const page of plan.pages) {
    const expectedPageNumber = expected.get(page.pageId);
    if (expectedPageNumber === undefined || expectedPageNumber !== page.pageNumber || seen.has(page.pageId)) {
      throw new ConfigurationError(
        'Episode beat plan must assign every existing page exactly once with its current page number',
      );
    }
    seen.add(page.pageId);
  }

  if (seen.size !== expected.size) {
    throw new ConfigurationError(
      'Episode beat plan must assign every existing page exactly once with its current page number',
    );
  }

  const storyBeatOwners = new Map<string, string>();
  for (const page of [...plan.pages].sort(compareBeatPlanPages)) {
    for (const storyBeat of page.storyBeats) {
      const normalized = normalizeDuplicateCandidate(storyBeat);
      if (normalized.length < STORY_BEAT_DUPLICATE_MIN_NORMALIZED_CHARS) {
        continue;
      }
      const firstOwner = storyBeatOwners.get(normalized);
      if (firstOwner !== undefined) {
        throw new ConfigurationError(
          'Episode beat plan assigned a duplicate story beat',
        );
      }
      storyBeatOwners.set(normalized, page.pageId);
    }
  }
}

export function buildEpisodeDetailContinuitySupplement(input: {
  context: EpisodePagePlanContext;
  plan: EpisodeBeatPlan;
  currentPageIds: ReadonlySet<string>;
  completedPages: EpisodePagePlanPageSuggestion[];
  currentDraftPages?: EpisodePagePlanPageSuggestion[];
  repairIssues?: EpisodePlanAuditIssue[];
}): string {
  const orderedPlan = [...input.plan.pages].sort(compareBeatPlanPages);
  const currentPages = orderedPlan.filter((page) => input.currentPageIds.has(page.pageId));
  const currentDraftPages = input.currentDraftPages ?? [];
  const entityLabels = buildEntityLabelLookup(input.context);
  const completedPageIds = new Set(input.completedPages.map((page) => page.pageId));
  const completedPanelCount = input.completedPages.reduce(
    (count, page) => count + page.panels.length,
    0,
  );
  const currentDraftPanelCount = currentDraftPages.reduce(
    (count, page) => count + page.panels.length,
    0,
  );
  const isRepair = currentDraftPages.length > 0;
  const completedPanelBudget = calculatePanelSummaryBudget(
    isRepair ? REPAIR_COMPLETED_PAGES_TARGET_CHARS : COMPLETED_PAGES_TARGET_CHARS,
    completedPanelCount,
    MAX_COMPLETED_PANEL_SUMMARY_CHARS,
    MIN_COMPLETED_PANEL_SUMMARY_CHARS,
  );
  const currentDraftPanelBudget = calculatePanelSummaryBudget(
    REPAIR_CURRENT_DRAFT_TARGET_CHARS,
    currentDraftPanelCount,
    MAX_REPAIR_DRAFT_PANEL_SUMMARY_CHARS,
    MIN_REPAIR_DRAFT_PANEL_SUMMARY_CHARS,
  );
  const futurePages = orderedPlan.filter(
    (page) => !input.currentPageIds.has(page.pageId) && !completedPageIds.has(page.pageId),
  );
  const repairSection =
    input.repairIssues === undefined || input.repairIssues.length === 0
      ? []
      : [
          '',
          '[REPAIR REQUIRED]',
          'Recompile this chunk while preserving unaffected story ownership and chronology.',
          ...input.repairIssues.map(
            (issue) =>
              `${issue.code} | pages=${issue.pageIds.join(',')} | ${issue.message} | ${issue.repairInstruction}`,
          ),
        ];
  const currentDraftSection =
    input.repairIssues === undefined ||
    input.repairIssues.length === 0 ||
    currentDraftPages.length === 0
      ? []
      : [
          '',
          '[CURRENT CHUNK DRAFT TO REPAIR]',
          'Keep panels and fields that are not named by REPAIR REQUIRED unchanged.',
          ...[...currentDraftPages]
            .sort(compareSuggestionPages)
            .map((page) => formatRepairDraftPage(page, currentDraftPanelBudget, entityLabels)),
        ];

  return [
    '',
    '[GLOBAL EPISODE LEDGER]',
    ...orderedPlan.map((page) => formatBeatPlanPage(page, LEDGER_FIELD_MAX_CHARS)),
    '',
    '[CURRENT CHUNK OWNERSHIP]',
    ...currentPages.map(formatOwnedBeatPlanPage),
    '',
    '[ALREADY COMPILED PAGES]',
    ...(input.completedPages.length > 0
      ? [...input.completedPages]
          .sort(compareSuggestionPages)
          .map((page) => formatCompiledPageSummary(page, completedPanelBudget, entityLabels))
      : ['(none)']),
    ...currentDraftSection,
    '',
    '[FUTURE RESERVED BEATS]',
    ...(futurePages.length > 0
      ? futurePages.map((page) => formatBeatPlanPage(page, RESERVED_LEDGER_FIELD_MAX_CHARS))
      : ['(none)']),
    '',
    '[CONTINUITY RULES]',
    'Use only the beats owned by CURRENT CHUNK OWNERSHIP for these pages.',
    'Do not repeat dialogue, discoveries, actions, reactions, or visual situations from ALREADY COMPILED PAGES.',
    'Do not use FUTURE RESERVED BEATS early.',
    'The first panel must continue from entry_state, and the final panel must reach exit_state and handoff.',
    'During repair, preserve every unaffected panel and field from CURRENT CHUNK DRAFT TO REPAIR.',
    ...repairSection,
  ].join('\n');
}

export function buildEpisodePlanAuditBrief(input: {
  context: EpisodePagePlanContext;
  plan: EpisodeBeatPlan;
  suggestion: EpisodePagePlanSuggestion;
  language: AppLanguage;
}): string {
  const panelCount = input.suggestion.pages.reduce(
    (count, page) => count + page.panels.length,
    0,
  );
  const panelBudget = calculatePanelSummaryBudget(
    AUDIT_DRAFT_TARGET_CHARS,
    panelCount,
    MAX_AUDIT_PANEL_SUMMARY_CHARS,
  );
  const entityLabels = buildEntityLabelLookup(input.context);

  return [
    '[AUDIT PURPOSE]',
    'Audit the complete compiled episode before anything is saved.',
    `Output language: ${input.language === 'en' ? 'English' : 'Japanese'}`,
    '',
    buildEpisodeBeatPlanCompilerBrief(input.context, input.language),
    '',
    '[GLOBAL EPISODE LEDGER]',
    ...[...input.plan.pages]
      .sort(compareBeatPlanPages)
      .map((page) => formatBeatPlanPage(page, LEDGER_FIELD_MAX_CHARS)),
    '',
    '[COMPILED EPISODE DRAFT]',
    ...[...input.suggestion.pages]
      .sort(compareSuggestionPages)
      .flatMap((page) => formatAuditPage(page, panelBudget, entityLabels)),
    '',
    '[AUDIT CONTRACT]',
    'Check the entire draft against the source and ledger, not each page in isolation.',
    'Target page_ids that must be recompiled. For repetition, target the later occurrence unless both pages must change.',
  ].join('\n');
}

export function detectDeterministicContinuityIssues(
  suggestion: EpisodePagePlanSuggestion,
): EpisodePlanAuditIssue[] {
  const dialogueOwners = new Map<string, { pageId: string; text: string }>();
  const visualOwners = new Map<string, { pageId: string; text: string }>();
  const issues: EpisodePlanAuditIssue[] = [];

  for (const page of [...suggestion.pages].sort(compareSuggestionPages)) {
    for (const panel of [...page.panels].sort((left, right) => left.order - right.order)) {
      for (const line of panel.dialogue ?? []) {
        const normalized = normalizeDuplicateCandidate(line.text);
        if (normalized.length < DIALOGUE_DUPLICATE_MIN_NORMALIZED_CHARS) {
          continue;
        }
        const first = dialogueOwners.get(normalized);
        if (first === undefined) {
          dialogueOwners.set(normalized, { pageId: page.pageId, text: line.text });
          continue;
        }
        if (first.pageId === page.pageId) {
          continue;
        }
        issues.push({
          code: 'duplicate_dialogue',
          severity: 'error',
          pageIds: [page.pageId],
          message: `Dialogue repeats an earlier page: ${truncatePromptText(line.text, 500)}`,
          repairInstruction: `Replace the later line with dialogue or silence that advances beyond page ${first.pageId}.`,
        });
      }

      if (panel.situationText === undefined || panel.situationText === null) {
        continue;
      }
      const normalizedSituation = normalizeDuplicateCandidate(panel.situationText);
      if (normalizedSituation.length < VISUAL_DUPLICATE_MIN_NORMALIZED_CHARS) {
        continue;
      }
      const firstVisual = visualOwners.get(normalizedSituation);
      if (firstVisual === undefined) {
        visualOwners.set(normalizedSituation, {
          pageId: page.pageId,
          text: panel.situationText,
        });
        continue;
      }
      if (firstVisual.pageId === page.pageId) {
        continue;
      }
      issues.push({
        code: 'duplicate_visual_beat',
        severity: 'error',
        pageIds: [page.pageId],
        message: `Visual beat repeats an earlier page: ${truncatePromptText(panel.situationText, 500)}`,
        repairInstruction: `Advance the later page beyond the situation already shown on page ${firstVisual.pageId}.`,
      });
    }
  }

  return deduplicateAuditIssues(issues);
}

export function mergeEpisodePlanAuditIssues(
  deterministicIssues: EpisodePlanAuditIssue[],
  modelIssues: EpisodePlanAuditIssue[],
  knownPageIds: ReadonlySet<string>,
): EpisodePlanAuditIssue[] {
  for (const issue of modelIssues) {
    if (issue.pageIds.some((pageId) => !knownPageIds.has(pageId))) {
      throw new ConfigurationError('Episode continuity audit referenced an unknown page');
    }
  }

  return deduplicateAuditIssues([...deterministicIssues, ...modelIssues]);
}

export function fingerprintEpisodePlanningContext(context: EpisodePagePlanContext): string {
  return createHash('sha256').update(stableStringify(context)).digest('hex');
}

function buildCanonicalEntityReferences(
  context: EpisodePagePlanContext,
): CanonicalEntityReference[] {
  return context.entities.map((entity) => ({
    id: entity.id,
    name: entity.name,
    aliases: extractEntityAliases(entity.structuredFields),
  }));
}

function buildEntityLabelLookup(context: EpisodePagePlanContext): ReadonlyMap<string, string> {
  const nameCounts = new Map<string, number>();
  for (const entity of context.entities) {
    const name = entity.name.trim();
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  return new Map(
    context.entities.map((entity) => {
      const name = entity.name.trim();
      const label = (nameCounts.get(name) ?? 0) > 1
        ? `${name}[${entity.id.slice(0, 8)}]`
        : name;
      return [entity.id, label] as const;
    }),
  );
}

function formatBeatPlanPage(page: EpisodeBeatPlanPage, fieldMaxChars: number): string {
  return [
    `Page ${page.pageNumber} (${page.pageId}):`,
    `beats=${truncatePromptText(page.storyBeats.join(' / '), fieldMaxChars * 2)}`,
    `entry=${truncatePromptText(page.entryState, fieldMaxChars)}`,
    `exit=${truncatePromptText(page.exitState, fieldMaxChars)}`,
    `new=${truncatePromptText(page.newInformation.join(' / ') || 'none', fieldMaxChars)}`,
    `dialogue=${truncatePromptText(page.dialogueIntent ?? 'none', fieldMaxChars)}`,
    `handoff=${truncatePromptText(page.handoff ?? 'none', fieldMaxChars)}`,
  ].join(' | ');
}

// Current ownership is the binding contract for the detail compiler. Keep every
// schema-valid beat here while retaining compact summaries for global/future pages.
function formatOwnedBeatPlanPage(page: EpisodeBeatPlanPage): string {
  return [
    `Page ${page.pageNumber} (${page.pageId}):`,
    `beats=${truncatePromptText(page.storyBeats.join(' / '), OWNED_STORY_BEATS_MAX_CHARS)}`,
    `entry=${truncatePromptText(page.entryState, OWNED_SCALAR_MAX_CHARS)}`,
    `exit=${truncatePromptText(page.exitState, OWNED_SCALAR_MAX_CHARS)}`,
    `new=${truncatePromptText(page.newInformation.join(' / ') || 'none', OWNED_NEW_INFORMATION_MAX_CHARS)}`,
    `dialogue=${truncatePromptText(page.dialogueIntent ?? 'none', OWNED_SCALAR_MAX_CHARS)}`,
    `handoff=${truncatePromptText(page.handoff ?? 'none', OWNED_SCALAR_MAX_CHARS)}`,
  ].join(' | ');
}

function formatSceneEntityStates(
  entityStates: EpisodePagePlanContext['scenes'][number]['entityStates'],
  entityNames: ReadonlyMap<string, string>,
  canonicalize: (value: string | null | undefined, maxLength?: number) => string,
): string {
  if (entityStates.length === 0) {
    return 'none';
  }

  const entries = entityStates.map((state) => {
    const entityName = canonicalize(
      entityNames.get(state.entityId) ?? state.entityId,
      ENTITY_NAME_MAX_CHARS,
    );
    const details = [
      formatSceneStateField('costume', state.costumeNote, canonicalize),
      formatSceneStateField('condition', state.conditionNote, canonicalize),
      formatSceneStateField('hair', state.hairNote, canonicalize),
      formatSceneStateField('expression', state.expressionDefault, canonicalize),
      formatSceneStateField('extra', state.extraNote, canonicalize),
    ].filter((value): value is string => value !== null);
    const summary = details.length === 0 ? 'registered state' : details.join(' / ');
    return truncatePromptText(`${entityName}: ${summary}`, SCENE_STATE_ENTRY_MAX_CHARS);
  });

  return truncatePromptText(entries.join(' ; '), SCENE_STATES_MAX_CHARS);
}

function formatSceneStateField(
  label: string,
  value: string | null,
  canonicalize: (value: string | null | undefined, maxLength?: number) => string,
): string | null {
  if (value === null || value.trim().length === 0) {
    return null;
  }
  return `${label}=${canonicalize(value, SCENE_STATE_FIELD_MAX_CHARS)}`;
}

function formatCompiledPageSummary(
  page: EpisodePagePlanPageSuggestion,
  panelBudget: number,
  entityLabels: ReadonlyMap<string, string>,
): string {
  const panelSummary = [...page.panels]
    .sort((left, right) => left.order - right.order)
    .map((panel) => {
      const entityIds = (panel.entities ?? []).map((entity) => entity.entityId);
      const fixed = `panel ${panel.order}: entities=${formatEntityLabels(entityIds, entityLabels, 120)}; `;
      const remaining = Math.max(60, panelBudget - fixed.length);
      const situationBudget = Math.max(24, Math.floor(remaining * 0.55));
      const dialogueBudget = Math.max(24, remaining - situationBudget);
      const summary = [
        fixed,
        `situation=${truncatePromptText(panel.situationText ?? 'none', situationBudget)}; `,
        `dialogue=${formatDialogueForBrief(panel.dialogue ?? [], dialogueBudget, entityLabels)}`,
      ].join('');
      return truncatePromptText(summary, panelBudget);
    })
    .join(' || ');
  const header = truncatePromptText(
    `Page ${page.pageNumber} (${page.pageId}): purpose=${page.pagePurpose ?? 'none'}`,
    PAGE_HEADER_MAX_CHARS,
  );
  return `${header} | ${panelSummary}`;
}

function formatRepairDraftPage(
  page: EpisodePagePlanPageSuggestion,
  panelBudget: number,
  entityLabels: ReadonlyMap<string, string>,
): string {
  const panelSummary = [...page.panels]
    .sort((left, right) => left.order - right.order)
    .map((panel) => formatRepairDraftPanel(panel, panelBudget, entityLabels))
    .join(' || ');
  const header = truncatePromptText(
    [
      `Page ${page.pageNumber} (${page.pageId})`,
      `purpose=${page.pagePurpose ?? 'none'}`,
      `continuity=${page.continuityNote ?? 'none'}`,
      `dialogue_mode=${page.page?.dialogueMode ?? 'unchanged'}`,
      `dialogue_enabled=${page.page?.pageDialogueToggle ?? 'unchanged'}`,
    ].join(' | '),
    PAGE_HEADER_MAX_CHARS,
  );
  return `${header} | ${panelSummary}`;
}

function formatRepairDraftPanel(
  panel: EpisodePagePlanPageSuggestion['panels'][number],
  panelBudget: number,
  entityLabels: ReadonlyMap<string, string>,
): string {
  const entityIds = (panel.entities ?? []).map((entity) => entity.entityId);
  const fixed = [
    `panel ${panel.order}`,
    `role=${panel.panelRole ?? 'unchanged'}`,
    `size=${panel.panelSize ?? 'unchanged'}`,
    `source=${panel.composition?.source ?? 'unchanged'}`,
    `shot=${panel.composition?.shotType ?? 'unchanged'}`,
    `angle=${panel.composition?.angle ?? 'unchanged'}`,
    `dialogue_in_panel=${panel.dialogueInPanel ?? 'unchanged'}`,
    `entities=${formatEntityLabels(entityIds, entityLabels, Math.max(24, Math.floor(panelBudget * 0.12)))}`,
  ].join('; ');
  const fieldLabels =
    '; situation=; composition=; custom=; background=; notes=; sfx=; dialogue=';
  const contentBudget = Math.max(7, panelBudget - fixed.length - fieldLabels.length);
  const situationBudget = Math.max(1, Math.floor(contentBudget * 0.2));
  const compositionBudget = Math.max(1, Math.floor(contentBudget * 0.2));
  const customBudget = Math.max(1, Math.floor(contentBudget * 0.12));
  const backgroundBudget = Math.max(1, Math.floor(contentBudget * 0.14));
  const notesBudget = Math.max(1, Math.floor(contentBudget * 0.14));
  const sfxBudget = Math.max(1, Math.floor(contentBudget * 0.05));
  const dialogueBudget = Math.max(
    1,
    contentBudget -
      situationBudget -
      compositionBudget -
      customBudget -
      backgroundBudget -
      notesBudget -
      sfxBudget,
  );
  const summary = [
    fixed,
    `situation=${truncatePromptText(panel.situationText ?? 'none', situationBudget)}`,
    `composition=${truncatePromptText(panel.composition?.compositionPrompt ?? 'none', compositionBudget)}`,
    `custom=${truncatePromptText(panel.composition?.customNote ?? 'none', customBudget)}`,
    `background=${truncatePromptText(panel.backgroundNote ?? 'none', backgroundBudget)}`,
    `notes=${truncatePromptText(panel.panelNotes ?? 'none', notesBudget)}`,
    `sfx=${truncatePromptText(panel.sfxText ?? 'none', sfxBudget)}`,
    `dialogue=${formatDialogueForBrief(panel.dialogue ?? [], dialogueBudget, entityLabels)}`,
  ].join('; ');
  return truncatePromptText(summary, panelBudget);
}

function formatAuditPage(
  page: EpisodePagePlanPageSuggestion,
  panelBudget: number,
  entityLabels: ReadonlyMap<string, string>,
): string[] {
  const header = truncatePromptText(
    [
      `Page ${page.pageNumber} (${page.pageId})`,
      `purpose=${page.pagePurpose ?? 'none'}`,
      `continuity=${page.continuityNote ?? 'none'}`,
    ].join(' | '),
    PAGE_HEADER_MAX_CHARS,
  );
  const panels = [...page.panels]
    .sort((left, right) => left.order - right.order)
    .map((panel) => {
      const entityIds = (panel.entities ?? []).map((entity) => entity.entityId);
      const fixed = [
        `Panel ${panel.order}`,
        `role=${panel.panelRole ?? 'none'}`,
        `shot=${panel.composition?.shotType ?? 'none'}`,
        `angle=${panel.composition?.angle ?? 'none'}`,
        `entities=${formatEntityLabels(
          entityIds,
          entityLabels,
          Math.max(24, Math.floor(panelBudget * 0.2)),
        )}`,
      ].join('|');
      const remaining = Math.max(48, panelBudget - fixed.length - 3);
      const dialogueBudget = Math.max(16, Math.floor(remaining * 0.42));
      const situationBudget = Math.max(16, Math.floor(remaining * 0.36));
      const backgroundBudget = Math.max(
        16,
        remaining - dialogueBudget - situationBudget,
      );
      const summary = [
        fixed,
        `d=${formatDialogueForBrief(panel.dialogue ?? [], dialogueBudget, entityLabels)}`,
        `s=${truncatePromptText(panel.situationText ?? 'none', situationBudget)}`,
        `b=${truncatePromptText(panel.backgroundNote ?? 'none', backgroundBudget)}`,
      ].join('|');
      return `  ${truncatePromptText(summary, panelBudget)}`;
    });
  return [header, ...panels];
}

function normalizeDuplicateCandidate(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

function truncatePromptText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (maxChars <= 3) {
    return normalized.slice(0, Math.max(0, maxChars));
  }
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

function calculatePanelSummaryBudget(
  targetChars: number,
  panelCount: number,
  maximum: number,
  minimum: number = MIN_PANEL_SUMMARY_CHARS,
): number {
  if (panelCount <= 0) {
    return maximum;
  }
  return Math.max(minimum, Math.min(maximum, Math.floor(targetChars / panelCount)));
}

function formatEntityLabels(
  entityIds: string[],
  entityLabels: ReadonlyMap<string, string>,
  maxChars: number,
): string {
  if (entityIds.length === 0) {
    return 'none';
  }
  const labels = entityIds.map((entityId) => entityLabels.get(entityId) ?? entityId);
  return truncatePromptText(labels.join(','), maxChars);
}

function formatDialogueForBrief(
  dialogue: EpisodePagePlanPageSuggestion['panels'][number]['dialogue'],
  maxChars: number,
  entityLabels: ReadonlyMap<string, string>,
): string {
  if (dialogue === undefined || dialogue.length === 0) {
    return 'none';
  }
  const visibleLines = dialogue.slice(0, MAX_DIALOGUE_LINES_IN_SUMMARY);
  const perLineBudget = Math.max(16, Math.floor(maxChars / visibleLines.length));
  const lines = visibleLines.map((line) =>
    truncatePromptText(
      `${line.type}:${line.entityId === null ? 'narrator' : (entityLabels.get(line.entityId) ?? line.entityId)}:${line.text}`,
      perLineBudget,
    ),
  );
  if (dialogue.length > visibleLines.length) {
    lines.push(`+${dialogue.length - visibleLines.length} more`);
  }
  return truncatePromptText(lines.join(' / '), maxChars);
}

function deduplicateAuditIssues(issues: EpisodePlanAuditIssue[]): EpisodePlanAuditIssue[] {
  const unique = new Map<string, EpisodePlanAuditIssue>();
  for (const issue of issues) {
    const pageIds = Array.from(new Set(issue.pageIds));
    const key = `${issue.code}:${[...pageIds].sort().join(',')}:${normalizeDuplicateCandidate(issue.message)}`;
    if (!unique.has(key)) {
      unique.set(key, { ...issue, pageIds });
    }
  }
  return Array.from(unique.values());
}

function compareContextPages(
  left: EpisodePagePlanContext['pages'][number],
  right: EpisodePagePlanContext['pages'][number],
): number {
  return left.pageNumber - right.pageNumber || left.pageId.localeCompare(right.pageId);
}

function compareBeatPlanPages(left: EpisodeBeatPlanPage, right: EpisodeBeatPlanPage): number {
  return left.pageNumber - right.pageNumber || left.pageId.localeCompare(right.pageId);
}

function compareSuggestionPages(
  left: EpisodePagePlanPageSuggestion,
  right: EpisodePagePlanPageSuggestion,
): number {
  return left.pageNumber - right.pageNumber || left.pageId.localeCompare(right.pageId);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return 'null';
}
