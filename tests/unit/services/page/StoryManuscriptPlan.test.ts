import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseStoryManuscript } from '../../../../packages/api-contract/src/storyManuscript.js';
import {
  applyManuscriptDirections,
  collectManuscriptPlanViolations,
  ManuscriptPlanConstraintError,
  prepareEpisodeManuscriptPlan,
  validateManuscriptPlan,
} from '../../../../src/services/page/StoryManuscriptPlan.js';
import type { EpisodePagePlanContext, EpisodePagePlanSuggestion } from '../../../../src/domain/types/page.js';

const source = 'ミオは港へ向かう。\n---\nミオとカイが握手をする。二人は一緒に船を見上げる。\n---\n船が出港していく。';
function context(raw = source): EpisodePagePlanContext {
  return {
    episodeId: 'episode', workId: 'work',
    chapter: { id: 'chapter', title: null, purpose: null, startingState: null, endingState: null, emotionCurve: null, keyBeats: [] },
    episode: { productionNotesEnabled: true, title: null, purpose: null, storyFullDraft: raw,
      introduction: null, middle: null, climax: null, endingHook: null, estimatedPages: 1 },
    scenes: [], entities: [], stateLibrary: [],
    pages: [{ pageId: 'page', pageNumber: 1, frameCount: 5, status: 'designing', dialogueMode: 'mixed', pageDialogueToggle: true,
      layoutConfig: { story_manuscript: { version: 1, source: raw,
        panels: ['segment-1', 'segment-1', 'segment-2', 'segment-3', 'segment-3'].map((blockId, i) => ({ order: i + 1, blockId })) } },
      panels: Array.from({ length: 5 }, (_, i) => ({ id: `panel-${i + 1}`, order: i + 1, panelRole: 'action', panelSize: 'standard',
        situationText: null, composition: { source: 'ai_auto', galleryItemId: null, compositionPrompt: null, shotType: null, angle: null, customNote: null },
        dialogueInPanel: false, dialogue: [], sfxText: null, backgroundNote: null, panelNotes: null, entities: [] })),
    }],
  };
}
function suggestion(): EpisodePagePlanSuggestion {
  return { pages: [{ pageId: 'page', pageNumber: 1, panels: [
    'ミオは港へ向かう。', 'ミオが立ち止まる。', 'ミオとカイが握手をする。二人は一緒に船を見上げる。',
    '船が出港していく。', '二人が見送る。',
  ].map((situationText, i) => ({ order: i + 1, situationText, entities: [] })) }] };
}

