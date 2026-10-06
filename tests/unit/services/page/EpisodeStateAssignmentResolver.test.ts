import { describe, expect, it } from 'vitest';
import type { PanelEntityAssignment } from '../../../../src/domain/types/panelEntityAssignment.js';
import {
  resolveEpisodeStateAssignments,
  EpisodeStatePlanError,
  type EpisodeStatePanel,
  type ResolveEpisodeStateAssignmentsInput,
} from '../../../../src/services/page/EpisodeStateAssignmentResolver.js';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const INJURED = '33333333-3333-4333-8333-333333333333';

function assignment(entityId: string, stateId: string | null = null): PanelEntityAssignment {
  return {
    entityId,
    role: 'primary',
    expression: 'calm',
    customExpression: null,
    action: 'standing_firm',
    customAction: null,
    position: 'center',
    facingDirection: null,
    effectNote: null,
    stateId,
  };
}

function panel(pageNumber: number, order: number, entities: PanelEntityAssignment[]): EpisodeStatePanel {
  return {
    panelId: `p${pageNumber}-${order}`,
    pageNumber,
    order,
    assignments: entities,
  };
}

function transition(startsAtPanelId: string, stateId: string | null) {
  return {
    entityId: ACTOR,
    stateId,
    startsAtPanelId,
    sourceSceneId: null,
    sourceField: 'middle' as const,
    sourceQuote: stateId === null ? '傷が治った' : '腕を負傷した',
  };
}

describe('resolveEpisodeStateAssignments', () => {
  it('同じsceneの途中で負傷した場合に不在のコマを越えて継続し回復境界から既定へ戻る', () => {
    const panels = [
      panel(1, 1, [assignment(ACTOR), assignment(OTHER)]),
      panel(1, 2, [assignment(ACTOR)]),
      panel(1, 3, [assignment(ACTOR)]),
      panel(2, 1, [assignment(OTHER)]),
      panel(2, 2, [assignment(ACTOR)]),
      panel(3, 1, [assignment(ACTOR)]),
      panel(3, 2, [assignment(ACTOR), assignment(OTHER)]),
    ];
    const resolved = resolveEpisodeStateAssignments({
      panels,
      startingStates: [],
      transitions: [transition('p1-3', INJURED), transition('p3-2', null)],
      policy: 'overwrite_existing',
    });

    expect(resolved.map((entry) => entry.assignments.find((item) => item.entityId === ACTOR)?.stateId))
      .toEqual([null, null, INJURED, undefined, INJURED, INJURED, null]);
    expect(resolved[0]?.assignments.find((item) => item.entityId === OTHER)?.stateId).toBeNull();
    expect(resolved[6]?.assignments.find((item) => item.entityId === OTHER)?.stateId).toBeNull();
    expect(panels[2]?.assignments[0]?.stateId).toBeNull();
  });

  it('話の開始状態が指定された場合に最初のコマから適用する', () => {
    const resolved = resolveEpisodeStateAssignments({
      panels: [panel(1, 1, [assignment(ACTOR)]), panel(1, 2, [assignment(ACTOR)])],
      startingStates: [{ entityId: ACTOR, stateId: INJURED }],
      transitions: [],
      policy: 'overwrite_existing',
    });
    expect(resolved.map((entry) => entry.assignments[0]?.stateId)).toEqual([INJURED, INJURED]);
  });

  it('既存の手動割当と異なる場合に明示上書きがなければ全体を拒否する', () => {
    expect(() => resolveEpisodeStateAssignments({
      panels: [panel(1, 1, [assignment(ACTOR, INJURED)])],
      startingStates: [],
      transitions: [],
      policy: 'preserve_existing',
      existingAssignmentsByPanelId: new Map([['p1-1', [assignment(ACTOR, INJURED)]]]),
    })).toThrowError(EpisodeStatePlanError);
  });

  it('既存割当の完全なsnapshotが無い場合に保護モードで処理を拒否する', () => {
    const incomplete = {
      panels: [panel(1, 1, [assignment(ACTOR)])],
      startingStates: [],
      transitions: [],
      policy: 'preserve_existing',
    } as unknown as ResolveEpisodeStateAssignmentsInput;
    expect(() => resolveEpisodeStateAssignments(incomplete)).toThrowError(EpisodeStatePlanError);
    expect(() => resolveEpisodeStateAssignments({
      panels: [panel(1, 1, [assignment(ACTOR)])],
      startingStates: [],
      transitions: [],
      policy: 'preserve_existing',
      existingAssignmentsByPanelId: new Map(),
    })).toThrowError(EpisodeStatePlanError);
  });

  it('存在しない境界panelと同一人物の同一境界重複を拒否する', () => {
    const panels = [panel(1, 1, [assignment(ACTOR)])];
    expect(() => resolveEpisodeStateAssignments({
      panels,
      startingStates: [],
      transitions: [transition('missing', INJURED)],
      policy: 'overwrite_existing',
    })).toThrowError(EpisodeStatePlanError);
    expect(() => resolveEpisodeStateAssignments({
      panels,
      startingStates: [],
      transitions: [transition('p1-1', INJURED), transition('p1-1', null)],
      policy: 'overwrite_existing',
    })).toThrowError(EpisodeStatePlanError);
  });
});
