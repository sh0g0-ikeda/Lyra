import { hasMatchingSourceBackedState } from '../domain/entity/CharacterStateIdentity.js';
import {
  MAX_EPISODE_STATE_SOURCE_QUOTE_CHARS,
  MAX_EPISODE_STATE_TRANSITIONS,
} from '../domain/constants/storyState.js';
import { ValidationError } from '../domain/errors/index.js';
import type { PersistedEpisodeStateChange } from '../domain/types/episodeStateChange.js';
import type { EpisodeUnresolvedStateTransition, EpisodeStateTransitionSourceField } from '../domain/types/episodeStateTransition.js';
import type { EpisodePagePlanContext } from '../domain/types/page.js';
import type { DatabaseClient } from '../lib/db.js';

interface StateRow {
  id: string;
  entity_id: string;
  name: string | null;
  description: string | null;
  extra_note: string | null;
}

/**
 * Writes only new, source-backed library drafts. The caller already holds the
 * work → entity → state graph locks, so this class deliberately does not open
 * a nested transaction or mutate base entities / existing state rows.
 */
export class PostgresEpisodeStateChangeRepository {
  public constructor(
    private readonly client: DatabaseClient,
    private readonly context: EpisodePagePlanContext,
  ) {}

  public async persist(
    changes: readonly EpisodeUnresolvedStateTransition[],
  ): Promise<readonly PersistedEpisodeStateChange[]> {
    if (changes.length > MAX_EPISODE_STATE_TRANSITIONS) throw new ValidationError('Too many episode state changes');
    const states = await this.lockKnownStates();
    const saved: PersistedEpisodeStateChange[] = [];
    for (const change of changes) {
      this.assertChange(change);
      const entityStates = states.get(change.entityId) ?? [];
      const matching = entityStates.find((state) => hasMatchingSourceBackedState([{
        name: state.name,
        description: state.description,
        sourceQuote: state.extra_note,
      }], {
        name: change.suggestedName,
        description: change.suggestedDescription,
        sourceQuote: change.sourceQuote,
      }));
      if (matching !== undefined) {
        saved.push(this.toPersisted(change, matching.id, false));
        continue;
      }
      const inserted = await this.client.query<{ id: string }>(
        `INSERT INTO entity_states
           (entity_id, scene_id, name, description, reference_image, expression_default, extra_note)
         SELECT entities.id, NULL, $2, $3, NULL, 'neutral', $4
         FROM entities
         WHERE entities.id = $1::uuid
           AND entities.work_id = $5::uuid
         RETURNING id`,
        [change.entityId, change.suggestedName.trim(), change.suggestedDescription.trim(), change.sourceQuote.trim(), this.context.workId],
      );
      const stateId = inserted.rows[0]?.id;
      if (stateId === undefined) throw new ValidationError('Episode state draft was not created');
      const state: StateRow = {
        id: stateId,
        entity_id: change.entityId,
        name: change.suggestedName.trim(),
        description: change.suggestedDescription.trim(),
        extra_note: change.sourceQuote.trim(),
      };
      entityStates.push(state);
      states.set(change.entityId, entityStates);
      saved.push(this.toPersisted(change, stateId, true));
    }
    return saved;
  }

  private async lockKnownStates(): Promise<Map<string, StateRow[]>> {
    const result = await this.client.query<StateRow>(
      `SELECT entity_states.id, entity_states.entity_id, entity_states.name,
              entity_states.description, entity_states.extra_note
       FROM entity_states
       INNER JOIN entities ON entities.id = entity_states.entity_id
       WHERE entity_states.entity_id = ANY($1::uuid[])
         AND entities.work_id = $2::uuid
       ORDER BY entity_states.entity_id ASC, entity_states.id ASC
       FOR UPDATE OF entity_states`,
      [this.context.entities.map((entity) => entity.id), this.context.workId],
    );
    const states = new Map<string, StateRow[]>();
    for (const state of result.rows) {
      const forEntity = states.get(state.entity_id) ?? [];
      forEntity.push(state);
      states.set(state.entity_id, forEntity);
    }
    return states;
  }

  private assertChange(change: EpisodeUnresolvedStateTransition): void {
    if (!this.context.entities.some((entity) => entity.id === change.entityId)
      || !this.context.pages.some((page) => page.panels.some((panel) => panel.id === change.startsAtPanelId))) {
      throw new ValidationError('Episode state change references an unknown entity or panel');
    }
    if (change.candidateStateId !== null && !this.context.stateLibrary?.some((state) =>
      state.stateId === change.candidateStateId && state.entityId === change.entityId)) {
      throw new ValidationError('Episode state candidate does not belong to the entity');
    }
    assertBoundedLiteral(change.suggestedName, 100, 'Episode state name is invalid');
    assertBoundedLiteral(change.suggestedDescription, 2_000, 'Episode state description is invalid');
    assertBoundedLiteral(change.sourceQuote, MAX_EPISODE_STATE_SOURCE_QUOTE_CHARS, 'Episode state quote is invalid');
    if (!normalizeSourceText(change.sourceQuote).includes(normalizeSourceText(change.suggestedDescription))) {
      throw new ValidationError('Episode state description is not source-backed');
    }
    const source = sourceText(this.context, change.sourceField, change.sourceSceneId);
    if (source === null || !normalizeSourceText(source).includes(normalizeSourceText(change.sourceQuote))) {
      throw new ValidationError('Episode state quote is not present in the saved story');
    }
  }

  private toPersisted(
    change: EpisodeUnresolvedStateTransition,
    stateId: string,
    created: boolean,
  ): PersistedEpisodeStateChange {
    return {
      entityId: change.entityId, stateId, startsAtPanelId: change.startsAtPanelId,
      sourceSceneId: change.sourceSceneId, sourceField: change.sourceField,
      sourceQuote: change.sourceQuote.trim(), description: change.suggestedDescription.trim(), created,
      ...(change.panelEvidenceQuote === undefined ? {} : { panelEvidenceQuote: change.panelEvidenceQuote }),
      ...(change.replacesDeltas === undefined ? {} : { replacesDeltas: change.replacesDeltas }),
    };
  }
}

function assertBoundedLiteral(value: string, max: number, message: string): void {
  if (value.trim().length === 0 || value.length > max) throw new ValidationError(message);
}

function sourceText(context: EpisodePagePlanContext, field: EpisodeStateTransitionSourceField, sceneId: string | null): string | null {
  if (field.startsWith('scene_')) {
    const scene = context.scenes.find((item) => item.id === sceneId);
    if (scene === undefined) return null;
    if (field === 'scene_location') return scene.location;
    if (field === 'scene_time') return scene.time;
    return scene.atmosphere;
  }
  if (sceneId !== null) return null;
  if (field === 'story_full_draft') return context.episode.storyFullDraft ?? null;
  if (field === 'introduction') return context.episode.introduction;
  if (field === 'middle') return context.episode.middle;
  if (field === 'climax') return context.episode.climax;
  return context.episode.endingHook;
}

function normalizeSourceText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}
