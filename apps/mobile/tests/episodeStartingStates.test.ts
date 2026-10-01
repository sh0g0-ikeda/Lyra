import { describe, expect, it } from 'vitest';
import { addStartingEntityState, startingStateDraftIsDirty, startingStateSavePatch } from '@/domain/episodeStartingStates';

describe('話の開始状態の互換保存', () => {
  it('未操作では開始状態fieldを省略し、明示リセットでは空配列を送る', () => {
    expect(startingStateSavePatch(undefined)).toEqual({});
    expect(startingStateSavePatch([])).toEqual({ starting_entity_states: [] });
    expect(startingStateDraftIsDirty(undefined, undefined)).toBe(false);
    expect(startingStateDraftIsDirty(undefined, [])).toBe(true);
  });
  it('明示defaultのnullを保持し、同じ保存値ではdirtyにしない', () => {
    const saved = [{ entity_id: 'entity', state_id: null }];
    expect(startingStateSavePatch(saved)).toEqual({ starting_entity_states: saved });
    expect(startingStateDraftIsDirty(saved, saved)).toBe(false);
    expect(startingStateDraftIsDirty(saved, [{ entity_id: 'entity', state_id: 'injured' }])).toBe(true);
  });
  it('新規行はdefaultとなり同じ人物を重複追加しない', () => {
    const value = addStartingEntityState([], 'entity');
    expect(value).toEqual([{ entity_id: 'entity', state_id: null }]);
    expect(addStartingEntityState(value, 'entity')).toBe(value);
  });
  it('上限100件で追加を止め、不明な既存状態を勝手に削除しない', () => {
    const value = Array.from({ length: 100 }, (_, index) => ({ entity_id: `e${index}`, state_id: 'legacy-state' }));
    expect(addStartingEntityState(value, 'new')).toBe(value);
    expect(startingStateSavePatch(value).starting_entity_states).toEqual(value);
    expect(startingStateSavePatch(value).starting_entity_states).not.toBe(value);
  });
});
