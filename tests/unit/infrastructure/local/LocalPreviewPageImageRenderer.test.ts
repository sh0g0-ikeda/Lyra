import { describe, expect, it } from 'vitest';
import { LocalPreviewPageImageRenderer } from '../../../../src/infrastructure/local/LocalPreviewPageImageRenderer.js';

describe('LocalPreviewPageImageRenderer', () => {
  it('returns a png preview for local page generation fallback', async () => {
    const renderer = new LocalPreviewPageImageRenderer();

    const result = await renderer.render({
      jobId: 'job-1',
      userId: 'user-1',
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'standard',
      prompt: 'A knight stands in a ruined town square at dusk.',
      quality: 'medium',
      internalPlan: null,
      inputImages: [],
    });

    expect(result.mimeType).toBe('image/png');
    expect(result.imageData.length).toBeGreaterThan(0);
    expect(result.costUsd).toBe(0);
  });
});
