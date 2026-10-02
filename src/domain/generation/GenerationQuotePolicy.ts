import { createHash } from 'node:crypto';
import { CREDIT_COSTS } from '../constants/credits.js';
import { calculatePageGenerationCreditCost, PAGE_GENERATION_INPUT_IMAGE_LIMITS } from '../constants/generation.js';
import { ENTITY_IMPORT_ANALYSIS_MODEL, ENTITY_REFERENCE_GENERATION } from '../constants/entityReference.js';
import { ConflictError, ValidationError } from '../errors/index.js';
import type { GenerationQuoteOperation, GenerationQuotePlan, GenerationQuoteRequest } from '../types/generationQuote.js';

export const GENERATION_QUOTE_PRICING_VERSION = 'lyra-existing-credits-v1';
export const GENERATION_QUOTE_TTL_MS = 5 * 60 * 1000;
export const GENERATION_QUOTE_MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;

export function calculateQuotePrice(operation: GenerationQuoteOperation, referenceCount: number): number {
  if (!Number.isInteger(referenceCount) || referenceCount < 0 || referenceCount > PAGE_GENERATION_INPUT_IMAGE_LIMITS.MAX_ENTITY_REFERENCE_IMAGES) {
    throw new ValidationError('Generation reference count is invalid');
  }
  if (operation === 'page_generate' || operation === 'page_regenerate') {
    return calculatePageGenerationCreditCost(referenceCount);
  }
  return operation === 'entity_import_analysis' ? CREDIT_COSTS.ENTITY_IMPORT_ANALYSIS
    : operation === 'entity_state_preview' ? CREDIT_COSTS.ENTITY_STATE_GENERATION : CREDIT_COSTS.ENTITY_GENERATION;
}

export function validateQuoteSelection(
  request: GenerationQuoteRequest,
  configuredImageModel: string,
): Pick<GenerationQuotePlan, 'imageModel' | 'providerModelId' | 'quality' | 'renderStyle'> {
  if (request.operation === 'entity_import_analysis') {
    if (request.imageModel !== undefined || request.quality !== undefined || request.renderStyle !== undefined) {
      throw new ValidationError('Image generation options do not apply to import analysis');
    }
    return { imageModel: null, providerModelId: ENTITY_IMPORT_ANALYSIS_MODEL, quality: null, renderStyle: null };
  }
  if ((request.imageModel ?? ENTITY_REFERENCE_GENERATION.MODEL) !== ENTITY_REFERENCE_GENERATION.MODEL) {
    throw new ValidationError('Selected image model is not available');
  }
  if (configuredImageModel !== ENTITY_REFERENCE_GENERATION.MODEL) {
    throw new ConflictError('Quoted image model is unavailable in this runtime');
  }
  if (request.quality !== undefined && request.quality !== 'medium') {
    throw new ValidationError('Selected image quality is not available');
  }
  const isPage = request.operation === 'page_generate' || request.operation === 'page_regenerate';
  if (!isPage && request.renderStyle !== undefined && request.renderStyle !== 'color') {
    throw new ValidationError('Selected rendering style is not available for this operation');
  }
  return {
    imageModel: ENTITY_REFERENCE_GENERATION.MODEL,
    providerModelId: configuredImageModel,
    quality: 'medium',
    renderStyle: isPage ? request.renderStyle ?? 'color' : 'color',
  };
}

export function fingerprintQuoteInput(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new ValidationError('Quote input contains an unsupported value');
    return encoded;
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}
