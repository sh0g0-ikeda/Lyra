import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { CharacterOutfitField } from '@/components/CharacterOutfitField';
import { mergeCharacterClothingDescription } from '@/domain/characterClothing';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'view',
}));

vi.mock('@/components/FormField', () => ({
  FormField: ({
    help,
    label,
    value,
  }: {
    help: string;
    label: string;
    value: string;
  }) => React.createElement('field', { help, value }, label),
}));

describe('CharacterOutfitField', () => {
  it('服装の細部は細分選択を重ねず自然言語の自由入力だけを表示する', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <CharacterOutfitField
          language="ja"
          onChange={vi.fn()}
          value="黒いロングコート"
        />,
      );
    });

    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain('服の詳細');
    expect(rendered).toContain('服の形、素材、色、靴などを自然な文章で書いてください');
    expect(rendered).not.toContain('襟の形');
    expect(rendered).not.toContain('袖丈');
    expect(rendered).not.toContain('靴下');
  });

  it('詳細payloadはdescriptionだけを書き既存の大分類値を変更せず保持する', () => {
    expect(mergeCharacterClothingDescription({}, '黒いロングコート')).toEqual({
      description: '黒いロングコート',
    });
    expect(
      mergeCharacterClothingDescription(
        { category: 'legacy', main_color: 'black' },
        '黒いロングコート',
      ),
    ).toEqual({
      category: 'legacy',
      description: '黒いロングコート',
      main_color: 'black',
    });
  });
});
