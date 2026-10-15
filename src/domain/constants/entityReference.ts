export const ENTITY_IMPORT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export const ENTITY_REFERENCE_GENERATION = {
  MODEL: 'gpt-image-2',
  QUALITY: 'medium',
  SIZE: '1024x1536',
  CANDIDATE_COUNT: 1,
} as const;

export const ENTITY_IMPORT_ANALYSIS_MODEL = 'gpt-5.4-mini';
export const ENTITY_IMPORT_ANALYSIS_SUPPORTED_MODELS = [
  'gpt-4o',
  ENTITY_IMPORT_ANALYSIS_MODEL,
] as const;
export type EntityImportAnalysisModel = (typeof ENTITY_IMPORT_ANALYSIS_SUPPORTED_MODELS)[number];

export function isEntityImportAnalysisModel(model: string): model is EntityImportAnalysisModel {
  return ENTITY_IMPORT_ANALYSIS_SUPPORTED_MODELS.some((candidate) => candidate === model);
}
export const ENTITY_REFERENCE_PROMPT_COMPILER_OPENAI_MODEL = 'gpt-5.4-mini';
export const ENTITY_REFERENCE_PROMPT_COMPILER_MAX_TOKENS = 600;
export const ENTITY_REFERENCE_PROMPT_COMPILER_VERSION = 'entity_ref_v2';

export const ENTITY_REFERENCE_LIMITS = {
  MIN_CONFIRM_COUNT: 1,
  MAX_CONFIRM_COUNT: 3,
  MAX_PROMPT_SUPPLEMENT_LENGTH: 2000,
  MAX_REFERENCE_ID_LENGTH: 200,
} as const;

export const ENTITY_IMPORT_ANALYSIS_MAX_TOKENS = 700;
