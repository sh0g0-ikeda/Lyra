import type { PageSkeletonPageDraft } from '../../domain/types/storyAi.js';
import {
  improveEpisodeDraftResponseSchema,
  pageSkeletonResponseSchema,
} from '../../lib/validators/storyAi.schema.js';
import { AnthropicClient } from './AnthropicClient.js';
import type { ZodType } from 'zod';
import type {
  StoryAiClientPort,
  StoryAiModelRequest,
  StoryEpisodeDraftWriterOutput,
} from '../../services/story/StoryAiClientPort.js';

const DEPRECATED_ANTHROPIC_STORY_MODEL = 'claude-sonnet-4-20250514';
const DEPRECATED_PAGE_SKELETON_MAX_TOKENS = 6000;
const DEPRECATED_STORY_COLLABORATION_MAX_TOKENS = 3000;
const DEPRECATED_STORY_EPISODE_IMPROVEMENT_WRITER_MAX_TOKENS = 3200;

export class AnthropicStoryAiClient implements StoryAiClientPort {
  public constructor(private readonly client: AnthropicClient) {}

  public streamCollaboration(request: StoryAiModelRequest): AsyncIterable<string> {
    return this.client.streamMessageText({
      model: DEPRECATED_ANTHROPIC_STORY_MODEL,
      system: request.systemPrompt,
      max_tokens: DEPRECATED_STORY_COLLABORATION_MAX_TOKENS,
      temperature: 0.7,
      messages: [
        {
          role: 'user',
          content: request.userPrompt,
        },
      ],
    });
  }

  public async generatePageSkeleton(request: StoryAiModelRequest): Promise<PageSkeletonPageDraft[]> {
    const response = await this.client.createMessageText({
      model: DEPRECATED_ANTHROPIC_STORY_MODEL,
      system: request.systemPrompt,
      max_tokens: DEPRECATED_PAGE_SKELETON_MAX_TOKENS,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: request.userPrompt,
        },
      ],
    });

    const parsed = await this.parseStructuredResponse(
      response.text,
      pageSkeletonResponseSchema,
      {
        model: DEPRECATED_ANTHROPIC_STORY_MODEL,
        maxTokens: Math.min(DEPRECATED_PAGE_SKELETON_MAX_TOKENS, 8_000),
        targetShape:
          '{ "pages": [{ "page_number": number, "purpose": string, "suggested_panel_count": number, "suggested_layout": string, "panels": [...] }] }',
      },
    );

    return parsed.pages.map((page) => ({
      pageNumber: page.page_number,
      purpose: page.purpose,
      suggestedPanelCount: page.suggested_panel_count,
      suggestedLayout: page.suggested_layout,
      panels: page.panels.map((panel) => ({
        order: panel.order,
        panelRole: panel.panel_role,
        suggestedSize: panel.suggested_size,
        situationHint: panel.situation_hint,
        suggestedEntities: panel.suggested_entities,
        suggestedDialogueHint: panel.suggested_dialogue_hint,
      })),
    }));
  }

  public async improveEpisodeDraft(request: StoryAiModelRequest): Promise<StoryEpisodeDraftWriterOutput> {
    const response = await this.client.createMessageText({
      model: DEPRECATED_ANTHROPIC_STORY_MODEL,
      system: request.systemPrompt,
      max_tokens: DEPRECATED_STORY_EPISODE_IMPROVEMENT_WRITER_MAX_TOKENS,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: request.userPrompt,
        },
      ],
    });

    const parsed = await this.parseStructuredResponse(
      response.text,
      improveEpisodeDraftResponseSchema,
      {
        model: DEPRECATED_ANTHROPIC_STORY_MODEL,
        maxTokens: Math.min(DEPRECATED_STORY_EPISODE_IMPROVEMENT_WRITER_MAX_TOKENS, 6_000),
        targetShape:
          '{ "title": string|null, "purpose": string|null, "introduction": string|null, "middle": string|null, "climax": string|null, "ending_hook": string|null }',
      },
    );

    return {
      title: parsed.title,
      purpose: parsed.purpose,
      introduction: parsed.introduction,
      middle: parsed.middle,
      climax: parsed.climax,
      endingHook: parsed.ending_hook,
    };
  }

  private async parseStructuredResponse<T>(
    responseText: string,
    schema: ZodType<T>,
    repairOptions: {
      model: string;
      maxTokens: number;
      targetShape: string;
    },
  ): Promise<T> {
    const direct = tryParseStructuredJson(responseText, schema);
    if (direct.success) {
      return direct.value;
    }

    const repairedText = await this.repairStructuredJson(responseText, repairOptions);
    const repaired = tryParseStructuredJson(repairedText, schema);
    if (repaired.success) {
      return repaired.value;
    }

    throw new SyntaxError(
      `Structured JSON parse failed after repair attempt. Initial error: ${direct.error.message}. Repair error: ${repaired.error.message}`,
    );
  }

  private async repairStructuredJson(
    malformedText: string,
    options: {
      model: string;
      maxTokens: number;
      targetShape: string;
    },
  ): Promise<string> {
    const response = await this.client.createMessageText({
      model: options.model,
      system: [
        'You repair malformed JSON emitted by another model.',
        'Return strict JSON only.',
        'Do not wrap the JSON in markdown fences.',
        'Do not add commentary.',
        'Preserve the intended content and field names; only make the minimum fixes needed for valid JSON.',
        `Target JSON shape: ${options.targetShape}`,
      ].join('\n'),
      max_tokens: options.maxTokens,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            'Repair this malformed JSON-like text into strict JSON.',
            '',
            malformedText,
          ].join('\n'),
        },
      ],
    });

    return response.text;
  }
}

function stripMarkdownCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/u, '')
    .replace(/\s*```$/u, '')
    .trim();
}

function normalizeStructuredJson(value: string): string {
  const trimmed = normalizeUnicodeQuotes(stripMarkdownCodeFence(value));
  const extracted = extractFirstJsonValue(trimmed);
  const candidate = extracted ?? trimmed;
  return stripTrailingCommas(candidate).trim();
}

function tryParseStructuredJson<T>(
  value: string,
  schema: ZodType<T>,
): { success: true; value: T } | { success: false; error: Error } {
  try {
    return {
      success: true,
      value: schema.parse(JSON.parse(normalizeStructuredJson(value))),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

function extractFirstJsonValue(value: string): string | null {
  const objectStart = value.indexOf('{');
  const arrayStart = value.indexOf('[');
  let start = -1;
  let opening = '{';
  let closing = '}';

  if (objectStart === -1 && arrayStart === -1) {
    return null;
  }
  if (objectStart === -1 || (arrayStart !== -1 && arrayStart < objectStart)) {
    start = arrayStart;
    opening = '[';
    closing = ']';
  } else {
    start = objectStart;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = start; index < value.length; index += 1) {
    const character = value[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (character === '\\') {
        isEscaped = true;
        continue;
      }

      if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === opening) {
      depth += 1;
      continue;
    }

    if (character === closing) {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return null;
}

function normalizeUnicodeQuotes(value: string): string {
  return value
    .replace(/[\u201c\u201d]/gu, '"')
    .replace(/[\u2018\u2019]/gu, "'");
}

function stripTrailingCommas(value: string): string {
  let result = '';
  let inString = false;
  let isEscaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (inString) {
      result += character;
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (character === '\\') {
        isEscaped = true;
        continue;
      }

      if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }

    if (character === ',') {
      const nextNonWhitespace = findNextNonWhitespace(value, index + 1);
      if (nextNonWhitespace === '}' || nextNonWhitespace === ']') {
        continue;
      }
    }

    result += character;
  }

  return result;
}

function findNextNonWhitespace(value: string, start: number): string | null {
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (/\s/u.test(character)) {
      continue;
    }
    return character;
  }

  return null;
}
