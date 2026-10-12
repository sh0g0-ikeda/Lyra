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
    expect(artifacts?.display).toContain('page|' + PAGE_ID + '\n0|p1.s');
    expect(buildEpisodePlanSourceReviewEvidenceArtifacts(catalog, [{ pageId: PAGE_ID, outputs: [{ ref: 'purpose', panelOrder: null, text: '中へ入る。' }] }])).toBeNull();
  });
  it('全unit応答予算またはfield上限超過は部分比較を返さず全体fallbackする', () => {
    const units = buildEpisodePlanSourceReviewUnits([{ scope: 'page', pageId: PAGE_ID, sourceRef: 'page_source', text: 'x.'.repeat(256) }])!;
    expect(buildEpisodePlanSourceReviewEvidenceArtifacts(units, [])).toBeNull();
    const outputs = Array.from({ length: 1025 }, (_, index) => ({ ref: 'p1.d' + (index+1), panelOrder: 1, text: '表示文' }));
    expect(buildEpisodePlanSourceReviewEvidenceArtifacts(oneUnitCatalog('表示文'), [{ pageId: PAGE_ID, outputs }])).toBeNull();
  });

  it('16ページ448fieldはpage headerで所属を保ちUUID反復を省く', () => {
    const pageIds = Array.from({ length: 16 }, (_unused, index) => {
      return `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    });
    const refs = Array.from({ length: 4 }, (_unused, panelIndex) => {
      const panel = panelIndex + 1;
      return [
        `p${panel}.s`,
        `p${panel}.b`,
        `p${panel}.c`,
        `p${panel}.x`,
        `p${panel}.n`,
        `p${panel}.e`,
        `p${panel}.d1`,
      ];
    }).flat();
    const pages = pageIds.map((pageId, pageIndex) => ({
      pageId,
      outputs: refs.map((ref, fieldIndex) => ({
        ref,
        panelOrder: Math.floor(fieldIndex / 7) + 1,
        text: `page-${pageIndex + 1}-field-${fieldIndex + 1}`,
      })),
    }));

    const artifacts = buildEpisodePlanSourceReviewEvidenceArtifacts(
      oneUnitCatalog('全ページの表示fieldを原文と照合する。'),
      pages,
    );

    expect(artifacts).not.toBeNull();
    expect(artifacts!.catalog.evidence).toHaveLength(448);
    expect(artifacts!.catalog.evidence).toEqual(pages.flatMap((page) => page.outputs.map((field) => ({
      ...field,
      pageId: page.pageId,
      panelOrder: field.panelOrder,
    }))));

    const fieldDisplay = artifacts!.display.slice(
      artifacts!.display.indexOf('[PANEL FIELD EVIDENCE - DISPLAYED DRAFT ONLY]'),
    );
    expect(fieldDisplay).toContain(
      'A page header applies to every following field row until the next page header.',
    );
    const parsedRows: Array<{ id: number; pageId: string; ref: string }> = [];
    const parsedPageIds: string[] = [];
    let currentPageId: string | null = null;
    for (const line of fieldDisplay.split('\n')) {
      if (line.startsWith('page|')) {
        currentPageId = line.slice('page|'.length);
        parsedPageIds.push(currentPageId);
        continue;
      }
      const match = /^(\d+)\|(p\d+\.(?:s|b|c|x|n|e|d\d+))$/u.exec(line);
      if (match === null) continue;
      expect(currentPageId).not.toBeNull();
      parsedRows.push({ id: Number(match[1]), pageId: currentPageId!, ref: match[2]! });
    }
    expect(parsedPageIds).toEqual(pageIds);
    expect(parsedRows).toHaveLength(448);
    expect(parsedRows.map((row) => row.id)).toEqual(Array.from({ length: 448 }, (_unused, id) => id));
    expect(parsedRows).toEqual(artifacts!.catalog.evidence!.map((field, id) => ({
      id,
      pageId: field.pageId,
      ref: field.ref,
    })));

    const legacyRows = artifacts!.catalog.evidence!.map((field, id) => {
      return `${id}|${field.pageId}|${field.ref}`;
    }).join('\n');
    const groupedRows = fieldDisplay.split('\n').filter((line) => {
      return line.startsWith('page|') || /^\d+\|/u.test(line);
    }).join('\n');
    expect(groupedRows.length).toBeLessThan(legacyRows.length - 10_000);
  });
});