describe('manuscript allocation through final autofill', () => {
  it('15ページの脚本で人物設定を省略し継続状態を再記述しても全60区間の配置を保つ', () => {
    const raw = readFileSync(new URL('../../../fixtures/manuscript-clocktower-15.txt', import.meta.url), 'utf8');
    const parsed = parseStoryManuscript(raw, true);
    const input = context(raw);
    const template = input.pages[0]!;
    input.pages = parsed.pages.map((page, pageIndex) => {
      // Reproduce the saved sparse-edge layout without any user identifiers.
      const slots = page.blocks.flatMap(block => Array.from({ length: block.fixedPanel ? 1 : 4 }, () => block.id))
        .map((blockId, index) => ({ order: index + 1, blockId }));
      return { ...template, pageId: `page-${pageIndex + 1}`, pageNumber: pageIndex + 1, frameCount: slots.length,
        layoutConfig: { story_manuscript: { version: 1, source: raw, panels: slots } },
        panels: slots.map(slot => ({ ...template.panels[0]!, id: `panel-${pageIndex}-${slot.order}`, order: slot.order })) };
    });
    const plan = prepareEpisodeManuscriptPlan(input)!;
    expect(input.pages).toHaveLength(15);
    expect(plan.blocks).toHaveLength(60);
    expect(plan.blocks[0]?.anchor).toBe('港町の中央に、細長い鐘楼がそびえている。');
    const output: EpisodePagePlanSuggestion = { pages: input.pages.map(page => ({
      pageId: page.pageId, pageNumber: page.pageNumber,
      panels: page.panels.map(panel => ({ order: panel.order, entities: [], situationText: plan.blocks
        .filter(block => block.slots[0]?.pageId === page.pageId && block.slots[0]?.order === panel.order)
        .map(block => block.text).join('\n') })),
    })) };
    const first = output.pages[0]!.panels[0]!;
    first.situationText = first.situationText!.slice(first.situationText!.indexOf('【本文】') + '【本文】'.length).trim();
    output.pages[10]!.panels[1]!.situationText += '\nルクスの胴体に鎖はない。';
    expect(collectManuscriptPlanViolations(plan, output)).toEqual([]);
    const directed = applyManuscriptDirections(plan, output);
    expect(directed.pages[0]!.panels[0]!.composition?.customNote).toContain('最初のコマを横長');
    expect(directed.pages[7]!.panels[1]!.composition?.customNote).toContain('覚醒');
    expect(applyManuscriptDirections(plan, directed)).toEqual(directed);
    const moved = structuredClone(output);
    moved.pages[14]!.panels[0]!.situationText = '三者の最終状態を描く。';
    expect(collectManuscriptPlanViolations(plan, moved)).toContainEqual(
      expect.objectContaining({ constraintId: 'segment-57', reason: 'missing_block_anchor' }),
    );
  });
  it('部分指定の中央だけ1コマで前後は複数コマのまま許可する', () => {
    const plan = prepareEpisodeManuscriptPlan(context());
    expect(plan?.blocks.map(block => block.slots.length)).toEqual([2, 1, 2]);
    expect(plan?.blocks.map(block => block.fixedPanel)).toEqual([false, true, false]);
    expect(() => validateManuscriptPlan(plan, suggestion())).not.toThrow();
  });
  it('固定コマの一部だけを後ろのコマへ移した場合も拒否する', () => {
    const output = suggestion();
    output.pages[0]!.panels[2]!.situationText = 'ミオとカイが握手をする。';
    output.pages[0]!.panels[4]!.situationText = '二人は一緒に船を見上げる。';
    expect(() => validateManuscriptPlan(prepareEpisodeManuscriptPlan(context()), output)).toThrow('別のコマ');
  });
  it('短い日本語の動作でも固定コマ外への分割を拒否する', () => {
    const raw = source.replace('ミオとカイが握手をする。二人は一緒に船を見上げる。', 'アキが跳ぶ。リンが叫ぶ。');
    const output = suggestion();
    output.pages[0]!.panels[2]!.situationText = 'アキが跳ぶ。';
    output.pages[0]!.panels[4]!.situationText = 'リンが叫ぶ。';
    expect(() => validateManuscriptPlan(prepareEpisodeManuscriptPlan(context(raw)), output)).toThrow('別のコマ');
  });
  it('後の監査・修復で別のコマへ移された場面を拒否する', () => {
    const output = suggestion();
    [output.pages[0]!.panels[2]!.situationText, output.pages[0]!.panels[3]!.situationText]
      = [output.pages[0]!.panels[3]!.situationText, output.pages[0]!.panels[2]!.situationText];
    try {
      validateManuscriptPlan(prepareEpisodeManuscriptPlan(context()), output);
      throw new Error('原稿の割当外移動が受理されました');
    } catch (error) {
      expect(error).toBeInstanceOf(ManuscriptPlanConstraintError);
      expect(error).toMatchObject({ constraintId: 'segment-2', reason: 'block_anchor_outside_allowed_slots' });
    }
  });
  it('監査修復が原稿anchorを消した場合は本文を補完せず専用エラーにする', () => {
    const output = suggestion();
    output.pages[0]!.panels[2]!.situationText = '二人は合流し、次の展開へ進む。';
    try {
      validateManuscriptPlan(prepareEpisodeManuscriptPlan(context()), output);
      throw new Error('原稿anchorの欠落が受理されました');
    } catch (error) {
      expect(error).toBeInstanceOf(ManuscriptPlanConstraintError);
      expect(error).toMatchObject({ constraintId: 'segment-2', reason: 'missing_block_anchor' });
    }
    expect(output.pages[0]!.panels[2]!.situationText).toBe('二人は合流し、次の展開へ進む。');
  });
  it('監査修復が固定コマの一部を外へ分割した場合も専用エラーにする', () => {
    const output = suggestion();
    output.pages[0]!.panels[2]!.situationText = 'ミオとカイが握手をする。';
    output.pages[0]!.panels[4]!.situationText = '二人は一緒に船を見上げる。';
    try {
      validateManuscriptPlan(prepareEpisodeManuscriptPlan(context()), output);
      throw new Error('固定コマの分割が受理されました');
    } catch (error) {
      expect(error).toBeInstanceOf(ManuscriptPlanConstraintError);
      expect(error).toMatchObject({ constraintId: 'segment-2', reason: 'fixed_panel_split' });
    }
  });
  it('閉じた冒頭人物設定をコマ本文へ転記しなくても場面が残っていれば許可する', () => {
    const raw = '【登場人物の基本設定】\nミオ：黒髪で緑の瞳。\n【本文】\n' + source;
    const input = context(raw);
    const plan = prepareEpisodeManuscriptPlan(input);
    expect(plan?.blocks[0]?.anchor).toBe('ミオは港へ向かう。');
    expect(() => validateManuscriptPlan(plan, suggestion())).not.toThrow();
    expect(input.episode.storyFullDraft).toBe(raw);
    expect(plan?.blocks[0]?.text).toContain('ミオ：黒髪で緑の瞳。');
    const missingScene = suggestion();
    missingScene.pages[0]!.panels[0]!.situationText = 'ミオ：黒髪で緑の瞳。';
    expect(collectManuscriptPlanViolations(plan, missingScene)).toContainEqual(
      expect.objectContaining({ constraintId: 'segment-1', reason: 'missing_block_anchor' }),
    );
  });
  it('閉じていない人物設定や物語中の見出しは黙って原稿から除外しない', () => {
    const raw = '【登場人物の基本設定】\nミオ：黒髪で緑の瞳。\n' + source;
    expect(prepareEpisodeManuscriptPlan(context(raw))?.blocks[0]?.anchor).toBe('【登場人物の基本設定】');
    const ordinary = '壁に書かれた【本文】を読む。\n' + source;
    expect(prepareEpisodeManuscriptPlan(context(ordinary))?.blocks[0]?.anchor).toBe('壁に書かれた【本文】を読む。');
  });
  it('人物設定だけに割り当てた区間は空のanchorを作らず構成修正を案内する', () => {
    const raw = '【登場人物の基本設定】\nミオ：黒髪。\n【本文】\n---\n船に乗る。\n---\n船が出る。';
    expect(() => prepareEpisodeManuscriptPlan(context(raw))).toThrow('人物設定だけの区間');
  });
  it('継続中の外見を別コマでも記述した場合は固定コマの分割と誤認しない', () => {
    const raw = source.replace('二人は一緒に船を見上げる。', 'ルクスの胴体に鎖はない。');
    const output = suggestion();
    output.pages[0]!.panels[2]!.situationText = 'ミオとカイが握手をする。ルクスの胴体に鎖はない。';
    output.pages[0]!.panels[4]!.situationText += 'ルクスの胴体に鎖はない。';
    expect(collectManuscriptPlanViolations(prepareEpisodeManuscriptPlan(context(raw)), output)).toEqual([]);
  });
  it('外見だけの固定コマでも元のコマに残る記述の反復を許可する', () => {
    const raw = source.replace('ミオとカイが握手をする。二人は一緒に船を見上げる。', 'ルクスの胴体に鎖はない。');
    const output = suggestion();
    output.pages[0]!.panels[2]!.situationText = 'ルクスの胴体に鎖はない。';
    output.pages[0]!.panels[4]!.situationText += 'ルクスの胴体に鎖はない。';
    expect(collectManuscriptPlanViolations(prepareEpisodeManuscriptPlan(context(raw)), output)).toEqual([]);
  });
  it('継続描写を許可しても固定コマの台詞を指定外へ複製することは拒否する', () => {
    const raw = source.replace('二人は一緒に船を見上げる。', 'ミオ「一緒に行こう」');
    const output = suggestion();
    output.pages[0]!.panels[2]!.situationText = 'ミオとカイが握手をする。ミオ「一緒に行こう」';
    output.pages[0]!.panels[4]!.situationText = 'ミオ「一緒に行こう」';
    expect(collectManuscriptPlanViolations(prepareEpisodeManuscriptPlan(context(raw)), output)).toContainEqual(
      expect.objectContaining({ constraintId: 'segment-2', reason: 'fixed_panel_split' }),
    );
  });
  it.each(['Mio said "Go now."', 'Mio said “Go now.”'])(
    '英語の明示引用 %s も固定コマ外への台詞複製を拒否する', dialogue => {
      const raw = source.replace('ミオとカイが握手をする。二人は一緒に船を見上げる。', dialogue);
      const output = suggestion();
      output.pages[0]!.panels[2]!.situationText = dialogue;
      output.pages[0]!.panels[4]!.situationText = dialogue;
      expect(collectManuscriptPlanViolations(prepareEpisodeManuscriptPlan(context(raw)), output)).toContainEqual(
        expect.objectContaining({ constraintId: 'segment-2', reason: 'fixed_panel_split' }),
      );
    },
  );
  it('原稿変更後の古い構成・配置先欠落・固定コマ分裂を拒否する', () => {
    const changed = context();
    changed.episode.storyFullDraft += '\n追加';
    expect(() => prepareEpisodeManuscriptPlan(changed)).toThrow('先に生成');
    const split = context();
    split.pages[0]!.layoutConfig = { story_manuscript: { version: 1, source,
      panels: ['segment-1', 'segment-2', 'segment-2', 'segment-3', 'segment-3'].map((blockId, i) => ({ order: i + 1, blockId })) } };
    expect(() => prepareEpisodeManuscriptPlan(split)).toThrow('1コマ指定');
  });
  it('位置のある指示を該当コマだけへ保存し再適用しても重複しない', () => {
    const raw = 'ミオは港へ向かう。\n＃主人公を引きアングルで＃\n船が出港していく。';
    const plan = prepareEpisodeManuscriptPlan(context(raw));
    expect(plan?.directions[0]?.anchor).toBe('船が出港していく。');
    const first = applyManuscriptDirections(plan, suggestion());
    expect(first.pages[0]!.panels[0]!.composition?.customNote).toBeUndefined();
    expect(first.pages[0]!.panels[3]!.composition?.customNote).toBe('[作画指示] 主人公を引きアングルで');
    expect(applyManuscriptDirections(plan, first)).toEqual(first);
  });
  it('シーン末尾の指示は直前のシーンへ付ける', () => {
    const plan = prepareEpisodeManuscriptPlan(context('ミオは港へ向かう。船が出港していく。＃引きで＃'));
    expect(plan?.directions[0]?.anchor).toBe('船が出港していく。');
  });
  it('境界のない作画指示は全出力コマを候補にして欠落を監査に渡す', () => {
    const plan = prepareEpisodeManuscriptPlan(context('ミオは港へ向かう。＃引きで＃船が出港していく。'));
    const output = suggestion();
    output.pages[0]!.panels[3]!.situationText = '船が動き出す。';

    expect(collectManuscriptPlanViolations(plan, output)).toContainEqual({
      constraintId: 'segment-1',
      reason: 'direction_target_ambiguous',
      allowedSlots: ['page:1', 'page:2', 'page:3', 'page:4', 'page:5'],
      actualSlots: [],
      directionIndex: 0,
    });
  });
  it('同じblockの複数指示はdirectionIndexで違反anchorを区別する', () => {
    const raw = 'ミオが歩く。＃引きで＃カイが頷く。＃寄りで＃船が出港する。';
    const plan = prepareEpisodeManuscriptPlan(context(raw));
    const output = suggestion();
    output.pages[0]!.panels[0]!.situationText = 'ミオが歩く。';
    output.pages[0]!.panels[1]!.situationText = 'カイが頷く。';
    output.pages[0]!.panels[2]!.situationText = '船が動く。';
    output.pages[0]!.panels[3]!.situationText = '港を見送る。';
    output.pages[0]!.panels[4]!.situationText = '二人が立ち尽くす。';

    const violations = collectManuscriptPlanViolations(plan, output)
      .filter(violation => violation.reason === 'direction_target_ambiguous');
    expect(plan?.directions.map(direction => direction.anchor)).toEqual([
      'カイが頷く。',
      '船が出港する。',
    ]);
    expect(violations).toEqual([expect.objectContaining({
      constraintId: 'segment-1',
      directionIndex: 1,
      actualSlots: [],
    })]);
  });
  it('同じ文が別の指定コマに再登場しても保存済みの配置先で区別する', () => {
    const raw = '---\nカイが頷く。\n---\nカイが頷く。\n---';
    const input = context(raw);
    input.pages[0]!.panels = input.pages[0]!.panels.slice(0, 2);
    input.pages[0]!.frameCount = 2;
    input.pages[0]!.layoutConfig = { story_manuscript: { version: 1, source: raw,
      panels: [{ order: 1, blockId: 'segment-2' }, { order: 2, blockId: 'segment-3' }] } };
    const plan = prepareEpisodeManuscriptPlan(input);
    const bothOwned = { pages: [{ pageId: 'page', pageNumber: 1,
      panels: [1, 2].map(order => ({ order, situationText: 'カイが頷く。', entities: [] })) }] };
    expect(() => validateManuscriptPlan(plan, bothOwned)).not.toThrow();

    const firstMissing = structuredClone(bothOwned);
    firstMissing.pages[0]!.panels[0]!.situationText = 'カイが動きで応える。';
    expect(collectManuscriptPlanViolations(plan, firstMissing)).toContainEqual({
      constraintId: 'segment-2',
      reason: 'missing_block_anchor',
      allowedSlots: ['page:1'],
      actualSlots: [],
    });
  });
  it('片側しか囲っていないページ境界も同じページへ混ぜない', () => {
    const raw = '前の話\n===\n後の話';
    const input = context(raw);
    input.pages[0]!.panels = input.pages[0]!.panels.slice(0, 2);
    input.pages[0]!.layoutConfig = { story_manuscript: { version: 1, source: raw,
      panels: [{ order: 1, blockId: 'segment-1' }, { order: 2, blockId: 'segment-2' }] } };
    expect(() => prepareEpisodeManuscriptPlan(input)).toThrow('ページ区切り');
  });
});
