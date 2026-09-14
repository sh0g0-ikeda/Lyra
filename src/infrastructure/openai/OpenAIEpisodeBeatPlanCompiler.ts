import {
  EPISODE_BEAT_PLAN_COMPILER_MAX_TOKENS,
  EPISODE_BEAT_PLAN_COMPILER_OPENAI_MODEL,
  EPISODE_BEAT_PLAN_COMPILER_VERSION,
} from '../../domain/constants/generation.js';
import { STORY_AI_LIMITS } from '../../domain/constants/storyAi.js';
import { describeAppLanguage } from '../../domain/types/language.js';
import { episodeBeatPlanSchema } from '../../lib/validators/episodeBeatPlan.schema.js';
import type {
  CompiledEpisodeBeatPlan,
  CompileEpisodeBeatPlanInput,
  EpisodeBeatPlanCompilerPort,
} from '../../services/page/EpisodeBeatPlanCompiler.js';
import { OpenAIClient } from './OpenAIClient.js';
import {
  requestStructuredOpenAIResponse,
  type OpenAIReasoningEffort,
} from './StructuredOpenAIResponse.js';
import { STORY_SOURCE_POLICY, STORY_TEXT_POLICY } from './StoryEditorialPrompts.js';

interface OpenAIEpisodeBeatPlanCompilerOptions {
  model: string;
  reasoningEffort?: OpenAIReasoningEffort;
}

export class OpenAIEpisodeBeatPlanCompiler implements EpisodeBeatPlanCompilerPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly options: OpenAIEpisodeBeatPlanCompilerOptions = {
      model: EPISODE_BEAT_PLAN_COMPILER_OPENAI_MODEL,
    },
  ) {}

  public async compileBeatPlan(
    input: CompileEpisodeBeatPlanInput,
  ): Promise<CompiledEpisodeBeatPlan> {
    const validated = await requestStructuredOpenAIResponse({
      client: this.client,
      model: this.options.model,
      reasoningEffort: this.options.reasoningEffort,
      maxOutputTokens: EPISODE_BEAT_PLAN_COMPILER_MAX_TOKENS,
      schemaName: 'episode_beat_plan',
      jsonSchema: episodeBeatPlanJsonSchema,
      responseSchema: episodeBeatPlanSchema,
      errorLabel: 'OpenAI episode beat plan compiler',
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: buildSystemPrompt(input.language) }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: input.compilerBrief }],
        },
      ],
    });

    return {
      plan: {
        pages: validated.pages.map((page) => ({
          pageId: page.page_id,
          pageNumber: page.page_number,
          storyBeats: page.story_beats,
          entryState: page.entry_state,
          exitState: page.exit_state,
          newInformation: page.new_information,
          dialogueIntent: page.dialogue_intent,
          ...(page.text_plan === undefined ? {} : { textPlan: {
            requiredTextBeats: page.text_plan.required_text_beats,
            visualOnlyBeats: page.text_plan.visual_only_beats,
            densityReason: page.text_plan.density_reason,
          } }),
          handoff: page.handoff,
        })),
      },
      compilerProvider: 'openai',
      compilerModel: this.options.model,
      compilerPromptVersion: EPISODE_BEAT_PLAN_COMPILER_VERSION,
    };
  }
}

function buildSystemPrompt(language: CompileEpisodeBeatPlanInput['language']): string {
  const outputLanguage = describeAppLanguage(language);
  return [
    'You are the global story editor for a manga episode.',
    'Plan the complete episode before any page is expanded into panels.',
    STORY_SOURCE_POLICY,
    'Each story beat must have exactly one owning page.',
    'Use every page ID and page number from CURRENT PAGES exactly once, without adding pages.',
    'Use frame_count as the page capacity: assign enough distinct visual beats to support that many panels, without padding a page with repeated actions or dialogue.',
    'Preserve the source narrative order and cause and effect, including explicitly authored flashbacks.',
    'Do not restart or rewind the timeline at chunk or page boundaries.',
    'Do not accidentally repeat a discovery, action, reaction, explanation, or dialogue purpose on later pages. A source-supported callback must have a distinct purpose and be planned as such.',
    'For every page, define the state entering it, the state leaving it, new information introduced there, and the handoff to the next page.',
    'Dialogue intent describes the conversational job of the page, not finished dialogue.',
    STORY_TEXT_POLICY,
    'For every page supply text_plan: required_text_beats identifies information that must be communicated in words at that point; visual_only_beats identifies information and pauses carried by images alone; density_reason briefly explains the reading-load choice relative to neighboring pages.',
    'Use compact information-beat labels in text_plan, not completed dialogue or copies of all story_beats. Plan the entire arc first so earlier pages do their necessary explanatory work and the ending is not overloaded. Intentional silent or intense pages are valid when motivated.',
    'A handoff must explain what motion, question, reveal, or emotional pressure carries the reader into the next page.',
    'Do not invent events, characters, locations, props, or facts not supported by the brief.',
    `Write all free-text values in natural ${outputLanguage}.`,
  ].join(' ');
}

const episodeBeatPlanJsonSchema = {
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
          'page_id',
          'page_number',
          'story_beats',
          'entry_state',
          'exit_state',
          'new_information',
          'dialogue_intent',
          'text_plan',
          'handoff',
        ],
        properties: {
          page_id: { type: 'string' },
          page_number: { type: 'integer', minimum: 1 },
          story_beats: {
            type: 'array',
            minItems: 1,
            maxItems: STORY_AI_LIMITS.maxPanelsPerPage,
            items: { type: 'string', minLength: 1, maxLength: 300 },
          },
          entry_state: { type: 'string', minLength: 1, maxLength: 600 },
          exit_state: { type: 'string', minLength: 1, maxLength: 600 },
          new_information: {
            type: 'array',
            maxItems: STORY_AI_LIMITS.maxPanelsPerPage,
            items: { type: 'string', minLength: 1, maxLength: 300 },
          },
          dialogue_intent: {
            anyOf: [
              { type: 'string', minLength: 1, maxLength: 600 },
              { type: 'null' },
            ],
          },
          text_plan: {
            type: 'object',
            additionalProperties: false,
            required: ['required_text_beats', 'visual_only_beats', 'density_reason'],
            properties: {
              required_text_beats: { type: 'array', maxItems: STORY_AI_LIMITS.maxPanelsPerPage, items: { type: 'string', minLength: 1, maxLength: 300 } },
              visual_only_beats: { type: 'array', maxItems: STORY_AI_LIMITS.maxPanelsPerPage, items: { type: 'string', minLength: 1, maxLength: 300 } },
              density_reason: { type: 'string', minLength: 1, maxLength: 600 },
            },
          },
          handoff: {
            anyOf: [
              { type: 'string', minLength: 1, maxLength: 600 },
              { type: 'null' },
            ],
          },
        },
      },
    },
  },
} as const;
