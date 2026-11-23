import { EntityReferenceModelIncompatibleError, PageReferenceModelIncompatibleError } from '../errors/index.js';
import { readImageProvenance, type ImageProvenance } from './ImageAccessPolicy.js';
import { GPT_IMAGE_2, GPT_IMAGE_25_SUNBURST, GPT_IMAGE_25_SUNBURST_SNAPSHOT } from '../constants/openAIImageModel.js';

/**
 * OpenAI image inputs may use legacy images without provenance or images whose
 * persisted provenance explicitly stays on a known OpenAI GPT image model pair.
 */
export function isOpenAIImageInputCompatible(image: ImageProvenance): boolean {
  if (image.imageModel == null) {
    return image.provider == null && image.providerModelId == null;
  }
  if (image.imageModel === GPT_IMAGE_25_SUNBURST) {
    return image.provider === 'openai'
      && image.providerModelId === GPT_IMAGE_25_SUNBURST_SNAPSHOT;
  }
  if (image.imageModel !== 'gpt-image-1' && image.imageModel !== 'gpt-image-2') return false;
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
      (provenance.providerModelId ?? provenance.imageModel) !== configuredModel
    )
  ) {
    throw createError();
  }
}

/** Only an accepted quote can select a different supported provider model. */
export function resolveQuotedOpenAIImageModel(
  params: Record<string, unknown>,
  configuredModel: string | undefined,
): string | undefined {
  if (configuredModel === GPT_IMAGE_2 && typeof params.quote_id === 'string'
    && params.provider_model_id === GPT_IMAGE_25_SUNBURST_SNAPSHOT) return GPT_IMAGE_25_SUNBURST_SNAPSHOT;
  return configuredModel;
}
