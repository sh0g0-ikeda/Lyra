import { describe, expect, it } from 'vitest';
import {
  buildCharacterAutofillCandidates,
  isCharacterAppearanceEvidenceGrounded,
  mergeCharacterAutofillCandidates,
} from '../../../../src/services/story/CharacterAutofillFields.js';

describe('ストーリーからキャラクター編集欄へ自動入力', () => {
  it('人外分類の否定表現を含む独立プロフィールでも肯定的な容姿を保持する', () => {
    const profile = [
      ' * 黒影の魔物（人型ではない存在）',
      '   * 容姿： 漆黒のタールと煙が混ざり合ったような不定形の怪物。体中に無数の時計の針が突き刺さっており、顔の位置に割れた文字盤のような白い仮面がある。',
    ].join('\n');
    const values = [
      '漆黒のタールと煙が混ざり合ったような不定形の怪物',
      '体中に無数の時計の針が突き刺さっており',
      '顔の位置に割れた文字盤のような白い仮面',
    ];

    const [row] = buildCharacterAutofillCandidates([profile], [{
      name: '黒影の魔物', name_quote: '黒影の魔物', entity_type: 'nonhuman',
      appearance: values.map(value => ({ field: 'distinctive_features' as const, value, quote: profile })),
      changes: [],
    }]);

    expect(row?.structuredFields).toEqual({ distinctive_features: values.join(' / ') });
    expect(row?.freeDescription).toBe(values.join(' / '));
  });

  it('人外プロフィール内に一意に対応する短い容姿引用を保持する', () => {
    const profile = [
      ' * 黒影の魔物（人間ではない存在）',
      '   * 容姿： 不定形の怪物。白い仮面がある。',
    ].join('\n');
    const [row] = buildCharacterAutofillCandidates([profile], [{
      name: '黒影の魔物', name_quote: '黒影の魔物', entity_type: 'nonhuman',
      appearance: [
        { field: 'base_form', value: '不定形の怪物', quote: '不定形の怪物' },
        { field: 'distinctive_features', value: '白い仮面', quote: '白い仮面がある' },
      ], changes: [],
    }]);

    expect(row?.structuredFields).toEqual({
      base_form: 'custom', distinctive_features: '不定形の怪物 / 白い仮面',
    });
  });

  it.each([
    ['否定', '白い仮面はない。', '白い仮面'],
    ['仮定', 'もし白い仮面があれば目立つ。', '白い仮面'],
    ['状態変化', '顔が白い仮面に変わる。', '白い仮面'],
  ])('人外プロフィールの%s容姿を基本設定に保存しない', (_caseName, appearance, value) => {
    const profile = ` * 黒影の魔物（人型ではない存在）\n   * 容姿： ${appearance}`;
    const [row] = buildCharacterAutofillCandidates([profile], [{
      name: '黒影の魔物', name_quote: '黒影の魔物', entity_type: 'nonhuman',
      appearance: [{ field: 'distinctive_features', value, quote: appearance }], changes: [],
    }]);

    expect(row?.structuredFields).toEqual({});
    expect(row?.freeDescription).toBeNull();
  });

  it('仮定的な人外分類見出しだけではキャラクターを作らない', () => {
    const profile = ' * 黒影の魔物（人型ではない存在かもしれない）\n   * 容姿： 白い仮面がある。';
    const rows = buildCharacterAutofillCandidates([profile], [{
      name: '黒影の魔物', name_quote: '黒影の魔物', entity_type: 'nonhuman',
      appearance: [{ field: 'distinctive_features', value: '白い仮面', quote: '白い仮面がある' }], changes: [],
    }]);

    expect(rows).toEqual([]);
  });

  it('別プロフィールにもある短い引用やプロフィール越界引用を当人に帰属しない', () => {
    const first = ' * 黒影の魔物（人型ではない存在）\n   * 容姿： 白い仮面がある。';
    const second = ' * 白影の魔物（人型ではない存在）\n   * 容姿： 白い仮面がある。';
    const story = `${first}\n${second}`;
    const [row] = buildCharacterAutofillCandidates([story], [{
      name: '黒影の魔物', name_quote: '黒影の魔物', entity_type: 'nonhuman',
      appearance: [
        { field: 'distinctive_features', value: '白い仮面', quote: '白い仮面がある' },
        { field: 'distinctive_features', value: '白影の魔物', quote: story },
      ], changes: [],
    }]);

    expect(row?.structuredFields).toEqual({});
    expect(row?.freeDescription).toBeNull();
  });

  it.each([
    ['既知の別人物が容姿文の主体', 'ミオは白い仮面をつけている。', ['ミオ']],
    ['未登録の別人物が容姿文の主体', '母は白い仮面をつけている。', []],
    ['既知の別人物が間に現れた後の部位文', '不定形の怪物。ミオが現れた。顔には白い仮面がある。', ['ミオ']],
  ])('%sの短い引用を黒影の魔物に帰属しない', (_caseName, body, otherCharacterNames) => {
    const source = `* 黒影の魔物（人型ではない存在）\n   * 容姿： ${body}`;

    expect(isCharacterAppearanceEvidenceGrounded({
      source: [source],
      characterName: '黒影の魔物',
      otherCharacterNames,
      quote: '白い仮面',
      value: '白い仮面',
    })).toBe(false);
  });

  it.each([
    ['短い引用', '黒影の魔物の顔に白い仮面が現れる'],
    ['見出しからの引用', '黒影の魔物（人型ではない存在）\n   * 容姿： 不定形の怪物。黒影の魔物の顔に白い仮面が現れる'],
  ])('プロフィール内の状態変化を%sで基本外見から除き状態に保持する', (_caseName, quote) => {
    const source = '* 黒影の魔物（人型ではない存在）\n'
      + '   * 容姿： 不定形の怪物。黒影の魔物の顔に白い仮面が現れる。';
    const [row] = buildCharacterAutofillCandidates([source], [{
      name: '黒影の魔物', name_quote: '黒影の魔物', entity_type: 'nonhuman',
      appearance: [{ field: 'distinctive_features', value: '白い仮面', quote }],
      changes: [{ name: '白い仮面', description: '白い仮面が現れる', quote }],
    }]);

    expect(row?.structuredFields).toEqual({});
    expect(row?.freeDescription).toBeNull();
    expect(row?.changes).toEqual([{
      name: '白い仮面', description: '白い仮面が現れる', quote,
    }]);
  });

  it.each(['変身後', '仮の姿'])('状態限定の注記「%s」の容姿を基本外見に保存しない', qualifier => {
    const source = `* 黒影の魔物（${qualifier}）\n   * 容姿： 白い仮面がある。`;
    for (const quote of ['白い仮面がある', source]) {
      const [row] = buildCharacterAutofillCandidates([source], [{
        name: '黒影の魔物', name_quote: '黒影の魔物', entity_type: 'nonhuman',
        appearance: [{ field: 'distinctive_features', value: '白い仮面', quote }], changes: [],
      }]);
      expect(row?.structuredFields).toEqual({});
      expect(row?.freeDescription).toBeNull();
    }
  });

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
      { hair: { color: 'blonde' } },
    ]);
    expect(result.map(c => c.freeDescription)).toEqual([null, '青紫色']);
  });

  it('一括の自由記述に入った既知の髪・瞳・服を選択欄へ戻す', () => {
    const story = 'ミオは黒髪で青い瞳、白い制服と左頬の星形の傷が特徴だ。';
    const [row] = buildCharacterAutofillCandidates([story], [{
      name: 'ミオ', entity_type: 'character', name_quote: 'ミオは黒髪', appearance: [{
        field: 'distinguishing_features',
        value: '黒髪で青い瞳、白い制服と左頬の星形の傷',
        quote: story,
      }], changes: [],
    }]);

    expect(row?.structuredFields).toEqual({
      hair: { color: 'black' },
      eyes: { color: 'blue' },
      clothing: { category: 'school', main_color: 'white' },
    });
    expect(row?.freeDescription).toBe('左頬の星形の傷');
  });

  it('服の色は選択欄に入れ、プリセットにない服種は消さず自由記述に残す', () => {
    const story = 'アキは白い制服。レイは赤いコート。';
    const rows = buildCharacterAutofillCandidates([story], [
      { name: 'アキ', entity_type: 'character', name_quote: 'アキは白い制服', appearance: [{
        field: 'distinguishing_features', value: '白い制服', quote: 'アキは白い制服。',
      }], changes: [] },
      { name: 'レイ', entity_type: 'character', name_quote: 'レイは赤いコート', appearance: [{
        field: 'distinguishing_features', value: '赤いコート', quote: 'レイは赤いコート。',
      }], changes: [] },
    ]);
    expect(rows.map(row => row.structuredFields)).toEqual([
      { clothing: { category: 'school', main_color: 'white' } },
      { clothing: { main_color: 'red' } },
    ]);
    expect(rows.map(row => row.freeDescription)).toEqual([null, 'コート']);
  });

  it('複数キャラの髪と瞳を混ぜず、傷だけを自由記述に残す', () => {
    const story = 'ナギは黒髪のポニーテールで、左頬に星形の傷がある。ソラは金髪で青い瞳。';
    const rows = buildCharacterAutofillCandidates([story], [
      { name: 'ナギ', entity_type: 'character', name_quote: 'ナギは黒髪', appearance: [{
        field: 'distinguishing_features', value: '黒髪のポニーテールで、左頬に星形の傷',
        quote: 'ナギは黒髪のポニーテールで、左頬に星形の傷がある。',
      }], changes: [] },
      { name: 'ソラ', entity_type: 'character', name_quote: 'ソラは金髪', appearance: [{
        field: 'distinguishing_features', value: '金髪で青い瞳', quote: 'ソラは金髪で青い瞳。',
      }], changes: [] },
    ]);
    expect(rows.map(row => row.structuredFields)).toEqual([
      { hair: { color: 'black', arrangement: 'ponytail' } },
      { hair: { color: 'blonde' }, eyes: { color: 'blue' } },
    ]);
    expect(rows.map(row => row.freeDescription)).toEqual(['左頬に星形の傷', null]);
  });

  it('複合髪型と誤分類を複数の髪の選択欄へ分ける', () => {
    const story = 'レナは黒髪ロングのポニーテールだ。';
    const [row] = buildCharacterAutofillCandidates([story], [{
      name: 'レナ', entity_type: 'character', name_quote: 'レナは黒髪', appearance: [{
        field: 'hair.style', value: '黒髪ロングのポニーテール', quote: story,
      }], changes: [],
    }]);

    expect(row?.structuredFields).toEqual({
      hair: { color: 'black', length: 'long', arrangement: 'ponytail' },
    });
    expect(row?.freeDescription).toBeNull();
  });

  it('髪の長さと色の日本語複合表現を選択欄へ分ける', () => {
    const story = 'アキは黒い短髪。ミオは長い黒髪。ユイは胸まで届く黒髪。';
    const rows = buildCharacterAutofillCandidates([story], [
      { name: 'アキ', entity_type: 'character', name_quote: 'アキは黒い短髪', appearance: [
        { field: 'distinguishing_features', value: '黒い短髪', quote: 'アキは黒い短髪' },
      ], changes: [] },
      { name: 'ミオ', entity_type: 'character', name_quote: 'ミオは長い黒髪', appearance: [
        { field: 'distinguishing_features', value: '長い黒髪', quote: 'ミオは長い黒髪' },
      ], changes: [] },
      { name: 'ユイ', entity_type: 'character', name_quote: 'ユイは胸まで届く黒髪', appearance: [
        { field: 'distinguishing_features', value: '胸まで届く黒髪', quote: 'ユイは胸まで届く黒髪' },
      ], changes: [] },
    ]);

    expect(rows.map(row => row.structuredFields)).toEqual([
      { hair: { color: 'black', length: 'short' } },
      { hair: { color: 'black', length: 'long' } },
      { hair: { color: 'black', length: 'very_long' } },
    ]);
    expect(rows.map(row => row.freeDescription)).toEqual([null, null, null]);
  });

  it('服飾と一般語の部分一致を髪や人外種別にしない', () => {
    const humanStory = 'レイは濃い茶色のロングコート、ロングスカート、ショートパンツ、ミディアム丈の上着を着ている。';
    const [human] = buildCharacterAutofillCandidates([humanStory], [{
      name: 'レイ', entity_type: 'character', name_quote: 'レイは濃い茶色', appearance: [{
        field: 'distinguishing_features',
        value: '濃い茶色のロングコート、ロングスカート、ショートパンツ、ミディアム丈の上着',
        quote: humanStory,
      }], changes: [],
    }]);
    expect(human?.structuredFields).toEqual({});
    expect(human?.freeDescription).toBe('濃い茶色のロングコート、ロングスカート、ショートパンツ、ミディアム丈の上着');

    const nonhumanStory = 'フィナは神秘的なdragonflyの姿をしている。';
    const [nonhuman] = buildCharacterAutofillCandidates([nonhumanStory], [{
      name: 'フィナ', entity_type: 'nonhuman', name_quote: 'フィナは神秘的', appearance: [{
        field: 'distinctive_features', value: '神秘的なdragonflyの姿', quote: nonhumanStory,
      }], changes: [],
    }]);
    expect(nonhuman?.structuredFields).toEqual({ distinctive_features: '神秘的なdragonflyの姿' });
    expect(nonhuman?.freeDescription).toBe('神秘的なdragonflyの姿');
  });

  it('UIに出ないテキスト欄の未一致部分を自由記述にも残す', () => {
    const story = 'ミオの見た目の軸は黒髪と左頬の星形の傷だ。';
    const [row] = buildCharacterAutofillCandidates([story], [{
      name: 'ミオ', entity_type: 'character', name_quote: 'ミオの見た目', appearance: [{
        field: 'character_identity.visual_anchor', value: '黒髪と左頬の星形の傷', quote: story,
      }], changes: [],
    }]);
    expect(row?.structuredFields).toEqual({
      hair: { color: 'black' }, character_identity: { visual_anchor: '左頬の星形の傷' },
    });
    expect(row?.freeDescription).toBe('左頬の星形の傷');
  });

  it('制服を着ており、という抽出結果の場合は残った動詞だけを特徴として保存しない', () => {
    const story = 'アキは制服を着ており、左頬に星形の傷がある。';
    const [row] = buildCharacterAutofillCandidates([story], [{
      name: 'アキ', entity_type: 'character', name_quote: 'アキ', changes: [],
      appearance: [
        { field: 'clothing.description', value: '制服を着ており', quote: story },
        { field: 'distinguishing_features', value: '左頬に星形の傷がある', quote: story },
      ],
    }]);
    expect(row?.structuredFields).toEqual({ clothing: { category: 'school' } });
    expect(row?.freeDescription).toBe('左頬に星形の傷がある');
  });

  it('選択肢にない服の説明は互換用欄と自由記述の両方に残す', () => {
    const story = 'ミオは裾が破れた古いマントを着ている。';
    const [row] = buildCharacterAutofillCandidates([story], [{
      name: 'ミオ', entity_type: 'character', name_quote: 'ミオは裾', appearance: [{
        field: 'clothing.description', value: '裾が破れた古いマント', quote: story,
      }], changes: [],
    }]);
    expect(row?.structuredFields).toEqual({ clothing: { description: '裾が破れた古いマント' } });
    expect(row?.freeDescription).toBe('裾が破れた古いマント');
  });

  it('人外の一括特徴から既知の大きさと移動を選択欄へ戻し、未一致の角だけを残す', () => {
    const story = 'ガルは大型の四足歩行で、赤い角が二本ある。';
    const [row] = buildCharacterAutofillCandidates([story], [{
      name: 'ガル', entity_type: 'nonhuman', name_quote: 'ガルは大型', appearance: [{
        field: 'distinctive_features', value: '大型の四足歩行で、赤い角が二本', quote: story,
      }], changes: [],
    }]);

    expect(row?.structuredFields).toEqual({
      size: 'large', movement: 'quadruped', distinctive_features: '赤い角が二本',
    });
    expect(row?.freeDescription).toBe('赤い角が二本');
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
    expect(result?.freeDescription).toBe('青いしずく形');
    expect(result?.changes[0]?.name).toBe('左腕に赤い模様が現れる');
  });

  it('人外の色と基本形が分断されても原文で隣接する場合は忠実な一句に戻す', () => {
    const story = 'ルゥは青いしずく形の生き物で、赤い角が二本、金色の目が三つある。';
    const [row] = buildCharacterAutofillCandidates([story], [{
      name: 'ルゥ', entity_type: 'nonhuman', name_quote: 'ルゥ', appearance: [
        { field: 'base_form', value: 'しずく形の生き物', quote: 'ルゥは青いしずく形の生き物' },
        { field: 'distinctive_features', value: '青い', quote: 'ルゥは青いしずく形の生き物' },
        { field: 'distinctive_features', value: '赤い角が二本', quote: '赤い角が二本' },
        { field: 'distinctive_features', value: '金色の目が三つ', quote: '金色の目が三つある' },
      ], changes: [],
    }]);
    const faithful = '青いしずく形の生き物 / 赤い角が二本 / 金色の目が三つ';
    expect(row?.structuredFields).toEqual({ base_form: 'custom', distinctive_features: faithful });
    expect(row?.freeDescription).toBe(faithful);
  });

  it('直前の一人だけが主語のときは後置された髪・目・服の明記を同じ人物に戻す', () => {
    const story = 'ミオは黒髪。目は緑色。ミオが立つ。服は白い制服。';
    const [row] = buildCharacterAutofillCandidates([story], [{
      name: 'ミオ', entity_type: 'character', name_quote: 'ミオは黒髪', changes: [],
      appearance: [
        { field: 'hair.color', value: '黒髪', quote: 'ミオは黒髪' },
        { field: 'eyes.color', value: '緑色', quote: '目は緑色' },
        { field: 'clothing.category', value: '制服', quote: '服は白い制服' },
        { field: 'clothing.main_color', value: '白い', quote: '服は白い制服' },
      ],
    }]);

    expect(row?.structuredFields).toEqual({
      hair: { color: 'black' },
      eyes: { color: 'green' },
      clothing: { category: 'school', main_color: 'white' },
    });
    expect(row?.choiceEvidence).toEqual([
      { field: 'hair.color', value: 'black', quote: 'ミオは黒髪' },
      { field: 'eyes.color', value: 'green', quote: '目は緑色' },
      { field: 'clothing.category', value: 'school', quote: '服は白い制服' },
      { field: 'clothing.main_color', value: 'white', quote: '服は白い制服' },
    ]);
  });

  it('同じ段落の外見文が続く場合は甲冑をカイに戻し、未対応の銀色も甲冑と一緒に残す', () => {
    const story = 'ミオは黒髪。\nカイは白髪の少女。髪型はおかっぱで、目は左が赤、右が青。銀色の甲冑を装着している。';
    const [row] = buildCharacterAutofillCandidates([story], [{
      name: 'カイ', entity_type: 'character', name_quote: 'カイは', changes: [],
      appearance: [
        { field: 'clothing.category', value: '甲冑', quote: '銀色の甲冑' },
        { field: 'clothing.main_color', value: '銀色', quote: '銀色の甲冑' },
      ],
    }]);

    expect(row?.structuredFields).toEqual({ clothing: { category: 'armor' } });
    expect(row?.freeDescription).toBe('銀色の甲冑');
    expect(row?.choiceEvidence).toEqual([
      { field: 'clothing.category', value: 'armor', quote: '銀色の甲冑' },
    ]);

    const [descriptionOnly] = buildCharacterAutofillCandidates([story], [{
      name: 'カイ', entity_type: 'character', name_quote: 'カイは', changes: [],
      appearance: [{ field: 'clothing.description', value: '銀色の甲冑', quote: '銀色の甲冑' }],
    }]);
    expect(descriptionOnly?.structuredFields).toEqual({
      clothing: { category: 'armor', description: '銀色の甲冑' },
    });
    expect(descriptionOnly?.freeDescription).toBe('銀色の甲冑');

    const [categoryOnly] = buildCharacterAutofillCandidates([story], [{
      name: 'カイ', entity_type: 'character', name_quote: 'カイは', changes: [],
      appearance: [{ field: 'clothing.category', value: '銀色の甲冑', quote: '銀色の甲冑' }],
    }]);
    expect(categoryOnly?.structuredFields).toEqual({ clothing: { category: 'armor' } });
    expect(categoryOnly?.freeDescription).toBe('銀色の甲冑');
  });

  it('甲冑の未対応修飾を関連付けても他の残余特徴を消さない', () => {
    const story = 'カイは銀色の甲冑、胸に星形の紋章がある。';
    const [row] = buildCharacterAutofillCandidates([story], [{
      name: 'カイ', entity_type: 'character', name_quote: 'カイは', changes: [], appearance: [{
        field: 'clothing.category', value: '銀色の甲冑、胸に星形の紋章がある', quote: story,
      }],
    }]);

    expect(row?.structuredFields).toEqual({ clothing: { category: 'armor' } });
    expect(row?.freeDescription).toBe('銀色の甲冑 / 胸に星形の紋章がある');
  });

  it.each([
    ['原文にない人物アンカー', 'カイは白髪の少女。髪型はおかっぱ。銀色の甲冑を装着している。', 'カイ。銀色の甲冑'],
    ['4文を超えた外見の連鎖', 'カイは白髪の少女。髪型はおかっぱ。目は青い。肌は白い。銀色の甲冑を装着している。', '銀色の甲冑'],
    ['500字を超えた外見の連鎖', `カイは白髪の少女。髪型は${'とても'.repeat(170)}短い。銀色の甲冑を装着している。`, '銀色の甲冑'],
    ['途中の行動', 'カイは白髪の少女。カイが扉を開く。銀色の甲冑を装着している。', '銀色の甲冑'],
    ['途中の別人物', 'カイは白髪の少女。ミオは黒髪。銀色の甲冑を装着している。', '銀色の甲冑'],
    ['途中の未登録主語', 'カイは白髪の少女。騎士は長髪である。銀色の甲冑を装着している。', '銀色の甲冑'],
    ['途中の家族呼称', 'カイは白髪の少女。母は長髪である。銀色の甲冑を装着している。', '銀色の甲冑'],
    ['着用文の未登録主語', 'カイは白髪の少女。母は銀色の甲冑を装着している。', '銀色の甲冑'],
    ['外見文の途中の未登録主語', 'カイは白髪の少女。髪型はボブで、母は短髪。銀色の甲冑を装着している。', '銀色の甲冑'],
    ['複数人物のアンカー', 'カイと母は白髪である。銀色の甲冑を装着している。', '銀色の甲冑'],
    ['段落の切れ目', 'カイは白髪の少女。\n髪型はおかっぱ。銀色の甲冑を装着している。', '銀色の甲冑'],
    ['否定された中間の外見', 'カイは白髪の少女。髪型はおかっぱではない。銀色の甲冑を装着している。', '銀色の甲冑'],
    ['棚の備品', 'カイは白髪の少女。銀色の甲冑が棚に置かれている。', '銀色の甲冑'],
    ['見ている装備', 'カイは白髪の少女。銀色の甲冑を見ている。', '銀色の甲冑'],
    ['甲冑を着た像への行動', 'カイは白髪の少女。銀色の甲冑を装着している像を見つめている。', '銀色の甲冑'],
    ['甲冑を着た別人物の絵', 'カイは白髪の少女。銀色の甲冑を装着している兵士の絵。', '銀色の甲冑'],
  ])('%sを越えて甲冑を人物に帰属しない', (_caseName, story, quote) => {
    const [row] = buildCharacterAutofillCandidates([story], [{
      name: 'カイ', entity_type: 'character', name_quote: 'カイ', changes: [],
      appearance: [{ field: 'clothing.category', value: '甲冑', quote }],
    }]);

    expect(row?.structuredFields).toEqual({});
    expect(row?.freeDescription).toBeNull();
  });

  it('4文以内の連続外見は受け入れ、別の原稿欄の人物へ装備を結び付けない', () => {
    const anchor = 'カイは白髪の少女。髪型はおかっぱ。目は青い。';
    const clothing = '銀色の甲冑を装着している。';
    const character = {
      name: 'カイ', entity_type: 'character' as const, name_quote: 'カイは', changes: [],
      appearance: [{ field: 'clothing.category' as const, value: '甲冑', quote: '銀色の甲冑' }],
    };
    expect(buildCharacterAutofillCandidates([anchor + clothing], [character])[0]?.structuredFields)
      .toEqual({ clothing: { category: 'armor' } });
    expect(buildCharacterAutofillCandidates([anchor, clothing], [character])[0]?.structuredFields)
      .toEqual({});
  });

  it('複数人が主語の直後や別人物を挟んだ後置特徴は誤って割り当てない', () => {
    const story = 'ミオとノアが並ぶ。目は緑色。ミオは黒髪。ノアが振り返る。服は白い制服。';
    const rows = buildCharacterAutofillCandidates([story], ['ミオ', 'ノア'].map(name => ({
      name, entity_type: 'character' as const, name_quote: name, changes: [],
      appearance: [
        { field: 'eyes.color' as const, value: '緑色', quote: '目は緑色' },
        { field: 'clothing.category' as const, value: '制服', quote: '服は白い制服' },
      ],
    })));

    expect(rows.map(row => row.structuredFields)).toEqual([{}, { clothing: { category: 'school' } }]);
  });

  it('同名候補の非競合欄と残余・根拠を統合し、競合欄は採用しない', () => {
    const [merged] = mergeCharacterAutofillCandidates([
      {
        name: 'ミオ', entityType: 'character', freeDescription: '左頜に星形の傷',
        structuredFields: { hair: { color: 'black' }, clothing: { category: 'school' } },
        choiceEvidence: [
          { field: 'hair.color', value: 'black', quote: 'ミオは黒髪' },
          { field: 'clothing.category', value: 'school', quote: 'ミオは制服' },
        ],
        changes: [],
      },
      {
        name: 'ミオ', entityType: 'character', freeDescription: '右耳に金のピアス',
        structuredFields: { hair: { color: 'blonde' }, eyes: { color: 'green' } },
        choiceEvidence: [
          { field: 'hair.color', value: 'blonde', quote: 'ミオは金髪' },
          { field: 'eyes.color', value: 'green', quote: '目は緑色' },
        ],
        changes: [],
      },
    ]);

    expect(merged?.structuredFields).toEqual({
      clothing: { category: 'school' },
      eyes: { color: 'green' },
    });
    expect(merged?.freeDescription).toBe('左頜に星形の傷 / 右耳に金のピアス');
    expect(merged?.choiceEvidence).toEqual([
      { field: 'clothing.category', value: 'school', quote: 'ミオは制服' },
      { field: 'eyes.color', value: 'green', quote: '目は緑色' },
    ]);
  });

  it('否定された外見は空欄を埋めず、後から起きる変化は基本外見に混ぜない', () => {
    const story = 'ミオは黒髪ではない。ミオの髪が白く変わる。';
    const [row] = buildCharacterAutofillCandidates([story], [{
      name: 'ミオ', entity_type: 'character', name_quote: 'ミオ',
      appearance: [
        { field: 'hair.color', value: '黒髪', quote: 'ミオは黒髪ではない' },
        { field: 'hair.color', value: '白', quote: 'ミオの髪が白く変わる' },
      ],
      changes: [{ name: '白髪', description: '髪が白く変わる', quote: 'ミオの髪が白く変わる' }],
    }]);

    expect(row?.structuredFields).toEqual({});
    expect(row?.freeDescription).toBeNull();
    expect(row?.changes).toEqual([{
      name: '髪が白く変わる', description: '髪が白く変わる', quote: 'ミオの髪が白く変わる',
    }]);
  });
});
