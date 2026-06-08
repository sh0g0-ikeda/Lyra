import { describe, expect, it } from 'vitest';
import { shouldUseLocalImageFallback } from '../../../../src/domain/generation/LocalImageFallbackPolicy.js';

describe('shouldUseLocalImageFallback', () => {
  it('local asset storage があっても明示フラグがなければ fallback しない', () => {
    expect(
      shouldUseLocalImageFallback({
        localAssetStorageConfigured: true,
        localImageFallbackEnabled: false,
      }),
    ).toBe(false);
  });

  it('local asset storage と明示フラグが両方ある場合だけ fallback を許可する', () => {
    expect(
      shouldUseLocalImageFallback({
        localAssetStorageConfigured: true,
        localImageFallbackEnabled: true,
      }),
    ).toBe(true);
  });

  it('明示フラグがあっても local asset storage がなければ fallback しない', () => {
    expect(
      shouldUseLocalImageFallback({
        localAssetStorageConfigured: false,
        localImageFallbackEnabled: true,
      }),
    ).toBe(false);
  });
});
