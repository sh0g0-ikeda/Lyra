import { describe, expect, it } from 'vitest';
import {
  EPISODE_PLAN_DETAIL_PACK_OUTPUT_UNITS,
  packEpisodePlanPages,
} from '../../../src/domain/episodePlanPacking.js';

interface TestPage {
  pageId: string;
  frameCount: number;
}

function buildPages(frameCounts: readonly number[]): TestPage[] {
  return frameCounts.map((frameCount, index) => ({
    pageId: `page-${index + 1}`,
    frameCount,
  }));
}

describe('packEpisodePlanPages', () => {
  it('4コマ10ページの場合にページ順を保った2つのpackになる', () => {
    const packs = packEpisodePlanPages(buildPages(Array.from({ length: 10 }, () => 4)));

    expect(packs.map((pack) => pack.map((page) => page.pageId))).toEqual([
      ['page-1', 'page-2', 'page-3', 'page-4', 'page-5'],
      ['page-6', 'page-7', 'page-8', 'page-9', 'page-10'],
    ]);
  });

  it('8コマのページでは安全な出力予算を超えず3ページずつになる', () => {
    const packs = packEpisodePlanPages(buildPages(Array.from({ length: 7 }, () => 8)));

    expect(packs.map((pack) => pack.length)).toEqual([3, 3, 1]);
    expect(
      packs.every(
        (pack) =>
          pack.reduce((total, page) => total + page.frameCount + 1, 0) <=
          EPISODE_PLAN_DETAIL_PACK_OUTPUT_UNITS,
      ),
    ).toBe(true);
  });

  it('単一ページが予算を超える場合でもページを分割しない', () => {
    const oversizedPage = buildPages([30, 1]);

    const packs = packEpisodePlanPages(oversizedPage);

    expect(packs).toEqual([[oversizedPage[0]], [oversizedPage[1]]]);
  });

  it('ページがない場合に空のpack一覧になる', () => {
    expect(packEpisodePlanPages([])).toEqual([]);
  });
});
