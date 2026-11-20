import { describe, expect, it, vi } from 'vitest';
import { parseStoryManuscript } from '../../../../packages/api-contract/src/storyManuscript.js';
import { buildStoryManuscriptSkeleton, resolveManuscriptPageGroups, type ManuscriptBlockCompilation } from '../../../../src/services/story/StoryManuscriptSkeleton.js';
import type { PageSkeletonPanelDraft } from '../../../../src/domain/types/storyAi.js';

const panel = (text: string): PageSkeletonPanelDraft => ({
  order: 1, panelRole: 'action', suggestedSize: 'standard', situationHint: text,
  suggestedEntities: [], suggestedDialogueHint: null,
});

describe('StoryManuscriptSkeleton', () => {
  it('自由領域のAIが選んだページ別コマ数を均等4コマへ潰さない', async () => {
    const source = '長い本文。＃引きで＃後半の本文。';
    const compileBlock = vi.fn(async (_input: ManuscriptBlockCompilation) => ({
      panels: Array.from({ length: 8 }, (_, index) => panel(`場面${index}`)),
      layouts: [{ start: 0, count: 3, template: 'top_wide_3' as const },
        { start: 3, count: 5, template: 'action_5' as const }],
    }));
    const pages = await buildStoryManuscriptSkeleton({ source, manuscript: parseStoryManuscript(source, true),
      estimatedPages: 2, entities: [], compileBlock });
    expect(compileBlock.mock.calls[0]?.[0]).toMatchObject({ pageCount: 2 });
    expect(pages.map(page => page.panels.length)).toEqual([3, 5]);
    expect(pages.map(page => page.suggestedLayout)).toEqual(['top_wide_3', 'action_5']);
  });
  it('コマとページ範囲が変わらない場合にAIの有効なレイアウトを維持する', async () => {
    const source = '===\n本文\n===';
    const pages = await buildStoryManuscriptSkeleton({ source, manuscript: parseStoryManuscript(source, true),
      estimatedPages: 1, entities: [], compileBlock: async () => ({
        panels: [panel('前'), panel('後')], layouts: [{ start: 0, count: 2, template: 'vertical_2' }],
      }) });
    expect(pages[0]?.suggestedLayout).toBe('vertical_2');
  });

  it('途中のコマだけを指定した場合に前後は複数コマを保つ', async () => {
    const source = '前の物語\n---\nアキが跳ぶ。\n---\n後の物語';
    const compileBlock = vi.fn(async ({ block }: { block: { text: string } }) =>
      [panel(`${block.text}1`), panel(`${block.text}2`)]);
    const pages = await buildStoryManuscriptSkeleton({ source,
      manuscript: parseStoryManuscript(source, true), estimatedPages: 2,
      entities: [{ id: 'aki', name: 'アキ', aliases: [] }], compileBlock });
    expect(pages).toHaveLength(2);
    expect(pages.flatMap(page => page.panels)).toHaveLength(5);
    expect(pages.flatMap(page => page.panels).filter(item => item.situationHint === 'アキが跳ぶ。'))
      .toEqual([expect.objectContaining({ suggestedEntities: ['aki'] })]);
    expect(compileBlock).toHaveBeenCalledTimes(2);
    expect(pages.flatMap(page => page.manuscriptSource?.panels ?? [])
      .filter(item => item.blockId === 'segment-2')).toHaveLength(1);
    expect(pages.every(page => page.manuscriptSource?.source === source)).toBe(true);
  });

  it('囲まれたページとコマを指定した場合に推定ページ数より手動区切りを優先する', async () => {
    const source = '===\nA\n---\nB\n===';
    const compileBlock = vi.fn();
    const pages = await buildStoryManuscriptSkeleton({ source,
      manuscript: parseStoryManuscript(source, true), estimatedPages: 20, entities: [], compileBlock });
    expect(pages).toHaveLength(1);
    expect(pages[0]?.panels.map(item => item.situationHint)).toEqual(['A', 'B']);
    expect(compileBlock).not.toHaveBeenCalled();
  });

  it('途中に固定ページがある場合に前後の自由領域へ残りを配分する', () => {
    const groups = resolveManuscriptPageGroups(parseStoryManuscript('前\n===\n固定\n===\n後', true), 5);
    expect(groups.map(group => group.pageCount)).toEqual([2, 1, 2]);
    expect(groups.map(group => group.pageNumber)).toEqual([1, 3, 4]);
  });

  it('自由領域がない場合に固定コマ数より多いページを作らない', async () => {
    const source = '---\nA\n---\nB\n---';
    const pages = await buildStoryManuscriptSkeleton({ source,
      manuscript: parseStoryManuscript(source, true), estimatedPages: 10, entities: [], compileBlock: vi.fn() });
    expect(pages).toHaveLength(2);
    expect(pages.map(page => page.panels.length)).toEqual([1, 1]);
  });

  it('固定ページのコマが8を超える場合に本文を捨てずエラーになる', () => {
    const source = `===\n${Array.from({ length: 9 }, (_, i) => `本文${i}`).join('\n---\n')}\n===`;
    expect(() => resolveManuscriptPageGroups(parseStoryManuscript(source, true), 1)).toThrow();
  });

  it('固定コマが2000文字を超える場合に本文を切らずエラーになる', async () => {
    const source = `---\n${'あ'.repeat(2001)}\n---`;
    await expect(buildStoryManuscriptSkeleton({ source, manuscript: parseStoryManuscript(source, true),
      estimatedPages: 1, entities: [], compileBlock: vi.fn() })).rejects.toThrow();
  });

  it('自由部分の生成が割り当て上限を超えた場合に切り捨てずエラーになる', async () => {
    const source = '===\n本文＃引きアングル＃\n===';
    await expect(buildStoryManuscriptSkeleton({ source, manuscript: parseStoryManuscript(source, true),
      estimatedPages: 1, entities: [], compileBlock: async () => Array.from({ length: 9 }, () => panel('本文')) }))
      .rejects.toThrow();
  });
});
