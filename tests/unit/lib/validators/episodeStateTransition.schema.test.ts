import { describe, expect, it } from 'vitest';
import {
  episodeStateTransitionPlanSchema,
  toEpisodeStateTransitionPlan,
} from '../../../../src/lib/validators/episodeStateTransition.schema.js';

const EVENT = {
  entity_id: '11111111-1111-4111-8111-111111111111',
  state_id: '22222222-2222-4222-8222-222222222222',
  starts_at_panel_id: '33333333-3333-4333-8333-333333333333',
  source_scene_id: null,
  source_field: 'middle',
  source_quote: '腕を負傷した',
};

describe('episodeStateTransitionPlanSchema', () => {
  it('version付きの状態変化をbounded JSONとして受理し内部型へ変換する', () => {
    const parsed = episodeStateTransitionPlanSchema.parse({
      plan_version: 'episode_state_plan_v1',
      state_transitions: [EVENT],
      unresolved_state_transitions: [],
    });
    expect(toEpisodeStateTransitionPlan(parsed).transitions[0]).toMatchObject({
      entityId: EVENT.entity_id,
      stateId: EVENT.state_id,
      startsAtPanelId: EVENT.starts_at_panel_id,
      sourceQuote: EVENT.source_quote,
    });
  });

  it('不明なIDと300文字超の根拠引用を拒否する', () => {
    expect(episodeStateTransitionPlanSchema.safeParse({
      plan_version: 'episode_state_plan_v1',
      state_transitions: [{ ...EVENT, entity_id: 'unknown' }],
      unresolved_state_transitions: [],
    }).success).toBe(false);
    expect(episodeStateTransitionPlanSchema.safeParse({
      plan_version: 'episode_state_plan_v1',
      state_transitions: [{ ...EVENT, source_quote: '傷'.repeat(301) }],
      unresolved_state_transitions: [],
    }).success).toBe(false);
  });

  it('512件を超える提案と余分な出力fieldを拒否する', () => {
    expect(episodeStateTransitionPlanSchema.safeParse({
      plan_version: 'episode_state_plan_v1',
      state_transitions: Array.from({ length: 513 }, () => EVENT),
      unresolved_state_transitions: [],
    }).success).toBe(false);
    expect(episodeStateTransitionPlanSchema.safeParse({
      plan_version: 'episode_state_plan_v1',
      state_transitions: [EVENT],
      unresolved_state_transitions: [],
      secret: 'should-not-pass',
    }).success).toBe(false);
  });

  it('未解決候補の既存state IDを保持し不正なIDを拒否する', () => {
    const unresolved = {
      entity_id: EVENT.entity_id,
      starts_at_panel_id: EVENT.starts_at_panel_id,
      source_scene_id: null,
      source_field: 'middle',
      source_quote: '腕を負傷した',
      candidate_state_id: EVENT.state_id,
      suggested_name: '負傷',
      suggested_description: '腕に包帯',
      reason: 'missing_reference',
    };
    const payload = {
      plan_version: 'episode_state_plan_v1',
      state_transitions: [],
      unresolved_state_transitions: [unresolved],
    };
    expect(toEpisodeStateTransitionPlan(episodeStateTransitionPlanSchema.parse(payload)).unresolved[0])
      .toMatchObject({ candidateStateId: EVENT.state_id });
    expect(episodeStateTransitionPlanSchema.safeParse({
      ...payload,
      unresolved_state_transitions: [{ ...unresolved, candidate_state_id: 'bad' }],
    }).success).toBe(false);
  });
});
