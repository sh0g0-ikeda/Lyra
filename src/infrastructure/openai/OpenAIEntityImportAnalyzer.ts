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

type ImportFieldValueRule =
  | {
      kind: 'string';
      paths: readonly EntityImportFieldPath[];
      maxLength: number;
    }
  | {
      kind: 'string_array';
      paths: readonly EntityImportFieldPath[];
      maxItems: number;
      itemMaxLength: number;
    }
  | {
      kind: 'enum';
      paths: readonly EntityImportFieldPath[];
      values: readonly string[];
    };

const CHARACTER_IMPORT_FIELD_PATH_SET = new Set<string>(CHARACTER_IMPORT_FIELD_PATHS);
const NONHUMAN_IMPORT_FIELD_PATH_SET = new Set<string>(NONHUMAN_IMPORT_FIELD_PATHS);
const OBJECT_IMPORT_FIELD_PATH_SET = new Set<string>(OBJECT_IMPORT_FIELD_PATHS);
const CHARACTER_IMPORT_FIELD_VALUE_RULES = [
  {
    kind: 'string',
    paths: [
      'gender_expression',
      'age_range',
      'skin_tone',
      'face_shape',
      'eyebrow_shape',
      'nose_shape',
      'mouth_shape',
      'height',
      'build',
      'hair.color',
      'hair.length',
      'hair.style',
      'hair.bangs',
      'eyes.color',
      'eyes.shape',
      'eyes.eyelid_type',
      'clothing.main_color',
      'proportions.head_to_body_ratio',
      'proportions.shoulder_width',
      'proportions.leg_length',
      'face_detail.eye_size',
      'face_detail.eye_angle',
      'face_detail.pupil_style',
      'outfit_detail.sleeve_length',
      'art_style',
    ],
    maxLength: 100,
  },
  {
    kind: 'string',
    paths: [
      'first_impression',
      'standing_style',
      'default_expression',
      'hair.arrangement',
      'clothing.category',
      'clothing.impression',
      'proportions.posture_axis',
      'face_detail.under_eye_detail',
      'face_detail.mouth_default',
      'hair_detail.front_shape',
      'hair_detail.side_hair',
      'hair_detail.back_shape',
      'outfit_detail.collar_shape',
      'outfit_detail.skirt_or_pants_shape',
      'outfit_detail.shoes',
      'outfit_detail.socks_or_legwear',
    ],
    maxLength: 150,
  },
  {
    kind: 'string',
    paths: ['character_identity.visual_anchor', 'character_identity.signature_feature'],
    maxLength: 300,
  },
  {
    kind: 'string',
    paths: ['clothing.description', 'distinguishing_features'],
    maxLength: 500,
  },
  {
    kind: 'string_array',
    paths: ['character_identity.aliases'],
    maxItems: 12,
    itemMaxLength: 100,
  },
  {
    kind: 'string_array',
    paths: ['character_identity.silhouette_keywords'],
    maxItems: 6,
    itemMaxLength: 100,
  },
] as const satisfies readonly ImportFieldValueRule[];

const NONHUMAN_IMPORT_FIELD_VALUE_RULES = [
  {
    kind: 'enum',
    paths: ['base_form'],
    values: ['dragon', 'wolf', 'spirit', 'robot', 'zombie', 'deity', 'custom'],
  },
  {
    kind: 'enum',
    paths: ['size'],
    values: ['tiny', 'small', 'human_scale', 'large', 'enormous'],
  },
  {
    kind: 'enum',
    paths: ['movement'],
    values: ['bipedal', 'quadruped', 'flying', 'floating', 'slithering', 'custom'],
  },
  {
    kind: 'string',
    paths: ['distinctive_features'],
    maxLength: 500,
  },
  {
    kind: 'enum',
    paths: ['threat_level'],
    values: ['harmless', 'low', 'medium', 'high', 'catastrophic'],
  },
  {
    kind: 'enum',
    paths: ['art_style'],
    values: ['anime', 'semi_realistic', 'manga', 'painterly'],
  },
] as const satisfies readonly ImportFieldValueRule[];

const OBJECT_IMPORT_FIELD_VALUE_RULES = [
  {
    kind: 'enum',
    paths: ['category'],
    values: ['weapon', 'tool', 'vehicle', 'structure', 'consumable', 'magical', 'custom'],
  },
  {
    kind: 'enum',
    paths: ['material'],
    values: ['metal', 'wood', 'stone', 'crystal', 'organic', 'energy', 'custom'],
  },
  {
    kind: 'enum',
    paths: ['size'],
    values: ['small', 'medium', 'large', 'enormous'],
  },
  {
    kind: 'string',
    paths: ['distinctive_features'],
    maxLength: 500,
  },
] as const satisfies readonly ImportFieldValueRule[];

const fieldSuggestionValueSchema = z.union([
  z.string().trim().min(1).max(500),
  z.array(z.string().trim().min(1).max(100)).min(1).max(12),
]);

const entityImportAnalysisResponseBaseSchema = z
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
      jsonSchema: buildEntityImportAnalysisJsonSchema(input.entityType),
      responseSchema: buildEntityImportAnalysisResponseSchema(input.entityType),
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
      suggestedFields: buildSuggestedFields(response.field_suggestions),
      promptSupplement: response.prompt_supplement,
    };
  }
}

