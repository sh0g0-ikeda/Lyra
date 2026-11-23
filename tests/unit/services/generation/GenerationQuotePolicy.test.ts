import { describe, expect, it } from 'vitest';
import { assertQuoteMatchesRequiredImageModel, calculateQuotePrice, fingerprintQuoteInput, requireExplicitQuoteImageModel, validateQuoteSelection } from '../../../../src/domain/generation/GenerationQuotePolicy.js';

describe('generation quote policy', () => {
  it('2.5 cutover中は内部未指定を2.5へ固定し旧モデルの明示選択を拒否する', () => {
    const legacy = { operation: 'page_generate' } as const;
    const explicit = { ...legacy, imageModel: 'gpt-image-2.5-sunburst' };
    expect(validateQuoteSelection(legacy, 'gpt-image-2', true)).toMatchObject({
      imageModel: 'gpt-image-2.5-sunburst', providerModelId: 'gpt-image-2.5-sunburst-2026-09-08',
    });
    expect(validateQuoteSelection(explicit, 'gpt-image-2', true)).toMatchObject({
      imageModel: 'gpt-image-2.5-sunburst', providerModelId: 'gpt-image-2.5-sunburst-2026-09-08',
    });
    expect(() => validateQuoteSelection({ ...legacy, imageModel: 'gpt-image-2' }, 'gpt-image-2', true)).toThrow();
    expect(() => validateQuoteSelection(explicit, 'gpt-image-2', false)).toThrow();
  });
  it('公開quoteはcutover中に2.5の明示を要求しimport解析だけを除外する', () => {
    expect(() => requireExplicitQuoteImageModel({ operation: 'page_generate' }, 'gpt-image-2.5-sunburst')).toThrow();
    expect(() => requireExplicitQuoteImageModel({ operation: 'page_generate', imageModel: 'gpt-image-2' }, 'gpt-image-2.5-sunburst')).toThrow();
    expect(() => requireExplicitQuoteImageModel({ operation: 'page_generate', imageModel: 'gpt-image-2.5-sunburst' }, 'gpt-image-2.5-sunburst')).not.toThrow();
    expect(() => requireExplicitQuoteImageModel({ operation: 'entity_import_analysis' }, 'gpt-image-2.5-sunburst')).not.toThrow();
  });
  it('cutover後は未acceptの旧quoteを拒否し2.5 planだけ受理する', () => {
    expect(() => assertQuoteMatchesRequiredImageModel({ operation: 'page_generate', imageModel: 'gpt-image-2', providerModelId: 'gpt-image-2' }, 'gpt-image-2.5-sunburst')).toThrow();
    expect(() => assertQuoteMatchesRequiredImageModel({ operation: 'page_generate', imageModel: 'gpt-image-2.5-sunburst', providerModelId: 'gpt-image-2.5-sunburst-2026-09-08' }, 'gpt-image-2.5-sunburst')).not.toThrow();
    expect(() => assertQuoteMatchesRequiredImageModel({ operation: 'entity_import_analysis', imageModel: null, providerModelId: 'gpt-5.4-mini' }, 'gpt-image-2.5-sunburst')).not.toThrow();
  });
  it.each([0, 1, 3, 4, 12])('ページ参照%d枚の生成と再生成は既存料金を保持する', (count) => {
    for (const operation of ['page_generate', 'page_regenerate'] as const) {
      expect(calculateQuotePrice(operation, count)).toBe(3 + Math.max(0, count - 3));
    }
  });
  it.each(['entity_preview', 'entity_state_preview', 'entity_import_analysis'] as const)('%sは1creditを保持する', (operation) => {
    expect(calculateQuotePrice(operation, 1)).toBe(1);
  });
  it.each([-1, 1.5, 13, NaN])('不正な参照数%dを拒否する', (count) => {
    expect(() => calculateQuotePrice('page_generate', count)).toThrow();
  });
  it('キー順に依存せず参照・状態・描画変更をfingerprintへ反映する', () => {
    expect(fingerprintQuoteInput({ a: 1, b: ['x'] })).toBe(fingerprintQuoteInput({ b: ['x'], a: 1 }));
    expect(fingerprintQuoteInput({ a: 1, b: ['x'] })).not.toBe(fingerprintQuoteInput({ a: 1, b: ['y'] }));
  });
  it('未指定は現行GPT mediumで未知モデルと無断high化を拒否する', () => {
    expect(validateQuoteSelection({ operation: 'page_generate' }, 'gpt-image-2')).toEqual({
      imageModel: 'gpt-image-2', providerModelId: 'gpt-image-2', quality: 'medium', renderStyle: 'color',
    });
    expect(() => validateQuoteSelection({ operation: 'page_generate', imageModel: 'hy4-preview' }, 'gpt-image-2')).toThrow();
    expect(() => validateQuoteSelection({ operation: 'page_generate', quality: 'high' }, 'gpt-image-2')).toThrow();
    expect(() => validateQuoteSelection({ operation: 'page_generate' }, 'different-runtime-model')).toThrow();
    expect(validateQuoteSelection({ operation: 'entity_import_analysis' }, 'gpt-image-2')).toEqual({
      imageModel: null, providerModelId: 'gpt-5.4-mini', quality: null, renderStyle: null,
    });
  });
});
