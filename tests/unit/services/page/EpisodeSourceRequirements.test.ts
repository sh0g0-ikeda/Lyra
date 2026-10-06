import { describe, expect, it } from 'vitest';
import {
  buildEpisodeSourceRequirementExtractionPacks,
  filterEpisodeSourceRequirementsByPageIds,
  formatEpisodeSourceRequirementsForDetail,
  prepareEpisodeSourceRequirementExtraction,
  validateEpisodeSourceRequirements,
  type EpisodeSourceRequirements,
} from '../../../../src/services/page/EpisodeSourceRequirements.js';

const PAGE_1 = '11111111-1111-4111-8111-111111111111';
const PAGE_2 = '22222222-2222-4222-8222-222222222222';

// Design contract: complete original-page ownership is established before a paid
// request. The extractor receives only immutable source units, and its structural
// validator proves ownership/relations/bounds without claiming semantic fidelity.
describe('EpisodeSourceRequirements', () => {
  it('原文catalogは完全なpage mappingをlossless unitへ分割しgenerated入力を受け取らない', () => {
    const original = [
      '1ページ目：扉を押すが動かない。小石を取り除く。',
      '2ページ目：再び押すと扉が開く。「入れた」。',
    ].join('\n');

    const prepared = prepareEpisodeSourceRequirementExtraction({
      storyFullDraft: original,
      pages: [
        { pageId: PAGE_1, pageNumber: 1 },
        { pageId: PAGE_2, pageNumber: 2 },
      ],
    });

    expect(prepared).not.toBeNull();
    expect(prepared?.pages.map((page) => page.pageId)).toEqual([PAGE_1, PAGE_2]);
    expect(prepared?.units.map((unit) => unit.text).join('')).toBe(original);
    expect(prepared?.compilerBrief).toContain('[ORIGINAL SOURCE UNITS - ONLY AUTHORITY]');
    expect(prepared?.compilerBrief).not.toContain('page_purpose');
    expect(prepared?.compilerBrief).not.toContain('continuity');
    expect(prepared?.compilerBrief).not.toContain('handoff');
    expect(prepared?.compilerBrief).not.toContain('panel');
  });

  it('mapping不足またはpreflight response estimate超過はpaid work前にwhole legacyへ戻せるnullを返す', () => {
    expect(prepareEpisodeSourceRequirementExtraction({
      storyFullDraft: '1ページ目：開始。',
      pages: [
        { pageId: PAGE_1, pageNumber: 1 },
        { pageId: PAGE_2, pageNumber: 2 },
      ],
    })).toBeNull();

    expect(prepareEpisodeSourceRequirementExtraction({
      storyFullDraft: `1ページ目：${'長い原文。'.repeat(2_000)}`,
      pages: [{ pageId: PAGE_1, pageNumber: 1 }],
    })).toBeNull();

  });

  it('既存8-page beat packは24k byte以下のworst-case extraction contractに収まる', () => {
    const pages = Array.from({ length: 8 }, (_, index) => ({
      pageId: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
      pageNumber: index + 1,
    }));
    const prepared = prepareEpisodeSourceRequirementExtraction({
      storyFullDraft: pages.map((page) => `${page.pageNumber}ページ目：複合動作を最後まで行う。`).join('\n'),
      pages,
    })!;
    const packs = buildEpisodeSourceRequirementExtractionPacks(prepared, [pages]);

    expect(packs).not.toBeNull();
    expect(packs?.[0]?.estimatedWorstCaseOutputBytes).toBeLessThanOrEqual(24_000);
  });

  it('15-page原文のglobal unitは既存2 packの容量へ追加callなしで事前配分される', () => {
    const pages = Array.from({ length: 15 }, (_, index) => ({
      pageId: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
      pageNumber: index + 1,
    }));
    const sentenceCounts = [6, 7, 6, 6, 6, 6, 7, 6, 8, 6, 7, 6, 7, 6, 8];
    const storyFullDraft = [
      Array.from({ length: 9 }, (_, index) => `全体条件${index + 1}。`).join(''),
      ...pages.map((page, pageIndex) => [
        `${page.pageNumber}ページ目：出来事1。`,
        ...Array.from({ length: sentenceCounts[pageIndex]! - 1 }, (_, index) => `出来事${index + 2}。`),
      ].join('')),
    ].join('\n');
    const prepared = prepareEpisodeSourceRequirementExtraction({ storyFullDraft, pages })!;
    expect(prepared.units.filter((unit) => unit.scope === 'global' && unit.text.trim().length > 0))
      .toHaveLength(9);
    expect(prepared.units.filter((unit) => unit.pageNumber !== null && unit.pageNumber <= 8 &&
      unit.text.trim().length > 0)).toHaveLength(50);
    expect(prepared.units.filter((unit) => unit.pageNumber !== null && unit.pageNumber > 8 &&
      unit.text.trim().length > 0)).toHaveLength(48);
    const packs = buildEpisodeSourceRequirementExtractionPacks(prepared, [
      pages.slice(0, 8),
      pages.slice(8),
    ]);

    expect(packs).not.toBeNull();
    expect(packs?.map((pack) => pack.estimatedWorstCaseOutputBytes)).toEqual([23_672, 23_952]);
    expect(packs?.map((pack) => pack.units.filter((unit) =>
      unit.scope === 'global' && unit.text.trim().length > 0).length))
      .toEqual([3, 6]);
    expect(packs?.flatMap((pack) => pack.units).map((unit) => unit.unitId)).toHaveLength(
      new Set(prepared.units.map((unit) => unit.unitId)).size,
    );
  });

  it('全頁global制約はpack担当pageへ所有移転せずP1とP9の両detailへcontextとして渡す', () => {
    const globalRequirement = {
      ...requirement('global-u1-r1', 'global-u1', 1, ['全頁同じ衣装'], [], [], null, false),
      scope: 'global', pageId: null, pageNumber: null,
    } as unknown as EpisodeSourceRequirements['requirements'][number];
    const page1 = { ...requirement('p1-u1-r2', 'p1-u1', 1, ['開始'], [], [], null, true), scope: 'page' as const };
    const page9 = {
      ...requirement('p9-u1-r3', 'p9-u1', 1, ['到着'], [], [], null, true),
      scope: 'page', pageId: PAGE_2, pageNumber: 9,
    } as unknown as EpisodeSourceRequirements['requirements'][number];
    const requirements: EpisodeSourceRequirements = { requirements: [globalRequirement, page1, page9] };

    expect(filterEpisodeSourceRequirementsByPageIds(requirements, new Set([PAGE_1])).requirements)
      .toEqual([globalRequirement, page1]);
    expect(filterEpisodeSourceRequirementsByPageIds(requirements, new Set([PAGE_2])).requirements)
      .toEqual([globalRequirement, page9]);
    const detail = formatEpisodeSourceRequirementsForDetail(requirements, new Set([PAGE_2]));
    expect(detail).toContain('全頁同じ衣装');
    expect(detail).toContain('Global requirements are context/style/constraints');
    expect(detail).not.toContain('assign every listed requirement');
  });

  it('global requirementはtrim済み原文全文をcontextに保持し空・partialを拒否する', () => {
    const prepared = prepareEpisodeSourceRequirementExtraction({
      storyFullDraft: '全15ページの日本の漫画。\n1ページ目：開始する。',
      pages: [{ pageId: PAGE_1, pageNumber: 1 }],
    })!;
    const globalUnit = prepared.units.find((unit) => unit.scope === 'global' && unit.text.trim().length > 0)!;
    const pageUnit = prepared.units.find((unit) => unit.scope === 'page' && unit.text.trim().length > 0)!;
    const requirementsFor = (context: string | null): EpisodeSourceRequirements => ({
      requirements: [{
        ...requirement('global-r1', globalUnit.unitId, 1, [], [], [], null, false),
        scope: 'global', pageId: null, pageNumber: null, context,
      }, requirement('page-r1', pageUnit.unitId, 1, ['開始する'], [], [], null, true)],
    });

    expect(validateEpisodeSourceRequirements(
      prepared,
      requirementsFor(globalUnit.text.trim()),
    )).toEqual(requirementsFor(globalUnit.text.trim()));
    expect(() => validateEpisodeSourceRequirements(prepared, requirementsFor(null))).toThrow(
      'Global source requirement context must preserve the complete trimmed source unit',
    );
    expect(() => validateEpisodeSourceRequirements(prepared, requirementsFor('全15ページ'))).toThrow(
      'Global source requirement context must preserve the complete trimmed source unit',
    );
  });

  it('1 unitの明示引用が4件を超える場合はpaid extraction前にlegacyへ戻す', () => {
    expect(prepareEpisodeSourceRequirementExtraction({
      storyFullDraft: '1ページ目：「一」「二」「三」「四」「五」と続けて言う。',
      pages: [{ pageId: PAGE_1, pageNumber: 1 }],
    })).toBeNull();
  });

  it('1 unitのordered span候補が5件を超える場合はpaid extraction前にlegacyへ戻す', () => {
    expect(prepareEpisodeSourceRequirementExtraction({
      storyFullDraft: '1ページ目：一、二、三、四、五、六を順に行う。',
      pages: [{ pageId: PAGE_1, pageNumber: 1 }],
    })).toBeNull();
  });

  it('requirements validatorは同じunitの複数obligationと条件付き完了を受理する', () => {
    const prepared = prepareEpisodeSourceRequirementExtraction({
      storyFullDraft: '1ページ目：小石を除くまで内部へ入らず、扉を押すが動かないため取っ手を確認する。小石を除き、再び押して中へ入る。',
      pages: [{ pageId: PAGE_1, pageNumber: 1 }],
    })!;
    const unitIds = prepared.units.map((unit) => unit.unitId);
    const requirements: EpisodeSourceRequirements = {
      requirements: [
        requirement('r1', unitIds[0]!, 1, ['扉を押す', '取っ手を確認する'], ['動かない'], [], '小石を除くまで内部へ入らず', false),
        requirement('r2', unitIds.at(-1)!, 2, ['小石を除き', '再び押して'], ['中へ入る'], ['r1'], null, true),
      ],
    };
    requirements.requirements[0]!.obligations = [
      { event: '扉を押す', result: '動かない', conditionalUntil: '小石を除くまで内部へ入らず', requiredByEnd: false },
      { event: '取っ手を確認する', result: null, conditionalUntil: null, requiredByEnd: false },
    ];
    requirements.requirements[1]!.sourceUnitIds = unitIds.slice(1);

    expect(validateEpisodeSourceRequirements(prepared, requirements)).toEqual(requirements);
  });

  it('quoted textが原文spanと一致しない場合は構造検査で拒否する', () => {
    const prepared = prepareEpisodeSourceRequirementExtraction({
      storyFullDraft: '1ページ目：「入れた」と言う。',
      pages: [{ pageId: PAGE_1, pageNumber: 1 }],
    })!;
    const value: EpisodeSourceRequirements = {
      requirements: [requirement(
        'r1', prepared.units[0]!.unitId, 1, ['言う'], [], [], null, true,
      )],
    };
    value.requirements[0]!.quotedText = ['まだ入らない'];

    expect(() => validateEpisodeSourceRequirements(prepared, value)).toThrow(
      'Source requirement text must be an exact original-source span',
    );
  });

  it.each([
    ['unknown unit', (value: EpisodeSourceRequirements) => { value.requirements[0]!.sourceUnitIds = ['unknown']; }],
    ['duplicate id', (value: EpisodeSourceRequirements) => { value.requirements[1]!.requirementId = 'r1'; }],
    ['unknown relation', (value: EpisodeSourceRequirements) => { value.requirements[1]!.afterRequirementIds = ['missing']; }],
    ['cycle', (value: EpisodeSourceRequirements) => { value.requirements[0]!.afterRequirementIds = ['r2']; }],
    ['wrong owner', (value: EpisodeSourceRequirements) => { value.requirements[0]!.pageId = PAGE_2; }],
    ['too many events', (value: EpisodeSourceRequirements) => {
      value.requirements[0]!.events = Array.from({ length: 6 }, () => '開始');
    }],
  ])('requirements validatorは%sを拒否する', (_label, mutate) => {
    const prepared = prepareEpisodeSourceRequirementExtraction({
      storyFullDraft: '1ページ目：開始。完了。',
      pages: [{ pageId: PAGE_1, pageNumber: 1 }],
    })!;
    const requirements: EpisodeSourceRequirements = {
      requirements: [
        requirement('r1', prepared.units[0]!.unitId, 1, ['開始'], [], [], null, false),
        requirement('r2', prepared.units.at(-1)!.unitId, 2, ['完了'], ['完了'], ['r1'], null, true),
      ],
    };
    mutate(requirements);

    expect(() => validateEpisodeSourceRequirements(prepared, requirements)).toThrow();
  });
});

function requirement(
  requirementId: string,
  sourceUnitId: string,
  order: number,
  events: string[],
  results: string[],
  afterRequirementIds: string[],
  conditionalUntil: string | null,
  requiredByEnd: boolean,
): EpisodeSourceRequirements['requirements'][number] {
  return {
    requirementId,
    scope: 'page',
    pageId: PAGE_1,
    pageNumber: 1,
    sourceUnitIds: [sourceUnitId],
    order,
    events,
    results,
    afterRequirementIds,
    conditionalUntil,
    requiredByEnd,
    context: null,
    emotion: null,
    function: null,
    camera: null,
    framing: null,
    quotedText: [],
  };
}
