import { describe, expect, it } from 'vitest';
import { analyzeStoryManuscript, parseStoryManuscript, splitStoryManuscriptForEditing } from '../../../packages/api-contract/src/storyManuscript.js';

describe('story manuscript commands', () => {
  it('AI改善用の分離と再結合で記号と改行を変更しない', () => {
    const raw = '前\r\n---\r\n＃引きで＃場面\r\n＝＝＝\r\n後';
    const parts = splitStoryManuscriptForEditing(raw);
    expect(parts.map(part => part.text).join('')).toBe(raw);
    expect(parts.filter(part => part.kind === 'command').map(part => part.text)).toEqual(['---\r\n', '＃引きで＃', '＝＝＝\r\n']);
  });
  it('部分指定では囲まれた場面だけ固定し前後は自動分割のままにする', () => {
    const parsed = parseStoryManuscript('長い前半\n---\nここだけ1コマ\n---\n長い後半', true);
    expect(parsed.pages[0]?.blocks.map(block => block.fixedPanel)).toEqual([false, true, false]);
    const pages = parseStoryManuscript('長い前半\n===\nここだけ1ページ\n===\n長い後半', true);
    expect(pages.pages.map(page => page.fixedPage)).toEqual([false, true, false]);
    expect(pages.explicitPageCount).toBeNull();
  });
  it('異なる境界に挟まれた内容も1コマになる', () => {
    const parsed = parseStoryManuscript('前のページ\n＝＝＝\nあるコマA\nーーー\n長い会話と動作。さらに会話。\n---\n次のコマ\n===\n最後のページ', true);
    expect(parsed.explicitPageCount).toBeNull();
    expect(parsed.pages[1]?.explicitPanels).toBe(true);
    expect(parsed.pages[1]?.blocks.map(block => block.text)).toEqual(['あるコマA', '長い会話と動作。さらに会話。', '次のコマ']);
    expect(parsed.pages[1]?.blocks.every(block => block.fixedPanel)).toBe(true);
    expect(parsed.minimumPanelCount).toBe(5);
  });
  it('指示を本文と分離し原稿内の所属コマを維持する', () => {
    const parsed = parseStoryManuscript('前\n---\n＃このシーンは主人公を引きアングルで＃\n主人公が歩く。\n---\n後', true);
    expect(parsed.prose).not.toContain('引きアングル');
    expect(parsed.pages[0]?.blocks[1]?.directions[0]?.instruction).toBe('このシーンは主人公を引きアングルで');
    expect(parsed.pages[0]?.blocks).toHaveLength(3);
  });
  it('通常の見出し・本文内記号を維持しOFFでは原文をそのまま返す', () => {
    const text = '# 第一話\na---b\n＃引きで＃話\n===\n次';
    expect(parseStoryManuscript(text, false).prose).toBe(text);
    expect(parseStoryManuscript(text, true).prose).toContain('# 第一話\na---b');
    const heading = '# 第一話 #\n本文';
    expect(parseStoryManuscript(heading, true).prose).toBe(heading);
    expect(splitStoryManuscriptForEditing(heading)).toEqual([{ kind: 'prose', text: heading }]);
    expect(parseStoryManuscript('前\n\\---\n後', true).hasCommands).toBe(false);
  });
  it('先頭末尾の区切りから空ページや空コマを作らない', () => {
    const parsed = parseStoryManuscript('===\nA\n---\nB\n===', true);
    expect(parsed.explicitPageCount).toBe(1);
    expect(parsed.minimumPanelCount).toBe(2);
  });
  it('指示を挟んだ単語を連結して新しい外見情報にしない', () => {
    expect(analyzeStoryManuscript('黒＃引きで＃髪', true).prose).toBe('黒\n\n髪');
  });
  it('閉じ忘れ・空指示・対象なしを拒否する', () => {
    for (const text of ['＃引きで\n場面', '＃＃場面', '＃引きで＃\n---\n場面']) {
      expect(() => parseStoryManuscript(text, true)).toThrow();
    }
  });
  it('従来の定型指示行を推定本文に混入させない', () => {
    expect(analyzeStoryManuscript('A\nB\n# 「A」と「B」は同じコマにする。', true).prose).toBe('A\nB');
  });
});
