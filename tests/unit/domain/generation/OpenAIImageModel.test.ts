import { describe, expect, it } from 'vitest';
import {
  GPT_IMAGE_25_SUNBURST_SNAPSHOT,
  resolveOpenAIImageRuntimeModel,
  resolveOpenAIImageRuntimeProvenance,
} from '../../../../src/domain/constants/openAIImageModel.js';

describe('OpenAI画像モデルcutover', () => {
  it('flag OFFは設定モデルを保持しONは固定2.5 snapshotだけを実行する', () => {
    expect(resolveOpenAIImageRuntimeModel('gpt-image-2', false)).toBe('gpt-image-2');
    expect(resolveOpenAIImageRuntimeModel('gpt-image-2', true)).toBe(GPT_IMAGE_25_SUNBURST_SNAPSHOT);
    expect(resolveOpenAIImageRuntimeProvenance('gpt-image-2', true)).toEqual({
      imageModel: 'gpt-image-2.5-sunburst',
      providerModelId: GPT_IMAGE_25_SUNBURST_SNAPSHOT,
      provider: 'openai',
    });
  });

  it('cutoverは旧base設定以外を受け入れて別providerへfallbackしない', () => {
    expect(() => resolveOpenAIImageRuntimeModel('hy4-preview', true)).toThrow();
    expect(() => resolveOpenAIImageRuntimeModel('gpt-image-2.5-sunburst', true)).toThrow();
  });
});
