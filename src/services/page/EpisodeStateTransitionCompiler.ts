import type { EpisodeStateTransitionPlan } from '../../domain/types/episodeStateTransition.js';
import type { AppLanguage } from '../../domain/types/language.js';
import type { EpisodePagePlanContext, EpisodePagePlanSuggestion } from '../../domain/types/page.js';
import type { EpisodeBeatPlan } from './EpisodeBeatPlanCompiler.js';
import { CHARACTER_STATE_EXTRACTION_RULES } from '../../domain/state/CharacterStateExtractionPolicy.js';
import { analyzeStoryManuscript } from '../../../packages/api-contract/src/storyManuscript.js';

export interface CompileEpisodeStateTransitionInput {
  context: EpisodePagePlanContext;
  beatPlan?: EpisodeBeatPlan;
  language: AppLanguage;
  beforeRetry?: () => Promise<void>;
  /** Completed detail + audit draft; context remains the immutable fingerprint authority. */
  finalSuggestion?: EpisodePagePlanSuggestion;
  /** Enables literal original-source and completed-onset-panel evidence checks. */
  strictEvidence?: boolean;
}

export interface CompiledEpisodeStateTransitionPlan {
  plan: EpisodeStateTransitionPlan;
  compilerProvider: 'openai';
  compilerModel: string;
  compilerPromptVersion: string;
}

export interface EpisodeStateTransitionCompilerPort {
  compileStateTransitions(
    input: CompileEpisodeStateTransitionInput,
  ): Promise<CompiledEpisodeStateTransitionPlan>;
}

