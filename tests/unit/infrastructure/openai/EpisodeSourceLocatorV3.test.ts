import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIEpisodeBeatPlanCompiler } from '../../../../src/infrastructure/openai/OpenAIEpisodeBeatPlanCompiler.js';
import {
  buildEpisodeSourceRequirementExtractionPacks,
  EPISODE_SOURCE_REQUIREMENT_LIMITS,
  prepareEpisodeSourceRequirementExtraction,
  type EpisodeSourceRequirementExtraction,
} from '../../../../src/services/page/EpisodeSourceRequirements.js';

const PAGE_1 = '11111111-1111-4111-8111-111111111111';
const PAGE_2 = '22222222-2222-4222-8222-222222222222';
const ARTIFICIAL_STORY = "タイトル：ココと消えた灯台の光\n全15ページの日本の漫画。読む方向は右から左。各ページ3～5コマ程度を基本に、静かな場面とアクションの緩急を付ける。主役とセリフの話者は、既に登録されている小さな青い丸いロボット「ココ」だけ。赤いマフラー、丸い頭、大きな目という外見は全編で変えない。別の名前付きキャラクターは登場させない。出来事を飛ばさず、下記の順番と因果関係を保ち、15ページ目で必ず物語を完結させる。セリフはかぎ括弧の内容をココの発話として扱う。\n\n1ページ目：朝の公園。ココはいつものベンチで古い絵本を読み、海沿いの町に立つ灯台の絵に目を止める。絵本には、灯台の光が港に帰る船の目印になると書かれている。遠景の海の向こうに同じ灯台が見えるが、朝なのに灯りが消え、雲が低く垂れ込めている。ココは絵本を丁寧に閉じて胸に抱え、「あの光、どうしたんだろう」と小さくつぶやく。出発のきっかけと灯台の方向を画面上で分かるようにする。\n\n2ページ目：ココは海へ続く石畳の坂道を歩く。絵本を開いて、港から灯台へ行く古い道の地図を確かめる。地図には木の橋と、岩場を抜ける細い道、灯台の入口が順に描かれている。坂の途中で立ち止まり、目の前の景色と地図の印を照合してから歩き出す。「道が残っていれば、きっと着ける」。ここではまだ橋を渡らない。ココが自分で行き先を決める姿を示す。\n\n3ページ目：港の手前で、地図にあった木の橋が壊れているのを見つける。中央の板が数枚抜け、その下を流れる水は雨で増えている。ココは足を踏み出しかけて止まり、安全な場所から橋の裂け目を見る。助走して飛ぶことはせず、絵本の地図をもう一度開くと、橋の上流に飛び石の印を見つける。「急いでも、無理はしない」。橋の問題と迂回を選ぶ判断を別のコマで示す。\n\n4ページ目：上流の飛び石へ移動。ココは最初の石を足先で慎重に確かめ、一つずつ重心を移して渡る。途中で濡れた石に足を滑らせ、片膝をつくが、絵本を高く持ち上げて濡らさないよう守る。立ち直って最後の石まで進み、対岸の草地に上がる。「一歩ずつでいい」。滑る前後の足と手の動きをつなげ、瞬間移動したような描写は避ける。\n\n5ページ目：対岸では風が強まり、絵本にはさんでいた一枚の古い地図が飛び出す。ココは絵本を閉じて脇に抱え、空中で回る地図を追う。地図は低い木の枝に引っかかる。ココは幹に足をかけて背伸びし、手を伸ばすが、少し届かない。「あと、ほんの少し」。最後のコマは地図と指先の距離を見せ、次のページへつなぐ。\n\n6ページ目：ココは周囲を見回し、落ちている長い枝を見つける。枝の先を使って地図をそっと手前に寄せ、もう片方の手でつかむ。地図を広げて無事を確認し、絵本にはさんだうえで、赤いマフラーの端で本を軽く巻いて飛び出さないようにする。「大切なものは、ちゃんと守ろう」。マフラーは首から外さず、絵本を固定できる程度に端を使う。取得した地図がこの後の道案内になることを示す。\n\n7ページ目：岩場の入口に到着する。雨が降り始め、岩の間に水がたまっている。ココは地図と、遠くに見える灯台の輪郭を確かめるが、目の前の斜面の高さにひるむ。一度腰を下ろし、濡れた指先を見つめる静かなコマを置く。その後、絵本の表紙に描かれた光を見てゆっくり立ち上がる。「できないからって、終わりじゃない」。くじけそうな表情から決意へ変わる過程を描く。\n\n8ページ目：ココは岩壁に張り付くような危険な登り方をやめ、地図にある低い通路を探す。足元の苔の切れ目と、古い矢印の刻まれた石を発見する。矢印に沿って狭い岩の隙間を横向きで通り、出口へ進む。隙間の途中で絵本が引っかかりそうになり、胸へ寄せて向きを変える。「近道より、確かな道」。狭い入口、通り抜ける体勢、出口の順に描く。\n\n9ページ目：岩の通路の出口から、灯台の白い壁が大きく見える。雨はやみ、空の一部が明るくなる。ココは入口の古い扉を押すが動かない。扉の下に小石が挟まっていると気づき、しゃがんで小石を取り除く。再び扉を押すと隙間から暗い内部が見える。「やっと、入口まで来た」。扉が開く前に内部へ移動させない。灯台へ入るまでをこのページで描く。\n\n10ページ目：灯台の中は薄暗く、中央にらせん階段が続いている。ココは絵本を抱えて一段ずつ上り、途中で窓から港を見下ろす。高くなった視点から、来た道と壊れた橋、迂回した川が小さく見える。足を止めて息を整え、さらに上へ向かう。「ちゃんと、ここまで来られた」。階段の登りと休憩の位置関係を保ち、まだ灯りの装置には触れない。\n\n11ページ目：最上階の灯室に到着。大きなレンズはあるが、内部のランプは消えている。床の脇には手回し発電機のハンドルと、それにつながる太いケーブルが見える。ココは絵本の灯台のページを開き、絵に描かれたケーブルの形と実物を見比べる。実物のケーブルの先が、壁の端子から抜けていることに気づく。「光が消えた理由、見つけた」。原因は抜けたケーブルだけで、未知の機械を新たに出さない。\n\n12ページ目：ココは端子の周りの水気がないことを確かめ、手回し発電機が止まっている状態でケーブルを元の端子へ差し込む。少しぐらつくので差し込み口の位置を直し、奥まで確実につなぐ。ケーブルを引いて抜けないことを軽く確認するが、ランプはまだ光らない。ココは振り返ってハンドルを見る。「次は、ぼくの番だ」。接続だけで勝手に点灯する展開にはしない。\n\n13ページ目：ココがハンドルを回し始める。最初はゆっくり、少しずつ速く回すと、小さなランプが一瞬点滅する。ココはうれしそうに目を見開くが、手を止めかけると光が弱くなる。すぐに両手でハンドルを握り直して一定の速さで回し続ける。「もう少し、もう少し！」。手の動きとランプの変化を対応させ、努力が光へつながることを描く。\n\n14ページ目：ランプが安定して明るくなり、大きなレンズを通した光が港へ伸びる。ココはハンドルを回しながら、窓の外にゆっくり港へ戻る小さな船の影を見る。船の人は描き込まず、姿は遠景のシルエットだけにする。雨雲の下でも灯台の光が道筋を示している。ココは安心した顔で、「届いた」と短く言う。ページの最後には外から見た灯台と港を入れ、物語の到達点を大きく見せる。\n\n15ページ目：夕方。手回し発電機の装置が十分に充電され、ハンドルから手を離しても光が続く。ココは点灯が続くことを確認してから、赤いマフラーの端をほどいて絵本を開く。最初に見た灯台の絵と、窓の外の本物の灯りを交互に見せる。ココは絵本を閉じ、満足して窓辺に座る。「一歩ずつでも、光にたどり着ける」。最後は夕暮れの海と灯台の光、窓の中の小さなココを静かに描いて完結する。新たな事件や続きのフックは付けない。";
interface ProviderRecord {
  i: number; u: number; o: number; e: string[]; r: Array<string | null>;
  a: number[]; c: Array<string | null>; z: boolean[]; x: string[]; q: string[];
}
function fragmentId(unit: EpisodeSourceRequirementExtraction['units'][number], value: string): string {
  const fragment = unit.fragmentCatalog.find((candidate) =>
    unit.text.slice(candidate.start, candidate.end) === value);
  if (fragment === undefined) throw new Error(`Missing test fragment: ${value}`);
  return fragment.id;
}
function prepare(story: string): EpisodeSourceRequirementExtraction {
  const result = prepareEpisodeSourceRequirementExtraction({
    storyFullDraft: story, pages: [{ pageId: PAGE_1, pageNumber: 1 }],
  });
  if (result === null) throw new Error('Invalid test extraction');
  return result;
}
function rowsFor(extraction: EpisodeSourceRequirementExtraction): ProviderRecord[] {
  const orders = new Map<string, number>();
  return extraction.units.flatMap((unit, index) => {
    const text = unit.text.trim();
    if (text.length === 0) return [];
    const order = (orders.get(unit.pageId ?? 'global') ?? 0) + 1;
    orders.set(unit.pageId ?? 'global', order);
    return [{
      i: index + 1, u: index + 1, o: order,
      e: unit.scope === 'global' ? [] : [fragmentId(unit, text)],
      r: unit.scope === 'global' ? [] : [null], a: [],
      c: unit.scope === 'global' ? [] : [null],
      z: unit.scope === 'global' ? [] : [true], x: [], q: [],
    }];
  });
}
async function compile(
  extraction: EpisodeSourceRequirementExtraction, rows: ProviderRecord[],
  requests: Array<Record<string, unknown>> = [],
): Promise<Awaited<ReturnType<OpenAIEpisodeBeatPlanCompiler['compileSourceRequirements']>>> {
  const client = {
    postJson: async (_path: string, payload: Record<string, unknown>) => {
      requests.push(payload);
      return { body: { output_text: JSON.stringify({ requirements: rows }) }, requestId: 'req-v3-test' };
    },
  } as unknown as OpenAIClient;
  return new OpenAIEpisodeBeatPlanCompiler(client).compileSourceRequirements({ extraction, language: 'ja' });
}

