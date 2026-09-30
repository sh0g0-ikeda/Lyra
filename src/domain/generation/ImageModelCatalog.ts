export const IMAGE_MODEL_PRICING_VERSION = 'existing-pricing-v1' as const;

export type ImageModelKey = 'gpt-image-2' | 'hy4-preview';

export interface ImageModelCapabilities {
  pageGeneration: boolean;
  entityPreview: boolean;
}

export interface ImageModelCatalogEntry {
  key: ImageModelKey;
  providerModelId: string;
  enabled: boolean;
  availableOn: readonly ('web' | 'mobile')[];
  pricingVersion: typeof IMAGE_MODEL_PRICING_VERSION | null;
  capabilities: ImageModelCapabilities;
}

export const IMAGE_MODEL_CATALOG: readonly ImageModelCatalogEntry[] = [
  {
    key: 'gpt-image-2',
    providerModelId: 'gpt-image-2',
    enabled: true,
    availableOn: ['web', 'mobile'],
    pricingVersion: IMAGE_MODEL_PRICING_VERSION,
    capabilities: {
      pageGeneration: true,
      entityPreview: true,
    },
  },
  {
    // Hy4 Preview has no verified image-generation contract or image tariff.
    key: 'hy4-preview',
    providerModelId: 'hy4-preview',
    enabled: false,
    availableOn: ['web'],
    pricingVersion: null,
    capabilities: {
      pageGeneration: false,
      entityPreview: false,
    },
  },
] as const;

export function resolveEnabledImageModel(key?: string): ImageModelCatalogEntry | null {
  const requestedKey = key ?? 'gpt-image-2';
  const model = IMAGE_MODEL_CATALOG.find((candidate) => candidate.key === requestedKey);

  return model?.enabled === true ? model : null;
}

export function isMobileImageModelAvailable(key: string | null | undefined): boolean {
  if (key === null || key === undefined) {
    return true; // Legacy images predate model provenance and remain available.
  }
  return IMAGE_MODEL_CATALOG.some((model) => model.key === key && model.availableOn.includes('mobile'));
}
