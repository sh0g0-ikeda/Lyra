import { describe, expect, it } from 'vitest';
import { resolveEpisodeEntityStates } from '../../../../src/domain/story/resolveEpisodeEntityStates.js';

describe('resolveEpisodeEntityStates', () => {
  it('開始状態から読順のtransitionを継続し、nullでdefaultへ戻す', () => {
    expect(resolveEpisodeEntityStates({
      panels: [{ id: 'p1', entityIds: ['a'] }, { id: 'p2', entityIds: ['a'] }, { id: 'p3', entityIds: [] }, { id: 'p4', entityIds: ['a'] }, { id: 'p5', entityIds: ['a'] }],
      startingStates: [{ entityId: 'a', stateId: null }],
      states: [{ id: 'injured', entityId: 'a', confirmed: true }],
      transitions: [{ entityId: 'a', stateId: 'injured', startsAtPanelId: 'p2' }, { entityId: 'a', stateId: null, startsAtPanelId: 'p5' }],
      existingAssignments: [],
      overwriteExisting: false,
    })).toEqual({ apply: true, assignments: [{ panelId: 'p2', entityId: 'a', stateId: 'injured' }, { panelId: 'p4', entityId: 'a', stateId: 'injured' }, { panelId: 'p5', entityId: 'a', stateId: null }], blockers: [] });
  });

  it('不明または未確定state、手動衝突、同境界重複、512超過は全話へapplyしない', () => {
    const base = { panels: [{ id: 'p1', entityIds: ['a'] }], startingStates: [], states: [], existingAssignments: [], overwriteExisting: false };
    for (const transitions of [
      [{ entityId: 'a', stateId: 'missing', startsAtPanelId: 'p1' }],
      [{ entityId: 'a', stateId: null, startsAtPanelId: 'missing' }],
      Array.from({ length: 513 }, () => ({ entityId: 'a', stateId: null, startsAtPanelId: 'p1' })),
    ]) expect(resolveEpisodeEntityStates({ ...base, transitions })).toMatchObject({ apply: false, assignments: [] });
    expect(resolveEpisodeEntityStates({ ...base, transitions: [{ entityId: 'a', stateId: null, startsAtPanelId: 'p1' }], existingAssignments: [{ panelId: 'p1', entityId: 'a', stateId: 'old' }] })).toMatchObject({ apply: false });
  });
});
