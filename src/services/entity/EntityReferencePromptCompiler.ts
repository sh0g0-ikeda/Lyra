import type { EntityReferenceContext } from '../../domain/types/entityReference.js';

export interface CompileEntityReferencePromptInput {
  context: EntityReferenceContext;
  draftPrompt: string;
  compilerBrief: string;
}

export interface CompiledEntityReferencePrompt {
  prompt: string;
  compilerProvider: 'openai' | 'anthropic' | 'none';
  compilerModel: string | null;
  compilerPromptVersion: string | null;
}

export interface EntityReferencePromptCompilerPort {
  compilePrompt(input: CompileEntityReferencePromptInput): Promise<CompiledEntityReferencePrompt>;
}

export class PassthroughEntityReferencePromptCompiler implements EntityReferencePromptCompilerPort {
  public async compilePrompt(input: CompileEntityReferencePromptInput): Promise<CompiledEntityReferencePrompt> {
    return {
      prompt: input.draftPrompt,
      compilerProvider: 'none',
      compilerModel: null,
      compilerPromptVersion: null,
    };
  }
}
