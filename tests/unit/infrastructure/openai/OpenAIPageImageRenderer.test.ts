import { describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { OPENAI_INPUT_IMAGE_MAX_BYTES } from '../../../../src/domain/constants/imageInput.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIPageImageRenderer } from '../../../../src/infrastructure/openai/OpenAIPageImageRenderer.js';

describe('OpenAIPageImageRenderer', () => {
  it('input image がない場合は /images/generations の base64 を Buffer に変換する', async () => {
    const postJson = vi.fn().mockResolvedValue({
      body: {
        data: [
          {
            b64_json: Buffer.from('png-bytes').toString('base64'),
          },
        ],
      },
      requestId: 'req-1',
    });
    const client = {
      postJson,
      postFormData: vi.fn(),
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
      inputImages: [],
    });

    expect(result).toEqual({
      imageData: Buffer.from('png-bytes'),
      mimeType: 'image/png',
      openaiRequestId: 'req-1',
      costUsd: null,
    });
    expect(postJson).toHaveBeenCalledWith(
      '/images/generations',
      expect.objectContaining({
        model: 'gpt-image-2',
      }),
    );
  });

  it('input image がある場合は /images/edits に multipart で送る', async () => {
    let capturedBody: RequestInit['body'] | undefined;
    const client = new OpenAIClient({
      apiKey: 'test',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn: async (_input, init) => {
        capturedBody = init?.body;

        return new Response(
          JSON.stringify({
            data: [
              {
                b64_json: Buffer.from('png-bytes').toString('base64'),
              },
            ],
          }),
          {
            status: 200,
            headers: { 'x-request-id': 'req-1', 'Content-Type': 'application/json' },
          },
        );
      },
      maxRetries: 1,
    });
    const renderer = new OpenAIPageImageRenderer(client);

    await renderer.render({
      jobId: 'job-1',
      userId: 'user-1',
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'standard',
      prompt: 'page prompt',
      quality: 'medium',
      internalPlan: null,
      inputImages: [{ role: 'entity_reference', label: 'Aoi', dataUrl: 'data:image/png;base64,cmVm' }],
    });

    expect(capturedBody).toBeInstanceOf(FormData);
    const formData = capturedBody as FormData;
    expect(formData.get('model')).toBe('gpt-image-2');
    expect(formData.getAll('image[]')).toHaveLength(1);
    const imageBlob = formData.getAll('image[]')[0];
    expect(imageBlob).toBeInstanceOf(File);
    expect((imageBlob as File).name).toBe('aoi.png');
  });

  it('unsupported input image MIME は OpenAI 呼び出し前に拒否する', async () => {
    const client = new OpenAIClient({
      apiKey: 'test',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn: async () => {
        throw new Error('fetch should not be called');
      },
      maxRetries: 1,
    });
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
        inputImages: [{ role: 'entity_reference', label: 'Aoi', dataUrl: 'data:text/plain;base64,cmVm' }],
      }),
    ).rejects.toEqual(new ConfigurationError('OpenAI image renderer received an unsupported image input type'));
  });

  it('empty input image は OpenAI 呼び出し前に拒否する', async () => {
    const client = new OpenAIClient({
      apiKey: 'test',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn: async () => {
        throw new Error('fetch should not be called');
      },
      maxRetries: 1,
    });
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
        inputImages: [{ role: 'entity_reference', label: 'Aoi', dataUrl: 'data:image/png;base64,====' }],
      }),
    ).rejects.toEqual(new ConfigurationError('OpenAI image renderer received an empty image input'));
  });

  it('too large input image は OpenAI 呼び出し前に拒否する', async () => {
    const client = new OpenAIClient({
      apiKey: 'test',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn: async () => {
        throw new Error('fetch should not be called');
      },
      maxRetries: 1,
    });
    const renderer = new OpenAIPageImageRenderer(client);
    const dataUrl = `data:image/png;base64,${Buffer.alloc(OPENAI_INPUT_IMAGE_MAX_BYTES + 1).toString('base64')}`;

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
        inputImages: [{ role: 'entity_reference', label: 'Aoi', dataUrl }],
      }),
    ).rejects.toEqual(new ConfigurationError('OpenAI image renderer received an input image that is too large'));
  });

  it('画像データが返らない場合は ConfigurationError を投げる', async () => {
    const client = {
      postJson: vi.fn().mockResolvedValue({
        body: { data: [] },
        requestId: 'req-1',
      }),
      postFormData: vi.fn(),
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

  it('画像データが base64 として空にしか decode できない場合は ConfigurationError を投げる', async () => {
    const client = {
      postJson: vi.fn().mockResolvedValue({
        body: { data: [{ b64_json: '====' }] },
        requestId: 'req-1',
      }),
      postFormData: vi.fn(),
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
    ).rejects.toEqual(new ConfigurationError('OpenAI image renderer returned invalid image data'));
  });
});
