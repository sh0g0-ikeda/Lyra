import { describe, expect, it } from 'vitest';
import type { Episode } from '../../../../src/domain/types/story.js';
import {
  extractCharacterAutofillWithCoverage,
  type CharacterAppearanceCoverageResponse,
} from '../../../../src/services/story/CharacterAppearanceCoverage.js';
import type {
  StoryAiClientPort,
  StoryAiModelRequest,
} from '../../../../src/services/story/StoryAiClientPort.js';

describe('CharacterAppearanceCoverage', () => {
  it('初回と照合が落とした明示的な髪色と目色を原文から補う', async () => {
    const client = new FakeStoryAiClient(
      [{
        name: 'アキ', name_quote: 'アキは黒髪で、青い瞳をしている。', entity_type: 'character',
        appearance: [], changes: [],
      }],
      emptyCoverage(),
    );

    const result = await extractCharacterAutofillWithCoverage(
      client,
      episode('アキは黒髪で、青い瞳をしている。'),
    );

    expect(result.unresolved).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.structuredFields).toMatchObject({
      hair: { color: 'black' },
      eyes: { color: 'blue' },
    });
  });

  it('仮定の外見や変化後の外見を基本設定に補わない', async () => {
    const manuscript = 'もしアキが黒髪なら目立つ。その後、アキの髪は白く変わった。アキの目は緑色に変わった。';
    const client = new FakeStoryAiClient(
      [{ name: 'アキ', name_quote: 'アキの髪は白く変わった。', entity_type: 'character', appearance: [], changes: [] }],
      emptyCoverage(),
    );

    const result = await extractCharacterAutofillWithCoverage(client, episode(manuscript));

    expect(result.candidates[0]?.structuredFields).toEqual({});
  });

  it.each([
    'ミオの目は緑色に変わっていた。',
    'ミオの目が緑色になっている。',
  ])('状態変化中の目色「%s」を基本設定に補わない', async (manuscript) => {
    const client = new FakeStoryAiClient(
      [{ name: 'ミオ', name_quote: manuscript, entity_type: 'character', appearance: [], changes: [] }],
      emptyCoverage(),
    );

    const result = await extractCharacterAutofillWithCoverage(client, episode(manuscript));

    expect(result.candidates[0]?.structuredFields).not.toHaveProperty('eyes.color');
  });

  it('一コマ限りの照明による見かけの髪色で基本の髪色を競合させない', async () => {
    const base = 'ハルは黒髪の人間だ。';
    const lighting = '一コマだけ、照明でハルの髪が緑色に見える。すぐに照明が消える。';
    const client = new FakeStoryAiClient(
      [{
        name: 'ハル', name_quote: base, entity_type: 'character', changes: [],
        appearance: [{ field: 'hair.color', value: '黒髪', quote: base }],
      }],
      emptyCoverage(),
    );

    const result = await extractCharacterAutofillWithCoverage(client, episode(`${base}\n${lighting}`));

    expect(result.candidates[0]?.structuredFields).toEqual({ hair: { color: 'black' } });
    expect(result.unresolved).toEqual([]);
  });

  it('500文字を超える原文ではスキャナーを安全に省略する', async () => {
    const manuscript = `アキは${'とても'.repeat(170)}黒髪。`;
    const client = new FakeStoryAiClient(
      [{ name: 'アキ', name_quote: 'アキ', entity_type: 'character', appearance: [], changes: [] }],
      emptyCoverage(),
    );

    const result = await extractCharacterAutofillWithCoverage(client, episode(manuscript));

    expect(result.candidates[0]?.structuredFields).toEqual({});
  });

  it('照合で解決できない根拠を理由付きで返す', async () => {
    const client = new FakeStoryAiClient(
      [{ name: 'アキ', name_quote: 'アキが立っていた。', entity_type: 'character', appearance: [], changes: [] }],
      {
        additions: [],
        unresolved: [{ quote: 'アキは青い。', reason: 'unverified_trait' }],
      },
    );

    const result = await extractCharacterAutofillWithCoverage(
      client,
      episode('アキが立っていた。アキは青い。'),
    );

    expect(result.unresolved).toEqual([
      { quote: 'アキは青い。', reason: 'unverified_trait' },
    ]);
  });

  it('必須の独立照合が未実装なら候補を返さず失敗する', async () => {
    const client: StoryAiClientPort = {
      async *streamCollaboration() {},
      async generatePageSkeleton() { return []; },
      async improveEpisodeDraft() { return { introduction: null, middle: null, climax: null, endingHook: null }; },
      async extractCharacterAutofill() { return []; },
    };

    await expect(extractCharacterAutofillWithCoverage(client, episode('アキが立っていた。')))
      .rejects.toThrow('Character autofill coverage is unavailable');
  });

  it('照合に原文全体と初回抽出結果を渡す', async () => {
    const manuscript = 'アキは黒髪。\nユイは青い瞳。';
    const client = new FakeStoryAiClient([], emptyCoverage());

    await extractCharacterAutofillWithCoverage(client, episode(manuscript));

    const payload = JSON.parse(client.coverageRequest?.userPrompt ?? '{}') as {
      original_manuscript?: string[];
      first_extraction?: unknown[];
    };
    expect(payload.original_manuscript).toEqual([manuscript]);
    expect(payload.first_extraction).toEqual([]);
  });

  it('初回の捏造引用を取得済み扱いせず照合で回収した甲冑と銀色を保持する', async () => {
    const manuscript = 'カイは白髪の少女。髪型はおかっぱで、目は左が赤、右が青。銀色の甲冑を装着している。';
    const client = new FakeStoryAiClient([{
      name: 'カイ', name_quote: 'カイは', entity_type: 'character', changes: [],
      appearance: [
        { field: 'hair.color', value: '白髪', quote: 'カイは白髪の少女' },
        { field: 'clothing.category', value: '甲冑', quote: 'カイ。銀色の甲冑' },
        { field: 'clothing.main_color', value: '銀色', quote: 'カイ。銀色の甲冑' },
      ],
    }], {
      additions: [{
        name: 'カイ', name_quote: 'カイは', entity_type: 'character', changes: [],
        appearance: [
          { field: 'clothing.category', option_id: 'armor', value: '甲冑', quote: '銀色の甲冑' },
          { field: 'clothing.main_color', option_id: 'custom', value: '銀色', quote: '銀色の甲冑' },
        ],
      }], unresolved: [],
    });

    const result = await extractCharacterAutofillWithCoverage(client, episode(manuscript));
    const payload = JSON.parse(client.coverageRequest?.userPrompt ?? '{}') as {
      first_extraction: Array<{ appearance: Array<{ field: string }> }>;
    };

    expect(payload.first_extraction[0]?.appearance.map(trait => trait.field)).toEqual(['hair.color']);
    expect(result.candidates[0]?.structuredFields).toMatchObject({
      hair: { color: 'white' }, clothing: { category: 'armor' },
    });
    expect(result.candidates[0]?.freeDescription).toContain('銀色の甲冑');
    expect(result.unresolved).toEqual([]);
  });

  it('人物への帰属を確認できない原文の装備を消さず確認項目に残す', async () => {
    const manuscript = 'カイは白髪。レンが入る。銀色の甲冑を装着している。';
    const client = new FakeStoryAiClient([
      { name: 'カイ', name_quote: 'カイは白髪', entity_type: 'character', changes: [],
        appearance: [{ field: 'clothing.category', value: '甲冑', quote: '銀色の甲冑' }] },
      { name: 'レン', name_quote: 'レンが入る', entity_type: 'character', changes: [], appearance: [] },
    ], emptyCoverage());

    const result = await extractCharacterAutofillWithCoverage(client, episode(manuscript));

    expect(result.candidates.find(character => character.name === 'カイ')?.structuredFields).not.toHaveProperty('clothing');
    expect(result.unresolved).toContainEqual({ quote: '銀色の甲冑', reason: 'ambiguous_character' });
  });

  it('捏造引用しか返らなくても実在する特徴だけを未確認として残す', async () => {
    const manuscript = 'カイは白髪。銀色の甲冑を装着している。';
    const client = new FakeStoryAiClient([{
      name: 'カイ', name_quote: 'カイは', entity_type: 'character', changes: [],
      appearance: [
        { field: 'clothing.category', value: '甲冑', quote: 'カイ。銀色の甲冑' },
        { field: 'distinguishing_features', value: '赤い翼', quote: 'カイには赤い翼がある' },
      ],
    }], emptyCoverage());

    const result = await extractCharacterAutofillWithCoverage(client, episode(manuscript));

    expect(result.unresolved).toEqual([{ quote: '甲冑', reason: 'unverified_trait' }]);
    expect(result.candidates[0]?.freeDescription ?? '').not.toContain('赤い翼');
  });

  it('二段階の棄却が大量でも確認項目を既存APIの上限内に収める', async () => {
    const first = Array.from({ length: 30 }, (_, index) => ({
      name: `人物${index}`, name_quote: `人物${index}は立つ。`, entity_type: 'character' as const, changes: [],
      appearance: Array.from({ length: 64 }, (_, offset) => ({
        field: 'distinguishing_features' as const, value: `特徴${index * 64 + offset}番`, quote: `存在しない引用${index * 64 + offset}番`,
      })),
    }));
    const omitted = Array.from({ length: 64 }, (_, index) => ({
      field: 'distinguishing_features' as const, option_id: null, value: `追加特徴${index}番`, quote: `存在しない追加引用${index}番`,
    }));
    const manuscript = first.map(character => character.name_quote).join('')
      + [...first.flatMap(character => character.appearance), ...omitted].map(trait => trait.value).join('、');
    const client = new FakeStoryAiClient(first, {
      additions: [{ name: '人物0', name_quote: '人物0は立つ。', entity_type: 'character', changes: [], appearance: omitted }], unresolved: [],
    });

    const result = await extractCharacterAutofillWithCoverage(client, episode(manuscript));

    expect(result.candidates).toHaveLength(30);
    expect(result.unresolved).toHaveLength(1920);
    expect(result.unresolved.every(issue => manuscript.includes(issue.quote))).toBe(true);
  });

  it('短い主語省略と複数人を混同せず、未分類の傷をreviewに残す', async () => {
    const manuscript = 'ミオは黒髪。目は緑色。左頬に星形の傷がある。ソラは金髪で青い瞳。ユイの目は緑色。';
    const client = new FakeStoryAiClient([
      { name: 'ミオ', name_quote: 'ミオは黒髪。', entity_type: 'character', appearance: [], changes: [] },
      { name: 'ソラ', name_quote: 'ソラは金髪で青い瞳。', entity_type: 'character', appearance: [], changes: [] },
      { name: 'ユイ', name_quote: 'ユイの目は緑色。', entity_type: 'character', appearance: [], changes: [] },
    ], emptyCoverage());

    const result = await extractCharacterAutofillWithCoverage(client, episode(manuscript));
    const byName = new Map(result.candidates.map(candidate => [candidate.name, candidate]));

    expect(byName.get('ミオ')?.structuredFields).toMatchObject({ hair: { color: 'black' }, eyes: { color: 'green' } });
    expect(byName.get('ソラ')?.structuredFields).toMatchObject({ hair: { color: 'blonde' }, eyes: { color: 'blue' } });
    expect(byName.get('ユイ')?.structuredFields).toMatchObject({ eyes: { color: 'green' } });
    expect(result.unresolved).toContainEqual({ quote: '左頬に星形の傷がある。', reason: 'unverified_trait' });
  });

  it('人外の色と部位数を一つの原文証拠のまま保つ', async () => {
    const manuscript = 'ルウは赤い角が二本ある竜だ。';
    const client = new FakeStoryAiClient([], {
      additions: [{
        name: 'ルウ', name_quote: manuscript, entity_type: 'nonhuman', changes: [],
        appearance: [{ field: 'distinctive_features', option_id: null, value: '赤い角が二本', quote: manuscript }],
      }],
      unresolved: [],
    });

    const result = await extractCharacterAutofillWithCoverage(client, episode(manuscript));

    expect(result.candidates[0]?.structuredFields).toMatchObject({ distinctive_features: '赤い角が二本' });
  });

  it('人物紹介の非人型という注記で肯定された人外の容姿を捨てない', async () => {
    const header = '* 黒影の魔物（人型ではない存在）\n   * 容姿： ';
    const body = '漆黒のタールと煙が混ざり合ったような不定形の怪物。'
      + '体中に無数の時計の針が突き刺さっており、顔の位置に割れた文字盤のような白い仮面がある。';
    const client = new FakeStoryAiClient([{
      name: '黒影の魔物', name_quote: '黒影の魔物', entity_type: 'nonhuman', changes: [],
      appearance: [
        { field: 'base_form', value: '漆黒のタールと煙が混ざり合ったような不定形の怪物', quote: header + body },
        { field: 'distinctive_features', value: '体中に無数の時計の針が突き刺さっており', quote: header + body },
        { field: 'distinctive_features', value: '顔の位置に割れた文字盤のような白い仮面がある', quote: header + body },
      ],
    }], emptyCoverage());

    const result = await extractCharacterAutofillWithCoverage(client, episode(header + body));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.entityType).toBe('nonhuman');
    expect(result.candidates[0]?.structuredFields.base_form).toBe('custom');
    for (const literal of ['漆黒', 'タール', '煙', '不定形', '無数の時計の針', '白い仮面']) {
      expect(result.candidates[0]?.structuredFields.distinctive_features).toContain(literal);
      expect(result.candidates[0]?.freeDescription).toContain(literal);
    }
    const payload = JSON.parse(client.coverageRequest?.userPrompt ?? '{}') as {
      first_extraction: Array<{ appearance: unknown[] }>;
    };
    expect(payload.first_extraction[0]?.appearance).toHaveLength(3);
    expect(result.unresolved).toEqual([]);
  });

  it('人外の分類注記を許しても仮定の仮面を基本外見に追加しない', async () => {
    const manuscript = '* 黒影の魔物（人型ではない存在）\n   * 容姿： 漆黒の不定形の怪物。もし白い仮面があれば目立つ。';
    const client = new FakeStoryAiClient([{
      name: '黒影の魔物', name_quote: '黒影の魔物', entity_type: 'nonhuman', changes: [],
      appearance: [{ field: 'base_form', value: '漆黒の不定形の怪物', quote: '漆黒の不定形の怪物' }],
    }], {
      additions: [{ name: '黒影の魔物', name_quote: '黒影の魔物', entity_type: 'nonhuman', changes: [],
        appearance: [{ field: 'distinctive_features', option_id: null, value: '白い仮面', quote: 'もし白い仮面があれば目立つ' }] }],
      unresolved: [],
    });

    const result = await extractCharacterAutofillWithCoverage(client, episode(manuscript));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.structuredFields.base_form).toBe('custom');
    expect(result.candidates[0]?.freeDescription).toContain('漆黒の不定形の怪物');
    expect(result.candidates[0]?.freeDescription).not.toContain('白い仮面');
  });

  it('照合が誤った選択肢IDを返しても原文から導ける値だけを保存候補にする', async () => {
    const firstSentence = 'ミオは黒い短髪で、白と青のしましまの上着を着ている。';
    const secondSentence = '目は一重で緑色である。';
    const manuscript = `${firstSentence}${secondSentence}ミオが扉を開く。窓から光が差し込む。`;
    const client = new FakeStoryAiClient([{
      name: 'ミオ', name_quote: firstSentence, entity_type: 'character', changes: [],
      appearance: [
        { field: 'eyes.eyelid_type', value: '一重', quote: 'ミオ。目は一重で緑色である。' },
        { field: 'eyes.color', value: '緑色', quote: 'ミオ。目は一重で緑色である。' },
      ],
    }], {
      additions: [{
        name: 'ミオ', name_quote: firstSentence, entity_type: 'character', changes: [],
        appearance: [
          { field: 'hair.color', option_id: 'gold', value: '黒い短髪', quote: firstSentence },
          { field: 'clothing.description', option_id: 'blue', value: '白と青のしましまの上着', quote: firstSentence },
          { field: 'eyes.color', option_id: 'red', value: '赤い瞳', quote: 'ミオの目は赤い。' },
        ],
      }],
      unresolved: [],
    });

    const result = await extractCharacterAutofillWithCoverage(client, episode(manuscript));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.structuredFields).toMatchObject({
      hair: { color: 'black', length: 'short' },
      eyes: { eyelid_type: 'single', color: 'green' },
      clothing: { description: '白と青のしましまの上着' },
    });
    expect(result.candidates[0]?.structuredFields).not.toMatchObject({ eyes: { color: 'red' } });
    expect(result.candidates[0]?.freeDescription).toContain('白と青のしましまの上着');
  });

  it('人外プロフィール内の変化を照合後も状態変化として保持し基本外見には混ぜない', async () => {
    const change = '黒影の魔物の顔に白い仮面が現れる';
    const manuscript = ` * 黒影の魔物（人型ではない存在）\n   * 容姿： 不定形の怪物。${change}。`;
    const client = new FakeStoryAiClient([{
      name: '黒影の魔物', name_quote: '黒影の魔物', entity_type: 'nonhuman', changes: [],
      appearance: [{ field: 'base_form', value: '不定形の怪物', quote: '不定形の怪物' }],
    }], {
      additions: [{
        name: '黒影の魔物', name_quote: '黒影の魔物', entity_type: 'nonhuman',
        appearance: [{ field: 'distinctive_features', option_id: null, value: '白い仮面', quote: change }],
        changes: [{ name: '仮面の出現', description: '白い仮面が現れる', quote: change }],
      }], unresolved: [],
    });

    const result = await extractCharacterAutofillWithCoverage(client, episode(manuscript));

    expect(result.candidates[0]?.structuredFields).toMatchObject({ base_form: 'custom' });
    expect(result.candidates[0]?.freeDescription).not.toContain('白い仮面');
    expect(result.candidates[0]?.changes).toEqual([
      { name: '白い仮面が現れる', description: '白い仮面が現れる', quote: change },
    ]);
  });

  it('仮定文の一重と目色を直前の人物の外見として回収しない', async () => {
    const manuscript = 'ミオは黒髪。もし目が一重で緑色なら、印象が変わる。';
    const client = new FakeStoryAiClient(
      [{ name: 'ミオ', name_quote: 'ミオは黒髪。', entity_type: 'character', appearance: [], changes: [] }],
      emptyCoverage(),
    );

    const result = await extractCharacterAutofillWithCoverage(client, episode(manuscript));

    expect(result.candidates[0]?.structuredFields).not.toHaveProperty('eyes');
  });

  it('目と髪の間に別の説明があるとき髪色を目色にしない', async () => {
    const manuscript = 'ミオの目は細く髪は緑色である。';
    const client = new FakeStoryAiClient(
      [{ name: 'ミオ', name_quote: manuscript, entity_type: 'character', appearance: [], changes: [] }],
      emptyCoverage(),
    );

    const result = await extractCharacterAutofillWithCoverage(client, episode(manuscript));

    expect(result.candidates[0]?.structuredFields).not.toHaveProperty('eyes.color');
  });

  it('目色の後に上着の二重構造があっても二重まぶたにしない', async () => {
    const manuscript = 'ミオの目は緑色で上着は二重構造である。';
    const client = new FakeStoryAiClient(
      [{ name: 'ミオ', name_quote: manuscript, entity_type: 'character', appearance: [], changes: [] }],
      emptyCoverage(),
    );

    const result = await extractCharacterAutofillWithCoverage(client, episode(manuscript));

    expect(result.candidates[0]?.structuredFields).toMatchObject({ eyes: { color: 'green' } });
    expect(result.candidates[0]?.structuredFields).not.toHaveProperty('eyes.eyelid_type');
  });

  it('初回抽出で保持済みの省略外見に重複reviewを出さない', async () => {
    const manuscript = 'ミオは黒髪。左頬に星形の傷がある。';
    const client = new FakeStoryAiClient([{
      name: 'ミオ', name_quote: 'ミオは黒髪。', entity_type: 'character', changes: [],
      appearance: [{ field: 'distinguishing_features', value: '星形の傷', quote: manuscript }],
    }], emptyCoverage());

    const result = await extractCharacterAutofillWithCoverage(client, episode(manuscript));

    expect(result.candidates[0]?.freeDescription).toContain('星形の傷');
    expect(result.unresolved).toEqual([]);
  });

  it('直前の人外主体を越えて省略外見を人間に誤帰属しない', async () => {
    const manuscript = 'ミオは黒髪。ルゥは青い生き物。目は緑色。';
    const client = new FakeStoryAiClient([
      { name: 'ミオ', name_quote: 'ミオは黒髪。', entity_type: 'character', appearance: [], changes: [] },
      { name: 'ルゥ', name_quote: 'ルゥは青い生き物。', entity_type: 'nonhuman', appearance: [], changes: [] },
    ], emptyCoverage());

    const result = await extractCharacterAutofillWithCoverage(client, episode(manuscript));
    const mio = result.candidates.find(candidate => candidate.name === 'ミオ');

    expect(mio?.structuredFields).toMatchObject({ hair: { color: 'black' } });
    expect(mio?.structuredFields).not.toMatchObject({ eyes: { color: 'green' } });
  });

  it('初回抽出内の同名競合は両方を保留し後続スキャンで復活させない', async () => {
    const green = 'アキの目は緑色。';
    const blue = 'アキの目は青い。';
    const client = new FakeStoryAiClient([
      { name: 'アキ', name_quote: green, entity_type: 'character', appearance: [{ field: 'eyes.color', value: '緑色', quote: green }], changes: [] },
      { name: 'アキ', name_quote: blue, entity_type: 'character', appearance: [{ field: 'eyes.color', value: '青い', quote: blue }], changes: [] },
    ], emptyCoverage());

    const result = await extractCharacterAutofillWithCoverage(client, episode(`${green}${blue}`));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.structuredFields).not.toHaveProperty('eyes.color');
    expect(result.unresolved).toEqual(expect.arrayContaining([
      { quote: green, reason: 'conflicting_traits' },
      { quote: blue, reason: 'conflicting_traits' },
    ]));
  });
});

