import { z } from 'zod';
import {
  ENTITY_IMPORT_ANALYSIS_MAX_TOKENS,
  ENTITY_IMPORT_ANALYSIS_MODEL,
} from '../../domain/constants/entityReference.js';
import type { EntityType } from '../../domain/types/entity.js';
import { OpenAIClient } from './OpenAIClient.js';
import { requestStructuredOpenAIResponse } from './StructuredOpenAIResponse.js';

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

const CHARACTER_IMPORT_FIELD_PATHS = [
  'gender_expression',
  'age_range',
  'skin_tone',
  'first_impression',
  'standing_style',
  'default_expression',
  'face_shape',
  'eyebrow_shape',
  'nose_shape',
  'mouth_shape',
  'height',
  'build',
  'hair.color',
  'hair.length',
  'hair.style',
  'hair.arrangement',
  'hair.bangs',
  'eyes.color',
  'eyes.shape',
  'eyes.eyelid_type',
  'clothing.category',
  'clothing.main_color',
  'clothing.impression',
  'clothing.description',
  'character_identity.aliases',
  'character_identity.visual_anchor',
  'character_identity.signature_feature',
  'character_identity.silhouette_keywords',
  'proportions.head_to_body_ratio',
  'proportions.shoulder_width',
  'proportions.leg_length',
  'proportions.posture_axis',
  'face_detail.eye_size',
  'face_detail.eye_angle',
  'face_detail.pupil_style',
  'face_detail.under_eye_detail',
  'face_detail.mouth_default',
  'hair_detail.front_shape',
  'hair_detail.side_hair',
  'hair_detail.back_shape',
  'outfit_detail.collar_shape',
  'outfit_detail.sleeve_length',
  'outfit_detail.skirt_or_pants_shape',
  'outfit_detail.shoes',
  'outfit_detail.socks_or_legwear',
  'distinguishing_features',
  'art_style',
] as const;

const NONHUMAN_IMPORT_FIELD_PATHS = [
  'base_form',
  'size',
  'movement',
  'distinctive_features',
  'threat_level',
  'art_style',
] as const;

const OBJECT_IMPORT_FIELD_PATHS = [
  'category',
  'material',
  'size',
  'distinctive_features',
] as const;

const ENTITY_IMPORT_FIELD_PATHS = [
  ...CHARACTER_IMPORT_FIELD_PATHS,
  'base_form',
  'size',
  'movement',
  'distinctive_features',
  'threat_level',
  'category',
  'material',
] as const;

type EntityImportFieldPath = (typeof ENTITY_IMPORT_FIELD_PATHS)[number];
type FieldSuggestionValue = string | string[];

const CHARACTER_IMPORT_FIELD_PATH_SET = new Set<string>(CHARACTER_IMPORT_FIELD_PATHS);
const NONHUMAN_IMPORT_FIELD_PATH_SET = new Set<string>(NONHUMAN_IMPORT_FIELD_PATHS);
const OBJECT_IMPORT_FIELD_PATH_SET = new Set<string>(OBJECT_IMPORT_FIELD_PATHS);
const ARRAY_FIELD_PATH_SET = new Set<string>([
  'character_identity.aliases',
  'character_identity.silhouette_keywords',
]);

const fieldSuggestionValueSchema = z.union([
  z.string().trim().min(1).max(500),
  z.array(z.string().trim().min(1).max(100)).min(1).max(12),
]);

const entityImportAnalysisResponseSchema = z
  .object({
    field_suggestions: z
      .array(
        z
          .object({
            path: z.enum(ENTITY_IMPORT_FIELD_PATHS),
            value: fieldSuggestionValueSchema,
          })
          .strict(),
      )
      .max(60),
    prompt_supplement: z.string().trim().min(1).max(2000),
  })
  .strict();

export class OpenAIEntityImportAnalyzer implements EntityImportAnalyzerPort {
  public constructor(
    private readonly client: OpenAIClient,
    private readonly model = ENTITY_IMPORT_ANALYSIS_MODEL,
  ) {}

