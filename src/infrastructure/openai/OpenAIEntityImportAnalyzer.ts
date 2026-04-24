import { ConfigurationError } from '../../domain/errors/index.js';
import type { EntityType } from '../../domain/types/entity.js';
import { OpenAIClient } from './OpenAIClient.js';

export interface AnalyzeEntityImportInput {
  entityType: EntityType;
  dataUrl: string;
}

export interface EntityImportAnalyzerPort {
  analyze(input: AnalyzeEntityImportInput): Promise<{
    suggestedFields: Record<string, unknown>;
    promptSupplement: string;
  }>;
}

interface OpenAIResponsesTextResponse {
  output_text?: unknown;
  output?: Array<{
    content?: Array<{
      type?: unknown;
      text?: unknown;
    }>;
  }>;
}

export class OpenAIEntityImportAnalyzer implements EntityImportAnalyzerPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly model = 'gpt-4o',
  ) {}

  public async analyze(input: AnalyzeEntityImportInput): Promise<{
    suggestedFields: Record<string, unknown>;
    promptSupplement: string;
  }> {
    const response = await this.client.postJson<OpenAIResponsesTextResponse>('/responses', {
      model: this.model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: buildAnalysisPrompt(input.entityType),
            },
            {
              type: 'input_image',
              image_url: input.dataUrl,
            },
          ],
        },
      ],
    });

    const text = extractResponseText(response.body);
    const normalizedText = stripMarkdownCodeFence(text);

    let parsed: unknown;
    try {
      parsed = JSON.parse(normalizedText);
    } catch {
      throw new ConfigurationError('Entity import analyzer returned invalid JSON');
    }

    const payload = toObjectRecord(parsed);
    if (
      typeof payload.prompt_supplement !== 'string'
    ) {
      throw new ConfigurationError('Entity import analyzer returned an invalid payload');
    }

    const suggestedFields =
      typeof payload.suggested_fields === 'object' &&
      payload.suggested_fields !== null &&
      !Array.isArray(payload.suggested_fields)
        ? (payload.suggested_fields as Record<string, unknown>)
        : {};

    return {
      suggestedFields,
      promptSupplement: payload.prompt_supplement.trim(),
    };
  }
}

function buildAnalysisPrompt(entityType: EntityType): string {
  return [
    `Analyze this ${entityType} design image.`,
    'Return JSON only.',
    'Shape: {"suggested_fields": {...}, "prompt_supplement": "..." }',
    'Use only enum-compatible values when obvious. Omit uncertain fields instead of inventing them.',
    'prompt_supplement must be one concise English visual description usable for later image generation.',
  ].join(' ');
}

function extractResponseText(response: OpenAIResponsesTextResponse): string {
  if (typeof response.output_text === 'string' && response.output_text.length > 0) {
    return response.output_text;
  }

  const contentText = response.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === 'output_text' && typeof item.text === 'string')
    ?.text;

  if (typeof contentText === 'string' && contentText.length > 0) {
    return contentText;
  }

  throw new ConfigurationError('Entity import analyzer returned no text');
}

function stripMarkdownCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '').trim();
}

function toObjectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}
