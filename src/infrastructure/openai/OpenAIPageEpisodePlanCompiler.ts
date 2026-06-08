import {
  EPISODE_PAGE_PLAN_COMPILER_MAX_TOKENS,
  EPISODE_PAGE_PLAN_COMPILER_OPENAI_MODEL,
  EPISODE_PAGE_PLAN_COMPILER_VERSION,
} from '../../domain/constants/generation.js';
import { STORY_AI_LIMITS } from '../../domain/constants/storyAi.js';
import { describeAppLanguage } from '../../domain/types/language.js';
import { episodePagePlanSuggestionSchema } from '../../lib/validators/episodePagePlan.schema.js';
import type {
  CompiledEpisodePagePlan,
  CompileEpisodePagePlanInput,
  EpisodePagePlanCompilerPort,
} from '../../services/page/EpisodePagePlanCompiler.js';
import { OpenAIClient } from './OpenAIClient.js';
import { requestStructuredOpenAIResponse } from './StructuredOpenAIResponse.js';

export class OpenAIPageEpisodePlanCompiler implements EpisodePagePlanCompilerPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly model = EPISODE_PAGE_PLAN_COMPILER_OPENAI_MODEL,
  ) {}

  public async compilePlan(
    input: CompileEpisodePagePlanInput,
  ): Promise<CompiledEpisodePagePlan> {
    const validated = await requestStructuredOpenAIResponse({
      client: this.client,
      model: this.model,
      maxOutputTokens: EPISODE_PAGE_PLAN_COMPILER_MAX_TOKENS,
      schemaName: 'episode_page_plan',
      jsonSchema: episodePagePlanJsonSchema,
      responseSchema: episodePagePlanSuggestionSchema,
      errorLabel: 'OpenAI episode page plan compiler',
      sanitize: sanitizeEpisodePagePlanPayload,
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

    return {
      suggestion: {
        pages: validated.pages.map((page) => ({
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
    'Work in this order: distribute story beats across pages, assign contiguous source scenes per page, split each page into panel beats, choose the visible subject or subjects for each panel, then fill the editable fields.',
    'Before writing any text lines, infer what information the whole page must communicate and decide which parts should be carried by image alone, which by narration, and which by character dialogue.',
    'Convert abstract chapter and episode intent into visible but editable panel cues: situation, shot, angle, background, character placement, expression, action, and dialogue or narration where the beat naturally needs text support.',
    'It is acceptable to add natural connective reaction shots or transition beats when they do not change story facts, but do not invent new events, props, weapons, locations, or surprise twists.',
    'Keep the result restrained and production-friendly. Avoid flashy or odd choices unless the source material clearly demands them.',
    'Keep every generated text field concise and editable. Prefer one short sentence or compact phrase per field.',
    'Do not restate the whole scene summary inside each panel. Each panel should describe only its own beat.',
    'Do not let adjacent panels collapse into the same beat description unless the story explicitly needs a held moment.',
    `All free-text fields, including situation_text, composition_prompt, custom_note, background_note, panel_notes, dialogue text, and narration text, must be written in natural ${outputLanguage} suitable for direct editing in the Lyra UI.`,
    'For situation_text, write a concrete visual beat that names the main subject or subjects, what they are doing or feeling, and the immediate context in image-friendly language.',
    'For composition.composition_prompt, name the visible subject, the framing intention, and the spatial relationship clearly enough for an image model to stage the panel.',
    'For composition.custom_note, provide a short camera and staging memo when shot type and angle alone are not enough to make the intended read obvious.',
    'Do not fill situation_text, composition_prompt, custom_note, and background_note with near-duplicate wording. Each field must do a separate job.',
    'Use only the provided entity IDs and scene IDs.',
    'Do not copy every named character into every panel. Choose only those who should actually be visible in that panel, and vary the focus when the page rhythm demands it.',
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

      const sanitizedPageSettings = isRecord(page.page)
        ? pruneNullablePageSettings(page.page)
        : undefined;

      return {
        ...page,
        page: sanitizedPageSettings,
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
    ? pruneNullableComposition({
        ...value.composition,
        shot_type: normalizeShotType(value.composition.shot_type),
        angle: normalizeAngle(value.composition.angle),
      })
    : undefined;

  return {
    ...value,
    panel_role: nullableToUndefined(normalizePanelRole(value.panel_role)),
    panel_size: nullableToUndefined(normalizePanelSize(value.panel_size)),
    composition,
    dialogue_in_panel: nullableToUndefined(value.dialogue_in_panel),
    dialogue: Array.isArray(value.dialogue) ? value.dialogue : undefined,
    entities: Array.isArray(value.entities)
      ? value.entities.map((entity) => sanitizeEntityAssignment(entity))
      : undefined,
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

function pruneNullablePageSettings(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const sanitized = {
    dialogue_mode: nullableToUndefined(value.dialogue_mode),
    page_dialogue_toggle: nullableToUndefined(value.page_dialogue_toggle),
  };

  if (sanitized.dialogue_mode === undefined && sanitized.page_dialogue_toggle === undefined) {
    return undefined;
  }

  return sanitized;
}

function pruneNullableComposition(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const sanitized = {
    source: nullableToUndefined(value.source),
    gallery_item_id: value.gallery_item_id ?? null,
    composition_prompt: value.composition_prompt ?? null,
    shot_type: value.shot_type ?? null,
    angle: value.angle ?? null,
    custom_note: value.custom_note ?? null,
  };

  if (
    sanitized.source === undefined &&
    sanitized.gallery_item_id === null &&
    sanitized.composition_prompt === null &&
    sanitized.shot_type === null &&
    sanitized.angle === null &&
    sanitized.custom_note === null
  ) {
    return undefined;
  }

  return sanitized;
}

function nullableToUndefined<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
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

const nullableStringSchema = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const;

const nullableBooleanSchema = {
  anyOf: [{ type: 'boolean' }, { type: 'null' }],
} as const;

const nullablePanelRoleSchema = {
  anyOf: [
    {
      type: 'string',
      enum: ['establish', 'action', 'reaction', 'emphasis', 'transition', 'pause', 'impact'],
    },
    { type: 'null' },
  ],
} as const;

const nullablePanelSizeSchema = {
  anyOf: [
    {
      type: 'string',
      enum: ['standard', 'large', 'wide', 'narrow', 'splash'],
    },
    { type: 'null' },
  ],
} as const;

const nullableCompositionSourceSchema = {
  anyOf: [
    { type: 'string', enum: ['gallery', 'custom', 'ai_auto'] },
    { type: 'null' },
  ],
} as const;

const nullableShotTypeSchema = {
  anyOf: [
    {
      type: 'string',
      enum: ['full_body', 'half_body', 'close_up', 'wide', 'extreme_close_up'],
    },
    { type: 'null' },
  ],
} as const;

const nullableAngleSchema = {
  anyOf: [
    {
      type: 'string',
      enum: ['front', 'side', 'three_quarter', 'bird_eye', 'worm_eye', 'dutch_angle'],
    },
    { type: 'null' },
  ],
} as const;

const nullableDialogueModeSchema = {
  anyOf: [
    { type: 'string', enum: ['image_baked', 'balloon_only', 'mixed'] },
    { type: 'null' },
  ],
} as const;

const nullableCompositionSchema = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: [
        'source',
        'gallery_item_id',
        'composition_prompt',
        'shot_type',
        'angle',
        'custom_note',
      ],
      properties: {
        source: nullableCompositionSourceSchema,
        gallery_item_id: nullableStringSchema,
        composition_prompt: nullableStringSchema,
        shot_type: nullableShotTypeSchema,
        angle: nullableAngleSchema,
        custom_note: nullableStringSchema,
      },
    },
    { type: 'null' },
  ],
} as const;

const nullableDialogueArraySchema = {
  anyOf: [
    {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['entity_id', 'text', 'type', 'position'],
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
    { type: 'null' },
  ],
} as const;

const nullableEntityAssignmentsSchema = {
  anyOf: [
    {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'entity_id',
          'role',
          'expression',
          'custom_expression',
          'action',
          'custom_action',
          'position',
          'facing_direction',
          'effect_note',
          'state_id',
        ],
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
          facing_direction: nullableStringSchema,
          effect_note: nullableStringSchema,
          state_id: nullableStringSchema,
        },
      },
    },
    { type: 'null' },
  ],
} as const;

const nullablePageSettingsSchema = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['dialogue_mode', 'page_dialogue_toggle'],
      properties: {
        dialogue_mode: nullableDialogueModeSchema,
        page_dialogue_toggle: nullableBooleanSchema,
      },
    },
    { type: 'null' },
  ],
} as const;

const episodePagePlanJsonSchema = {
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
          'source_scene_ids',
          'page_purpose',
          'continuity_note',
          'page',
          'panels',
        ],
        properties: {
          page_id: { type: 'string' },
          page_number: { type: 'integer', minimum: 1, maximum: 10000 },
          source_scene_ids: {
            type: 'array',
            maxItems: 100,
            items: { type: 'string' },
          },
          page_purpose: nullableStringSchema,
          continuity_note: nullableStringSchema,
          page: nullablePageSettingsSchema,
          panels: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'order',
                'panel_role',
                'panel_size',
                'situation_text',
                'composition',
                'dialogue_in_panel',
                'dialogue',
                'sfx_text',
                'background_note',
                'panel_notes',
                'entities',
              ],
              properties: {
                order: { type: 'integer', minimum: 1, maximum: 10000 },
                panel_role: nullablePanelRoleSchema,
                panel_size: nullablePanelSizeSchema,
                situation_text: nullableStringSchema,
                composition: nullableCompositionSchema,
                dialogue_in_panel: nullableBooleanSchema,
                dialogue: nullableDialogueArraySchema,
                sfx_text: nullableStringSchema,
                background_note: nullableStringSchema,
                panel_notes: nullableStringSchema,
                entities: nullableEntityAssignmentsSchema,
              },
            },
          },
        },
      },
    },
  },
} as const;
