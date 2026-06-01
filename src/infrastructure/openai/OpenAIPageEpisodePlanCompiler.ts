import { ConfigurationError } from '../../domain/errors/index.js';
import {
  EPISODE_PAGE_PLAN_COMPILER_MAX_TOKENS,
  EPISODE_PAGE_PLAN_COMPILER_OPENAI_MODEL,
  EPISODE_PAGE_PLAN_COMPILER_VERSION,
} from '../../domain/constants/generation.js';
import { describeAppLanguage } from '../../domain/types/language.js';
import { episodePagePlanSuggestionSchema } from '../../lib/validators/episodePagePlan.schema.js';
import type {
  CompiledEpisodePagePlan,
  CompileEpisodePagePlanInput,
  EpisodePagePlanCompilerPort,
} from '../../services/page/EpisodePagePlanCompiler.js';
import { OpenAIClient } from './OpenAIClient.js';

interface OpenAICompilerResponse {
  output_text?: unknown;
  output?: unknown;
}

export class OpenAIPageEpisodePlanCompiler implements EpisodePagePlanCompilerPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly model = EPISODE_PAGE_PLAN_COMPILER_OPENAI_MODEL,
  ) {}

  public async compilePlan(
    input: CompileEpisodePagePlanInput,
  ): Promise<CompiledEpisodePagePlan> {
    const response = await this.client.postJson<OpenAICompilerResponse>('/responses', {
      model: this.model,
      max_output_tokens: EPISODE_PAGE_PLAN_COMPILER_MAX_TOKENS,
      text: {
        format: {
          type: 'json_schema',
          name: 'episode_page_plan',
          strict: false,
          schema: episodePagePlanJsonSchema,
        },
      },
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: buildSystemPrompt(input.language) }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: buildUserPrompt(input.compilerBrief) }],
        },
      ],
    });

    const outputText = extractOutputText(response.body);
    if (outputText === null) {
      throw new ConfigurationError('OpenAI episode page plan compiler returned no text output');
    }

    const normalized = normalizeCompiledJson(outputText);
    let parsed: unknown;
    try {
      parsed = JSON.parse(normalized);
    } catch {
      throw new ConfigurationError(
        `OpenAI episode page plan compiler returned invalid JSON: ${normalized.slice(0, 400)}`,
      );
    }

    const sanitized = sanitizeEpisodePagePlanPayload(parsed);
    const validated = episodePagePlanSuggestionSchema.safeParse(sanitized);
    if (!validated.success) {
      throw new ConfigurationError(
        `OpenAI episode page plan compiler returned an invalid payload: ${validated.error.message}`,
      );
    }

    return {
      suggestion: {
        pages: validated.data.pages.map((page) => ({
          pageId: page.page_id,
          pageNumber: page.page_number,
          sourceSceneIds: page.source_scene_ids,
          pagePurpose: page.page_purpose,
          continuityNote: page.continuity_note,
          page:
            page.page === undefined
              ? undefined
              : {
                  dialogueMode: page.page.dialogue_mode,
                  pageDialogueToggle: page.page.page_dialogue_toggle,
                },
          panels: page.panels.map((panel) => ({
            order: panel.order,
            panelRole: panel.panel_role,
            panelSize: panel.panel_size,
            situationText: panel.situation_text,
            composition:
              panel.composition === undefined
                ? undefined
                : {
                    source: panel.composition.source,
                    galleryItemId: panel.composition.gallery_item_id,
                    compositionPrompt: panel.composition.composition_prompt,
                    shotType: panel.composition.shot_type,
                    angle: panel.composition.angle,
                    customNote: panel.composition.custom_note,
                  },
            dialogueInPanel: panel.dialogue_in_panel,
            dialogue: panel.dialogue?.map((line) => ({
              entityId: line.entity_id,
              text: line.text,
              type: line.type,
              position: line.position,
            })),
            sfxText: panel.sfx_text,
            backgroundNote: panel.background_note,
            panelNotes: panel.panel_notes,
            entities: panel.entities?.map((assignment) => ({
              entityId: assignment.entity_id,
              role: assignment.role,
              expression: assignment.expression,
              customExpression: assignment.custom_expression,
              action: assignment.action,
              customAction: assignment.custom_action,
              position: assignment.position,
              facingDirection: assignment.facing_direction,
              effectNote: assignment.effect_note,
              stateId: assignment.state_id,
            })),
          })),
        })),
      },
      compilerProvider: 'openai',
      compilerModel: this.model,
      compilerPromptVersion: EPISODE_PAGE_PLAN_COMPILER_VERSION,
    };
  }
}

