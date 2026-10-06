import { describe, expect, it } from 'vitest';
import {
  validateEpisodePlanAuditIssueGrounding,
  validateEpisodePlanAuditSourceUnitReview,
} from '../../../../src/infrastructure/openai/OpenAIEpisodePlanAuditGrounding.js';
import type {
  EpisodePlanAudit,
  EpisodePlanAuditGroundingCatalog,
} from '../../../../src/services/page/EpisodePlanAuditCompiler.js';

const PAGE_ID = '11111111-1111-4111-8111-111111111111';
const PAGE_TWO_ID = '22222222-2222-4222-8222-222222222222';

describe('OpenAIEpisodePlanAuditGrounding', () => {
  it('generated panel noteの文をoriginal page根拠として引用できない', () => {
    const audit = buildAudit('timeline_discontinuity');
    expect(() => validateEpisodePlanAuditIssueGrounding({
      audit,
      groundings: [{
        issue_index: 0,
        basis: 'source',
        source_evidence: [{
          page_id: PAGE_ID,
          source_ref: 'page_source',
          quote: '出口に到達する直前で区切る',
        }],
        output_evidence: [{
          page_id: PAGE_ID,
          output_ref: 'p1.n',
          quote: '出口に到達する直前で区切る',
        }],
      }],
      catalog: buildCatalog(),
    })).toThrow('source grounding quote is not exact');
  });

  it('visibleなvalidated state authorityはtimeline errorの根拠として保持する', () => {
    const audit = buildAudit('timeline_discontinuity');
    audit.panelRepairs = [];
    expect(() => validateEpisodePlanAuditIssueGrounding({
      audit,
      groundings: [{
        issue_index: 0,
        basis: 'source',
        source_evidence: [{
          page_id: PAGE_ID,
          source_ref: 'validated_state',
          quote: 'state_id=raincoat',
        }],
        output_evidence: [{
          page_id: PAGE_ID,
          output_ref: 'p1.e',
          quote: 'state_id=default',
        }],
      }],
      catalog: buildCatalog(),
      additionalAuthorities: [{
        ref: 'validated_state',
        text: 'entity_id=coco | state_id=raincoat',
        kind: 'validated_state',
      }],
    })).not.toThrow();
  });

  it('field repair付きerrorとpatch不要のstate errorが混在してもground済みbodyを受理する', () => {
    const audit = buildAudit('source_omission');
    audit.issues.push({
      code: 'timeline_discontinuity',
      severity: 'error',
      pageIds: [PAGE_TWO_ID],
      message: '状態境界を確認できない。',
      repairInstruction: 'state mappingとして確認する。',
    });
    const catalog = buildCatalog();
    catalog.pages.push({
      pageId: PAGE_TWO_ID,
      authorities: [{
        ref: 'page_source',
        text: '別ページの原文。',
        kind: 'original_page',
      }],
      outputs: [{ ref: 'p1.e', text: 'state_id=default', panelOrder: 1 }],
    });

    expect(() => validateEpisodePlanAuditIssueGrounding({
      audit,
      groundings: [
        ...buildSourceOmissionGrounding(),
        {
          issue_index: 1,
          basis: 'source',
          source_evidence: [{
            page_id: PAGE_TWO_ID,
            source_ref: 'validated_state',
            quote: 'state_id=raincoat',
          }],
          output_evidence: [{
            page_id: PAGE_TWO_ID,
            output_ref: 'p1.e',
            quote: 'state_id=default',
          }],
        },
      ],
      catalog,
      additionalAuthorities: [{
        ref: 'validated_state',
        text: 'entity_id=coco | state_id=raincoat',
        kind: 'validated_state',
      }],
    })).not.toThrow();
  });

  it('visibleなsource contextはentity state矛盾の根拠として保持する', () => {
    const audit = buildAudit('visible_entity_mismatch');
    const catalog = buildCatalog();
    catalog.pages[0]!.authorities.push({
      ref: 'source_context',
      text: 'ココのコートは赤い。',
      kind: 'source_context',
    });

    expect(() => validateEpisodePlanAuditIssueGrounding({
      audit,
      groundings: [{
        issue_index: 0,
        basis: 'source',
        source_evidence: [{
          page_id: PAGE_ID,
          source_ref: 'source_context',
          quote: 'コートは赤い',
        }],
        output_evidence: [{
          page_id: PAGE_ID,
          output_ref: 'p1.e',
          quote: 'state_id=default',
        }],
      }],
      catalog,
    })).not.toThrow();
  });

  it('deterministic exemptionは実際のtyped findingとcode・pageが一致する場合だけ許可する', () => {
    const audit = buildAudit('duplicate_dialogue');
    const catalog = buildCatalog();
    catalog.deterministicIssues = [{ code: 'dialogue_density', pageIds: [PAGE_ID] }];

    expect(() => validateEpisodePlanAuditIssueGrounding({
      audit,
      groundings: [{
        issue_index: 0,
        basis: 'deterministic',
        source_evidence: [],
        output_evidence: [],
      }],
      catalog,
    })).toThrow('deterministic grounding does not match');
  });

  it('存在しないpanelを修復対象にしたsource-owned bodyを拒否する', () => {
    const audit = buildAudit('source_omission');
    audit.panelRepairs = [{
      pageId: PAGE_ID,
      panelOrder: 2,
      changedFields: ['situationText'],
      patch: { situationText: '出口へ進む。' },
    }];

    expect(() => validateEpisodePlanAuditIssueGrounding({
      audit,
      groundings: [{
        issue_index: 0,
        basis: 'source',
        source_evidence: [{
          page_id: PAGE_ID,
          source_ref: 'page_source',
          quote: '出口へ進む',
        }],
        output_evidence: [],
      }],
      catalog: buildCatalog(),
    })).toThrow('panel repair is outside the audit scope');
  });

  it('error対象外の既知pageへ向けたrepairを拒否する', () => {
    const audit = buildAudit('source_omission');
    audit.panelRepairs = [{
      pageId: PAGE_TWO_ID,
      panelOrder: 1,
      changedFields: ['situationText'],
      patch: { situationText: '別ページを変更する。' },
    }];
    const catalog = buildCatalog();
    catalog.pages.push({
      pageId: PAGE_TWO_ID,
      authorities: [{
        ref: 'page_source',
        text: '別ページの原文。',
        kind: 'original_page',
      }],
      outputs: [{ ref: 'p1.s', text: '別ページの描写。', panelOrder: 1 }],
    });

    expect(() => validateEpisodePlanAuditIssueGrounding({
      audit,
      groundings: buildSourceOmissionGrounding(),
      catalog,
    })).toThrow('repair targeted a page without an error');
  });

  it('同じpage・panel fieldを複数repairで変更するbodyを拒否する', () => {
    const audit = buildAudit('source_omission');
    audit.panelRepairs?.push({
      pageId: PAGE_ID,
      panelOrder: 1,
      changedFields: ['situationText'],
      patch: { situationText: '同じfieldを再変更する。' },
    });

    expect(() => validateEpisodePlanAuditIssueGrounding({
      audit,
      groundings: buildSourceOmissionGrounding(),
      catalog: buildCatalog(),
    })).toThrow('repair changed the same field more than once');
  });

  it('全null source unit reviewの受理はschema・link整合だけで意味品質の証明ではない', () => {
    expect(() => validateEpisodePlanAuditSourceUnitReview({
      audit: { accepted: true, issues: [], pageRepairs: [], panelRepairs: [] },
      review: [null],
      catalog: buildSourceReviewCatalog(PAGE_ID),
      groundings: [],
      groundingCatalog: buildCatalog(),
    })).not.toThrow();
  });

  it('page unitは同じpageの既存grounded errorへだけlinkできる', () => {
    expect(() => validateEpisodePlanAuditSourceUnitReview({
      audit: buildAudit('source_omission'),
      review: [0],
      catalog: buildSourceReviewCatalog(PAGE_ID),
      groundings: buildSourceOmissionGrounding(),
      groundingCatalog: buildCatalog(),
    })).not.toThrow();
  });

  it('4文字未満unitでもauthority上の境界跨ぎexact quoteがspanへ重なる場合はlinkできる', () => {
    const audit = buildAudit('source_omission');
    const authorityText = '前。笑う。次へ進む。';
    const groundings = buildSourceOmissionGrounding();
    groundings[0]!.source_evidence[0]!.quote = '。笑う。';
    const groundingCatalog = buildCatalog();
    groundingCatalog.pages[0]!.authorities[0]!.text = authorityText;

    expect(() => validateEpisodePlanAuditSourceUnitReview({
      audit,
      review: [0],
      catalog: {
        units: [{
          scope: 'page', pageId: PAGE_ID, sourceRef: 'page_source',
          start: 2, end: 5, text: '笑う。',
        }],
      },
      groundings,
      groundingCatalog,
    })).not.toThrow();
  });

  it('同じexact quoteの複数出現中にunitと重なる出現があればlinkできる', () => {
    const authorityText = '合図する。別の節。合図する。';
    const groundings = buildSourceOmissionGrounding();
    groundings[0]!.source_evidence[0]!.quote = '合図する';
    const groundingCatalog = buildCatalog();
    groundingCatalog.pages[0]!.authorities[0]!.text = authorityText;

    expect(() => validateEpisodePlanAuditSourceUnitReview({
      audit: buildAudit('source_omission'),
      review: [0],
      catalog: {
        units: [{
          scope: 'page', pageId: PAGE_ID, sourceRef: 'page_source',
          start: 9, end: 14, text: '合図する。',
        }],
      },
      groundings,
      groundingCatalog,
    })).not.toThrow();
  });

  it('exact quoteが同じauthorityの遠い別unitにしかない場合はlinkを拒否する', () => {
    const authorityText = '遠い引用。別の節。';
    const groundings = buildSourceOmissionGrounding();
    groundings[0]!.source_evidence[0]!.quote = '遠い引用';
    const groundingCatalog = buildCatalog();
    groundingCatalog.pages[0]!.authorities[0]!.text = authorityText;

    expect(() => validateEpisodePlanAuditSourceUnitReview({
      audit: buildAudit('source_omission'),
      review: [0],
      catalog: {
        units: [{
          scope: 'page', pageId: PAGE_ID, sourceRef: 'page_source',
          start: 5, end: 9, text: '別の節。',
        }],
      },
      groundings,
      groundingCatalog,
    })).toThrow('not grounded in that exact source unit');
  });

  it('page unitをoriginal_global authorityへ交換して検証できない', () => {
    const groundingCatalog = buildCatalog();
    groundingCatalog.pages[0]!.authorities[0]!.kind = 'original_global';
    expect(() => validateEpisodePlanAuditSourceUnitReview({
      audit: buildAudit('source_omission'),
      review: [0],
      catalog: buildSourceReviewCatalog(PAGE_ID),
      groundings: buildSourceOmissionGrounding(),
      groundingCatalog,
    })).toThrow('not an exact span of its typed original authority');
  });

  it.each([
    ['missing', []],
    ['extra', [null, null]],
  ])('source unit reviewの%s vectorを拒否する', (_label, review) => {
    expect(() => validateEpisodePlanAuditSourceUnitReview({
      audit: { accepted: true, issues: [], pageRepairs: [], panelRepairs: [] },
      review,
      catalog: buildSourceReviewCatalog(PAGE_ID),
      groundings: [],
      groundingCatalog: buildCatalog(),
    })).toThrow('length does not match');
  });

  it('source unit reviewのunknown issue indexを拒否する', () => {
    expect(() => validateEpisodePlanAuditSourceUnitReview({
      audit: buildAudit('source_omission'),
      review: [9],
      catalog: buildSourceReviewCatalog(PAGE_ID),
      groundings: buildSourceOmissionGrounding(),
      groundingCatalog: buildCatalog(),
    })).toThrow('unknown or non-source error issue');
  });

  it('source unit reviewを別page issueへlinkできない', () => {
    expect(() => validateEpisodePlanAuditSourceUnitReview({
      audit: buildAudit('source_omission'),
      review: [0],
      catalog: buildSourceReviewCatalog(PAGE_TWO_ID),
      groundings: buildSourceOmissionGrounding(),
      groundingCatalog: buildCatalog(),
    })).toThrow('outside the unit page');
  });
});

