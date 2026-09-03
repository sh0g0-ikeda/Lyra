import { ConfigurationError } from '../../domain/errors/index.js';
import {
  PAGE_PROMPT_COMPILER_MAX_TOKENS,
  PAGE_PROMPT_COMPILER_OPENAI_MODEL,
  PAGE_PROMPT_COMPILER_VERSION,
} from '../../domain/constants/generation.js';
import type {
  CompiledPagePrompt,
  CompilePagePromptInput,
  PagePromptCompilerPort,
} from '../../services/page/PagePromptCompiler.js';
import { OpenAIClient } from './OpenAIClient.js';

interface OpenAICompilerResponse {
  output_text?: unknown;
  output?: unknown;
}

export class OpenAIPagePromptCompiler implements PagePromptCompilerPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly model = PAGE_PROMPT_COMPILER_OPENAI_MODEL,
  ) {}

  public async compilePrompt(input: CompilePagePromptInput): Promise<CompiledPagePrompt> {
    const response = await this.client.postJson<OpenAICompilerResponse>('/responses', {
      model: this.model,
      max_output_tokens: PAGE_PROMPT_COMPILER_MAX_TOKENS,
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
      throw new ConfigurationError('OpenAI page prompt compiler returned no text output');
    }

    return {
      prompt: normalizeCompiledPrompt(outputText),
      compilerProvider: 'openai',
      compilerModel: this.model,
      compilerPromptVersion: PAGE_PROMPT_COMPILER_VERSION,
    };
  }
}

function buildSystemPrompt(): string {
  return [
    'Rewrite the provided manga page design brief into one optimized GPT Image 2 prompt for a manga page illustration.',
    'Return only the final prompt text.',
    'Write a clear natural-language manga production prompt, not JSON and not a field-by-field dump.',
    'The final prompt should read like a concise manga page direction note: first define the page as one complete image, then explain the reference image roles, then the overall setting and continuity, then the panel-by-panel action flow.',
    'If the brief contains a named style reference title, preserve that title explicitly in the final prompt and honor the accompanying generalized style interpretation and style anchors as hard page-wide rendering constraints.',
    'Character identity must stay anchored to the provided character reference images. Do not let the style reference alter face shape, eye shape, hair silhouette, body proportions, or outfit silhouette.',
    'Prioritize: 1. named style constraint and style anchors, 2. exact panel count and reading order, 3. strict layout adherence, 4. stable character identity from the named reference images, 5. coherent action continuity across panels, 6. readable dialogue and SFX only where they are explicitly required in the artwork.',
    'Always keep the reference image mapping explicit. If the brief says "Image 1 (Aoi)", preserve that role clearly so the model knows which image anchors which character.',
    'Treat every authored dialogue line as a hard lock whenever the brief marks it as baked dialogue. Preserve the exact wording, the exact speaker assignment, and whether the line is narration or character speech.',
    'If a brief says a line belongs to a named character, that same character must visibly own the line in the final page. Do not swap speakers, paraphrase the line, collapse multiple lines into one, or move narration into dialogue.',
    'For Japanese manga page flow, panel 1 is the upper-right or rightmost top entry; follow its numbered frame map generally right-to-left and downward toward the lower-left. For regular tiers this is right-to-left, then top-to-bottom; the complete frame map is authoritative for asymmetric or custom layouts.',
    'Keep dialogue, narration, and SFX in that reader sequence only within their supplied positions; every explicit authored dialogue position is also a hard lock.',
    'When the brief requires baked Japanese dialogue or narration, use traditional vertical tategaki, with glyphs top-to-bottom and columns right-to-left. Do not alter authored action, composition, or camera direction to fit text; preserve the authored dialogue and speaker locks exactly.',
    'Convert abstract emotional instructions into visible panel cues, but do not add props, extra characters, omitted panels, scenic backgrounds beyond the described setting, camera effects, or text that is not already present in the brief.',
    'Preserve all hard constraints exactly, especially panel order, dialogue text, SFX text, panel count, and reference image roles.',
    'The result must describe one complete manga page with explicit layout fidelity and full-page framing.',
    'Use clear concrete visual language. Avoid vague praise words like beautiful, cool, high-quality, masterpiece, cinematic, or stunning.',
    'Output the final prompt in the same language that the brief uses for authored dialogue, narration, and editable text fields.',
    'Keep the final prompt dense but readable, typically around 220 to 360 English-word equivalent unless the brief is very simple.',
  ].join(' ');
}

function buildUserPrompt(compilerBrief: string): string {
  return [
    'Page brief:',
    compilerBrief,
    '',
    'Write the final GPT Image 2 page-generation prompt now.',
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
