export const GPT_IMAGE_2 = 'gpt-image-2';
export const GPT_IMAGE_25_SUNBURST = 'gpt-image-2.5-sunburst';
export const GPT_IMAGE_25_SUNBURST_SNAPSHOT = 'gpt-image-2.5-sunburst-2026-09-08';

export function displayOpenAIImageModel(providerModelId: string): string {
  return providerModelId === GPT_IMAGE_25_SUNBURST_SNAPSHOT ? GPT_IMAGE_25_SUNBURST : providerModelId;
}