function buildSourceOmissionGrounding() {
  return [{
    issue_index: 0,
    basis: 'source' as const,
    source_evidence: [{
      page_id: PAGE_ID,
      source_ref: 'page_source',
      quote: '出口へ進む',
    }],
    output_evidence: [],
  }];
}

function buildAudit(code: EpisodePlanAudit['issues'][number]['code']): EpisodePlanAudit {
  return {
    accepted: false,
    issues: [{
      code,
      severity: 'error',
      pageIds: [PAGE_ID],
      message: '修復が必要。',
      repairInstruction: '原文へ戻す。',
    }],
    pageRepairs: [],
    panelRepairs: [{
      pageId: PAGE_ID,
      panelOrder: 1,
      changedFields: ['situationText'],
      patch: { situationText: '出口へ進む。' },
    }],
  };
}

function buildCatalog(): EpisodePlanAuditGroundingCatalog {
  return {
    pages: [{
      pageId: PAGE_ID,
      authorities: [{
        ref: 'page_source',
        text: '矢印に沿って狭い岩の隙間を通り、出口へ進む。',
        kind: 'original_page',
      }],
      outputs: [
        {
          ref: 'p1.n',
          text: '出口に到達する直前で区切る。',
          panelOrder: 1,
        },
        {
          ref: 'p1.e',
          text: 'ココ{state_id=default}',
          panelOrder: 1,
        },
      ],
    }],
    deterministicIssues: [],
  };
}

function buildSourceReviewCatalog(pageId: string) {
  const text = '矢印に沿って狭い岩の隙間を通り、出口へ進む。';
  return {
    units: [{ scope: 'page' as const, pageId, sourceRef: 'page_source' as const, start: 0, end: text.length, text }],
  };
}
