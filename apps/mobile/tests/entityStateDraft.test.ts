import { describe, expect, it } from 'vitest';
import {
  buildEntityStateCreate,
  buildEntityStateUpdate,
  createEntityStateDraft,
  emptyEntityStateDraft,
  hasRemoteEntityStateChanged,
  isEntityStateDraftDirty,
} from '../src/domain/entityStateDraft';
import type { EntityStateRecord } from '../src/lib/api';

describe('entityStateDraft', () => {
  it('保存済みstateからcostume refを編集対象へ混ぜずdraftを作る', () => {
    expect(createEntityStateDraft(buildState())).toEqual({
      scene_id: '66666666-6666-4666-8666-666666666666',
      costume_note: '黒い外套',
      condition_note: '左腕を負傷',
      hair_note: '雨で濡れている',
      expression_default: 'determined',
      extra_note: '杖を右手に持つ',
    });
  });

  it('新規stateをtrim・nullable正規化しcostume_ref_idなしで作る', () => {
    expect(buildEntityStateCreate({
      ...emptyEntityStateDraft(),
      scene_id: '66666666-6666-4666-8666-666666666666',
      costume_note: '  黒い外套  ',
      condition_note: '   ',
      expression_default: '  calm  ',
    })).toEqual({
      ok: true,
      payload: {
        scene_id: '66666666-6666-4666-8666-666666666666',
        costume_note: '黒い外套',
        condition_note: null,
        hair_note: null,
        expression_default: 'calm',
        extra_note: null,
      },
    });
  });

  it('更新は変更fieldだけを送り空白はnullでclearする', () => {
    const saved = createEntityStateDraft(buildState());

    expect(buildEntityStateUpdate(saved, {
      ...saved,
      costume_note: '   ',
      hair_note: '  乾いた短髪  ',
    })).toEqual({
      ok: true,
      payload: {
        costume_note: null,
        hair_note: '乾いた短髪',
      },
    });
    expect(buildEntityStateUpdate(saved, {
      ...saved,
      costume_note: `  ${saved.costume_note}  `,
    })).toEqual({ ok: true, payload: {} });
    expect(isEntityStateDraftDirty(saved, saved)).toBe(false);
  });

  it.each([
    ['costume_note_too_long', { costume_note: 'x'.repeat(2_001) }],
    ['condition_note_too_long', { condition_note: 'x'.repeat(2_001) }],
    ['hair_note_too_long', { hair_note: 'x'.repeat(2_001) }],
    ['expression_required', { expression_default: '   ' }],
    ['expression_too_long', { expression_default: 'x'.repeat(101) }],
    ['extra_note_too_long', { extra_note: 'x'.repeat(2_001) }],
  ] as const)('%sはnetwork前に拒否する', (reason, update) => {
    const draft = { ...emptyEntityStateDraft(), ...update };

    expect(buildEntityStateCreate(draft)).toEqual({ ok: false, reason });
  });

  it('表示対象のremote変更とidentity変更を競合として扱う', () => {
    const saved = buildState();

    expect(hasRemoteEntityStateChanged(saved, { ...saved })).toBe(false);
    expect(hasRemoteEntityStateChanged(saved, {
      ...saved,
      costume_note: '別の外套',
    })).toBe(true);
    expect(hasRemoteEntityStateChanged(saved, {
      ...saved,
      costume_ref_id: 'remote-reference',
    })).toBe(true);
    expect(hasRemoteEntityStateChanged(saved, {
      ...saved,
      scene_id: null,
    })).toBe(true);
    expect(hasRemoteEntityStateChanged(saved, {
      ...saved,
      entity_id: '77777777-7777-4777-8777-777777777777',
    })).toBe(true);
  });
});

function buildState(): EntityStateRecord {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    entity_id: '55555555-5555-4555-8555-555555555555',
    scene_id: '66666666-6666-4666-8666-666666666666',
    costume_note: '黒い外套',
    costume_ref_id: 'reference-1',
    condition_note: '左腕を負傷',
    hair_note: '雨で濡れている',
    expression_default: 'determined',
    extra_note: '杖を右手に持つ',
    created_at: '2026-08-01T00:00:00.000Z',
  };
}
