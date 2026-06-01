import { describe, expect, it } from 'vitest';
import { LocalPreviewEntityReferenceGenerator } from '../../../../src/infrastructure/local/LocalPreviewEntityReferenceGenerator.js';

describe('LocalPreviewEntityReferenceGenerator', () => {
  it('returns one local preview candidate', async () => {
    const generator = new LocalPreviewEntityReferenceGenerator();

    const result = await generator.generateCandidates({
      prompt: 'Full-body reference of a scarred knight in a weathered black coat.',
      inputImages: [],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.mimeType).toBe('image/png');
    expect(result.candidates[0]?.imageData.length ?? 0).toBeGreaterThan(0);
    expect(result.costUsd).toBe(0);
  });
});
