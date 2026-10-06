import { EntityReferenceModelIncompatibleError, PageReferenceModelIncompatibleError } from '../errors/index.js';
import { readImageProvenance, type ImageProvenance } from './ImageAccessPolicy.js';

/**
 * OpenAI image inputs may use legacy images without provenance or images whose
 * persisted provenance explicitly stays on the OpenAI GPT image family.
 */
export function isOpenAIImageInputCompatible(image: ImageProvenance): boolean {
  if (image.imageModel == null) {
    return image.provider == null && image.providerModelId == null;
  }
  if (image.imageModel !== 'gpt-image-1' && image.imageModel !== 'gpt-image-2') {
    return false;
  }
  return (image.provider == null || image.provider === 'openai')
    && (image.providerModelId == null || image.providerModelId === image.imageModel);
}

export function requireOpenAIImageInputCompatible(image: ImageProvenance): void {
  if (!isOpenAIImageInputCompatible(image)) {
    throw new PageReferenceModelIncompatibleError();
  }
}

export function requireOpenAIEntityInputCompatible(image: ImageProvenance): void {
  if (!isOpenAIImageInputCompatible(image)) {
    throw new EntityReferenceModelIncompatibleError();
  }
}

export function requireOpenAIPageJobCompatible(
  params: unknown,
  configuredModel?: string,
): void {
  requireOpenAIJobCompatible(params, configuredModel, () => new PageReferenceModelIncompatibleError());
}

export function requireOpenAIEntityJobCompatible(
  params: unknown,
  configuredModel?: string,
): void {
  requireOpenAIJobCompatible(params, configuredModel, () => new EntityReferenceModelIncompatibleError());
}

function requireOpenAIJobCompatible(
  params: unknown,
  configuredModel: string | undefined,
  createError: () => Error,
): void {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw createError();
  }
  const record = params as Record<string, unknown>;
  const persistedFields = ['image_model', 'provider_model_id', 'provider'] as const;
  const hasPersistedProvenance = persistedFields.some((field) => Object.prototype.hasOwnProperty.call(record, field));
  if (!hasPersistedProvenance) return;
  if (typeof record.image_model !== 'string' || record.image_model.trim().length === 0) {
    throw createError();
  }
  for (const field of ['provider_model_id', 'provider'] as const) {
    if (Object.prototype.hasOwnProperty.call(record, field)
      && (typeof record[field] !== 'string' || record[field].trim().length === 0)) {
      throw createError();
    }
  }
  const provenance = readImageProvenance(params);
  if (!isOpenAIImageInputCompatible(provenance)) {
    throw createError();
  }
  if (
    configuredModel !== undefined
    && (
      (provenance.imageModel != null && provenance.imageModel !== configuredModel)
      || (provenance.providerModelId != null && provenance.providerModelId !== configuredModel)
    )
  ) {
    throw createError();
  }
}
