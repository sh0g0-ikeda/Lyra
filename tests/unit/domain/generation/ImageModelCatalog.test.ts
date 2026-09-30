import { describe, expect, it } from 'vitest';

import {
  IMAGE_MODEL_CATALOG,
  IMAGE_MODEL_PRICING_VERSION,
  resolveEnabledImageModel,
} from '../../../../src/domain/generation/ImageModelCatalog.js';

describe('ImageModelCatalog', () => {
  it('GPT Image 2 を既存料金のページ・entity preview対応モデルとして公開する', () => {
    expect(IMAGE_MODEL_PRICING_VERSION).toBe('existing-pricing-v1');
    expect(IMAGE_MODEL_CATALOG).toContainEqual(expect.objectContaining({
      key: 'gpt-image-2',
      providerModelId: 'gpt-image-2',
      enabled: true,
      pricingVersion: IMAGE_MODEL_PRICING_VERSION,
      capabilities: {
        pageGeneration: true,
        entityPreview: true,
      },
    }));
  });

  it('Hy4 Preview を画像能力・画像価格なしの無効モデルとして明示する', () => {
    expect(IMAGE_MODEL_CATALOG).toContainEqual(expect.objectContaining({
      key: 'hy4-preview',
      providerModelId: 'hy4-preview',
      enabled: false,
      pricingVersion: null,
      capabilities: {
        pageGeneration: false,
        entityPreview: false,
      },
    }));
  });

  it('将来のHy4画像公開先をブラウザ版に限定する', () => {
    expect(IMAGE_MODEL_CATALOG.find((model) => model.key === 'hy4-preview')?.availableOn).toEqual(['web']);
    expect(IMAGE_MODEL_CATALOG.find((model) => model.key === 'gpt-image-2')?.availableOn).toEqual(['web', 'mobile']);
  });

  it('無指定時は現行GPT Image 2を解決する', () => {
    expect(resolveEnabledImageModel()).toMatchObject({ key: 'gpt-image-2' });
  });

  it('未知または無効な画像モデルを安全に拒否する', () => {
    expect(resolveEnabledImageModel('unknown-image-model')).toBeNull();
    expect(resolveEnabledImageModel('hy4-preview')).toBeNull();
  });
});
