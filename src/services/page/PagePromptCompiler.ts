export interface CompilePagePromptInput {
  draftPrompt: string;
  compilerBrief: string;
}

export interface CompiledPagePrompt {
  prompt: string;
  compilerProvider: 'openai' | 'none';
  compilerModel: string | null;
  compilerPromptVersion: string | null;
}

export interface PagePromptCompilerPort {
  compilePrompt(input: CompilePagePromptInput): Promise<CompiledPagePrompt>;
}

export class PassthroughPagePromptCompiler implements PagePromptCompilerPort {
  public async compilePrompt(input: CompilePagePromptInput): Promise<CompiledPagePrompt> {
    return {
      prompt: input.draftPrompt,
      compilerProvider: 'none',
      compilerModel: null,
      compilerPromptVersion: null,
    };
  }
}
