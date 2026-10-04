import { describe, expect, it } from 'vitest';
import { validateEpisodePlanAuditSourceUnitReview } from '../../../../src/infrastructure/openai/OpenAIEpisodePlanAuditGrounding.js';

const PAGE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SOURCE = '扉を開けて中へ入る。';
const FIELD = { pageId: PAGE, ref: 'p1.s', panelOrder: 1, text: '中へ入る。' };
const EMPTY_AUDIT = { accepted: true, issues: [], pageRepairs: [], panelRepairs: [] };
function fixture() {
  return {
    audit: EMPTY_AUDIT,
    review: [{ verdict: 'supported', evidence: [0], counter_evidence: [], issue: null }],
    catalog: { units: [{ scope: 'page', pageId: PAGE, sourceRef: 'page_source', start: 0, end: SOURCE.length, text: SOURCE }], evidence: [FIELD] },
    groundings: [],
    groundingCatalog: { pages: [{ pageId: PAGE, authorities: [{ ref: 'page_source', text: SOURCE, kind: 'original_page' }], outputs: [{ ref: FIELD.ref, panelOrder: FIELD.panelOrder, text: FIELD.text }] }], deterministicIssues: [] },
  };
}
function validate(value: unknown): void {
  validateEpisodePlanAuditSourceUnitReview(value as Parameters<typeof validateEpisodePlanAuditSourceUnitReview>[0]);
}

describe('EpisodePlanSourceEvidence', () => {
  it('各原文unitは同頁の表示済みpanel根拠でsupportedを検証する', () => {
    expect(() => validate(fixture())).not.toThrow();
  });
  it('全nullの結果は根拠付きunit比較を完了した扱いにしない', () => {
    expect(() => validate({ ...fixture(), review: [null] })).toThrow('comparison');
  });
  it.each([9, -1, 0.5])('未知または不正なfield ID %sを拒否する', (id) => {
    expect(() => validate({ ...fixture(), review: [{ verdict: 'supported', evidence: [id], counter_evidence: [], issue: null }] })).toThrow();
  });
  it('別頁のpanelは同頁の行動が実現した根拠にできない', () => {
    const input = fixture();
    input.catalog.evidence[0] = { ...FIELD, pageId: OTHER };
    input.groundingCatalog.pages.push({ pageId: OTHER, authorities: [], outputs: [{ ref: FIELD.ref, panelOrder: 1, text: FIELD.text }] });
    expect(() => validate(input)).toThrow('outside the unit page');
  });
  it('purpose metadataやbrief未表示のtextはpanel根拠にできない', () => {
    const metadata = fixture();
    metadata.catalog.evidence[0] = { ...FIELD, ref: 'purpose' };
    metadata.groundingCatalog.pages[0]!.outputs[0] = { ref: 'purpose', panelOrder: 1, text: FIELD.text };
    expect(() => validate(metadata)).toThrow('visible panel');
    const hidden = fixture();
    hidden.catalog.evidence[0] = { ...FIELD, text: '未表示の内部説明。' };
    expect(() => validate(hidden)).toThrow('visible panel');
  });
  it('supportedには空でない実panel根拠が必要になる', () => {
    expect(() => validate({ ...fixture(), review: [{ verdict: 'supported', evidence: [], counter_evidence: [], issue: null }] })).toThrow('supported');
  });
  it('入場義務と禁止notesのconflictは同unitの既存grounded errorへ結び付く', () => {
    const input = fixture();
    const note = { pageId: PAGE, ref: 'p1.n', panelOrder: 1, text: 'まだ内部へ入れない。' };
    const audit = { accepted: false, issues: [{ code: 'timeline_discontinuity', severity: 'error', pageIds: [PAGE], message: '原文の入場と禁止notesが衝突する。', repairInstruction: '同頁で入場する。' }], pageRepairs: [], panelRepairs: [] };
    const groundings = [{ issue_index: 0, basis: 'source', source_evidence: [{ page_id: PAGE, source_ref: 'page_source', quote: '中へ入る' }], output_evidence: [{ page_id: PAGE, output_ref: 'p1.n', quote: '内部へ入れない' }] }];
    input.catalog.evidence.push(note);
    input.groundingCatalog.pages[0]!.outputs.push({ ref: note.ref, text: note.text, panelOrder: 1 });
    expect(() => validate({ ...input, audit, groundings, review: [{ verdict: 'conflict', evidence: [], counter_evidence: [1], issue: 0 }] })).not.toThrow();
    expect(() => validate({ ...input, audit, groundings, review: [{ verdict: 'conflict', evidence: [], counter_evidence: [], issue: 0 }] })).toThrow('conflict');
    expect(() => validate({ ...input, audit, groundings, review: [{ verdict: 'missing', evidence: [], counter_evidence: [], issue: 9 }] })).toThrow('unknown');
  });
  it('global見出しはcontext分類で不必要な欠落errorを要求しない', () => {
    const input = fixture();
    const text = '小さなロボットの旅。';
    const catalog = { ...input.catalog, units: [{ scope: 'global', pageId: null, sourceRef: 'global_source', start: 0, end: text.length, text }] };
    const groundingCatalog = { ...input.groundingCatalog, pages: [{ ...input.groundingCatalog.pages[0]!, authorities: [{ ref: 'global_source', text, kind: 'original_global' }] }] };
    expect(() => validate({ ...input, catalog, groundingCatalog, review: [{ verdict: 'context', evidence: [], counter_evidence: [], issue: null }] })).not.toThrow();
  });
});
