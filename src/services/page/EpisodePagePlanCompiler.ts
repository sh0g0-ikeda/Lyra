import type { EpisodePagePlanSuggestion } from '../../domain/types/page.js';
import type { AppLanguage } from '../../domain/types/language.js';

export interface CompileEpisodePagePlanInput {
  compilerBrief: string;
  language: AppLanguage;
  allowedEntityIds: readonly string[];
  beforeRetry?: () => Promise<void>;
}

export interface CompiledEpisodePagePlan {
  suggestion: EpisodePagePlanSuggestion;
  compilerProvider: 'openai';
  compilerModel: string;
  compilerPromptVersion: string;
}

export interface EpisodePagePlanCompilerPort {
  compilePlan(input: CompileEpisodePagePlanInput): Promise<CompiledEpisodePagePlan>;
}
