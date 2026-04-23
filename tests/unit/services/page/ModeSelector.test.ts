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
    it('initial standard は medium 品質と10crになる', () => {
      const result = selector.selectProfile({
        entityCount: 4,
        panelCount: 8,
        requestKind: 'initial',
      });

      expect(result).toEqual({
        requestKind: 'initial',
        mode: 'standard',
        quality: 'medium',
        creditCost: 10,
        requiresPlanner: false,
      });
    });

    it('initial thinking は medium 品質と14crになる', () => {
      const result = selector.selectProfile({
        entityCount: 5,
        panelCount: 8,
        requestKind: 'initial',
      });

      expect(result).toEqual({
        requestKind: 'initial',
        mode: 'thinking',
        quality: 'medium',
        creditCost: 14,
        requiresPlanner: true,
      });
    });

    it('regenerate は high 品質と22crになりplannerを使う', () => {
      const result = selector.selectProfile({
        entityCount: 1,
        panelCount: 3,
        requestKind: 'regenerate',
      });

      expect(result).toEqual({
        requestKind: 'regenerate',
        mode: 'standard',
        quality: 'high',
        creditCost: 22,
        requiresPlanner: true,
      });
    });
  });
});
