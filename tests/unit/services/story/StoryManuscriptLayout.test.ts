import { describe, expect, it, vi } from 'vitest';
import { parseStoryManuscript } from '../../../../packages/api-contract/src/storyManuscript.js';
import { buildStoryManuscriptSkeleton } from '../../../../src/services/story/StoryManuscriptSkeleton.js';
import { applyStoryManuscriptLayouts, type ManuscriptLayoutResponse } from '../../../../src/services/story/StoryManuscriptLayout.js';
import type { PageSkeletonPageDraft } from '../../../../src/domain/types/storyAi.js';
import type { StoryAiModelRequest } from '../../../../src/services/story/StoryAiClientPort.js';

async function fixture(source: string): Promise<PageSkeletonPageDraft[]> {
  return buildStoryManuscriptSkeleton({ source, manuscript: parseStoryManuscript(source, true),
    estimatedPages: 1, entities: [], compileBlock: vi.fn() });
}

const source = '===\n＃2コマ目を最も大きくし、他のコマとの差をつける＃\nナギが目を閉じる。\n---\nナギが覚醒する。\n---\nトウマが驚く。\n---\n光が広がる。\n===';
const response: ManuscriptLayoutResponse = { directions: [{ direction_index: 0,
  targets: [{ page_number: 1, order: 2, size: 'largest', shape: null }] }] };

describe('StoryManuscriptLayout', () => {
  it('固定4コマの2コマ目最大指示を実際の枠面積に反映して本文と割当を保つ', async () => {
    const pages = await fixture(source);
    const plan = vi.fn(async (_request: StoryAiModelRequest): Promise<ManuscriptLayoutResponse> => response);
    const result = await applyStoryManuscriptLayouts(pages, parseStoryManuscript(source, true), plan);
    const areas = result[0]!.manuscriptFrames!.map(frame => {
      const xs = frame.vertices.map(v => v.x); const ys = frame.vertices.map(v => v.y);
      return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    });
    expect(areas[1]).toBeGreaterThan(Math.max(areas[0]!, areas[2]!, areas[3]!));
    expect(result[0]?.panels[1]?.suggestedSize).toBe('large');
    expect(result[0]?.panels.map(p => p.situationHint)).toEqual(pages[0]?.panels.map(p => p.situationHint));
    expect(result[0]?.manuscriptSource).toEqual(pages[0]?.manuscriptSource);
    expect(pages[0]?.manuscriptFrames).toBeUndefined();
    const request = plan.mock.calls[0]?.[0];
    expect(JSON.stringify(request)).toContain('2コマ目を最も大きく');
    expect(JSON.stringify(request)).toContain('ナギが覚醒する');
  });

  it('サイズと形状の指示を別々に合成して横長の大コマを作る', async () => {
    const pages = await fixture(source);
    const result = await applyStoryManuscriptLayouts(pages, parseStoryManuscript(source, true), async () => ({
      directions: [{ direction_index: 0, targets: [{ page_number: 1, order: 3, size: 'large', shape: 'wide' }] }],
    }));
    const frames = result[0]!.manuscriptFrames!;
    const dimensions = frames.map(frame => ({
      w: Math.max(...frame.vertices.map(v => v.x)) - Math.min(...frame.vertices.map(v => v.x)),
      h: Math.max(...frame.vertices.map(v => v.y)) - Math.min(...frame.vertices.map(v => v.y)),
    }));
    expect(dimensions[2]!.w * 0.7 / dimensions[2]!.h).toBeGreaterThan(1.2);
    expect(dimensions[2]!.w * dimensions[2]!.h).toBeGreaterThan(dimensions[0]!.w * dimensions[0]!.h);
  });

  it('コマ割りを指定しない指示では元のテンプレートを維持する', async () => {
    const pages = await fixture(source);
    const result = await applyStoryManuscriptLayouts(pages, parseStoryManuscript(source, true), async () => ({
      directions: [{ direction_index: 0, targets: [] }],
    }));
    expect(result).toEqual(pages);
  });

  it('指示がない場合は追加のモデル呼出しをしない', async () => {
    const plain = '===\n本文\n---\n次の場面\n===';
    const pages = await fixture(plain);
    const plan = vi.fn();
    expect(await applyStoryManuscriptLayouts(pages, parseStoryManuscript(plain, true), plan)).toEqual(pages);
    expect(plan).not.toHaveBeenCalled();
  });

  it('未知のコマ・別ページ・欠落や重複した指示IDを保存前に拒否する', async () => {
    const pages = await fixture(source);
    for (const invalid of [
      { directions: [] },
      { directions: [response.directions[0]!, response.directions[0]!] },
      { directions: [{ direction_index: 0, targets: [{ page_number: 1, order: 5, size: 'large', shape: null }] }] },
      { directions: [{ direction_index: 0, targets: [{ page_number: 2, order: 1, size: 'large', shape: null }] }] },
    ]) {
      await expect(applyStoryManuscriptLayouts(pages, parseStoryManuscript(source, true),
        async () => invalid as ManuscriptLayoutResponse)).rejects.toThrow();
      expect(pages[0]?.manuscriptFrames).toBeUndefined();
    }
  });
});
