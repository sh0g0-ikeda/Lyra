import type { EpisodePagePlanSuggestion } from '../../domain/types/page.js';
import type { AppLanguage } from '../../domain/types/language.js';
import type { EpisodeSourceRequirements } from './EpisodeSourceRequirements.js';
import type { EpisodeAutofillStateReference } from './EpisodeAutofillStateReferences.js';

/**
 * Autofill-only provider references are fixed from the complete authorized
 * episode context. Provider aliases never become persisted entity IDs.
 */
export interface EpisodeAutofillCharacterReference {
  readonly ref: string;
  readonly entityId: string;
  readonly name: string;
  readonly entityType: 'character' | 'nonhuman' | 'object';
}

export interface CompileEpisodePagePlanInput {
  compilerBrief: string;
  language: AppLanguage;
  sourceOwnedPageContext?: boolean;
  sourceRequirements?: EpisodeSourceRequirements;
  sourceRequirementPlacementPageIds?: string[];
  beforeRetry?: () => Promise<void>;
  /** Omission retains the existing internal compiler contract. */
  characterReferences?: readonly EpisodeAutofillCharacterReference[];
  /** Omission retains the legacy UUID/null contract; an explicit empty catalog is null-only. */
  stateReferences?: readonly EpisodeAutofillStateReference[];
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
