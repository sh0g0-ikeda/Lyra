import type { AppLanguage } from '../../domain/types/language.js';

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

export interface EpisodeBeatPlanCompilerPort {
  compileBeatPlan(input: CompileEpisodeBeatPlanInput): Promise<CompiledEpisodeBeatPlan>;
}