function buildSystemPrompt(language: CompileEpisodePagePlanInput['language']): string {
  const outputLanguage = describeAppLanguage(language);
  return [
    'You plan editable manga page and panel draft data for Lyra from chapter, episode, and scene notes.',
    'Respect the exact existing pages, page numbers, panel counts, and panel orders given in the brief.',
    'Assign scenes to pages in a grounded, contiguous way so the chapter and episode read coherently from page to page.',
    'Before writing any text lines, infer what information the whole page must communicate and decide which parts should be carried by image alone, which by narration, and which by character dialogue.',
    'Convert abstract chapter and episode intent into visible but editable panel cues: situation, shot, angle, background, character placement, expression, action, and dialogue or narration where the beat naturally needs text support.',
    'It is acceptable to add natural connective reaction shots or transition beats when they do not change story facts, but do not invent new events, props, weapons, locations, or surprise twists.',
    'Keep the result restrained and production-friendly. Avoid flashy or odd choices unless the source material clearly demands them.',
    'Keep every generated text field concise and editable. Prefer one short sentence or compact phrase per field.',
    'Do not restate the whole scene summary inside each panel. Each panel should describe only its own beat.',
    `All free-text fields, including situation_text, composition_prompt, custom_note, background_note, panel_notes, dialogue text, and narration text, must be written in natural ${outputLanguage} suitable for direct editing in the Lyra UI.`,
    'For situation_text, write a concrete visual beat that names the main subject or subjects, what they are doing or feeling, and the immediate context in image-friendly language.',
    'For composition.composition_prompt, name the visible subject, the framing intention, and the spatial relationship clearly enough for an image model to stage the panel.',
    'For composition.custom_note, provide a short camera and staging memo when shot type and angle alone are not enough to make the intended read obvious.',
    'Use only the provided entity IDs and scene IDs.',
    'Dialogue itself should remain restrained, but not unnaturally sparse. It is acceptable for some panels to remain silent, and not every beat needs spoken lines.',
    'Narration may be used more freely whenever important story information, transition logic, emotional framing, or time-space context would be hard to understand from the image alone.',
    'Do not leave an entire page under-explained if the story beat would become unclear without textual support. When in doubt, prefer a short narration line over forcing extra character dialogue.',
    `When dialogue is needed, make it sound like natural ${outputLanguage} that one character would actually say or think in that moment, not like a mechanical summary of plot facts.`,
    'Use character speech to surface conflict, reaction, hesitation, refusal, confirmation, or emotional pressure, not just to restate exposition.',
    'If one character speaks and another reacts in the next beat, make the later line feel like a real response to the earlier line rather than two isolated statements.',
    'Keep track of who knows what and what they would naturally choose to say aloud. Avoid unnatural exposition that both speakers already know unless the scene gives them a reason to say it.',
    'If the page needs textual support but spoken dialogue would feel stiff or forced, move that burden into short narration instead of making the characters explain the plot to each other.',
    'Use character speech or thought when interpersonal exchange or an explicit emotional reaction truly needs it, but do not make every panel chatty.',
    'For confrontation, conversation, confession, explanation, emotional reversal, obvious reaction beats, or clear internal decision moments, provide at least one short speech or thought line unless the panel is clearly meant to land in silence.',
    'If two named characters are facing each other, challenging each other, responding to each other, or emotionally reacting to each other, assume some dialogue is usually natural unless the brief strongly suggests silence.',
    'Use narration especially for scene-setting, transitions, internal realization, cause-and-effect clarification, historical or temporal context, and emotional framing that staging alone cannot fully communicate.',
    'Do not repeat the same narration across multiple panels, and keep each narration line short, specific, and panel-relevant.',
    'Distribute narration across the page deliberately: use it where information density is high or where the page would otherwise skip a logical step, but do not stack redundant narration in every panel.',
    'If a character voice should feel terse, guarded, awkward, polite, sharp, or emotionally strained, let that affect wording length and rhythm.',
  ].join(' ');
}

