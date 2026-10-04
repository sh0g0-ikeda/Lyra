import type { AppLanguage } from '../../domain/types/language.js';
import type {
  PageAutofillPanelSuggestion,
  PageDialogueMode,
} from '../../domain/types/page.js';
import type { EpisodePlanAuditCoverageCatalog } from './EpisodePlanAuditCoverage.js';
import type { EpisodePlanSourceReviewCatalog } from './EpisodePlanSourceReview.js';

export type EpisodePlanAuditIssueCode =
  | 'duplicate_dialogue'
  | 'dialogue_density'
  | 'duplicate_visual_beat'
  | 'timeline_discontinuity'
  | 'dialogue_misplacement'
  | 'knowledge_violation'
  | 'page_handoff_break'
  | 'unsupported_story_fact'
  | 'source_omission'
  | 'ongoing_action_dropped'
  | 'visible_entity_mismatch';

export interface EpisodePlanAuditIssue {
  code: EpisodePlanAuditIssueCode;
  severity: 'warning' | 'error';
  pageIds: string[];
  message: string;
  repairInstruction: string;
}

export type EpisodePlanAuditPageRepairField =
  | 'sourceSceneIds'
  | 'pagePurpose'
  | 'continuityNote'
  | 'dialogueMode'
  | 'pageDialogueToggle';

export interface EpisodePlanAuditPageRepairPatch {
  sourceSceneIds?: string[];
  pagePurpose?: string | null;
  continuityNote?: string | null;
  dialogueMode?: PageDialogueMode;
  pageDialogueToggle?: boolean;
}

export interface EpisodePlanAuditPageRepair {
  pageId: string;
  changedFields: EpisodePlanAuditPageRepairField[];
  patch: EpisodePlanAuditPageRepairPatch;
}

export type EpisodePlanAuditPanelRepairField =
  | 'panelRole'
  | 'panelSize'
  | 'situationText'
  | 'composition'
  | 'dialogueInPanel'
  | 'dialogue'
  | 'sfxText'
  | 'backgroundNote'
  | 'panelNotes'
  | 'entities';

export type EpisodePlanAuditPanelRepairPatch = Partial<
  Omit<PageAutofillPanelSuggestion, 'order'>
>;

export interface EpisodePlanAuditPanelRepair {
  pageId: string;
  panelOrder: number;
  changedFields: EpisodePlanAuditPanelRepairField[];
  patch: EpisodePlanAuditPanelRepairPatch;
}

export interface EpisodePlanAuditCoverageEvidence {
  outputRef: string;
  quote: string;
}

export interface EpisodePlanAuditCoverageRepairTarget {
  scope: 'panel';
  pageId: string;
  panelOrder: number;
}

export interface EpisodePlanAuditCoverageCheck {
  sourceRef: string;
  sourceQuote: string;
  status: 'present' | 'missing';
  outputEvidence: EpisodePlanAuditCoverageEvidence[];
  issueCode: 'source_omission' | 'ongoing_action_dropped' | null;
  repairTarget: EpisodePlanAuditCoverageRepairTarget | null;
}

export interface EpisodePlanAuditSourceCoverage {
  pageId: string;
  checks: EpisodePlanAuditCoverageCheck[];
}

export type EpisodePlanAuditGroundingAuthorityKind =
  | 'original_page'
  | 'original_global'
  | 'source_context'
  | 'validated_state';

export interface EpisodePlanAuditGroundingAuthority {
  ref: string;
  text: string;
  kind: EpisodePlanAuditGroundingAuthorityKind;
}

export interface EpisodePlanAuditGroundingPageCatalog {
  pageId: string;
  authorities: EpisodePlanAuditGroundingAuthority[];
  outputs: Array<{
    ref: string;
    text: string;
    panelOrder: number | null;
  }>;
}

export interface EpisodePlanAuditGroundingCatalog {
  pages: EpisodePlanAuditGroundingPageCatalog[];
  deterministicIssues: Array<{
    code: EpisodePlanAuditIssueCode;
    pageIds: string[];
  }>;
}

export type EpisodePlanAuditCoverageCatalogWithGrounding = EpisodePlanAuditCoverageCatalog & {
  /** Trusted service-built authorities. User text never selects or extends this catalog. */
  grounding?: EpisodePlanAuditGroundingCatalog;
  /** Provider-only exact original-source review units; never persisted or returned publicly. */
  sourceReview?: EpisodePlanSourceReviewCatalog;
};

export interface EpisodePlanAudit {
  accepted: boolean;
  issues: EpisodePlanAuditIssue[];
  pageRepairs?: EpisodePlanAuditPageRepair[];
  panelRepairs?: EpisodePlanAuditPanelRepair[];
  /** Optional for legacy and fake compilers; the OpenAI compiler always returns it. */
  sourceCoverage?: EpisodePlanAuditSourceCoverage[];
}

export interface CompileEpisodePlanAuditInput {
  compilerBrief: string;
  language: AppLanguage;
  pageIds: string[];
  coverageCatalog?: EpisodePlanAuditCoverageCatalogWithGrounding;
  sourceOwnedPageContext?: boolean;
  /** Additional visible, validated authority appended by the service (for example state transitions). */
  groundingAuthorities?: EpisodePlanAuditGroundingAuthority[];
  beforeRetry?: () => Promise<void>;
}

export interface CompiledEpisodePlanAudit {
  audit: EpisodePlanAudit;
  compilerProvider: 'openai';
  compilerModel: string;
  compilerPromptVersion: string;
}

export interface EpisodePlanAuditCompilerPort {
  auditPlan(input: CompileEpisodePlanAuditInput): Promise<CompiledEpisodePlanAudit>;
}
