import { describe, expect, it } from 'vitest';
import { buildStoryManuscriptImprovementPlan } from '../../../../src/services/story/StoryManuscriptImprovement.js';

describe('command-preserving writer limits', () => {
  it('4節の合計256部分は改善可能で、それ以上はprovider呼び出し前に拒否する', () => {
    const draft = (count: number) => {
      const section = Array.from({ length: count }, (_, index) => `場面${index}。`).join('\n---\n');
      return { title: null, purpose: null, storyInputMode: 'structured' as const, storyFullDraft: null,
        introduction: section, middle: section, climax: section, endingHook: section };
    };
    expect(buildStoryManuscriptImprovementPlan(draft(64))?.editableFragments).toHaveLength(256);
    expect(() => buildStoryManuscriptImprovementPlan(draft(65))).toThrow('256');
  });
});
