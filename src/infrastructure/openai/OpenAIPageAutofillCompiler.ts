import { STORY_SOURCE_POLICY, STORY_TEXT_POLICY, STORY_SPEAKER_POLICY, STORY_PANEL_POLICY } from './StoryEditorialPrompts.js';
import {
  EPISODE_PAGE_PLAN_MAX_DIALOGUE_LINES_PER_PANEL,
  PAGE_AUTOFILL_COMPILER_MAX_TOKENS,
  PAGE_AUTOFILL_COMPILER_OPENAI_MODEL,
  PAGE_AUTOFILL_COMPILER_VERSION,
} from '../../domain/constants/generation.js';
import { describeAppLanguage } from '../../domain/types/language.js';
import { pageAutofillSuggestionSchema } from '../../lib/validators/pageAutofill.schema.js';
import type {
  CompiledPageAutofillSuggestion,
  CompilePageAutofillInput,
  PageAutofillCompilerPort,
} from '../../services/page/PageAutofillCompiler.js';
import { OpenAIClient } from './OpenAIClient.js';
import { requestStructuredOpenAIResponse } from './StructuredOpenAIResponse.js';

export class OpenAIPageAutofillCompiler implements PageAutofillCompilerPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly model = PAGE_AUTOFILL_COMPILER_OPENAI_MODEL,
  ) {}

  public async compileSuggestions(
    input: CompilePageAutofillInput,
  ): Promise<CompiledPageAutofillSuggestion> {
    const validated = await requestStructuredOpenAIResponse({
      client: this.client,
      model: this.model,
      maxOutputTokens: PAGE_AUTOFILL_COMPILER_MAX_TOKENS,
      schemaName: 'page_autofill',
      jsonSchema: pageAutofillJsonSchema,
      responseSchema: pageAutofillSuggestionSchema,
      errorLabel: 'OpenAI page autofill compiler',
      sanitize: sanitizePageAutofillPayload,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: buildSystemPrompt(input.language),
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

    return {
      suggestion: {
        page:
          validated.page === undefined
            ? undefined
            : {
                dialogueMode: validated.page.dialogue_mode,
                pageDialogueToggle: validated.page.page_dialogue_toggle,
              },
        panels: validated.panels.map((panel) => ({
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
      },
      compilerProvider: 'openai',
      compilerModel: this.model,
      compilerPromptVersion: PAGE_AUTOFILL_COMPILER_VERSION,
    };
  }
}

function buildSystemPrompt(language: CompilePageAutofillInput['language']): string {
  const outputLanguage = describeAppLanguage(language);
  return [
    'You draft one editable manga page for Lyra from its supplied story context.',
    STORY_SOURCE_POLICY,
    'Return JSON only matching the output contract. Keep the exact page number, panel count, and panel orders.',
    'Treat the episode draft as the page content source, scenes as available concrete context, and chapter data as consistency constraints. Do not invent missing story facts.',
    'Decide the page’s entry, progression, and exit, then allocate information to panels before writing any final dialogue. Respect already planned page purpose and adjacent story context.',
    STORY_TEXT_POLICY,
    STORY_SPEAKER_POLICY,
    STORY_PANEL_POLICY,
    'Choose only the actually visible registered subjects; named off-panel voices remain dialogue speakers, not visible entity assignments. A panel centered on a visible registered character must identify that entity.',
    'Preserve natural questions and replies and the speakers’ knowledge and voice. Emotion and facing characters are not automatic requirements to add text.',
    'Prefer composition source custom unless the brief explicitly supplies an appropriate gallery ID.',
    `Write free-text values in natural ${outputLanguage}, concise and suitable for direct editing in the UI.`,
  ].join(' ');
}
function buildUserPrompt(compilerBrief: string): string {
  return [
    'Page autofill brief:',
    compilerBrief,
    '',
    'Return the final JSON now.',
  ].join('\n');
}

function sanitizePageAutofillPayload(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.panels)) {
    return value;
  }

  return {
    ...value,
    page: isRecord(value.page) ? pruneNullablePageSettings(value.page) : undefined,
    panels: value.panels.map((panel) => sanitizePanelLikeObject(panel)),
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
      maxItems: EPISODE_PAGE_PLAN_MAX_DIALOGUE_LINES_PER_PANEL,
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
          position: { type: 'string', enum: ['left', 'center', 'right', 'background'] },
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

const pageAutofillJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['page', 'panels'],
  properties: {
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
} as const;
