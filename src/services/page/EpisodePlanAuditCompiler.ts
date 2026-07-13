import type { AppLanguage } from '../../domain/types/language.js';

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

export interface EpisodePlanAudit {
  accepted: boolean;
  issues: EpisodePlanAuditIssue[];
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
