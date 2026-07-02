import {
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
    'You convert Lyra story notes into editable manga page and panel draft data.',
    'Return JSON only. Do not output markdown, commentary, or prose outside the JSON object.',
    'The JSON must match the requested output shape exactly.',
    'Treat the episode draft as the main source of truth. Use scenes when they are provided, but do not require scenes to produce a useful page draft.',
    'Treat chapter information only as a consistency guard so the page does not contradict the larger chapter arc.',
    'Fill the existing editable fields with grounded defaults that a user can revise before image generation.',
    'First decide the page beat, then split that page beat into panel beats in Japanese manga reading order: right-to-left within a row, then top-to-bottom across rows.',
    'Panel order numbers must match the saved layout reading order; panel 1 is the first panel a manga reader sees.',
    'Explicitly choose the visible subject or subjects for each panel before writing any field text.',
    'Before writing any text lines, infer what information the full page still needs in order to be understandable, then distribute that information between image, narration, and dialogue instead of dumping everything into one field.',
    'For each panel, explicitly decide who the visible subject is, what changes in that panel, and why that panel exists in the page rhythm.',
    'Convert abstract story intent into visible panel cues such as situation, camera distance, angle, character placement, posture, gaze, expression, background, and when needed dialogue or narration.',
    'Keep every generated text field concise and editable. Prefer one short sentence or compact phrase per field.',
    'Do not copy a whole scene summary into every panel. Describe only the panel-specific beat.',
    'Do not repeat the same panel beat in neighboring panels unless the story genuinely stalls on a held moment.',
    'Do not fill situation_text, composition_prompt, custom_note, and background_note with the same sentence in different wrappers. Each field must do a different job.',
    'situation_text explains what is happening in the panel. composition_prompt explains how the panel should be framed. custom_note explains staging or camera emphasis. background_note names only the visible environment.',
    `All free-text fields, including situation_text, composition_prompt, custom_note, background_note, panel_notes, dialogue text, and narration text, must be written in natural ${outputLanguage} suitable for direct editing in the Lyra UI.`,
    'For situation_text, write a concrete visual beat that names the subject or subjects, their visible action or feeling, and the immediate context in image-friendly language.',
    'For composition.composition_prompt, explicitly name the subject, the framing intention, and the spatial relation or emphasis so an image model can stage the panel correctly.',
    'For composition.custom_note, add a short camera or direction memo whenever shot type and angle alone would leave the intended staging ambiguous.',
    'If a panel beat clearly centers on a named character or identified group, do not leave entities empty. Choose the visible subject as primary and only add supporting entities when they truly appear in the frame.',
    'If multiple named characters matter to the page, vary panel focus intentionally: some panels may show both, some only one reaction, some only the environment or pause beat as needed.',
    'Use only the provided entity IDs and only the provided enum values.',
    'Do not invent extra characters, new locations, props, weapons, twists, or dramatic action that is not supported by the supplied story information.',
    'Dialogue itself should remain restrained and should not appear in every panel, but it should not become unnaturally scarce either.',
    'Narration may be used more freely when important story logic, transition, emotional framing, or time-space context would be difficult to convey through the image alone.',
    'Some panels may remain silent, but do not let the page become under-explained. When the story beat would feel unclear without text, prefer a short narration line rather than forcing extra dialogue.',
    `When dialogue is needed, write it as natural ${outputLanguage} a character would actually say or think in context, not as a stiff summary of plot information.`,
    'Use speech to carry pressure, reaction, disagreement, hesitation, reassurance, challenge, or personal emphasis. Use narration to carry connective or explanatory information that would sound unnatural if spoken aloud.',
    'If one line is followed by another character in the next panel, make the second line answer, deflect, or react to the first line so the exchange reads like an actual conversation.',
    'Respect character knowledge and motivation. Do not make characters say information to each other if both already know it, unless the scene gives them a real reason to voice it.',
    'If spoken dialogue would feel clumsy but the reader still needs the information, prefer short narration instead.',
    'Prefer concise character speech or thought for interpersonal beats that clearly need a spoken or internal voice.',
    'For confrontation, conversation, explanation, emotional turn, obvious reaction beats, or clear internal decision moments, provide at least one short speech or thought line unless the panel is clearly intended to be silent.',
    'If two named characters are facing each other, responding to each other, challenging each other, or emotionally reacting to each other, assume some dialogue is usually natural unless the brief strongly implies silence.',
    'Use narration especially for setup, transition, internal realization, cause-and-effect clarification, and context that staging alone cannot fully express.',
    'Do not duplicate the same narration across multiple panels and do not stuff every panel with dialogue. Keep narration compact, specific, and directly tied to the panel.',
    'Distribute narration deliberately across the page so it fills real information gaps, not as repetitive decoration.',
    'If a character voice should feel terse, blunt, awkward, formal, guarded, or emotionally frayed, let the wording length and rhythm reflect that.',
    'Respect the exact existing page number, panel count, and panel orders in the brief.',
    'Prefer composition source "custom" unless a gallery id is explicitly required in the brief.',
    'Keep the result restrained, readable, and suitable for manga production rather than flashy or quirky.',
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
