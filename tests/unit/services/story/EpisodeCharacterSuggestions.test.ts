import { describe, expect, it } from 'vitest';
import { episodeCharacterSource, groundCharacterSuggestions } from '../../../../src/services/story/EpisodeCharacterSuggestions.js';

const source = ['銀髪のミオが扉を押す。店員は黒い服を着ている。', 'ルカが覚醒し、翼が青く光った。'];
const roster = [{
  id: 'luca-id', name: 'ルカ', aliases: ['ルー'], entityType: 'nonhuman', freeDescription: null,
}];

describe('groundCharacterSuggestions', () => {
  it('指示だけに書かれた人名・傷をキャラ情報へ登録しない', () => {
    const quote = 'カイの左頬に赤い傷を描く';
    const evidence = episodeCharacterSource({ storyInputMode: 'full',
      storyFullDraft: `ミオが歩く。＃${quote}＃\n---\nミオが止まる。`,
      introduction: null, middle: null, climax: null, endingHook: null }, true);
    expect(evidence.join('\n')).not.toContain(quote);
    expect(groundCharacterSuggestions(evidence, [], [{ name: 'カイ', name_quote: quote,
      entity_type: 'character', appearance: [], changes: [{ label: '赤い傷', description: '赤い傷', quote }] }])).toEqual([]);
  });
  it('同じ人外キャラの輪郭と部位数をすべて残し重複する特徴だけをまとめる', () => {
    const quote = 'ルゥは青いしずく形で赤い角が二本、金色の目が三つある。';
    const traits = ['青いしずく形', '赤い角が二本', '金色の目が三つ'];
    const [result] = groundCharacterSuggestions([quote], [], [{
      name: 'ルゥ', name_quote: quote, entity_type: 'nonhuman', changes: [],
      appearance: [...traits, traits[0]!].map(value => ({ field: 'features', value, quote })),
    }]);
    expect(result?.appearance.map(trait => trait.value)).toEqual(traits);
  });
  it('別の登場人物や仮定と同じ引用にある外見を確定欄へ入れない', () => {
    const group = 'ミオの隣に黒髪のルカがいた。もしミオが銀髪だったら。';
    const [mio] = groundCharacterSuggestions([group], roster, [{
      name: 'ミオ', name_quote: 'ミオの隣に黒髪のルカがいた。', entity_type: null,
      appearance: [
        { field: 'hair_color', value: '黒', quote: 'ミオの隣に黒髪のルカがいた。' },
        { field: 'hair_color', value: '銀', quote: 'もしミオが銀髪だったら。' },
      ],
      changes: [],
    }]);
    expect(mio?.appearance).toEqual([]);
  });
  it('名前のある新規キャラに原文で確認できる外見だけを採る', () => {
    const [suggestion] = groundCharacterSuggestions(source, roster, [
      { name: 'ミオ', name_quote: '銀髪のミオが扉を押す。', entity_type: null, appearance: [
        { field: 'hair_color', value: '銀', quote: '銀髪のミオが扉を押す。' },
        { field: 'eye_color', value: '青', quote: '銀髪のミオが扉を押す。' },
        { field: 'clothing', value: '黒い服', quote: '店員は黒い服を着ている。' },
      ], changes: [] },
      { name: 'ハナ', name_quote: '銀髪のミオが扉を押す。', entity_type: null, appearance: [], changes: [] },
    ]);
    expect(suggestion).toMatchObject({ name: 'ミオ', status: 'new', appearance: [
      { field: 'hair_color', value: '銀', quote: '銀髪のミオが扉を押す。' },
    ] });
  });

  it('登録済みキャラに状態変化だけを提案する', () => {
    const [suggestion] = groundCharacterSuggestions(source, roster, [{
      name: 'ルカ', name_quote: source[1]!, entity_type: 'nonhuman',
      appearance: [{ field: 'features', value: '翼', quote: source[1]! }],
      changes: [{ label: '覚醒', description: '翼が青く光った', quote: source[1]! }],
    }]);
    expect(suggestion).toMatchObject({
      status: 'existing', entity_ids: ['luca-id'], appearance: [],
      changes: [{ label: '覚醒', description: '翼が青く光った' }],
    });
  });
});
