import type { EpisodePagePlanContext, EpisodePagePlanSuggestion, PageAutofillPanelContext } from '../../domain/types/page.js';
import type { PanelDialogueLine } from '../../domain/types/panel.js';
import type { EpisodeAutofillCharacterReference } from './EpisodePagePlanCompiler.js';

/**
 * Design: this module is intentionally a pure, bounded repair pass. It may only
 * replace a dialogue speaker with an entity already authorized by the complete
 * episode context; page/panel assignments, state references, and display text
 * are never inputs to mutation. Existing downstream validators own unresolved
 * lines when no authorized fallback exists.
 */
export function buildEpisodeAutofillCharacterReferences(
  context: EpisodePagePlanContext,
): readonly EpisodeAutofillCharacterReference[] {
  const seenEntityIds = new Set<string>();
  const entities = [...context.entities]
    .sort(compareEntityContexts)
    .filter((entity) => {
      if (seenEntityIds.has(entity.id)) {
        return false;
      }
      seenEntityIds.add(entity.id);
      return true;
    });

  return entities.map((entity, index) => ({
    ref: `E${index + 1}`,
    entityId: entity.id,
    name: entity.name,
    entityType: entity.entityType,
  }));
}

export function resolveEpisodeAutofillDialogueSpeakers(
  context: EpisodePagePlanContext,
  suggestion: EpisodePagePlanSuggestion,
): { suggestion: EpisodePagePlanSuggestion; repairedSpeakerCount: number } {
  const references = buildEpisodeAutofillCharacterReferences(context);
  const resolution = buildResolutionIndex(references);
  let repairedSpeakerCount = 0;
  let pagesChanged = false;

  const pages = suggestion.pages.map((page) => {
    const sourcePage = context.pages.find((candidate) => candidate.pageId === page.pageId);
    let panelsChanged = false;
    const panels = page.panels.map((panel) => {
      const sourcePanel = sourcePage?.panels.find((candidate) => candidate.order === panel.order);
      const dialogue = panel.dialogue;
      if (!Array.isArray(dialogue)) {
        return panel;
      }

      const repairedDialogue = dialogue.map((line) => {
        const resolvedEntityId = resolveDialogueSpeaker({
          line,
          panel,
          sourcePanel,
          pageSourceSceneIds: sourceSceneIdsForPage(page, sourcePage),
          context,
          resolution,
        });
        if (resolvedEntityId === line.entityId) {
          return line;
        }
        repairedSpeakerCount += 1;
        panelsChanged = true;
        return { ...line, entityId: resolvedEntityId };
      });

      return panelsChanged && repairedDialogue.some((line, index) => line !== dialogue[index])
        ? { ...panel, dialogue: repairedDialogue }
        : panel;
    });

    if (!panelsChanged) {
      return page;
    }
    pagesChanged = true;
    return { ...page, panels };
  });

  return pagesChanged
    ? { suggestion: { ...suggestion, pages }, repairedSpeakerCount }
    : { suggestion, repairedSpeakerCount };
}

interface ResolutionIndex {
  readonly entityIds: ReadonlySet<string>;
  readonly aliases: ReadonlyMap<string, string>;
  readonly orderedEntityIds: readonly string[];
  readonly speakerEntityIds: readonly string[];
}

function buildResolutionIndex(references: readonly EpisodeAutofillCharacterReference[]): ResolutionIndex {
  const entityIds = new Set(references.map((reference) => reference.entityId));
  return {
    entityIds,
    aliases: new Map(references.map((reference) => [reference.ref, reference.entityId])),
    orderedEntityIds: references.map((reference) => reference.entityId),
    speakerEntityIds: references
      .filter((reference) => reference.entityType === 'character' || reference.entityType === 'nonhuman')
      .map((reference) => reference.entityId),
  };
}

function resolveDialogueSpeaker(input: {
  line: PanelDialogueLine;
  panel: EpisodePagePlanSuggestion['pages'][number]['panels'][number];
  sourcePanel: PageAutofillPanelContext | undefined;
  pageSourceSceneIds: readonly string[];
  context: EpisodePagePlanContext;
  resolution: ResolutionIndex;
}): string | null {
  if (input.line.type === 'narration') {
    return null;
  }
  if (!isSpokenDialogue(input.line)) {
    return input.line.entityId;
  }
  if (input.line.entityId !== null && input.resolution.entityIds.has(input.line.entityId)) {
    return input.line.entityId;
  }

  const candidates = [
    knownEntityId(input.line.entityId, input.resolution),
    matchingSourceSpeaker(input.sourcePanel, input.line.text, input.resolution),
    firstSourceSpeaker(input.sourcePanel, input.resolution),
    firstKnownEntityId((input.panel.entities ?? []).map((assignment) => assignment.entityId), input.resolution),
    firstSceneEntityId(input.context, input.pageSourceSceneIds, input.resolution),
    input.resolution.speakerEntityIds[0],
    input.resolution.orderedEntityIds[0],
  ];
  return candidates.find((candidate): candidate is string => candidate !== undefined) ?? input.line.entityId;
}

function isSpokenDialogue(line: PanelDialogueLine): boolean {
  return line.type === 'speech' || line.type === 'thought' || line.type === 'shout' || line.type === 'whisper';
}

function matchingSourceSpeaker(
  sourcePanel: PageAutofillPanelContext | undefined,
  text: string,
  resolution: ResolutionIndex,
): string | undefined {
  const matchingLine = sourcePanel?.dialogue.find((line) => line.text === text);
  return knownEntityId(matchingLine?.entityId ?? null, resolution);
}

function firstSourceSpeaker(
  sourcePanel: PageAutofillPanelContext | undefined,
  resolution: ResolutionIndex,
): string | undefined {
  return firstKnownEntityId(sourcePanel?.dialogue.map((line) => line.entityId) ?? [], resolution);
}

function firstSceneEntityId(
  context: EpisodePagePlanContext,
  sourceSceneIds: readonly string[],
  resolution: ResolutionIndex,
): string | undefined {
  const sceneIds = new Set(sourceSceneIds);
  return firstKnownEntityId(
    context.scenes
      .filter((scene) => sceneIds.has(scene.id))
      .flatMap((scene) => scene.involvedEntityIds),
    resolution,
  );
}

function firstKnownEntityId(values: readonly (string | null)[], resolution: ResolutionIndex): string | undefined {
  for (const value of values) {
    const entityId = knownEntityId(value, resolution);
    if (entityId !== undefined) {
      return entityId;
    }
  }
  return undefined;
}

function knownEntityId(value: string | null, resolution: ResolutionIndex): string | undefined {
  if (value === null) {
    return undefined;
  }
  if (resolution.entityIds.has(value)) {
    return value;
  }
  return resolution.aliases.get(value);
}

function sourceSceneIdsForPage(
  page: EpisodePagePlanSuggestion['pages'][number],
  sourcePage: EpisodePagePlanContext['pages'][number] | undefined,
): readonly string[] {
  if (page.sourceSceneIds !== undefined) {
    return page.sourceSceneIds;
  }
  const sourceSceneIds = sourcePage?.layoutConfig.story_source_scene_ids;
  return Array.isArray(sourceSceneIds)
    ? sourceSceneIds.filter((sceneId): sceneId is string => typeof sceneId === 'string')
    : [];
}

function compareEntityContexts(
  left: EpisodePagePlanContext['entities'][number],
  right: EpisodePagePlanContext['entities'][number],
): number {
  return left.id.localeCompare(right.id)
    || left.name.localeCompare(right.name)
    || left.entityType.localeCompare(right.entityType);
}
