import type {
  StoryEpisodeDraftFields,
  StoryEpisodeImprovementAudit,
  StoryEpisodeImprovementContext,
  StoryEpisodeImprovementPlan,
} from '../../domain/types/storyAi.js';
import type { AppLanguage } from '../../domain/types/language.js';

export interface PlanStoryEpisodeImprovementInput {
  instruction: string;
  language: AppLanguage;
  baseDraft: StoryEpisodeDraftFields;
  context: StoryEpisodeImprovementContext;
}

export interface AuditStoryEpisodeImprovementInput {
  instruction: string;
  language: AppLanguage;
  baseDraft: StoryEpisodeDraftFields;
  context: StoryEpisodeImprovementContext;
  plan: StoryEpisodeImprovementPlan;
  draft: StoryEpisodeDraftFields;
}

export interface CompiledStoryEpisodeImprovementPlan {
  plan: StoryEpisodeImprovementPlan;
  compilerProvider: 'openai';
  compilerModel: string;
  compilerPromptVersion: string;
}

export interface CompiledStoryEpisodeImprovementAudit {
  audit: StoryEpisodeImprovementAudit;
  compilerProvider: 'openai';
  compilerModel: string;
  compilerPromptVersion: string;
}

export interface StoryEpisodeImprovementPlannerPort {
  planEpisodeImprovement(
    input: PlanStoryEpisodeImprovementInput,
  ): Promise<CompiledStoryEpisodeImprovementPlan>;
  auditEpisodeImprovement(
    input: AuditStoryEpisodeImprovementInput,
  ): Promise<CompiledStoryEpisodeImprovementAudit>;
}
