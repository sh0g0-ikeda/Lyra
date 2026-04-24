import { describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIPageImageRenderer } from '../../../../src/infrastructure/openai/OpenAIPageImageRenderer.js';

describe('OpenAIPageImageRenderer', () => {
  it('base64画像をBufferに変換して返す', async () => {
    const postJson = vi.fn().mockResolvedValue({
      body: {
        output: [
          {
            type: 'image_generation_call',
            result: Buffer.from('png-bytes').toString('base64'),
          },
        ],
      },
      requestId: 'req-1',
    });
    const client = {
      postJson,
    } as unknown as OpenAIClient;
    const renderer = new OpenAIPageImageRenderer(client);

    const result = await renderer.render({
      jobId: 'job-1',
      userId: 'user-1',
      pageId: 'page-1',
      requestKind: 'initial',
        generationMode: 'standard',
        prompt: 'page prompt',
        quality: 'medium',
        internalPlan: 'keep panel 1 wide',
        inputImages: [{ role: 'entity_reference', dataUrl: 'data:image/png;base64,cmVm' }],
      });

    expect(result).toEqual({
      imageData: Buffer.from('png-bytes'),
      mimeType: 'image/png',
      openaiRequestId: 'req-1',
      costUsd: null,
    });
    expect(postJson).toHaveBeenCalledWith('/responses', expect.objectContaining({
      model: 'gpt-image-2',
    }));
  });

  it('画像が無い場合はConfigurationErrorを投げる', async () => {
    const client = {
      postJson: vi.fn().mockResolvedValue({
        body: { output: [] },
        requestId: 'req-1',
      }),
    } as unknown as OpenAIClient;
    const renderer = new OpenAIPageImageRenderer(client);

    await expect(
      renderer.render({
        jobId: 'job-1',
        userId: 'user-1',
        pageId: 'page-1',
        requestKind: 'initial',
        generationMode: 'standard',
        prompt: 'page prompt',
        quality: 'medium',
        internalPlan: null,
        inputImages: [],
      }),
    ).rejects.toEqual(new ConfigurationError('OpenAI image renderer returned no image data'));
  });
});
