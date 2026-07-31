import { describe, expect, it } from 'vitest';
import {
  buildSceneUpdate,
  createSceneDraft,
  isSceneDraftDirty,
} from '../src/domain/sceneDraft';

const scene = {
  id: '66666666-6666-4666-8666-666666666666',
  episode_id: '44444444-4444-4444-8444-444444444444',
  order: 1,
  location: 'ローリストン・ガーデン',
  time: null,
  atmosphere: '不穏',
  involved_entity_ids: ['77777777-7777-4777-8777-777777777777'],
  entity_states: [],
  status: 'ready' as const,
  created_at: '2026-07-31T00:00:00.000Z',
  updated_at: '2026-07-31T00:00:00.000Z',
};

describe('scene draft', () => {
  it('保存済みの場所・時間・雰囲気だけをdraftへ変換する', () => {
    expect(createSceneDraft(scene)).toEqual({
      atmosphere: '不穏',
      location: 'ローリストン・ガーデン',
      time: '',
    });
  });

  it('空白差を正規化し変更fieldだけをpayloadへ含める', () => {
    const saved = createSceneDraft(scene);
    expect(isSceneDraftDirty(saved, { ...saved, location: '  ローリストン・ガーデン  ' })).toBe(false);
    expect(buildSceneUpdate(saved, {
      atmosphere: '  ',
      location: 'ベーカー街',
      time: '夜',
    })).toEqual({
      ok: true,
      payload: {
        atmosphere: null,
        location: 'ベーカー街',
        time: '夜',
      },
    });
  });

  it('200文字を超えるfieldを拒否し既存値を送らない', () => {
    const saved = createSceneDraft(scene);
    expect(buildSceneUpdate(saved, { ...saved, location: 'あ'.repeat(201) })).toEqual({
      ok: false,
      reason: 'location_too_long',
    });
  });
});