class FakeStoryAiClient implements StoryAiClientPort {
  public coverageRequest: StoryAiModelRequest | null = null;

  public constructor(
    private readonly extraction: Awaited<ReturnType<NonNullable<StoryAiClientPort['extractCharacterAutofill']>>>,
    private readonly coverage: CharacterAppearanceCoverageResponse,
  ) {}

  public async *streamCollaboration(): AsyncGenerator<string, void, void> {}
  public async generatePageSkeleton() { return []; }
  public async improveEpisodeDraft() { return { introduction: null, middle: null, climax: null, endingHook: null }; }
  public async extractCharacterAutofill() { return this.extraction; }
  public async reconcileCharacterAutofillCoverage(request: StoryAiModelRequest) {
    this.coverageRequest = request;
    return this.coverage;
  }
}

function emptyCoverage(): CharacterAppearanceCoverageResponse {
  return { additions: [], unresolved: [] };
}

function episode(storyFullDraft: string): Episode {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    chapterId: '22222222-2222-4222-8222-222222222222',
    order: 1,
    title: null,
    purpose: null,
    storyInputMode: 'full',
    storyFullDraft,
    introduction: null,
    middle: null,
    climax: null,
    endingHook: null,
    estimatedPages: 1,
    entitiesInvolved: [],
    pageSkeletonGenerated: false,
    version: 1,
    editHistory: [],
    status: 'draft',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}