function buildUserPrompt(compilerBrief: string): string {
  return ['Episode page planning brief:', compilerBrief, '', 'Return the final JSON now.'].join('\n');
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

function normalizeCompiledJson(value: string): string {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '').trim();
  const extracted = extractFirstJsonObject(trimmed);
  return extracted ?? trimmed;
}

function sanitizeEpisodePagePlanPayload(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.pages)) {
    return value;
  }

  return {
    ...value,
    pages: value.pages.map((page) => {
      if (!isRecord(page) || !Array.isArray(page.panels)) {
        return page;
      }

      return {
        ...page,
        panels: page.panels.map((panel) => sanitizePanelLikeObject(panel)),
      };
    }),
  };
}

function sanitizePanelLikeObject(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const composition = isRecord(value.composition)
    ? {
        ...value.composition,
        shot_type: normalizeShotType(value.composition.shot_type),
        angle: normalizeAngle(value.composition.angle),
      }
    : value.composition;

  return {
    ...value,
    panel_role: normalizePanelRole(value.panel_role),
    panel_size: normalizePanelSize(value.panel_size),
    composition,
    entities: Array.isArray(value.entities)
      ? value.entities.map((entity) => sanitizeEntityAssignment(entity))
      : value.entities,
  };
}

function sanitizeEntityAssignment(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  return {
    ...value,
    position: normalizeEntityPosition(value.position),
    facing_direction: normalizeFacingDirection(value.facing_direction),
  };
}

function normalizePanelRole(value: unknown): unknown {
  if (typeof value !== 'string') {
    return 'action';
  }

  switch (value) {
    case 'closeup':
    case 'close_up':
      return 'emphasis';
    case 'establish':
    case 'action':
    case 'reaction':
    case 'emphasis':
    case 'transition':
    case 'pause':
    case 'impact':
      return value;
    default:
      return 'action';
  }
}

function normalizePanelSize(value: unknown): unknown {
  if (typeof value !== 'string') {
    return 'standard';
  }

  switch (value) {
    case 'small':
    case 'tall':
      return 'narrow';
    case 'standard':
    case 'large':
    case 'wide':
    case 'narrow':
    case 'splash':
      return value;
    default:
      return 'standard';
  }
}

function normalizeShotType(value: unknown): unknown {
  if (typeof value !== 'string') {
    return null;
  }

  switch (value) {
    case 'wide_shot':
      return 'wide';
    case 'full_shot':
      return 'full_body';
    case 'medium_shot':
      return 'half_body';
    case 'closeup':
      return 'close_up';
    case 'extreme_closeup':
      return 'extreme_close_up';
    case 'full_body':
    case 'half_body':
    case 'close_up':
    case 'wide':
    case 'extreme_close_up':
      return value;
    default:
      return null;
  }
}

function normalizeAngle(value: unknown): unknown {
  if (typeof value !== 'string') {
    return null;
  }

  switch (value) {
    case 'three_quarter_left':
    case 'three_quarter_right':
      return 'three_quarter';
    case 'overhead':
      return 'bird_eye';
    case 'low_angle':
      return 'worm_eye';
    case 'tilted':
      return 'dutch_angle';
    case 'front':
    case 'side':
    case 'three_quarter':
    case 'bird_eye':
    case 'worm_eye':
    case 'dutch_angle':
      return value;
    default:
      return null;
  }
}

function normalizeEntityPosition(value: unknown): unknown {
  if (typeof value !== 'string') {
    return 'center';
  }

  if (value.includes('left')) {
    return 'left';
  }
  if (value.includes('right')) {
    return 'right';
  }
  if (value.includes('back')) {
    return 'background';
  }

  switch (value) {
    case 'left':
    case 'center':
    case 'right':
    case 'background':
      return value;
    case 'foreground':
      return 'center';
    default:
      return 'center';
  }
}

