import { describe, expect, it } from 'vitest';
import { hasMatchingCharacterState, hasMatchingSourceBackedState } from '../../../../src/domain/entity/CharacterStateIdentity.js';

describe('CharacterStateIdentity', () => {
  it('同じ引用に複数の変化があっても別の差分を重複扱いにしない', () => {
    const states = [{ name: '負傷', description: '左頬に赤い傷', sourceQuote: 'ミオの左頬に赤い傷があり、右目が青く光る。' }];
    expect(hasMatchingSourceBackedState(states, {
      name: '発光', description: '右目が青く光る', sourceQuote: 'ミオの左頬に赤い傷があり、右目が青く光る。',
    })).toBe(false);
  });

  it('名称が言い換えられても引用と差分が一致すればdraftを再利用する', () => {
    const states = [{ name: '負傷', description: '左頬に赤い傷', sourceQuote: 'ミオの左頬に赤い傷があり、右目が青く光る。' }];
    expect(hasMatchingSourceBackedState(states, {
      name: '頬の異変', description: '左頬に赤い傷', sourceQuote: '左頬に赤い傷',
    })).toBe(true);
    expect(hasMatchingCharacterState(states, {
      name: '負傷', description: '左頬に赤い傷', sourceQuote: '別の引用',
    })).toBe(true);
  });

  it('同一引用でも既存差分の上位集合は別draftとして扱う', () => {
    const states = [{ name: '負傷', description: '左頬に赤い傷', sourceQuote: 'ミオの左頬に赤い傷があり、右目が青く光る。' }];
    expect(hasMatchingSourceBackedState(states, {
      name: '負傷と発光', description: '左頬に赤い傷があり、右目が青く光る', sourceQuote: 'ミオの左頬に赤い傷があり、右目が青く光る。',
    })).toBe(false);
  });
});
