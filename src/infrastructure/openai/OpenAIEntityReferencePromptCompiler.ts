import { ConfigurationError } from '../../domain/errors/index.js';
import {
  ENTITY_REFERENCE_PROMPT_COMPILER_MAX_TOKENS,
  ENTITY_REFERENCE_PROMPT_COMPILER_OPENAI_MODEL,
  ENTITY_REFERENCE_PROMPT_COMPILER_VERSION,
} from '../../domain/constants/entityReference.js';
import type {
  CompiledEntityReferencePrompt,
  CompileEntityReferencePromptInput,
  EntityReferencePromptCompilerPort,
} from '../../services/entity/EntityReferencePromptCompiler.js';
import { OpenAIClient } from './OpenAIClient.js';
import { OPENAI_IMAGE_PROMPT_PERSON_GUIDANCE } from './OpenAIImagePromptGuidance.js';

interface OpenAICompilerResponse {
  output_text?: unknown;
  output?: unknown;
}

export class OpenAIEntityReferencePromptCompiler implements EntityReferencePromptCompilerPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly model = ENTITY_REFERENCE_PROMPT_COMPILER_OPENAI_MODEL,
  ) {}

  public async compilePrompt(input: CompileEntityReferencePromptInput): Promise<CompiledEntityReferencePrompt> {
    const response = await this.client.postJson<OpenAICompilerResponse>('/responses', {
      model: this.model,
      max_output_tokens: ENTITY_REFERENCE_PROMPT_COMPILER_MAX_TOKENS,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: buildSystemPrompt(),
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: buildUserPrompt(input.compilerBrief),
            },
          ],
        },
      ],
    });

    const outputText = extractOutputText(response.body);
    if (outputText === null) {
      throw new ConfigurationError('OpenAI entity prompt compiler returned no text output');
    }

    return {
      prompt: normalizeCompiledPrompt(outputText),
      compilerProvider: 'openai',
      compilerModel: this.model,
      compilerPromptVersion: ENTITY_REFERENCE_PROMPT_COMPILER_VERSION,
    };
  }
}

function buildSystemPrompt(): string {
  return [
    'Rewrite the provided manga character design brief into one optimized GPT Image 2 prompt for a full-body character reference.',
    'Return only the final prompt text.',
    'Write a compact natural-language art direction brief, not JSON and not a field-by-field list.',
    'If the brief contains a named style reference title, preserve that title explicitly in the final prompt and honor the accompanying generalized style interpretation and style anchors as hard rendering constraints.',
    'Treat the style reference as rendering treatment only. Do not let it override the authored face shape, eye shape, hair silhouette, body proportions, or outfit silhouette.',
    'Prioritize: 1. named style constraint and style anchors, 2. instantly readable character identity, 3. stable silhouette, 4. distinctive face and hair anchors, 5. outfit readability, 6. neutral full-body reference framing.',
    'Convert abstract personality traits into visible design cues, but do not add action, props, weapons, dramatic background, camera effects, text, or extra characters unless explicitly requested.',
    ...OPENAI_IMAGE_PROMPT_PERSON_GUIDANCE,
    'Preserve all hard constraints exactly.',
    'The subject must be centered, single, fully visible from head to toe, with both hands and both feet visible, on a plain neutral background.',
    'Use clear concrete visual language. Avoid vague praise words like beautiful, cool, high-quality, masterpiece, cinematic, or stunning.',
    'Keep the final prompt between 150 and 220 words unless the brief is very simple.',
  ].join(' ');
}

function buildUserPrompt(compilerBrief: string): string {
  return [
    'Character brief:',
    compilerBrief,
    '',
    'Write the final GPT Image 2 prompt now.',
  ].join('\n');
}

function extractOutputText(response: OpenAICompilerResponse): string | null {
  if (typeof response.output_text === 'string' && response.output_text.trim().length > 0) {
    return response.output_text.trim();
  }

  if (!Array.isArray(response.output)) {
    return null;
  }

  for (const item of response.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (!isRecord(content)) {
        continue;
      }

      const text = content.text;
      if (typeof text === 'string' && text.trim().length > 0) {
        return text.trim();
      }
    }
  }

  return null;
}

function normalizeCompiledPrompt(value: string): string {
  return value
    .trim()
    .replace(/^```(?:text)?\s*/u, '')
    .replace(/\s*```$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
