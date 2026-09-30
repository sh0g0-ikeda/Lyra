import type { EpisodeStateTransitionPlan } from '../../domain/types/episodeStateTransition.js';
import type { AppLanguage } from '../../domain/types/language.js';
import type { EpisodePagePlanContext } from '../../domain/types/page.js';
import type { EpisodeBeatPlan } from './EpisodeBeatPlanCompiler.js';

export interface CompileEpisodeStateTransitionInput {
  context: EpisodePagePlanContext;
  beatPlan?: EpisodeBeatPlan;
  language: AppLanguage;
  beforeRetry?: () => Promise<void>;
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
): string {
  const panels = [...context.pages]
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .flatMap((page) => [...page.panels]
      .sort((left, right) => left.order - right.order)
      .map((panel) => [
        `Page ${page.pageNumber} | page_id=${page.pageId}`,
        `source_scene_ids=${readSourceSceneIds(page.layoutConfig).join(',') || '(none)'}`,
        `Panel ${panel.order} | panel_id=${panel.id}`,
        `situation=${textOrNone(panel.situationText)}`,
        `dialogue=${panel.dialogue.map((line) => `${line.entityId}:${line.text}`).join(' / ') || '(none)'}`,
      ].join(' | ')));
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
    `Full draft: ${textOrNone(context.episode.storyFullDraft)}`,
    `Introduction: ${textOrNone(context.episode.introduction)}`,
    `Middle: ${textOrNone(context.episode.middle)}`,
    `Climax: ${textOrNone(context.episode.climax)}`,
    `Ending hook: ${textOrNone(context.episode.endingHook)}`,
    '',
    '[SAVED SCENES]',
    ...(scenes.length === 0 ? ['(none)'] : scenes),
    '',
    '[ENTITIES]',
    ...(entities.length === 0 ? ['(none)'] : entities),
    '',
    '[PANELS IN READING ORDER]',
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
    'A state with reference_ready=false remains a candidate; report it as unresolved when it is needed.',
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
