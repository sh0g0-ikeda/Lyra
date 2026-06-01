import { ConfigurationError } from '../../domain/errors/index.js';
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

interface OpenAICompilerResponse {
  output_text?: unknown;
  output?: unknown;
}

export class OpenAIPageAutofillCompiler implements PageAutofillCompilerPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly model = PAGE_AUTOFILL_COMPILER_OPENAI_MODEL,
  ) {}

  public async compileSuggestions(
    input: CompilePageAutofillInput,
  ): Promise<CompiledPageAutofillSuggestion> {
    const response = await this.client.postJson<OpenAICompilerResponse>('/responses', {
      model: this.model,
      max_output_tokens: PAGE_AUTOFILL_COMPILER_MAX_TOKENS,
      text: {
        format: {
          type: 'json_schema',
          name: 'page_autofill',
          strict: false,
          schema: pageAutofillJsonSchema,
        },
      },
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

    const outputText = extractOutputText(response.body);
    if (outputText === null) {
      throw new ConfigurationError('OpenAI page autofill compiler returned no text output');
    }

    const normalized = normalizeCompiledJson(outputText);
    let parsed: unknown;
    try {
      parsed = JSON.parse(normalized);
    } catch {
      throw new ConfigurationError(
        `OpenAI page autofill compiler returned invalid JSON: ${normalized.slice(0, 400)}`,
      );
    }

    const sanitized = sanitizePageAutofillPayload(parsed);
    const validated = pageAutofillSuggestionSchema.safeParse(sanitized);
    if (!validated.success) {
      throw new ConfigurationError(
        `OpenAI page autofill compiler returned an invalid payload: ${validated.error.message}`,
      );
    }

    return {
      suggestion: {
        page:
          validated.data.page === undefined
            ? undefined
            : {
                dialogueMode: validated.data.page.dialogue_mode,
                pageDialogueToggle: validated.data.page.page_dialogue_toggle,
              },
        panels: validated.data.panels.map((panel) => ({
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
    'Treat the episode draft and scenes as the main source of truth.',
    'Treat chapter information only as a consistency guard so the page does not contradict the larger chapter arc.',
    'Fill the existing editable fields with grounded defaults that a user can revise before image generation.',
    'Before writing any text lines, infer what information the full page still needs in order to be understandable, then distribute that information between image, narration, and dialogue instead of dumping everything into one field.',
    'Convert abstract story intent into visible panel cues such as situation, camera distance, angle, character placement, posture, gaze, expression, background, and when needed dialogue or narration.',
    'Keep every generated text field concise and editable. Prefer one short sentence or compact phrase per field.',
    'Do not copy a whole scene summary into every panel. Describe only the panel-specific beat.',
    `All free-text fields, including situation_text, composition_prompt, custom_note, background_note, panel_notes, dialogue text, and narration text, must be written in natural ${outputLanguage} suitable for direct editing in the Lyra UI.`,
    'For situation_text, write a concrete visual beat that names the subject or subjects, their visible action or feeling, and the immediate context in image-friendly language.',
    'For composition.composition_prompt, explicitly name the subject, the framing intention, and the spatial relation or emphasis so an image model can stage the panel correctly.',
    'For composition.custom_note, add a short camera or direction memo whenever shot type and angle alone would leave the intended staging ambiguous.',
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

function sanitizePageAutofillPayload(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.panels)) {
    return value;
  }

  return {
    ...value,
    panels: value.panels.map((panel) => sanitizePanelLikeObject(panel)),
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

const pageAutofillJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['panels'],
  properties: {
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
                anyOf: [
                  {
                    type: 'string',
                    enum: ['full_body', 'half_body', 'close_up', 'wide', 'extreme_close_up'],
                  },
                  { type: 'null' },
                ],
              },
              angle: {
                anyOf: [
                  {
                    type: 'string',
                    enum: ['front', 'side', 'three_quarter', 'bird_eye', 'worm_eye', 'dutch_angle'],
                  },
                  { type: 'null' },
                ],
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
              required: ['entity_id', 'role', 'expression', 'action', 'position'],
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
                facing_direction: {
                  anyOf: [
                    {
                      type: 'string',
                      enum: ['front', 'left', 'right', 'away', 'three_quarter_left', 'three_quarter_right'],
                    },
                    { type: 'null' },
                  ],
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
} as const;
