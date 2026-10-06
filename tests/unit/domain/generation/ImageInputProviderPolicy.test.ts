import { describe, expect, it } from 'vitest';
import {
  isOpenAIImageInputCompatible,
  requireOpenAIEntityInputCompatible,
  requireOpenAIEntityJobCompatible,
  requireOpenAIImageInputCompatible,
  requireOpenAIPageJobCompatible,
} from '../../../../src/domain/generation/ImageInputProviderPolicy.js';

describe('OpenAI画像入力のprovider境界', () => {
  it.each([
    {},
    { imageModel: null },
    { imageModel: 'gpt-image-1' },
    { imageModel: 'gpt-image-2', provider: 'openai', providerModelId: 'gpt-image-2' },
  ])('legacyまたは整合するGPT画像だけ許可する (%j)', (provenance) => {
    expect(isOpenAIImageInputCompatible(provenance)).toBe(true);
    expect(() => requireOpenAIImageInputCompatible(provenance)).not.toThrow();
  });

  it.each([
    { imageModel: 'hy4-preview', provider: 'tencent', providerModelId: 'hy4-preview' },
    { imageModel: 'unknown-model' },
    { imageModel: 'gpt-image-2', provider: 'tencent' },
    { imageModel: 'gpt-image-2', providerModelId: 'different-model' },
    { provider: 'openai' },
    { providerModelId: 'gpt-image-2' },
  ])('Hy4・未知・矛盾metadataをOpenAI入力へ流さない (%j)', (provenance) => {
    expect(isOpenAIImageInputCompatible(provenance)).toBe(false);
    expect(() => requireOpenAIImageInputCompatible(provenance)).toThrowError(
      expect.objectContaining({ code: 'PAGE_REFERENCE_MODEL_INCOMPATIBLE', statusCode: 409 }),
    );
  });

  it('entity sourceとstate baseは共通の安定codeで拒否する', () => {
    expect(() => requireOpenAIEntityInputCompatible({ imageModel: 'hy4-preview' })).toThrowError(
      expect.objectContaining({ code: 'ENTITY_REFERENCE_MODEL_INCOMPATIBLE', statusCode: 409 }),
    );
  });

  it('legacy jobは許可し、明示されたHy4 jobはprovider呼び出し前に拒否する', () => {
    expect(() => requireOpenAIPageJobCompatible({}, 'gpt-image-2')).not.toThrow();
    expect(() => requireOpenAIPageJobCompatible({
      image_model: 'hy4-preview',
      provider_model_id: 'hy4-preview',
      provider: 'tencent',
    }, 'gpt-image-2')).toThrowError(expect.objectContaining({
      code: 'PAGE_REFERENCE_MODEL_INCOMPATIBLE',
      statusCode: 409,
    }));
  });

  it('jobに固定されたGPT modelがworker設定と異なる場合もfallbackしない', () => {
    expect(() => requireOpenAIEntityJobCompatible({
      image_model: 'gpt-image-1',
      provider_model_id: 'gpt-image-1',
      provider: 'openai',
    }, 'gpt-image-2')).toThrowError(expect.objectContaining({
      code: 'ENTITY_REFERENCE_MODEL_INCOMPATIBLE',
      statusCode: 409,
    }));
  });

  it('job metadataが明示nullまたは欠損組合せならlegacy扱いにせずfail closedにする', () => {
    expect(() => requireOpenAIPageJobCompatible({ image_model: null }, 'gpt-image-2'))
      .toThrowError(expect.objectContaining({ code: 'PAGE_REFERENCE_MODEL_INCOMPATIBLE' }));
    expect(() => requireOpenAIEntityJobCompatible({ provider: 'openai' }, 'gpt-image-2'))
      .toThrowError(expect.objectContaining({ code: 'ENTITY_REFERENCE_MODEL_INCOMPATIBLE' }));
  });
});
