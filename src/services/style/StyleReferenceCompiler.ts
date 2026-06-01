import type { StyleReferenceAnchors, StyleReferenceTarget } from '../../domain/types/styleReference.js';

export interface CompileStyleReferenceInput {
  title: string;
  notes: string | null;
  target: StyleReferenceTarget;
}

export interface CompiledStyleReference {
  title: string;
  notes: string | null;
  compiledBrief: string;
  anchors: StyleReferenceAnchors;
  compilerProvider: 'openai';
  compilerModel: string;
  compilerPromptVersion: string;
  compiledAt: string;
}

export interface StyleReferenceCompilerPort {
  compileStyleReference(input: CompileStyleReferenceInput): Promise<CompiledStyleReference>;
}
