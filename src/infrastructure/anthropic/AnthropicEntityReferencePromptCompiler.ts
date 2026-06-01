import { ConfigurationError } from '../../domain/errors/index.js';
import {
  ENTITY_REFERENCE_PROMPT_COMPILER_ANTHROPIC_MODEL,
  ENTITY_REFERENCE_PROMPT_COMPILER_MAX_TOKENS,
  ENTITY_REFERENCE_PROMPT_COMPILER_VERSION,
} from '../../domain/constants/entityReference.js';
import type { EntityReferenceContext } from '../../domain/types/entityReference.js';
import { AnthropicClient } from './AnthropicClient.js';
import type {
  CompiledEntityReferencePrompt,
  CompileEntityReferencePromptInput,
  EntityReferencePromptCompilerPort,
} from '../../services/entity/EntityReferencePromptCompiler.js';

export class AnthropicEntityReferencePromptCompiler implements EntityReferencePromptCompilerPort {
  public constructor(private readonly client: AnthropicClient) {}

  public async compilePrompt(input: CompileEntityReferencePromptInput): Promise<CompiledEntityReferencePrompt> {
    const response = await this.client.createMessageText({
      model: ENTITY_REFERENCE_PROMPT_COMPILER_ANTHROPIC_MODEL,
      system: buildSystemPrompt(),
      max_tokens: ENTITY_REFERENCE_PROMPT_COMPILER_MAX_TOKENS,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: buildUserPrompt(input.context, input.compilerBrief),
        },
      ],
    });

    const compiledPrompt = normalizeCompiledPrompt(response.text);
    if (compiledPrompt.length === 0) {
      throw new ConfigurationError('Entity prompt compiler returned empty text');
    }

    return {
      prompt: compiledPrompt,
      compilerProvider: 'anthropic',
      compilerModel: ENTITY_REFERENCE_PROMPT_COMPILER_ANTHROPIC_MODEL,
      compilerPromptVersion: ENTITY_REFERENCE_PROMPT_COMPILER_VERSION,
    };
  }
}

function buildSystemPrompt(): string {
  return [
    'Rewrite the provided manga character design brief into one optimized GPT Image 2 prompt for a full-body character reference.',
    'Return only the final prompt text.',
    'Write a compact natural-language art direction brief, not JSON and not a field-by-field list.',
    'Prioritize: 1. instantly readable character identity, 2. stable silhouette, 3. distinctive face and hair anchors, 4. outfit readability, 5. neutral full-body reference framing.',
    'Convert abstract personality traits into visible design cues, but do not add action, props, weapons, dramatic background, camera effects, text, or extra characters unless explicitly requested.',
    'Preserve all hard constraints exactly.',
    'The subject must be centered, single, fully visible from head to toe, with both hands and both feet visible, on a plain neutral background.',
    'Use clear concrete visual language. Avoid vague praise words like beautiful, cool, high-quality, masterpiece, cinematic, or stunning.',
    'Keep the final prompt between 150 and 220 words unless the brief is very simple.',
  ].join(' ');
}

function buildUserPrompt(context: EntityReferenceContext, compilerBrief: string): string {
  return [
    `Entity type: ${context.entityType}`,
    compilerBrief,
    'Rewrite this into one polished prompt for GPT Image 2.',
    'The result should read like a finished visual brief for a single full-body manga character reference image.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function normalizeCompiledPrompt(value: string): string {
  return value
    .trim()
    .replace(/^```(?:text)?\s*/u, '')
    .replace(/\s*```$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}
