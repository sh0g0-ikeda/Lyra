import { describe, expect, it } from 'vitest';

import { buildPageEntityStateOptions } from '@/domain/pageEntityStateOptions';
import type { EntityStateRecord } from '@/domain/types';

const entityId = '11111111-1111-4111-8111-111111111111';

const state = (
  id: string,
  ownerEntityId: string,
  overrides: Partial<EntityStateRecord> = {}
): EntityStateRecord => ({
  id,
  entity_id: ownerEntityId,
  scene_id: null,
  costume_note: null,
  costume_ref_id: null,
  condition_note: null,
  hair_note: null,
  expression_default: '',
  extra_note: null,
  created_at: '2026-07-24T00:00:00.000Z',
  ...overrides
});

describe('pageEntityStateOptions', () => {
  it('状態なしを先頭に置き対象キャラクターの状態だけを候補にする', () => {
    const options = buildPageEntityStateOptions({
      entityId,
      language: 'ja',
      states: [
        state('22222222-2222-4222-8222-222222222222', entityId, {
          costume_note: '制服',
          condition_note: '右腕に包帯'
        }),
        state(
          '33333333-3333-4333-8333-333333333333',
          '44444444-4444-4444-8444-444444444444',
          { costume_note: '別キャラクターの衣装' }
        )
      ]
    });

    expect(options).toEqual([
      { id: '', label: '状態指定なし' },
      {
        id: '22222222-2222-4222-8222-222222222222',
        label: '服装: 制服 / 状態: 右腕に包帯'
      }
    ]);
  });

  it('説明が空の状態は順番が分かるラベルにする', () => {
    const options = buildPageEntityStateOptions({
      entityId,
      language: 'en',
      states: [
        state('55555555-5555-4555-8555-555555555555', entityId),
        state('66666666-6666-4666-8666-666666666666', entityId, {
          hair_note: 'ponytail'
        })
      ]
    });

    expect(options.map((option) => option.label)).toEqual([
      'No state override',
      'State 1',
      'Hair: ponytail'
    ]);
  });
});