function buildAnalysisPrompt(entityType: EntityType): string {
  const allowedPaths = getAllowedFieldPaths(entityType);
  const valueContracts = getImportFieldValueRules(entityType).map(describeImportFieldValueRule).join('; ');

  return [
    `Analyze this ${entityType} design image and return JSON only.`,
    'Output concise field suggestions as path/value pairs using only the allowed paths listed below.',
    'Omit uncertain fields instead of inventing them.',
    `Allowed paths for this entity type: ${Array.from(allowedPaths).join(', ')}.`,
    `Value contracts: ${valueContracts}.`,
    'For character_identity.aliases and character_identity.silhouette_keywords, value may be an array of short strings.',
    'prompt_supplement must be one concise English visual description usable for later full-body image generation.',
    'When the source image is cropped or partial, infer only stable full-body details visually supported by the image.',
  ].join(' ');
}

function buildSuggestedFields(
  suggestions: Array<{ path: EntityImportFieldPath; value: FieldSuggestionValue }>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  for (const suggestion of suggestions) {
    const value = normalizeFieldSuggestionValue(suggestion.value);
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

function normalizeFieldSuggestionValue(value: FieldSuggestionValue): string | string[] {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim());
  }

  return value.trim();
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

function getImportFieldValueRules(entityType: EntityType): readonly ImportFieldValueRule[] {
  switch (entityType) {
    case 'character':
      return CHARACTER_IMPORT_FIELD_VALUE_RULES;
    case 'nonhuman':
      return NONHUMAN_IMPORT_FIELD_VALUE_RULES;
    case 'object':
      return OBJECT_IMPORT_FIELD_VALUE_RULES;
  }
}

function findImportFieldValueRule(
  entityType: EntityType,
  path: EntityImportFieldPath,
): ImportFieldValueRule | undefined {
  return getImportFieldValueRules(entityType).find((rule) => rule.paths.some((candidate) => candidate === path));
}

function buildEntityImportAnalysisResponseSchema(entityType: EntityType): typeof entityImportAnalysisResponseBaseSchema {
  return entityImportAnalysisResponseBaseSchema.superRefine((response, context) => {
    const seenPaths = new Set<EntityImportFieldPath>();

    response.field_suggestions.forEach((suggestion, index) => {
      const rule = findImportFieldValueRule(entityType, suggestion.path);
      if (rule === undefined) {
        context.addIssue({
          code: 'custom',
          message: `Path ${suggestion.path} is not valid for ${entityType}`,
          path: ['field_suggestions', index, 'path'],
        });
        return;
      }

      if (seenPaths.has(suggestion.path)) {
        context.addIssue({
          code: 'custom',
          message: `Path ${suggestion.path} must not be repeated`,
          path: ['field_suggestions', index, 'path'],
        });
      }
      seenPaths.add(suggestion.path);

      const valueError = validateImportFieldSuggestionValue(rule, suggestion.value);
      if (valueError !== null) {
        context.addIssue({
          code: 'custom',
          message: valueError,
          path: ['field_suggestions', index, 'value'],
        });
      }
    });
  });
}

function validateImportFieldSuggestionValue(
  rule: ImportFieldValueRule,
  value: FieldSuggestionValue,
): string | null {
  switch (rule.kind) {
    case 'string':
      return typeof value === 'string' && value.length <= rule.maxLength
        ? null
        : `Value must be a string with at most ${rule.maxLength} characters`;
    case 'string_array':
      return Array.isArray(value)
        && value.length <= rule.maxItems
        && value.every((item) => item.length <= rule.itemMaxLength)
        ? null
        : `Value must be an array of at most ${rule.maxItems} strings`;
    case 'enum':
      return typeof value === 'string' && rule.values.some((candidate) => candidate === value)
        ? null
        : `Value must be one of: ${rule.values.join(', ')}`;
  }
}

function describeImportFieldValueRule(rule: ImportFieldValueRule): string {
  const paths = rule.paths.join(', ');
  switch (rule.kind) {
    case 'string':
      return `${paths} = non-empty string up to ${rule.maxLength} characters`;
    case 'string_array':
      return `${paths} = array of 1-${rule.maxItems} non-empty strings`;
    case 'enum':
      return `${paths} = one of ${rule.values.join('|')}`;
  }
}

function buildEntityImportAnalysisJsonSchema(entityType: EntityType): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['field_suggestions', 'prompt_supplement'],
    properties: {
      field_suggestions: {
        type: 'array',
        maxItems: 60,
        items: {
          anyOf: getImportFieldValueRules(entityType).map((rule) => ({
            type: 'object',
            additionalProperties: false,
            required: ['path', 'value'],
            properties: {
              path: {
                type: 'string',
                enum: rule.paths,
              },
              value: buildImportFieldValueJsonSchema(rule),
            },
          })),
        },
      },
      prompt_supplement: {
        type: 'string',
        minLength: 1,
        maxLength: 2000,
      },
    },
  };
}

function buildImportFieldValueJsonSchema(rule: ImportFieldValueRule): Record<string, unknown> {
  switch (rule.kind) {
    case 'string':
      return {
        type: 'string',
        minLength: 1,
        maxLength: rule.maxLength,
      };
    case 'string_array':
      return {
        type: 'array',
        minItems: 1,
        maxItems: rule.maxItems,
        items: {
          type: 'string',
          minLength: 1,
          maxLength: rule.itemMaxLength,
        },
      };
    case 'enum':
      return {
        type: 'string',
        enum: rule.values,
      };
  }
}