  public async analyze(input: AnalyzeEntityImportInput): Promise<{
    suggestedFields: Record<string, unknown>;
    promptSupplement: string;
  }> {
    const response = await requestStructuredOpenAIResponse({
      client: this.client,
      model: this.model,
      maxOutputTokens: ENTITY_IMPORT_ANALYSIS_MAX_TOKENS,
      schemaName: 'entity_import_analysis',
      jsonSchema: entityImportAnalysisJsonSchema,
      responseSchema: entityImportAnalysisResponseSchema,
      errorLabel: 'OpenAI entity import analyzer',
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

    return {
      suggestedFields: buildSuggestedFields(input.entityType, response.field_suggestions),
      promptSupplement: response.prompt_supplement,
    };
  }
}

function buildAnalysisPrompt(entityType: EntityType): string {
  const allowedPaths = getAllowedFieldPaths(entityType);

  return [
    `Analyze this ${entityType} design image and return JSON only.`,
    'Output concise field suggestions as path/value pairs using only the allowed paths listed below.',
    'Omit uncertain fields instead of inventing them.',
    `Allowed paths for this entity type: ${Array.from(allowedPaths).join(', ')}.`,
    'Use enum-compatible values when the UI field expects an enum.',
    'For character_identity.aliases and character_identity.silhouette_keywords, value may be an array of short strings.',
    'prompt_supplement must be one concise English visual description usable for later full-body image generation.',
    'When the source image is cropped or partial, infer only stable full-body details visually supported by the image.',
  ].join(' ');
}

function buildSuggestedFields(
  entityType: EntityType,
  suggestions: Array<{ path: EntityImportFieldPath; value: FieldSuggestionValue }>,
): Record<string, unknown> {
  const allowedPaths = getAllowedFieldPaths(entityType);
  const fields: Record<string, unknown> = {};

  for (const suggestion of suggestions) {
    if (!allowedPaths.has(suggestion.path)) {
      continue;
    }

    const value = normalizeFieldSuggestionValue(suggestion.path, suggestion.value);
    if (value === null) {
      continue;
    }

    assignFieldPath(fields, suggestion.path, value);
  }

  return fields;
}

function getAllowedFieldPaths(entityType: EntityType): ReadonlySet<string> {
  switch (entityType) {
    case 'character':
      return CHARACTER_IMPORT_FIELD_PATH_SET;
    case 'nonhuman':
      return NONHUMAN_IMPORT_FIELD_PATH_SET;
    case 'object':
      return OBJECT_IMPORT_FIELD_PATH_SET;
  }
}

function normalizeFieldSuggestionValue(path: string, value: FieldSuggestionValue): string | string[] | null {
  const expectsArray = ARRAY_FIELD_PATH_SET.has(path);

  if (Array.isArray(value)) {
    const values = value.map((item) => item.trim()).filter((item) => item.length > 0);
    if (values.length === 0) {
      return null;
    }

    return expectsArray ? values : values.join(', ');
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }

  return expectsArray ? [normalized] : normalized;
}

function assignFieldPath(target: Record<string, unknown>, path: string, value: string | string[]): void {
  const segments = path.split('.');
  let current = target;

  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (!isRecord(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  const leaf = segments[segments.length - 1];
  if (leaf !== undefined) {
    current[leaf] = value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const stringValueJsonSchema = {
  type: 'string',
  maxLength: 500,
} as const;

const stringArrayValueJsonSchema = {
  type: 'array',
  maxItems: 12,
  items: {
    type: 'string',
    maxLength: 100,
  },
} as const;

const entityImportAnalysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['field_suggestions', 'prompt_supplement'],
  properties: {
    field_suggestions: {
      type: 'array',
      maxItems: 60,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'value'],
        properties: {
          path: {
            type: 'string',
            enum: ENTITY_IMPORT_FIELD_PATHS,
          },
          value: {
            anyOf: [stringValueJsonSchema, stringArrayValueJsonSchema],
          },
        },
      },
    },
    prompt_supplement: {
      type: 'string',
      maxLength: 2000,
    },
  },
} as const;
