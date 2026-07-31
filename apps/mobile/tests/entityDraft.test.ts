import { describe, expect, it } from 'vitest';
import {
  buildCreateEntityInput,
  buildUpdateEntityInput,
  createEntityDraft,
  emptyEntityDraft,
  isEntityDraftDirty,
} from '../src/domain/entityDraft';

const savedEntity = {
  id: 'entity-1',
  work_id: 'work-1',
  entity_type: 'character' as const,
  name: 'ホームズ',
  free_description: null,
  structured_fields: { age_range: '成人' },
  prompt_supplement: 'hidden prompt',
  speech_profile: { tone: 'calm' },
  status: 'ready' as const,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

describe('entity draft', () => {
  it('新規キャラはtrim済み名前とnull説明だけを最小payloadにする', () => {
    expect(buildCreateEntityInput({
      entityType: 'nonhuman',
      name: '  魔犬  ',
      freeDescription: '',
    })).toEqual({
      ok: true,
      input: {
        entity_type: 'nonhuman',
        name: '魔犬',
        free_description: null,
      },
    });
  });

  it('既存キャラ更新は変更された表示項目だけを送りhidden fieldsと種類を含めない', () => {
    expect(buildUpdateEntityInput(savedEntity, {
      entityType: 'character',
      name: 'シャーロック・ホームズ',
      freeDescription: '探偵',
    })).toEqual({
      ok: true,
      input: {
        name: 'シャーロック・ホームズ',
        free_description: '探偵',
      },
    });
  });

  it('nullと空文字を同一視し、実質変更がなければdirtyにも更新にもならない', () => {
    const draft = createEntityDraft(savedEntity);
    expect(draft).toEqual({
      entityType: 'character',
      name: 'ホームズ',
      freeDescription: '',
    });
    expect(isEntityDraftDirty(savedEntity, draft)).toBe(false);
    expect(buildUpdateEntityInput(savedEntity, draft)).toEqual({
      ok: false,
      reason: 'no_changes',
    });
  });

  it('名前100文字と説明2000文字を受理し、各上限超過を拒否する', () => {
    expect(buildCreateEntityInput({
      ...emptyEntityDraft(),
      name: '名'.repeat(100),
      freeDescription: '説'.repeat(2_000),
    }).ok).toBe(true);
    expect(buildCreateEntityInput({
      ...emptyEntityDraft(),
      name: '名'.repeat(101),
    })).toEqual({ ok: false, reason: 'name_too_long' });
    expect(buildCreateEntityInput({
      ...emptyEntityDraft(),
      name: '名前',
      freeDescription: '説'.repeat(2_001),
    })).toEqual({ ok: false, reason: 'description_too_long' });
  });

  it('空白だけの名前を拒否する', () => {
    expect(buildCreateEntityInput({
      ...emptyEntityDraft(),
      name: '   ',
    })).toEqual({ ok: false, reason: 'name_required' });
  });
});
