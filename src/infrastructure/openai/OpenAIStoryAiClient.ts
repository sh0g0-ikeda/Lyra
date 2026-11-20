import { z } from 'zod';
import {
  PAGE_SKELETON_MAX_TOKENS,
  PAGE_SKELETON_MODEL,
  STORY_AI_LIMITS,
  STORY_COLLABORATION_MAX_TOKENS,
  STORY_COLLABORATION_MODEL,
  STORY_EPISODE_IMPROVEMENT_WRITER_MAX_TOKENS,
  STORY_EPISODE_IMPROVEMENT_WRITER_MODEL,
  CHARACTER_AUTOFILL_COVERAGE_MAX_TOKENS,
  CHARACTER_AUTOFILL_EXTRACTION_MAX_TOKENS,
  CHARACTER_AUTOFILL_OPENAI_MODEL,
  CHARACTER_AUTOFILL_REASONING_EFFORT,
} from '../../domain/constants/storyAi.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { PageSkeletonPageDraft } from '../../domain/types/storyAi.js';
import { PANEL_FRAME_TEMPLATE_IDS } from '../../domain/constants/panelFrameTemplates.js';
import {
  improveEpisodeDraftResponseSchema,
  pageSkeletonResponseSchema,
} from '../../lib/validators/storyAi.schema.js';
import type {
  StoryAiClientPort,
  StoryAiModelRequest,
  StoryEpisodeDraftWriterOutput,
} from '../../services/story/StoryAiClientPort.js';
import { OpenAIClient } from './OpenAIClient.js';
import { requestOpenAIText, requestStructuredOpenAIResponse } from './StructuredOpenAIResponse.js';
import { extractedCharactersSchema, type ExtractedCharacter } from '../../../packages/api-contract/src/characterSuggestions.js';
import { characterAutofillExtractionSchema, type CharacterAutofillExtraction } from '../../services/story/CharacterAutofillFields.js';
import {
  characterAppearanceCoverageResponseSchema,
  type CharacterAppearanceCoverageResponse,
} from '../../services/story/CharacterAppearanceCoverage.js';

export class OpenAIStoryAiClient implements StoryAiClientPort {
  public constructor(private readonly client: OpenAIClient) {}

  public async suggestEpisodeProductionNotes(request: StoryAiModelRequest): Promise<string[]> {
    const schema = z.object({ notes: z.array(z.string().trim().min(1).max(600)).max(8) }).strict();
    const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(schema);
    const result = await requestStructuredOpenAIResponse({
      client: this.client,
      model: STORY_EPISODE_IMPROVEMENT_WRITER_MODEL,
      maxOutputTokens: 3_000,
      schemaName: 'episode_production_note_suggestions',
      jsonSchema,
      responseSchema: schema,
      errorLabel: 'OpenAI episode production suggestions',
      input: buildInput(request),
    });
    return result.notes;
  }

  public async extractEpisodeCharacters(request: StoryAiModelRequest): Promise<ExtractedCharacter[]> {
    const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(extractedCharactersSchema);
    const result = await requestStructuredOpenAIResponse({
      client: this.client,
      model: STORY_EPISODE_IMPROVEMENT_WRITER_MODEL,
      maxOutputTokens: 8_000,
      schemaName: 'episode_character_suggestions',
      jsonSchema,
      responseSchema: extractedCharactersSchema,
      errorLabel: 'OpenAI episode character extractor',
      input: buildInput(request),
    });
    return result.characters;
  }

  public async extractCharacterAutofill(request: StoryAiModelRequest): Promise<CharacterAutofillExtraction> {
    const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(characterAutofillExtractionSchema);
    const result = await requestStructuredOpenAIResponse({
      client: this.client,
      model: CHARACTER_AUTOFILL_OPENAI_MODEL,
      reasoningEffort: CHARACTER_AUTOFILL_REASONING_EFFORT,
      maxOutputTokens: CHARACTER_AUTOFILL_EXTRACTION_MAX_TOKENS,
      schemaName: 'episode_character_autofill',
      jsonSchema,
      responseSchema: characterAutofillExtractionSchema,
      errorLabel: 'OpenAI episode character autofill',
      input: buildInput(request),
    });
    return result.characters;
  }

  public async reconcileCharacterAutofillCoverage(
    request: StoryAiModelRequest,
  ): Promise<CharacterAppearanceCoverageResponse> {
    const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(
      characterAppearanceCoverageResponseSchema,
    );
    return requestStructuredOpenAIResponse({
      client: this.client,
      model: CHARACTER_AUTOFILL_OPENAI_MODEL,
      reasoningEffort: CHARACTER_AUTOFILL_REASONING_EFFORT,
      maxOutputTokens: CHARACTER_AUTOFILL_COVERAGE_MAX_TOKENS,
      schemaName: 'episode_character_appearance_coverage',
      jsonSchema,
      responseSchema: characterAppearanceCoverageResponseSchema,
      errorLabel: 'OpenAI episode character appearance coverage',
      input: buildInput(request),
    });
  }

  public streamCollaboration(request: StoryAiModelRequest): AsyncIterable<string> {
    return this.streamSingleResponse(request);
  }

