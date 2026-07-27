import type { AppLanguage } from '../../domain/types/language.js';
import { ConfigurationError } from '../../domain/errors/index.js';

export interface EpisodeBeatPlanPage {
  pageId: string;
  pageNumber: number;
  storyBeats: string[];
  entryState: string;
  exitState: string;
  newInformation: string[];
  dialogueIntent: string | null;
  handoff: string | null;
}

export interface EpisodeBeatPlan {
  pages: EpisodeBeatPlanPage[];
}

export interface EpisodeBeatPlanOutlinePage {
  pageId: string;
  pageNumber: number;
  storyAnchor: string;
  reservedTransition: string;
}

export interface EpisodeBeatPlanOutline {
  pages: EpisodeBeatPlanOutlinePage[];
}

export interface CompileEpisodeBeatPlanInput {
  compilerBrief: string;
  language: AppLanguage;
}

export interface CompiledEpisodeBeatPlan {
  plan: EpisodeBeatPlan;
  compilerProvider: 'openai';
  compilerModel: string;
  compilerPromptVersion: string;
}

export interface CompileEpisodeBeatPlanOutlineInput {
  compilerBrief: string;
  language: AppLanguage;
}

export interface CompiledEpisodeBeatPlanOutline {
  outline: EpisodeBeatPlanOutline;
  compilerProvider: 'openai';
  compilerModel: string;
  compilerPromptVersion: string;
}

/**
 * Lets the service split a global ledger only for the provider's explicit
 * structured-output capacity failure, without depending on an infrastructure
 * error class.
 */
export class EpisodeBeatPlanOutputLimitError extends ConfigurationError {
  public constructor() {
    super('Episode beat plan reached its structured output limit');
  }
}

export interface EpisodeBeatPlanCompilerPort {
  compileBeatPlan(input: CompileEpisodeBeatPlanInput): Promise<CompiledEpisodeBeatPlan>;
}

export interface EpisodeBeatPlanOutlineCompilerPort {
  compileOutline(
    input: CompileEpisodeBeatPlanOutlineInput,
  ): Promise<CompiledEpisodeBeatPlanOutline>;
}
