import { describe, expect, it } from 'vitest';
import {
  EPISODE_PLAN_SOURCE_REVIEW_MAX_DISPLAY_CHARS,
  EPISODE_PLAN_SOURCE_REVIEW_MAX_UNITS,
} from '../../../../src/domain/constants/generation.js';
import {
  buildEpisodePlanSourceReviewArtifacts,
  buildEpisodePlanSourceReviewEvidenceArtifacts,
  buildEpisodePlanSourceReviewUnits,
  formatEpisodePlanSourceReview,
  type EpisodePlanSourceReviewCatalog,
  type EpisodePlanSourceReviewSource,
} from '../../../../src/services/page/EpisodePlanSourceReview.js';

const PAGE_ID = '11111111-1111-4111-8111-111111111111';

describe('EpisodePlanSourceReview', () => {
  it('CRLF・複合文・引用内句点・日英mixedをlosslessな連続sliceとして保つ', () => {
    const sources: EpisodePlanSourceReviewSource[] = [
      { scope: 'global', pageId: null, sourceRef: 'global_source', text: '  前書き。\r\n' },
      {
        scope: 'page',
        pageId: PAGE_ID,
        sourceRef: 'page_source',
        text: '1ページ目：「Go. now」と言い、扉を開けて中へ入る。\r\nJoy follows!  ',
      },
    ];
    const catalog = buildEpisodePlanSourceReviewUnits(sources);
    expect(catalog).not.toBeNull();
    for (const source of sources) {
      const units = catalog!.units.filter((unit) => unit.sourceRef === source.sourceRef);
      expect(units.map((unit) => unit.text).join('')).toBe(source.text);
      expect(units[0]?.start).toBe(0);
      expect(units.at(-1)?.end).toBe(source.text.length);
      expect(units.every((unit, index) => index === 0 || units[index - 1]!.end === unit.start)).toBe(true);
      expect(units.every((unit) => unit.text === source.text.slice(unit.start, unit.end))).toBe(true);
    }
    expect(catalog!.units.some((unit) => unit.text.includes('「Go. now」と言い'))).toBe(true);
    expect(catalog!.units.at(-1)?.text.endsWith('  ')).toBe(true);
  });

  it('256 unitsは保持し257 unitsは部分catalogを返さず全体fallbackする', () => {
    const source = (count: number): EpisodePlanSourceReviewSource[] => [{
      scope: 'page', pageId: PAGE_ID, sourceRef: 'page_source', text: 'x.'.repeat(count),
    }];
    expect(buildEpisodePlanSourceReviewUnits(source(EPISODE_PLAN_SOURCE_REVIEW_MAX_UNITS))?.units)
      .toHaveLength(EPISODE_PLAN_SOURCE_REVIEW_MAX_UNITS);
    expect(buildEpisodePlanSourceReviewUnits(source(EPISODE_PLAN_SOURCE_REVIEW_MAX_UNITS + 1)))
      .toBeNull();
  });

  it('displayは8000文字境界を含み超過時はcatalogごとfallbackする', () => {
    let accepted: { textLength: number; display: string } | null = null;
    for (let length = 1; length <= EPISODE_PLAN_SOURCE_REVIEW_MAX_DISPLAY_CHARS; length += 1) {
      const catalog = oneUnitCatalog('x'.repeat(length));
      const display = formatEpisodePlanSourceReview(catalog);
      if (display === null) break;
      accepted = { textLength: length, display };
    }
    expect(accepted?.display).toHaveLength(EPISODE_PLAN_SOURCE_REVIEW_MAX_DISPLAY_CHARS);
    const overflowingText = 'x'.repeat(accepted!.textLength + 1);
    expect(formatEpisodePlanSourceReview(oneUnitCatalog(overflowingText))).toBeNull();
    expect(buildEpisodePlanSourceReviewArtifacts([{
      scope: 'page', pageId: PAGE_ID, sourceRef: 'page_source', text: overflowingText,
    }])).toBeNull();
  });

  it('空または空白だけの原文はcomplete reviewとして扱わない', () => {
    expect(buildEpisodePlanSourceReviewUnits([])).toBeNull();
    expect(buildEpisodePlanSourceReviewUnits([{
      scope: 'global', pageId: null, sourceRef: 'global_source', text: '\r\n  ',
    }])).toBeNull();
  });
});

function oneUnitCatalog(text: string): EpisodePlanSourceReviewCatalog {
  return {
    units: [{
      scope: 'page', pageId: PAGE_ID, sourceRef: 'page_source', start: 0, end: text.length, text,
    }],
  };
}


describe('EpisodePlanSourceReviewEvidenceArtifacts', () => {
  it('短い表示済みfieldも根拠IDに含めmetadataを含めない', () => {
    const catalog = oneUnitCatalog('中へ入る。');
    const artifacts = buildEpisodePlanSourceReviewEvidenceArtifacts(catalog, [{ pageId: PAGE_ID, outputs: [{ ref: 'p1.s', panelOrder: 1, text: '入る' }] }]);
    expect(artifacts?.catalog.evidence).toEqual([{ pageId: PAGE_ID, ref: 'p1.s', panelOrder: 1, text: '入る' }]);
    expect(artifacts?.display).toContain('0|' + PAGE_ID + '|p1.s');
    expect(buildEpisodePlanSourceReviewEvidenceArtifacts(catalog, [{ pageId: PAGE_ID, outputs: [{ ref: 'purpose', panelOrder: null, text: '中へ入る。' }] }])).toBeNull();
  });
  it('全unit応答予算またはfield上限超過は部分比較を返さず全体fallbackする', () => {
    const units = buildEpisodePlanSourceReviewUnits([{ scope: 'page', pageId: PAGE_ID, sourceRef: 'page_source', text: 'x.'.repeat(256) }])!;
    expect(buildEpisodePlanSourceReviewEvidenceArtifacts(units, [])).toBeNull();
    const outputs = Array.from({ length: 1025 }, (_, index) => ({ ref: 'p1.d' + (index+1), panelOrder: 1, text: '表示文' }));
    expect(buildEpisodePlanSourceReviewEvidenceArtifacts(oneUnitCatalog('表示文'), [{ pageId: PAGE_ID, outputs }])).toBeNull();
  });
});