  public async generatePageSkeleton(request: StoryAiModelRequest): Promise<PageSkeletonPageDraft[]> {
    try {
      return await this.requestPageSkeleton(request, PAGE_SKELETON_MAX_TOKENS);
    } catch (error) {
      if (!shouldRetryPageSkeletonCompilation(error)) {
        throw error;
      }

      return this.requestPageSkeleton(
        request,
        Math.max(PAGE_SKELETON_MAX_TOKENS + 4000, PAGE_SKELETON_MAX_TOKENS * 2),
      );
    }
  }

  public async improveEpisodeDraft(
    request: StoryAiModelRequest,
  ): Promise<StoryEpisodeDraftWriterOutput> {
    const parsed = await requestStructuredOpenAIResponse({
      client: this.client,
      model: STORY_EPISODE_IMPROVEMENT_WRITER_MODEL,
      maxOutputTokens: STORY_EPISODE_IMPROVEMENT_WRITER_MAX_TOKENS,
      schemaName: 'episode_draft_improvement',
      jsonSchema: improveEpisodeDraftJsonSchema,
      responseSchema: improveEpisodeDraftResponseSchema,
      errorLabel: 'OpenAI episode draft writer',
      input: buildInput(request),
    });

    return {
      introduction: parsed.introduction,
      middle: parsed.middle,
      climax: parsed.climax,
      endingHook: parsed.ending_hook,
    };
  }

  private async *streamSingleResponse(
    request: StoryAiModelRequest,
  ): AsyncGenerator<string, void, void> {
    const outputText = await requestOpenAIText(this.client, {
      model: STORY_COLLABORATION_MODEL,
      maxOutputTokens: STORY_COLLABORATION_MAX_TOKENS,
      input: buildInput(request),
      errorLabel: 'OpenAI story collaboration',
    });

    if (outputText.length > 0) {
      yield outputText;
    }
  }

  private async requestPageSkeleton(
    request: StoryAiModelRequest,
    maxOutputTokens: number,
  ): Promise<PageSkeletonPageDraft[]> {
    const parsed = await requestStructuredOpenAIResponse({
      client: this.client,
      model: PAGE_SKELETON_MODEL,
      maxOutputTokens,
      schemaName: 'page_skeleton',
      jsonSchema: pageSkeletonJsonSchema,
      responseSchema: pageSkeletonResponseSchema,
      errorLabel: 'OpenAI page skeleton compiler',
      input: buildInput(request),
    });

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
}

function shouldRetryPageSkeletonCompilation(error: unknown): boolean {
  if (!(error instanceof ConfigurationError)) {
    return false;
  }

  return error.message === 'OpenAI page skeleton compiler returned invalid JSON';
}

function buildInput(request: StoryAiModelRequest) {
  return [
    {
      role: 'system' as const,
      content: [{ type: 'input_text' as const, text: request.systemPrompt }],
    },
    {
      role: 'user' as const,
      content: [{ type: 'input_text' as const, text: request.userPrompt }],
    },
  ];
}

const PAGE_SKELETON_PANEL_ROLES = [
  'establish',
  'action',
  'reaction',
  'emphasis',
  'transition',
  'pause',
  'impact',
] as const;

const PAGE_SKELETON_PANEL_SIZES = [
  'standard',
  'large',
  'wide',
  'narrow',
  'splash',
] as const;

const nullableStringSchema = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const;

const pageSkeletonJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['pages'],
  properties: {
    pages: {
      type: 'array',
      minItems: 1,
      maxItems: STORY_AI_LIMITS.maxSkeletonPages,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'page_number',
          'purpose',
          'suggested_panel_count',
          'suggested_layout',
          'panels',
        ],
        properties: {
          page_number: {
            type: 'integer',
            minimum: 1,
            maximum: STORY_AI_LIMITS.maxSkeletonPages,
          },
          purpose: { type: 'string', maxLength: 500 },
          suggested_panel_count: {
            type: 'integer',
            minimum: 1,
            maximum: STORY_AI_LIMITS.maxPanelsPerPage,
          },
          suggested_layout: { type: 'string', enum: [...PANEL_FRAME_TEMPLATE_IDS] },
          panels: {
            type: 'array',
            minItems: 1,
            maxItems: STORY_AI_LIMITS.maxPanelsPerPage,
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'order',
                'panel_role',
                'suggested_size',
                'situation_hint',
                'suggested_entities',
                'suggested_dialogue_hint',
              ],
              properties: {
                order: {
                  type: 'integer',
                  minimum: 1,
                  maximum: STORY_AI_LIMITS.maxPanelsPerPage,
                },
                panel_role: { type: 'string', enum: [...PAGE_SKELETON_PANEL_ROLES] },
                suggested_size: { type: 'string', enum: [...PAGE_SKELETON_PANEL_SIZES] },
                situation_hint: { type: 'string', maxLength: 2000 },
                suggested_entities: {
                  type: 'array',
                  maxItems: STORY_AI_LIMITS.maxEntitiesPerPanel,
                  items: { type: 'string' },
                },
                suggested_dialogue_hint: nullableStringSchema,
              },
            },
          },
        },
      },
    },
  },
} as const;

const improveEpisodeDraftJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['introduction', 'middle', 'climax', 'ending_hook'],
  properties: {
    introduction: nullableStringSchema,
    middle: nullableStringSchema,
    climax: nullableStringSchema,
    ending_hook: nullableStringSchema,
  },
} as const;
