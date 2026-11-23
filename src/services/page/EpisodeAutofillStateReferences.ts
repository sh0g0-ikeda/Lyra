import type { EpisodePagePlanContext } from '../../domain/types/page.js';

export interface EpisodeAutofillStateReference {
  readonly entityId: string;
  readonly stateId: string;
  readonly name: string | null;
  readonly description: string | null;
}

/**
 * Builds the server-owned state catalog once from the complete episode context.
 * Scene pairs preserve the released scene contract; library pairs additionally
 * require a ready, materialized reference image. Unknown scene entities are never
 * promoted into a provider or persistence authorization.
 */
export function buildEpisodeAutofillStateReferences(
  context: EpisodePagePlanContext,
): readonly EpisodeAutofillStateReference[] {
  const entityIds = new Set(context.entities.map((entity) => entity.id));
  const libraryByPair = new Map((context.stateLibrary ?? []).map((state) => [
    `${state.entityId}:${state.stateId}`,
    state,
  ] as const));
  const pairs = new Map<string, EpisodeAutofillStateReference>();
  const add = (
    entityId: string,
    stateId: string,
    name: string | null,
    description: string | null,
  ): void => {
    if (!entityIds.has(entityId)) return;
    const key = `${entityId}:${stateId}`;
    const existing = pairs.get(key);
    pairs.set(key, {
      entityId,
      stateId,
      name: existing?.name ?? name,
      description: existing?.description ?? description,
    });
  };

  for (const scene of context.scenes) {
    for (const state of scene.entityStates) {
      const library = libraryByPair.get(`${state.entityId}:${state.stateId}`);
      const sceneDescription = [
        state.costumeNote,
        state.conditionNote,
        state.hairNote,
        state.expressionDefault,
        state.extraNote,
      ].filter((value): value is string => value !== null && value.trim().length > 0).join(' / ');
      add(
        state.entityId,
        state.stateId,
        library?.name ?? null,
        sceneDescription.length > 0 ? sceneDescription : library?.description ?? null,
      );
    }
  }
  for (const state of context.stateLibrary ?? []) {
    if (state.referenceReady && state.referenceImage !== null) {
      add(state.entityId, state.stateId, state.name, state.description);
    }
  }

  return [...pairs.values()].sort((left, right) =>
    left.entityId.localeCompare(right.entityId) || left.stateId.localeCompare(right.stateId));
}

export function isEpisodeAutofillStateReferenceAllowed(
  references: readonly EpisodeAutofillStateReference[],
  entityId: string,
  stateId: string,
): boolean {
  return references.some((reference) =>
    reference.entityId === entityId && reference.stateId === stateId);
}