function normalizeFacingDirection(value: unknown): unknown {
  if (typeof value !== 'string') {
    return null;
  }

  switch (value) {
    case 'forward':
      return 'front';
    case 'back':
      return 'away';
    case 'front':
    case 'left':
    case 'right':
    case 'away':
    case 'three_quarter_left':
    case 'three_quarter_right':
      return value;
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractFirstJsonObject(value: string): string | null {
  const start = value.indexOf('{');
  if (start === -1) {
    return null;
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

    if (character === '{') {
      depth += 1;
      continue;
    }

    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return null;
}

const nullableStringSchema = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const;

const episodePagePlanJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['pages'],
  properties: {
    pages: {
      type: 'array',
      minItems: 1,
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['page_id', 'page_number', 'panels'],
        properties: {
          page_id: { type: 'string' },
          page_number: { type: 'integer', minimum: 1, maximum: 10000 },
          source_scene_ids: {
            type: 'array',
            items: { type: 'string' },
          },
          page_purpose: nullableStringSchema,
          continuity_note: nullableStringSchema,
          page: {
            type: 'object',
            additionalProperties: false,
            properties: {
              dialogue_mode: {
                type: 'string',
                enum: ['image_baked', 'balloon_only', 'mixed'],
              },
              page_dialogue_toggle: { type: 'boolean' },
            },
          },
          panels: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['order'],
              properties: {
                order: { type: 'integer', minimum: 1, maximum: 10000 },
                panel_role: {
                  type: 'string',
                  enum: ['establish', 'action', 'reaction', 'emphasis', 'transition', 'pause', 'impact'],
                },
                panel_size: {
                  type: 'string',
                  enum: ['standard', 'large', 'wide', 'narrow', 'splash'],
                },
                situation_text: nullableStringSchema,
                composition: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    source: { type: 'string', enum: ['gallery', 'custom', 'ai_auto'] },
                    gallery_item_id: nullableStringSchema,
                    composition_prompt: nullableStringSchema,
                    shot_type: {
                      type: 'string',
                      enum: ['full_body', 'half_body', 'close_up', 'wide', 'extreme_close_up'],
                    },
                    angle: {
                      type: 'string',
                      enum: ['front', 'side', 'three_quarter', 'bird_eye', 'worm_eye', 'dutch_angle'],
                    },
                    custom_note: nullableStringSchema,
                  },
                },
                dialogue_in_panel: { type: 'boolean' },
                dialogue: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['text', 'type', 'position'],
                    properties: {
                      entity_id: nullableStringSchema,
                      text: { type: 'string' },
                      type: {
                        type: 'string',
                        enum: ['speech', 'thought', 'narration', 'shout', 'whisper'],
                      },
                      position: {
                        type: 'string',
                        enum: ['top', 'bottom', 'left', 'right', 'center'],
                      },
                    },
                  },
                },
                sfx_text: nullableStringSchema,
                background_note: nullableStringSchema,
                panel_notes: nullableStringSchema,
                entities: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['entity_id', 'role', 'position'],
                    properties: {
                      entity_id: { type: 'string' },
                      role: { type: 'string', enum: ['primary', 'secondary', 'background'] },
                      expression: {
                        type: 'string',
                        enum: ['determined', 'calm', 'angry', 'sad', 'surprised', 'custom'],
                      },
                      custom_expression: nullableStringSchema,
                      action: {
                        type: 'string',
                        enum: ['standing_firm', 'attacking', 'defending', 'running', 'custom'],
                      },
                      custom_action: nullableStringSchema,
                      position: {
                        type: 'string',
                        enum: ['left', 'center', 'right', 'background'],
                      },
                      facing_direction: {
                        type: 'string',
                        enum: ['front', 'left', 'right', 'away', 'three_quarter_left', 'three_quarter_right'],
                      },
                      effect_note: nullableStringSchema,
                      state_id: nullableStringSchema,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
