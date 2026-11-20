import { describe, expect, it } from 'vitest';
import { characterAutofillResultSchema, characterAutofillWithReviewResultSchema } from '../../../../packages/api-contract/src/characterAutofill.js';
import { applyAppearanceChoice, readCharacterAppearanceChoice } from '../../../../src/services/entity/CharacterAppearanceReview.js';

describe('自動入力で見つかった空欄候補の確認', () => {
  it('ユーザーが選んだ空欄だけを埋め、旧形式の独自項目と元の値を保持する', () => {
    const before = { hair_color: 'black', eyes: { shape: 'round' }, historical: { title: '作者メモ' } };
    expect(applyAppearanceChoice(before, 'eyes.color', 'green')).toEqual({
      ...before, eyes: { shape: 'round', color: 'green' },
    });
    expect(before.eyes).toEqual({ shape: 'round' });
    expect(readCharacterAppearanceChoice(before, 'hair.color')).toBe('black');
  });

  it('手入力や旧形式の選択が存在する場合は上書きしない', () => {
    for (const before of [{ eyes: { color: '翡翠' } }, { eye_color: 'blue' }, { eyes: '旧形式の目の記録' }]) {
      expect(() => applyAppearanceChoice(before, 'eyes.color', 'green')).toThrow();
    }
  });

  it('存在しない項目名、色、空の選択やcustomの場合は拒否する', () => {
    for (const [field,value] of [['constructor.prototype', 'test'], ['eyes.color','custom'], ['eyes.color',''], ['eyes.color','unknown']]) {
      expect(() => applyAppearanceChoice({}, field, value)).toThrow();
    }
  });

  it('確認対応クライアントは旧応答も受け取り、旧クライアントの応答契約を維持する', () => {
    const old = { version: 1, characters: [], skipped_names: [] };
    const reviewed = { ...old, appearance_review: { unresolved: [{quote:'瞳は緑。',reason:'ambiguous_character'}],suggestions:[] } };
    expect(characterAutofillWithReviewResultSchema.parse(old)).toEqual(old);
    expect(characterAutofillWithReviewResultSchema.parse(reviewed)).toEqual(reviewed);
    expect(characterAutofillResultSchema.safeParse(reviewed).success).toBe(false);
  });
});
