import { ConfigurationError } from '../errors/index.js';

export const GPT_IMAGE_2 = 'gpt-image-2';
export const GPT_IMAGE_25_SUNBURST = 'gpt-image-2.5-sunburst';
export const GPT_IMAGE_25_SUNBURST_SNAPSHOT = 'gpt-image-2.5-sunburst-2026-09-08';

export interface OpenAIImageRuntimeProvenance {
  imageModel: string;
  providerModelId: string;
  provider: 'openai';
}

/**
 * Cutover is server-owned: OFF preserves the configured legacy model, while ON
 * pins every provider call to the audited snapshot and never interprets another
 * configured model as a fallback.
 */
export function resolveOpenAIImageRuntimeModel(configuredModel: string, sunburstEnabled: boolean): string {
  if (!sunburstEnabled) return configuredModel;
  if (configuredModel !== GPT_IMAGE_2) {
    throw new ConfigurationError('GPT Image 2.5 cutover requires gpt-image-2 as the compatible base model');
  }
  return GPT_IMAGE_25_SUNBURST_SNAPSHOT;
}

export function resolveOpenAIImageRuntimeProvenance(
  configuredModel: string,
  sunburstEnabled: boolean,
): OpenAIImageRuntimeProvenance {
  const providerModelId = resolveOpenAIImageRuntimeModel(configuredModel, sunburstEnabled);
  return { imageModel: displayOpenAIImageModel(providerModelId), providerModelId, provider: 'openai' };
}

export function displayOpenAIImageModel(providerModelId: string): string {
  return providerModelId === GPT_IMAGE_25_SUNBURST_SNAPSHOT ? GPT_IMAGE_25_SUNBURST : providerModelId;
}