/** Builds the only state-transition input exposed to the model; reference descriptors stay server-side. */
export function buildEpisodeStateTransitionCompilerBrief(
  context: EpisodePagePlanContext,
  language: AppLanguage,
  beatPlan?: EpisodeBeatPlan,
  finalSuggestion?: EpisodePagePlanSuggestion,
): string {
  const prose = (value: string | null | undefined): string => textOrNone(value == null ? value
    : analyzeStoryManuscript(value, context.episode.productionNotesEnabled === true).prose);
  const suggestionByPageId = new Map(finalSuggestion?.pages.map((page) => [page.pageId, page] as const));
  const panels = [...context.pages]
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .flatMap((page) => {
      const suggestedByOrder = new Map(
        suggestionByPageId.get(page.pageId)?.panels.map((panel) => [panel.order, panel] as const) ?? [],
      );
      return [...page.panels]
      .sort((left, right) => left.order - right.order)
      .map((panel) => {
        const finalPanel = suggestedByOrder.get(panel.order);
        const assignments = finalPanel?.entities ?? panel.entities;
        return [
        `Page ${page.pageNumber} | page_id=${page.pageId}`,
        `source_scene_ids=${readSourceSceneIds(page.layoutConfig).join(',') || '(none)'}`,
        `Panel ${panel.order} | panel_id=${panel.id}`,
        `situation=${textOrNone(finalPanel === undefined ? panel.situationText : finalPanel.situationText)}`,
        `composition=${textOrNone(finalPanel === undefined
          ? panel.composition.compositionPrompt
          : finalPanel.composition?.compositionPrompt)}`,
        `effects=${assignments.map((assignment) => `${assignment.entityId}:${textOrNone(assignment.effectNote)}`).join(' / ') || '(none)'}`,
        `dialogue=${(finalPanel === undefined ? panel.dialogue : finalPanel.dialogue ?? [])
          .map((line) => `${line.entityId}:${line.text}`).join(' / ') || '(none)'}`,
      ].join(' | ');
      });
    });
  const scenes = [...context.scenes]
    .sort((left, right) => left.order - right.order)
    .map((scene) => [
      `Scene ${scene.order} | scene_id=${scene.id}`,
      `location=${textOrNone(scene.location)}`,
      `time=${textOrNone(scene.time)}`,
      `atmosphere=${textOrNone(scene.atmosphere)}`,
    ].join(' | '));
  const states = [...(context.stateLibrary ?? [])]
    .sort((left, right) => left.entityId.localeCompare(right.entityId)
      || left.stateId.localeCompare(right.stateId))
    .map((state) => [
      `entity_id=${state.entityId}`,
      `state_id=${state.stateId}`,
      `name=${textOrNone(state.name)}`,
      `description=${textOrNone(state.description)}`,
      `reference_ready=${state.referenceReady}`,
      'candidate=true',
    ].join(' | '));
  const starting = (context.episode.startingEntityStates ?? [])
    .map((state) => `entity_id=${state.entityId} | starting_state=${state.stateId ?? 'none'}`);
  const entities = [...context.entities]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((entity) => `entity_id=${entity.id} | name=${textOrNone(entity.name)}`);
  const beatLines = beatPlan === undefined ? [] : [...beatPlan.pages]
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .map((page) => `Page ${page.pageNumber} | page_id=${page.pageId} | entry=${page.entryState} | exit=${page.exitState} | beats=${page.storyBeats.join(' / ')}`);

  return [
    '[PURPOSE]',
    'Infer all character state changes once for this complete episode. Do not generate images or spend credits.',
    `Output language: ${language === 'en' ? 'English' : 'Japanese'}`,
    '',
    '[SAVED EPISODE STORY]',
    `Full draft: ${prose(context.episode.storyFullDraft)}`,
    `Introduction: ${prose(context.episode.introduction)}`,
    `Middle: ${prose(context.episode.middle)}`,
    `Climax: ${prose(context.episode.climax)}`,
    `Ending hook: ${prose(context.episode.endingHook)}`,
    '',
    '[SAVED SCENES]',
    ...(scenes.length === 0 ? ['(none)'] : scenes),
    '',
    '[ENTITIES]',
    ...(entities.length === 0 ? ['(none)'] : entities),
    '',
    finalSuggestion === undefined
      ? '[PANELS IN READING ORDER]'
      : '[FINAL AUDITED PANELS IN READING ORDER]',
    ...(panels.length === 0 ? ['(none)'] : panels),
    '',
    '[STARTING ENTITY STATES]',
    ...(starting.length === 0 ? ['(none)'] : starting),
    '',
    '[STATE LIBRARY]',
    ...(states.length === 0 ? ['(none)'] : states),
    '',
    '[EPISODE BEAT PLAN]',
    ...(beatLines.length === 0 ? ['(none)'] : beatLines),
    '',
    '[BINDING RULES]',
    'Use only entity IDs, state IDs, scene IDs, and panel IDs listed above.',
    'Prefer a listed reference_ready=true state for a supported transformation.',
    'A state with reference_ready=false remains an unassignable candidate; report it as an unresolved visual-only fallback when it is needed.',
    ...CHARACTER_STATE_EXTRACTION_RULES,
    'If no listed READY state represents a qualifying continuing condition, report a visual-only fallback. Do not create a new state.',
    finalSuggestion === undefined
      ? 'Each unresolved suggested_description must describe the complete visible appearance from its boundary until the next boundary for that character.'
      : 'Each unresolved suggested_description must be only the persistent visible appearance delta copied literally from source_quote; do not rewrite the base profile or include actions and transient emotions.',
    ...(finalSuggestion === undefined ? [] : [
      'When an existing candidate description is itself a literal substring of source_quote and exactly represents the same visible delta, copy that exact description and its name. Do not fold additional or different changes into that candidate.',
    ]),
    ...(finalSuggestion === undefined ? [
      'Do not drop an earlier injury, costume, or transformation unless the saved source explicitly ends it.',
    ] : []),
    'Keep suggested_description concise (prefer at most 300 characters) while preserving the persistent visible change supported by the saved source.',
    'Do not output decisions, smiles, poses, held objects, hand movements, or other transient emotion/action as character states.',
    ...(finalSuggestion === undefined ? [] : [
      'For every boundary, panel_evidence_quote must be a literal substring of the completed onset panel situation, composition, or matching entity effect note and must show the change already visible there.',
      'A request, prediction, preparation, or not-yet-visible change is not an onset. Choose the first completed panel that visibly depicts the persistent delta.',
      'For each unresolved boundary, emit replaces_deltas as an array. An additive delta uses []; a partial reversal names only earlier active deltas for the same entity by their exact source_quote and literal description. Two independent deltas may share one source quote and onset panel.',
    ]),
    'For each transition, quote the saved source text that proves it. Do not infer facts absent from that text.',
    'Use null state_id only when returning to the default state.',
  ].join('\n');
}

function textOrNone(value: string | null | undefined): string {
  return value === null || value === undefined || value.trim().length === 0 ? '(none)' : value;
}

function readSourceSceneIds(layoutConfig: Record<string, unknown>): string[] {
  const value = layoutConfig.story_source_scene_ids;
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
