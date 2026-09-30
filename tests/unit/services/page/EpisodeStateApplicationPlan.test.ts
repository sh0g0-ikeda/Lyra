import { describe, expect, it } from 'vitest';
import type { PanelEntityAssignment } from '../../../../src/domain/types/panelEntityAssignment.js';
import { EpisodeStatePlanError } from '../../../../src/services/page/EpisodeStateAssignmentResolver.js';
import { resolveEpisodePlanStateAssignments } from '../../../../src/services/page/EpisodeStateApplicationPlan.js';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const INJURED = '22222222-2222-4222-8222-222222222222';
const MANUAL = '55555555-5555-4555-8555-555555555555';
const FIRST = '33333333-3333-4333-8333-333333333333';
const SECOND = '44444444-4444-4444-8444-444444444444';

function assignment(stateId: string | null): PanelEntityAssignment {
  return {
    entityId: ACTOR, role: 'primary', expression: 'calm', customExpression: null,
    action: 'standing_firm', customAction: null, position: 'center', facingDirection: null,
    effectNote: null, stateId,
  };
}

function input(policy: 'preserve_existing' | 'overwrite_existing') {
  return {
    pages: [{
      pageId: 'page-1', pageNumber: 1,
      panels: [
        { id: FIRST, order: 1, entities: [assignment(null)] },
        { id: SECOND, order: 2, entities: [assignment(null)] },
      ],
    }],
    suggestion: { pages: [{
      pageId: 'page-1', pageNumber: 1,
      panels: [{ order: 1, entities: [assignment(null)] }, { order: 2, entities: [assignment(null)] }],
    }] },
    startingStates: [],
    transitions: [{
      entityId: ACTOR, stateId: INJURED, startsAtPanelId: SECOND,
      sourceSceneId: null, sourceField: 'middle' as const, sourceQuote: '負傷',
    }],
    policy,
  };
}

describe('resolveEpisodePlanStateAssignments', () => {
  it('同じページの途中から状態を切り替え最終assignmentsをpanel IDに対応させる', () => {
    const result = resolveEpisodePlanStateAssignments(input('overwrite_existing'));
    expect(result.get(FIRST)?.[0]?.stateId).toBeNull();
    expect(result.get(SECOND)?.[0]?.stateId).toBe(INJURED);
  });

  it('手動状態が計画と違う場合は上書き指定まで全体を拒否する', () => {
    const request = input('preserve_existing');
    request.pages[0]!.panels[1]!.entities[0]!.stateId = MANUAL;
    request.suggestion.pages[0]!.panels[1]!.entities[0]!.stateId = null;
    expect(() => resolveEpisodePlanStateAssignments(request)).toThrowError(EpisodeStatePlanError);
    expect(resolveEpisodePlanStateAssignments({ ...request, policy: 'overwrite_existing' }).get(SECOND)?.[0]?.stateId)
      .toBe(INJURED);
  });
});
