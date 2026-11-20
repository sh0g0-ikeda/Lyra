import { describe, expect, it } from 'vitest';
import { buildCharacterAutofillCandidates } from '../../../../src/services/story/CharacterAutofillFields.js';

describe('ストーリーからキャラクター編集欄へ自動入力', () => {
  it('複数人が同じ文にいる場合も根拠ごとに選択肢を振り分ける', () => {
    const story = '黒髪のアキと金髪のユイが出会う。アキは制服姿でポニーテール。ユイの目は青紫色。';
    const result = buildCharacterAutofillCandidates([story], [
      { name: 'アキ', name_quote: '黒髪のアキ', entity_type: 'character', appearance: [
        { field: 'hair.color', value: '黒髪', quote: '黒髪のアキ' },
        { field: 'clothing.category', value: '制服', quote: '制服姿' },
        { field: 'hair.length', value: 'ポニーテール', quote: 'アキは制服姿でポニーテール' },
        { field: 'hair.style', value: 'ポニーテール', quote: 'アキは制服姿でポニーテール' },
      ], changes: [] },
      { name: 'ユイ', name_quote: '金髪のユイ', entity_type: 'character', appearance: [
        { field: 'hair.color', value: '金髪', quote: '金髪のユイ' },
        { field: 'eyes.color', value: '青紫色', quote: 'ユイの目は青紫色' },
        { field: 'hair.length', value: '黒髪', quote: '黒髪のアキと金髪のユイ' },
      ], changes: [] },
    ]);
    expect(result.map(c => c.structuredFields)).toEqual([
      { hair: { color: 'black', arrangement: 'ponytail' }, clothing: { category: 'school' } },
      { hair: { color: 'blonde' }, eyes: { color: '青紫色' } },
    ]);
  });
  it('年齢と服装の詳細に一致する選択肢がある場合は保存用の値にする', () => {
    const story = 'ユイは17歳。ユイは半袖でローファーを履く。';
    const [row] = buildCharacterAutofillCandidates([story], [{
      name: 'ユイ', entity_type: 'character', name_quote: 'ユイは17歳', appearance: [
        { field: 'age_range', value: '17歳', quote: 'ユイは17歳' },
        { field: 'outfit_detail.sleeve_length', value: '半袖', quote: '半袖' },
        { field: 'outfit_detail.shoes', value: 'ローファー', quote: 'ローファー' },
      ], changes: [],
    }]);
    expect(row?.structuredFields).toEqual({ age_range: 'late_teens', outfit_detail: { sleeve_length: 'short sleeves', shoes: 'loafers' } });
  });

  it('短い引用が他人の文にも出る場合は服の色を推測しない', () => {
    const story = 'ハルは赤い服。サキも赤い服。';
    const rows = buildCharacterAutofillCandidates([story], ['ハル', 'サキ'].map(name => ({
      name, entity_type: 'character', name_quote: name, appearance: [{field:'clothing.main_color', value:'赤い', quote:'赤い服'}], changes: [],
    })));
    expect(rows.map(row => row.structuredFields)).toEqual([{}, {}]);
  });

  it('二人ともと明記された服だけ両者に入力し、片方だけの髪色を伝播させない', () => {
    const story = 'アキとユイは二人とも制服だが、アキだけは黒髪。';
    const rows = buildCharacterAutofillCandidates([story], ['アキ', 'ユイ'].map(name => ({
      name, entity_type: 'character', name_quote: name, appearance: [
        { field: 'clothing.category', value: '制服', quote: story },
        { field: 'hair.color', value: '黒髪', quote: story },
      ], changes: [],
    })));
    expect(rows.map(row => row.structuredFields)).toEqual([{ clothing: { category: 'school' }, hair: { color: 'black' } }, { clothing: { category: 'school' } }]);
  });

  it('明記された部位数、色、移動方法を人外の欄に残し、仮定と無名の役割を除く', () => {
    const line = 'ルゥは青いしずく形で、赤い角が二本、金色の目が三つある。ルゥは四足歩行。もしルゥが巨大なら目立つ。通行人が来る。';
    const result = buildCharacterAutofillCandidates([line], [
      { name: 'ルゥ', entity_type: 'nonhuman', name_quote: 'ルゥは青いしずく形', appearance: [
        ...['青いしずく形', '赤い角が二本', '金色の目が三つ'].map(value => ({
          field: 'distinctive_features' as const, value, quote: 'ルゥは青いしずく形で、赤い角が二本、金色の目が三つある。',
        })),
        { field: 'movement', value: '四足歩行', quote: 'ルゥは四足歩行。' },
        { field: 'size', value: '巨大', quote: 'もしルゥが巨大なら目立つ。' },
      ], changes: [] },
      { name: '通行人', name_quote: '通行人が来る', entity_type: 'character', appearance: [], changes: [] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.structuredFields).toEqual({ distinctive_features: '青いしずく形 / 赤い角が二本 / 金色の目が三つ', movement: 'quadruped' });
  });
  it('プリセットにない人外の基本形は自由入力として保存し、状態名には変化の内容を使う', () => {
    const source = ['ルゥは青いしずく形の生き物。ルゥの左腕に赤い模様が現れる。もしルゥが巨大なら驚くだろう。'];
    const [result] = buildCharacterAutofillCandidates(source, [{
      name: 'ルゥ', entity_type: 'nonhuman', name_quote: 'ルゥは青いしずく形', appearance: [
        { field: 'base_form', value: '青いしずく形', quote: 'ルゥは青いしずく形' },
        { field: 'size', value: '巨大', quote: 'ルゥが巨大' },
      ], changes: [{ name: 'ルゥ', description: '左腕に赤い模様が現れる', quote: 'ルゥの左腕に赤い模様が現れる' }],
    }]);
    expect(result?.structuredFields).toEqual({ base_form: 'custom', distinctive_features: '青いしずく形' });
    expect(result?.changes[0]?.name).toBe('左腕に赤い模様が現れる');
  });
});
