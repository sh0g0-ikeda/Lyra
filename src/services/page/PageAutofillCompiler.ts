import type { PageAutofillSuggestion } from '../../domain/types/page.js';
import type { AppLanguage } from '../../domain/types/language.js';

export interface CompilePageAutofillInput {
  compilerBrief: string;
  language: AppLanguage;
}

export interface CompiledPageAutofillSuggestion {
  suggestion: PageAutofillSuggestion;
  compilerProvider: 'openai';
  compilerModel: string;
  compilerPromptVersion: string;
}

export interface PageAutofillCompilerPort {
  compileSuggestions(input: CompilePageAutofillInput): Promise<CompiledPageAutofillSuggestion>;
}