// Spec §6: globally unique fragment IDs resolve only through their owning unit;
// all packs are bounded before payment, while semantic quality is checked separately.
describe('原文fragment ID v4の受入契約', () => {
  it('日本語・絵文字・改行・引用符のfragmentが元UTF16 spanを完全保持する', () => {
    const original = '1ページ目：😀が「はい」と言う。\n次の行は"引用"、“確認”と続ける。\n';
    const extraction = prepare(original);
    expect(extraction.units.map(unit => unit.text).join('')).toBe(original);
    const fragments = extraction.units.flatMap(unit => unit.fragmentCatalog.map(fragment => ({ unit, fragment })));
    expect(new Set(fragments.map(({ fragment }) => fragment.id)).size).toBe(fragments.length);
    const emojiUnit = extraction.units.find(unit => unit.text.includes('😀'))!;
    const emojiFragment = emojiUnit.fragmentCatalog.find(fragment =>
      emojiUnit.text.slice(fragment.start, fragment.end).includes('😀'))!;
    expect(emojiUnit.text.slice(emojiFragment.start, emojiFragment.end)).toContain('😀');
    expect(emojiUnit.text.slice(emojiFragment.start, emojiFragment.end)).not.toContain('\uFFFD');
    expect(fragments.some(({ unit, fragment }) =>
      unit.text.slice(fragment.start, fragment.end) === 'はい')).toBe(true);
    expect(fragments.some(({ unit, fragment }) =>
      unit.text.slice(fragment.start, fragment.end) === '引用')).toBe(true);
    expect(fragments.some(({ unit, fragment }) =>
      unit.text.slice(fragment.start, fragment.end) === '確認')).toBe(true);
  });

  it('eventと結果・条件・引用を列挙済みfragmentから正確に復元する', async () => {
    const extraction = prepare('1ページ目：😀、止まり、言う前は待つ、「はい」。');
    const unit = extraction.units[0]!;
    const row = rowsFor(extraction)[0]!;
    row.e = [fragmentId(unit, '😀')];
    row.r = [fragmentId(unit, '止まり')];
    row.c = [fragmentId(unit, '言う前は待つ')];
    row.q = [fragmentId(unit, 'はい')];
    const result = await compile(extraction, [row]);
    expect(result.requirements.requirements[0]).toMatchObject({
      events: ['😀'], results: ['止まり'], quotedText: ['はい'],
      conditionalUntil: '言う前は待つ',
      obligations: [{
        event: '😀', result: '止まり', conditionalUntil: '言う前は待つ', requiredByEnd: true,
      }],
    });
  });

  it('5種類の属性は同じunitの原文spanからすべて正確に復元する', async () => {
    const extraction = prepare('1ページ目：😀、驚き、理由を確かめ、近景、引く。');
    const unit = extraction.units[0]!;
    const row = rowsFor(extraction)[0]!;
    row.x = ['😀', '驚き', '理由を確かめ', '近景', '引く'].map(
      (value, index) => String(index + 1) + ':' + fragmentId(unit, value),
    );
    const result = await compile(extraction, [row]);
    expect(result.requirements.requirements[0]).toMatchObject({
      context: '😀', emotion: '驚き', function: '理由を確かめ', camera: '近景', framing: '引く',
    });
  });
  it.each([
    ['unknown ID', (row: ProviderRecord) => { row.e = ['f9999']; }],
    ['旧numeric range', (row: ProviderRecord) => { row.e = ['1-2']; }],
    ['旧colon', (row: ProviderRecord) => { row.e = ['1:f1']; }],
    ['結果のunknown ID', (row: ProviderRecord) => { row.r = ['f9999']; }],
    ['条件のunknown ID', (row: ProviderRecord) => { row.c = ['f9999']; }],
    ['属性のunknown ID', (row: ProviderRecord) => { row.x = ['5:f9999']; }],
    ['引用のunknown ID', (row: ProviderRecord) => { row.q = ['f9999']; }],
    ['obligation配列の不一致', (row: ProviderRecord) => { row.r = []; }],
  ])('%sの場合に不正な原文を保存せず拒否する', async (_label, change) => {
    const extraction = prepare('1ページ目：😀が進む。');
    const rows = rowsFor(extraction);
    change(rows[0]!);
    await expect(compile(extraction, rows)).rejects.toThrow();
  });

  it('別unitに属するfragment IDの場合に不正な原文を保存せず拒否する', async () => {
    const extraction = prepareEpisodeSourceRequirementExtraction({
      storyFullDraft: '1ページ目：扉を開く。\n2ページ目：窓を閉じる。',
      pages: [
        { pageId: PAGE_1, pageNumber: 1 },
        { pageId: PAGE_2, pageNumber: 2 },
      ],
    })!;
    const firstUnit = extraction.units.find((unit) =>
      unit.pageNumber === 1 && unit.text.trim().length > 0)!;
    const secondUnitIndex = extraction.units.findIndex((unit) =>
      unit.pageNumber === 2 && unit.text.trim().length > 0);
    const rows = rowsFor(extraction);
    const secondRow = rows.find((row) => row.u === secondUnitIndex + 1)!;
    secondRow.e = [firstUnit.fragmentCatalog[0]!.id];

    await expect(compile(extraction, rows)).rejects.toThrow(
      'Source requirement referenced an invalid source span',
    );
  });

  it('JSON escape後だけ32KiBを超える原文を全pack事前判定で拒否する', () => {
    let found: EpisodeSourceRequirementExtraction | undefined;
    for (let count = 200; count <= 7_900; count += 20) {
      const extraction = prepare('1ページ目：' + String.fromCharCode(92).repeat(count) + '。');
      const raw = Buffer.byteLength(extraction.compilerBrief, 'utf8');
      const escaped = Buffer.byteLength(JSON.stringify(extraction.compilerBrief), 'utf8');
      if (raw <= 32_768 && escaped > 32_768) { found = extraction; break; }
    }
    expect(found).toBeDefined();
    expect(buildEpisodeSourceRequirementExtractionPacks(found!, [found!.pages])).toBeNull();
  });

  it('後方packだけが32KiB超過しても先頭packのpaid call前に全体を拒否する', () => {
    const pages = [{ pageId: PAGE_1, pageNumber: 1 }, { pageId: PAGE_2, pageNumber: 2 }];
    const first = prepare('1ページ目：開始。');
    expect(buildEpisodeSourceRequirementExtractionPacks(first, [first.pages])).not.toBeNull();
    const extraction = prepareEpisodeSourceRequirementExtraction({
      storyFullDraft: '1ページ目：開始。\n2ページ目：' + String.fromCharCode(92).repeat(7_000) + '。', pages,
    })!;
    expect(extraction).not.toBeNull();
    expect(buildEpisodeSourceRequirementExtractionPacks(extraction, [pages.slice(0, 1), pages.slice(1)])).toBeNull();
  });

  it('人工15ページ137unitを54+53件の2packに収め実postJson全体も64KiB内に収める', async () => {
    const pages = Array.from({ length: 15 }, (_value, index) => ({
      pageId: String(index + 1).padStart(8, '0') + '-1111-4111-8111-111111111111',
      pageNumber: index + 1,
    }));
    const extraction = prepareEpisodeSourceRequirementExtraction({ storyFullDraft: ARTIFICIAL_STORY, pages })!;
    expect(extraction.units).toHaveLength(137);
    expect(extraction.units.filter(unit => unit.text.trim().length > 0)).toHaveLength(107);
    const packs = buildEpisodeSourceRequirementExtractionPacks(extraction, [pages.slice(0, 8), pages.slice(8)])!;
    expect(packs).toHaveLength(2);
    expect(packs.map(pack => rowsFor(pack).length)).toEqual([54, 53]);
    const requests: Array<Record<string, unknown>> = [];
    for (const pack of packs) {
      await compile(pack, rowsFor(pack), requests);
      expect(Buffer.byteLength(JSON.stringify(pack.compilerBrief), 'utf8')).toBeLessThanOrEqual(32_768);
    }
    const bytes = requests.map(request => Buffer.byteLength(JSON.stringify(request), 'utf8'));
    expect(bytes.every(value => value <= 65_536)).toBe(true);
    requests.forEach((request, index) => {
      const briefBytes = Buffer.byteLength(JSON.stringify(packs[index]!.compilerBrief), 'utf8');
      expect(Buffer.byteLength(JSON.stringify(request), 'utf8') - briefBytes).toBeLessThanOrEqual(32_768);
    });
  });

  it('最大56件の全出力serializerがv4係数と固定reserveの予算内に収まる', () => {
    const span = 'f9999';
    const row: ProviderRecord = {
      i: 512, u: 256, o: 10_000,
      e: Array(5).fill(span), r: Array(5).fill(span),
      a: [512, 512, 512, 512], c: Array(5).fill(span), z: Array(5).fill(false),
      x: ['1:', '2:', '3:', '4:', '5:'].map(kind => kind + span), q: Array(4).fill(span),
    };
    expect(Buffer.byteLength(JSON.stringify(row), 'utf8')).toBe(317);
    expect(Buffer.byteLength(JSON.stringify(row), 'utf8')).toBeLessThanOrEqual(
      EPISODE_SOURCE_REQUIREMENT_LIMITS.maxProviderBytesPerRequirement,
    );
    const bytes = Buffer.byteLength(JSON.stringify({ requirements: Array(56).fill(row) }), 'utf8');
    expect(bytes).toBeLessThanOrEqual(317 * 56 + 2_048);
    expect(bytes).toBeLessThanOrEqual(EPISODE_SOURCE_REQUIREMENT_LIMITS.maxProviderOutputBytes);
  });
});
