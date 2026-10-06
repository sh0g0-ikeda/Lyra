import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  prepareEpisodeSourceRequirementExtraction,
  validateEpisodeSourceRequirements,
  type EpisodeSourceRequirement,
  type EpisodeSourceRequirementExtraction,
  type EpisodeSourceRequirements,
} from '../../../../src/services/page/EpisodeSourceRequirements.js';

function extractionWithUnitCount(unitCount: number): EpisodeSourceRequirementExtraction {
  const sentences = Array.from({ length: unitCount }, (_, index) =>
    `ココは第${index + 1}の道で灯台へ向かい安全を確かめながら一歩ずつ進む。`);
  const extraction = prepareEpisodeSourceRequirementExtraction({
    storyFullDraft: `1ページ目：${sentences.join('')}`,
    pages: [{ pageId: '11111111-1111-4111-8111-111111111111', pageNumber: 1 }],
  });
  expect(extraction).not.toBeNull();
  return extraction!;
}

function exactRequirements(extraction: EpisodeSourceRequirementExtraction): EpisodeSourceRequirements {
  return {
    requirements: extraction.units
      .filter((unit) => unit.text.trim().length > 0)
      .map((unit, index): EpisodeSourceRequirement => {
        const event = unit.text.trim();
        return {
          requirementId: `r${index + 1}`,
          scope: unit.scope,
          pageId: unit.pageId,
          pageNumber: unit.pageNumber,
          sourceUnitIds: [unit.unitId],
          order: index + 1,
          events: [event],
          results: [],
          afterRequirementIds: [],
          conditionalUntil: null,
          requiredByEnd: true,
          context: null,
          emotion: null,
          function: null,
          camera: null,
          framing: null,
          quotedText: [],
          obligations: [{ event, result: null, conditionalUntil: null, requiredByEnd: true }],
        };
      }),
  };
}

describe('source requirement decode後の内部byte budget', () => {
  it('provider packを個別検証済みの原文復元結果は64KBを超えても全unitをmergeできる', () => {
    const extraction = extractionWithUnitCount(120);
    const requirements = exactRequirements(extraction);
    expect(Buffer.byteLength(JSON.stringify(requirements), 'utf8')).toBeGreaterThan(64_000);
    expect(validateEpisodeSourceRequirements(extraction, requirements)).toEqual(requirements);
  });

  it('短いextractionから導ける最大復元形状を超える内部objectは絶対上限未満でも拒否する', () => {
    const extraction = extractionWithUnitCount(1);
    const requirements = exactRequirements(extraction);
    requirements.requirements[0]!.events = ['x'.repeat(10_000)];
    expect(Buffer.byteLength(JSON.stringify(requirements), 'utf8')).toBeLessThan(64_000);
    expect(() => validateEpisodeSourceRequirements(extraction, requirements))
      .toThrow('Source requirements exceeded the structured output budget');
  });
});
