import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../../src/domain/errors/index.js';
import { ModeSelector } from '../../../../src/services/page/ModeSelector.js';

describe('ModeSelector', () => {
  const selector = new ModeSelector();

  describe('selectMode', () => {
    it('エンティティ数4・コマ数8はstandardになる', () => {
      const result = selector.selectMode({ entityCount: 4, panelCount: 8 });

      expect(result).toBe('standard');
    });

    it('エンティティ数5はthinkingになる', () => {
      const result = selector.selectMode({ entityCount: 5, panelCount: 4 });

      expect(result).toBe('thinking');
    });

    it('コマ数9はthinkingになる', () => {
      const result = selector.selectMode({ entityCount: 2, panelCount: 9 });

      expect(result).toBe('thinking');
    });

    it('負の件数はVALIDATION_ERRORになる', () => {
      expect(() => selector.selectMode({ entityCount: -1, panelCount: 4 })).toThrow(ValidationError);
    });
  });

  describe('selectProfile', () => {
    it('initial standard は medium 品質と3crになる', () => {
      const result = selector.selectProfile({
        entityCount: 4,
        panelCount: 8,
        requestKind: 'initial',
        billableReferenceCount: 3,
      });

      expect(result).toEqual({
        requestKind: 'initial',
        mode: 'standard',
        quality: 'medium',
        creditCost: 3,
        billableReferenceCount: 3,
        requiresPlanner: false,
      });
    });

    it('4枚目以降の参照画像は1枚ごとに1crを追加する', () => {
      const result = selector.selectProfile({
        entityCount: 4,
        panelCount: 8,
        requestKind: 'initial',
        billableReferenceCount: 4,
      });

      expect(result.creditCost).toBe(4);
      expect(result.billableReferenceCount).toBe(4);
    });

    it('initial thinking は medium 品質で参照数に応じたcrになる', () => {
      const result = selector.selectProfile({
        entityCount: 5,
        panelCount: 8,
        requestKind: 'initial',
        billableReferenceCount: 5,
      });

      expect(result).toEqual({
        requestKind: 'initial',
        mode: 'thinking',
        quality: 'medium',
        creditCost: 5,
        billableReferenceCount: 5,
        requiresPlanner: true,
      });
    });

    it('regenerate standard は medium 品質で planner を強制しない', () => {
      const result = selector.selectProfile({
        entityCount: 1,
        panelCount: 3,
        requestKind: 'regenerate',
        billableReferenceCount: 1,
      });

      expect(result).toEqual({
        requestKind: 'regenerate',
        mode: 'standard',
        quality: 'medium',
        creditCost: 3,
        billableReferenceCount: 1,
        requiresPlanner: false,
      });
    });

    it('regenerate thinking は complexity に応じて planner を使う', () => {
      const result = selector.selectProfile({
        entityCount: 5,
        panelCount: 3,
        requestKind: 'regenerate',
        billableReferenceCount: 5,
      });

      expect(result).toEqual({
        requestKind: 'regenerate',
        mode: 'thinking',
        quality: 'medium',
        creditCost: 5,
        billableReferenceCount: 5,
        requiresPlanner: true,
      });
    });

    it('負の参照画像数はVALIDATION_ERRORになる', () => {
      expect(() =>
        selector.selectProfile({
          entityCount: 1,
          panelCount: 3,
          requestKind: 'initial',
          billableReferenceCount: -1,
        }),
      ).toThrow(ValidationError);
    });
  });
});
