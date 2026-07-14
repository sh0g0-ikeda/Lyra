import type { AppLanguage } from '../../domain/types/language.js';
import type {
  PageAutofillPanelSuggestion,
  PageDialogueMode,
} from '../../domain/types/page.js';

export type EpisodePlanAuditIssueCode =
  | 'duplicate_dialogue'
  | 'duplicate_visual_beat'
  | 'timeline_discontinuity'
  | 'dialogue_misplacement'
  | 'knowledge_violation'
  | 'page_handoff_break'
  | 'unsupported_story_fact';

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

export interface EpisodePlanAudit {
  accepted: boolean;
  issues: EpisodePlanAuditIssue[];
  pageRepairs?: EpisodePlanAuditPageRepair[];
  panelRepairs?: EpisodePlanAuditPanelRepair[];
}

export interface CompileEpisodePlanAuditInput {
  compilerBrief: string;
  language: AppLanguage;
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
