import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { EpisodePlanAudit } from '../../../../src/services/page/EpisodePlanAuditCompiler.js';
import {
  EpisodePlanAuditCoverageError,
  EPISODE_PLAN_AUDIT_COVERAGE_MAX_CHECKS_PER_PAGE,
  EPISODE_PLAN_AUDIT_COVERAGE_MAX_EVIDENCE_PER_CHECK,
  EPISODE_PLAN_AUDIT_COVERAGE_QUOTE_MAX_CHARS,
  validateEpisodePlanAuditCoverage,
  type EpisodePlanAuditCoverageCatalog,
} from '../../../../src/services/page/EpisodePlanAuditCoverage.js';

const PAGE_ID = '11111111-1111-4111-8111-111111111111';

describe('EpisodePlanAuditCoverage', () => {
  it('同一ページの欠落事実をerrorとpanel修復へ結線する', () => {
    expect(() => validateEpisodePlanAuditCoverage(buildMissingAudit(), buildCatalog())).not.toThrow();
  });

  it.each([
    ['偽の原作引用', { sourceQuote: '原作に存在しない引用' }],
    ['未知の出力参照', { outputRef: 'p9.s' }],
  ])('%sを拒否する', (_label, override) => {
    const audit = buildPresentAudit();
    const check = audit.sourceCoverage?.[0]?.checks[0];
    if (check === undefined) throw new Error('fixture check is missing');
    if ('sourceQuote' in override) check.sourceQuote = override.sourceQuote;
    if ('outputRef' in override && check.outputEvidence[0] !== undefined) {
      check.outputEvidence[0].outputRef = override.outputRef;
    }
    expect(() => validateEpisodePlanAuditCoverage(audit, buildCatalog())).toThrow();
  });

  it('偽引用の再試行診断は位置と既知refだけを返しquote本文を返さない', () => {
    const audit = buildPresentAudit();
    const check = audit.sourceCoverage?.[0]?.checks[0];
    if (check === undefined) throw new Error('fixture check is missing');
    check.sourceQuote = '光は港へ帰る船の目印';
    const catalog = buildCatalog();
    catalog.pages[0]!.sources[0]!.text = `灯台の光が港に帰る船の目印になる${'秘密本文'.repeat(200)}`;

    let thrown: unknown;
    try {
      validateEpisodePlanAuditCoverage(audit, catalog);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EpisodePlanAuditCoverageError);
    const coverageError = thrown as EpisodePlanAuditCoverageError;
    const feedback = coverageError.retryInstruction;
    expect(feedback).toContain(`page_id="${PAGE_ID}"`);
    expect(feedback).toContain('source_ref="story"');
    expect(feedback).toContain('check_index=0');
    expect(feedback).toContain('ref_known=true');
    expect(feedback).not.toContain('光は港へ帰る船の目印');
    expect(feedback).not.toContain('秘密本文');
    expect(feedback.length).toBeLessThan(600);
    expect(coverageError.quoteCorrectionPlan).toEqual({
      slots: [{
        key: 'c0',
        pageId: PAGE_ID,
        checkIndex: 0,
        evidenceIndex: null,
        kind: 'source',
        ref: 'story',
      }],
    });
  });

  it('混合source引用・短文padding・別field参照を一度に診断する', () => {
    const audit = buildPresentAudit();
    const first = audit.sourceCoverage?.[0]?.checks[0];
    if (first === undefined) throw new Error('fixture check is missing');
    first.sourceQuote = '十分に充電されて絵本を閉じる';
    first.outputEvidence = [{ outputRef: 'p1.d1', quote: '届いた」' }];
    audit.sourceCoverage?.[0]?.checks.push({
      sourceRef: 'story',
      sourceQuote: '絵本を閉じる',
      status: 'present',
      outputEvidence: [{ outputRef: 'p1.s', quote: '手をハンドルから離した瞬間' }],
      issueCode: null,
      repairTarget: null,
    });
    const catalog = buildCatalog();
    catalog.pages[0]?.outputs.push(
      { ref: 'p1.d1', text: '届いた', panelOrder: 1 },
      { ref: 'p1.c', text: '手をハンドルから離した瞬間', panelOrder: 1 },
    );

    let thrown: unknown;
    try {
      validateEpisodePlanAuditCoverage(audit, catalog);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EpisodePlanAuditCoverageError);
    const coverageError = thrown as EpisodePlanAuditCoverageError;
    const feedback = coverageError.retryInstruction;
    expect(feedback).toContain('citation_errors=3');
    expect(feedback).toContain('source_ref="story"');
    expect(feedback).toContain('output_ref="p1.d1"');
    expect(feedback).toContain('output_ref="p1.s"');
    expect(feedback).not.toContain('十分に充電されて絵本を閉じる');
    expect(feedback).not.toContain('届いた」');
    expect(feedback).not.toContain('手をハンドルから離した瞬間');
    expect(feedback).toContain('omitted_diagnostics=0');
    expect(feedback.length).toBeLessThanOrEqual(4_000);
    expect(coverageError.quoteCorrectionPlan?.slots.map((slot) => ({
      key: slot.key,
      kind: slot.kind,
      ref: slot.ref,
      checkIndex: slot.checkIndex,
      evidenceIndex: slot.evidenceIndex,
    }))).toEqual([
      { key: 'c0', kind: 'source', ref: 'story', checkIndex: 0, evidenceIndex: null },
      { key: 'c1', kind: 'output', ref: 'p1.d1', checkIndex: 0, evidenceIndex: 0 },
      { key: 'c2', kind: 'output', ref: 'p1.s', checkIndex: 1, evidenceIndex: 0 },
    ]);
  });

  it('未知refの任意文字列をechoせずknown=falseとcatalog refだけを返す', () => {
    const audit = buildPresentAudit();
    const check = audit.sourceCoverage?.[0]?.checks[0];
    if (check === undefined) throw new Error('fixture check is missing');
    check.outputEvidence = [{ outputRef: 'RAW-UNTRUSTED-REF', quote: '光が続く' }];

    let thrown: unknown;
    try {
      validateEpisodePlanAuditCoverage(audit, buildCatalog());
    } catch (error) {
      thrown = error;
    }

    const feedback = (thrown as EpisodePlanAuditCoverageError).retryInstruction;
    expect(feedback).toContain('ref_known=false');
    expect(feedback).toContain('output_ref="unknown"');
    expect(feedback).toContain('valid_refs=["p1.s"]');
    expect(feedback).not.toContain('RAW-UNTRUSTED-REF');
  });

  it('引用診断は8件と4000文字で止め省略件数を示す', () => {
    const pages = Array.from({ length: 5 }, (_, pageIndex) => {
      const pageId = `00000000-0000-4000-8000-${String(pageIndex + 1).padStart(12, '0')}`;
      return {
        pageId,
        sources: [{ ref: 'source', text: '正しい原作本文だけを保持する' }],
        outputs: [{ ref: 'p1.s', text: '正しい出力本文だけを保持する', panelOrder: 1 }],
      };
    });
    const audit: EpisodePlanAudit = {
      accepted: true,
      issues: [],
      pageRepairs: [],
      panelRepairs: [],
      sourceCoverage: pages.map((page, pageIndex) => ({
        pageId: page.pageId,
        checks: Array.from({ length: 2 }, (_, checkIndex) => ({
          sourceRef: 'source',
          sourceQuote: `偽原作引用${pageIndex}${checkIndex}`,
          status: 'present' as const,
          outputEvidence: [{ outputRef: 'p1.s', quote: `偽出力引用${pageIndex}${checkIndex}` }],
          issueCode: null,
          repairTarget: null,
        })),
      })),
    };

    let thrown: unknown;
    try {
      validateEpisodePlanAuditCoverage(audit, { pages });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EpisodePlanAuditCoverageError);
    const feedback = (thrown as EpisodePlanAuditCoverageError).retryInstruction;
    expect(feedback).toContain('citation_errors=20');
    expect(feedback).toContain('omitted_diagnostics=12');
    expect(feedback.match(/diagnostic\[/gu)).toHaveLength(8);
    expect(feedback.length).toBeLessThanOrEqual(4_000);
  });

  it('escapeの多いvalid refsでも4000文字内の完全な診断行だけを数える', () => {
    const pageId = PAGE_ID;
    const validOutputRefs = Array.from(
      { length: 12 },
      (_, index) => (`p${index}"\\field`.repeat(4)).slice(0, 24),
    );
    const validSourceRefs = Array.from(
      { length: 12 },
      (_, index) => (`s${index}"\\source`.repeat(4)).slice(0, 24),
    );
    const pages = [{
      pageId,
      sources: validSourceRefs.map((ref, index) => ({ ref, text: `正しい原作本文${index}` })),
      outputs: validOutputRefs.map((ref, index) => ({
        ref,
        text: `正しい出力本文${index}`,
        panelOrder: index + 1,
      })),
    }];
    const audit: EpisodePlanAudit = {
      accepted: true,
      issues: [],
      pageRepairs: [],
      panelRepairs: [],
      sourceCoverage: [{
        pageId,
        checks: Array.from({ length: 8 }, (_, checkIndex) => ({
          sourceRef: `RAW-SOURCE-${checkIndex}`,
          sourceQuote: `偽原作引用${checkIndex}`,
          status: 'present' as const,
          outputEvidence: [{ outputRef: `RAW-UNKNOWN-${checkIndex}`, quote: `偽出力引用${checkIndex}` }],
          issueCode: null,
          repairTarget: null,
        })),
      }],
    };

    let thrown: unknown;
    try {
      validateEpisodePlanAuditCoverage(audit, { pages });
    } catch (error) {
      thrown = error;
    }

    const feedback = (thrown as EpisodePlanAuditCoverageError).retryInstruction;
    const rows = feedback.split('\n').filter((line) => line.startsWith('diagnostic['));
    const shown = Number(feedback.match(/shown_diagnostics=(\d+)/u)?.[1]);
    const omitted = Number(feedback.match(/omitted_diagnostics=(\d+)/u)?.[1]);
    expect(feedback.length).toBeLessThanOrEqual(4_000);
    expect(rows).toHaveLength(shown);
    expect(shown + omitted).toBe(16);
    expect(rows.every((row) => /reason=(unknown_ref|not_exact)( valid_refs=.+)?$/u.test(row))).toBe(true);
    expect(feedback).not.toContain('RAW-UNKNOWN');
    expect(feedback).not.toContain('偽原作引用');
    expect(feedback).not.toContain('偽出力引用');
    expect((thrown as EpisodePlanAuditCoverageError).quoteCorrectionPlan).toBeNull();
  });

  it('引用診断が8件を超える場合はquote限定補正へ進めない', () => {
    const pages = [0, 1].map((pageIndex) => {
      const pageId = `00000000-0000-4000-8000-${String(pageIndex + 1).padStart(12, '0')}`;
      return {
        pageId,
        sources: [{ ref: 'story', text: `原作${pageIndex}A 原作${pageIndex}B` }],
        outputs: [
          { ref: 'p1.s', text: `出力${pageIndex}A`, panelOrder: 1 },
          { ref: 'p1.n', text: `出力${pageIndex}B`, panelOrder: 1 },
        ],
      };
    });
    const audit: EpisodePlanAudit = {
      accepted: true,
      issues: [],
      pageRepairs: [],
      panelRepairs: [],
      sourceCoverage: pages.map((page) => ({
        pageId: page.pageId,
        checks: [0, 1].map((checkIndex) => ({
          sourceRef: 'story',
          sourceQuote: `存在しない原作${page.pageId}${checkIndex}`,
          status: 'present' as const,
          outputEvidence: [
            { outputRef: 'p1.s', quote: `存在しない出力A${page.pageId}${checkIndex}` },
            { outputRef: 'p1.n', quote: `存在しない出力B${page.pageId}${checkIndex}` },
          ],
          issueCode: null,
          repairTarget: null,
        })),
      })),
    };

    let thrown: unknown;
    try {
      validateEpisodePlanAuditCoverage(audit, { pages });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EpisodePlanAuditCoverageError);
    expect((thrown as EpisodePlanAuditCoverageError).retryInstruction).toContain(
      'omitted_diagnostics=4',
    );
    expect((thrown as EpisodePlanAuditCoverageError).quoteCorrectionPlan).toBeNull();
  });

  it('未表示tailはactual output prefixに存在しない引用として拒否する', () => {
    const audit = buildPresentAudit();
    const check = audit.sourceCoverage?.[0]?.checks[0];
    if (check === undefined) throw new Error('fixture check is missing');
    check.outputEvidence = [{ outputRef: 'p1.s', quote: '末尾未表示' }];
    const catalog = buildCatalog();
    catalog.pages[0]!.outputs[0]!.text = '画面に表示された実prefix';

    expect(() => validateEpisodePlanAuditCoverage(audit, catalog)).toThrow(
      EpisodePlanAuditCoverageError,
    );
  });

  it('実fieldに含まれるliteral ellipsisの連続引用は許可する', () => {
    const audit = buildPresentAudit();
    const check = audit.sourceCoverage?.[0]?.checks[0];
    if (check === undefined) throw new Error('fixture check is missing');
    check.outputEvidence = [{ outputRef: 'p1.s', quote: '閉じる...' }];
    const catalog = buildCatalog();
    catalog.pages[0]!.outputs[0]!.text = '扉を閉じる...';

    expect(() => validateEpisodePlanAuditCoverage(audit, catalog)).not.toThrow();
  });

  it('重複checkを拒否する', () => {
    const audit = buildPresentAudit();
    const check = audit.sourceCoverage?.[0]?.checks[0];
    if (check === undefined) throw new Error('fixture check is missing');
    audit.sourceCoverage?.[0]?.checks.push(structuredClone(check));
    expect(() => validateEpisodePlanAuditCoverage(audit, buildCatalog())).toThrow(/duplicate/i);
  });

  it('同じpanel fieldの異なる2引用を許可し同一引用の重複だけを拒否する', () => {
    const valid = buildPresentAudit();
    const validCheck = valid.sourceCoverage?.[0]?.checks[0];
    if (validCheck === undefined) throw new Error('fixture check is missing');
    validCheck.outputEvidence = [
      { outputRef: 'p1.s', quote: '光が続く' },
      { outputRef: 'p1.s', quote: '窓辺に座る' },
    ];
    expect(() => validateEpisodePlanAuditCoverage(valid, buildCatalog())).not.toThrow();

    const duplicate = buildPresentAudit();
    const duplicateCheck = duplicate.sourceCoverage?.[0]?.checks[0];
    if (duplicateCheck === undefined) throw new Error('fixture check is missing');
    duplicateCheck.outputEvidence = [
      { outputRef: 'p1.s', quote: '光が続く' },
      { outputRef: 'p1.s', quote: '光が続く' },
    ];
    expect(() => validateEpisodePlanAuditCoverage(duplicate, buildCatalog())).toThrow(/duplicate/i);
  });

  it('page metadataだけをpresent evidenceとして引用することを拒否する', () => {
    const audit = buildPresentAudit();
    const check = audit.sourceCoverage?.[0]?.checks[0];
    if (check === undefined) throw new Error('fixture check is missing');
    check.outputEvidence = [{ outputRef: 'page.purpose', quote: '光が続く' }];
    const catalog = buildCatalog();
    catalog.pages[0]?.outputs.push({
      ref: 'page.purpose',
      text: '光が続くことを確認する',
      panelOrder: null,
    });
    expect(() => validateEpisodePlanAuditCoverage(audit, catalog)).toThrow();
  });

  it('欠落checkに対応するerrorまたは同一ページ修復がない場合は拒否する', () => {
    const audit = buildMissingAudit();
    audit.panelRepairs = [];
    expect(() => validateEpisodePlanAuditCoverage(audit, buildCatalog())).toThrow(/repair/i);
  });

  it('欠落checkの未知panelまたは空のcontent修復を拒否する', () => {
    const unknownPanel = buildMissingAudit();
    const target = unknownPanel.sourceCoverage?.[0]?.checks[0]?.repairTarget;
    if (target === null || target === undefined) throw new Error('fixture target is missing');
    target.panelOrder = 9;
    expect(() => validateEpisodePlanAuditCoverage(unknownPanel, buildCatalog())).toThrow(/unknown panel/i);

    const emptyRepair = buildMissingAudit();
    const repair = emptyRepair.panelRepairs?.[0];
    if (repair === undefined) throw new Error('fixture repair is missing');
    repair.patch.situationText = null;
    expect(() => validateEpisodePlanAuditCoverage(emptyRepair, buildCatalog())).toThrow(/repair/i);
  });

  it('引用一致は意味の正当性ではなく出典の存在だけを保証する', () => {
    const audit = buildPresentAudit();
    const check = audit.sourceCoverage?.[0]?.checks[0];
    if (check === undefined) throw new Error('fixture check is missing');
    check.sourceQuote = '絵本を閉じる';
    check.outputEvidence = [{ outputRef: 'p1.s', quote: '光が続く' }];
    expect(() => validateEpisodePlanAuditCoverage(audit, buildCatalog())).not.toThrow();
  });

  it('最大32ページのsidecarを日本語最悪値でも70KB未満へ抑える', () => {
    const pageIds = Array.from({ length: 32 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    const sourceCoverage = pageIds.map((pageId) => ({
      pageId,
      checks: Array.from({ length: EPISODE_PLAN_AUDIT_COVERAGE_MAX_CHECKS_PER_PAGE }, (_, checkIndex) => ({
        sourceRef: '原典参照識別子'.repeat(4).slice(0, 24),
        sourceQuote: '鬱蒼複雑原典引用'.repeat(6).slice(0, EPISODE_PLAN_AUDIT_COVERAGE_QUOTE_MAX_CHARS),
        status: 'present' as const,
        outputEvidence: Array.from(
          { length: EPISODE_PLAN_AUDIT_COVERAGE_MAX_EVIDENCE_PER_CHECK },
          (_, evidenceIndex) => ({
            outputRef: `出力参照${checkIndex}${evidenceIndex}`.padEnd(24, '字'),
            quote: '複雑描写証拠引用'.repeat(6).slice(0, EPISODE_PLAN_AUDIT_COVERAGE_QUOTE_MAX_CHARS),
          }),
        ),
        issueCode: null,
        repairTarget: null,
      })),
    }));
    const serializedBytes = Buffer.byteLength(JSON.stringify({ source_coverage: sourceCoverage }), 'utf8');
    // This proves only a UTF-8 byte bound. The repository has no installed
    // tokenizer, so provider-token usage must be confirmed by a real trace.
    expect(serializedBytes).toBeLessThan(70_000);
  });

  it('long15実traceの4欠落を修復へ結びP14の2描写をpresentとして保持する', () => {
    const fixture = JSON.parse(readFileSync(
      new URL('../../../fixtures/episode-plan-audit-long15-coverage.json', import.meta.url),
      'utf8',
    )) as Long15Fixture;
    expect(fixture.scope).toContain('No API metadata');

    const pageNumbers = [1, 9, 14, 15];
    const pages = pageNumbers.map((pageNumber) => {
      const cases = fixture.cases.filter((candidate) => candidate.source.pageNumber === pageNumber);
      const outputs = cases.flatMap((candidate) => candidate.actualPanels.flatMap((panel) => [
        {
          ref: `p${panel.panelOrder}.s`,
          text: panel.fields.situationText,
          panelOrder: panel.panelOrder,
        },
        ...(panel.fields.panelNotes === undefined ? [] : [{
          ref: `p${panel.panelOrder}.n`,
          text: panel.fields.panelNotes,
          panelOrder: panel.panelOrder,
        }]),
      ]));
      return {
        pageId: long15PageId(pageNumber),
        sources: [{
          ref: 'source',
          text: cases.map((candidate) => candidate.source.exactQuote).join('\n'),
        }],
        outputs: Array.from(new Map(outputs.map((output) => [output.ref, output])).values()),
      };
    });

    const missingCases = fixture.cases.filter((candidate) => candidate.status === 'missing');
    const audit: EpisodePlanAudit = {
      accepted: false,
      issues: missingCases.map((candidate) => ({
        code: candidate.id.includes('second_push') ? 'ongoing_action_dropped' : 'source_omission',
        severity: 'error',
        pageIds: [long15PageId(candidate.source.pageNumber)],
        message: candidate.missingReason ?? 'source fact is missing',
        repairInstruction: '同じページのpanelへ原作事実を戻す。',
      })),
      pageRepairs: [],
      panelRepairs: missingCases.map((candidate) => ({
        pageId: long15PageId(candidate.source.pageNumber),
        panelOrder: candidate.repairCandidate!.panelOrder,
        changedFields: ['situationText'],
        patch: { situationText: candidate.source.exactQuote },
      })),
      sourceCoverage: pageNumbers.map((pageNumber) => ({
        pageId: long15PageId(pageNumber),
        checks: fixture.cases
          .filter((candidate) => candidate.source.pageNumber === pageNumber)
          .map((candidate) => candidate.status === 'missing' ? {
            sourceRef: 'source',
            sourceQuote: candidate.source.exactQuote,
            status: 'missing' as const,
            outputEvidence: [],
            issueCode: candidate.id.includes('second_push')
              ? 'ongoing_action_dropped' as const
              : 'source_omission' as const,
            repairTarget: {
              scope: 'panel' as const,
              pageId: long15PageId(pageNumber),
              panelOrder: candidate.repairCandidate!.panelOrder,
            },
          } : {
            sourceRef: 'source',
            sourceQuote: candidate.source.exactQuote,
            status: 'present' as const,
            outputEvidence: candidate.id.includes('rotation')
              ? [{ outputRef: 'p2.s', quote: 'ハンドルを回しながら' }]
              : [{ outputRef: 'p4.s', quote: '外から見た岬の灯台' }],
            issueCode: null,
            repairTarget: null,
          }),
      })),
    };

    expect(missingCases.map((candidate) => candidate.id)).toEqual([
      'p1_returning_ships_role',
      'p9_second_push_after_pebble',
      'p15_sufficient_charge_before_release',
      'p15_close_book_before_sitting',
    ]);
    expect(audit.sourceCoverage?.find((page) => page.pageId === long15PageId(15))?.checks).toHaveLength(2);
    expect(() => validateEpisodePlanAuditCoverage(audit, { pages })).not.toThrow();
    expect(Buffer.byteLength(JSON.stringify({ source_coverage: audit.sourceCoverage }), 'utf8')).toBeLessThan(5_000);
  });
});

interface Long15Fixture {
  scope: string;
  cases: Array<{
    id: string;
    status: 'missing' | 'present';
    missingReason?: string;
    source: { pageNumber: number; exactQuote: string };
    actualPanels: Array<{
      panelOrder: number;
      fields: { situationText: string; panelNotes?: string };
    }>;
    repairCandidate: { panelOrder: number } | null;
  }>;
}

function long15PageId(pageNumber: number): string {
  return `0000000a-0000-4000-8000-${pageNumber.toString(16).padStart(12, '0')}`;
}

function buildCatalog(): EpisodePlanAuditCoverageCatalog {
  return {
    pages: [{
      pageId: PAGE_ID,
      sources: [{ ref: 'story', text: '十分に充電されて光が続く。絵本を閉じる。' }],
      outputs: [{ ref: 'p1.s', text: '光が続くので窓辺に座る。', panelOrder: 1 }],
    }],
  };
}

function buildPresentAudit(): EpisodePlanAudit {
  return {
    accepted: true,
    issues: [],
    pageRepairs: [],
    panelRepairs: [],
    sourceCoverage: [{
      pageId: PAGE_ID,
      checks: [{
        sourceRef: 'story',
        sourceQuote: '十分に充電されて光が続く',
        status: 'present',
        outputEvidence: [{ outputRef: 'p1.s', quote: '光が続く' }],
        issueCode: null,
        repairTarget: null,
      }],
    }],
  };
}

function buildMissingAudit(): EpisodePlanAudit {
  return {
    accepted: false,
    issues: [{
      code: 'source_omission',
      severity: 'error',
      pageIds: [PAGE_ID],
      message: '充電完了の前提が欠落している。',
      repairInstruction: '同じページの状況描写へ充電完了を追加する。',
    }],
    pageRepairs: [],
    panelRepairs: [{
      pageId: PAGE_ID,
      panelOrder: 1,
      changedFields: ['situationText'],
      patch: { situationText: '十分に充電され、手を離しても光が続く。' },
    }],
    sourceCoverage: [{
      pageId: PAGE_ID,
      checks: [{
        sourceRef: 'story',
        sourceQuote: '十分に充電されて光が続く',
        status: 'missing',
        outputEvidence: [],
        issueCode: 'source_omission',
        repairTarget: { scope: 'panel', pageId: PAGE_ID, panelOrder: 1 },
      }],
    }],
  };
}
