import { describe, expect, it, vi } from 'vitest';
import { ConfigurationError, ValidationError } from '../../../../src/domain/errors/index.js';
import { OPENAI_INPUT_IMAGE_MAX_BYTES } from '../../../../src/domain/constants/imageInput.js';
import { PAGE_IMAGE_PROMPT_MAX_CHARACTERS } from '../../../../src/domain/constants/generation.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIPageImageRenderer } from '../../../../src/infrastructure/openai/OpenAIPageImageRenderer.js';
import { PAGE_VISUAL_INTEGRITY_POLICY } from '../../../../src/services/page/PageVisualPolicy.js';
import { buildPersistedPromptDiagnostics } from '../../../../src/lib/promptDiagnostics.js';

describe('OpenAIPageImageRenderer', () => {
  it('ポリシーを含む最終プロンプトが上限ちょうどなら /images/generations を呼ぶ', async () => {
    const postJson = vi.fn().mockResolvedValue({
      body: { data: [{ b64_json: Buffer.from('png-bytes').toString('base64') }] },
      requestId: 'req-1',
    });
    const renderer = new OpenAIPageImageRenderer({ postJson, postFormData: vi.fn() } as unknown as OpenAIClient);
    const prompt = 'a'.repeat(PAGE_IMAGE_PROMPT_MAX_CHARACTERS - Array.from(PAGE_VISUAL_INTEGRITY_POLICY).length - 2);

    await renderer.render({
      jobId: 'job-1', userId: 'user-1', pageId: 'page-1', requestKind: 'initial',
      generationMode: 'standard', prompt, quality: 'medium', internalPlan: null, inputImages: [],
    });

    const request = postJson.mock.calls[0]?.[1] as { prompt: string };
    expect(Array.from(request.prompt)).toHaveLength(PAGE_IMAGE_PROMPT_MAX_CHARACTERS);
  });

  it('ポリシーを含む最終プロンプトが1文字超過なら provider 呼出し前に拒否する', async () => {
    const postJson = vi.fn();
    const renderer = new OpenAIPageImageRenderer({ postJson, postFormData: vi.fn() } as unknown as OpenAIClient);
    const prompt = 'a'.repeat(PAGE_IMAGE_PROMPT_MAX_CHARACTERS - Array.from(PAGE_VISUAL_INTEGRITY_POLICY).length - 1);

    await expect(renderer.render({
      jobId: 'job-1', userId: 'user-1', pageId: 'page-1', requestKind: 'initial',
      generationMode: 'standard', prompt, quality: 'medium', internalPlan: null, inputImages: [],
    })).rejects.toEqual(new ValidationError('Page image prompt exceeds the provider character limit'));
    expect(postJson).not.toHaveBeenCalled();
  });

  it('任意の内部計画だけが上限を超える場合は本文を残して計画を外す', async () => {
    const postJson = vi.fn().mockResolvedValue({
      body: { data: [{ b64_json: Buffer.from('png-bytes').toString('base64') }] },
      requestId: 'req-1',
    });
    const renderer = new OpenAIPageImageRenderer({ postJson, postFormData: vi.fn() } as unknown as OpenAIClient);
    const prompt = 'authored base text';

    await renderer.render({
      jobId: 'job-1', userId: 'user-1', pageId: 'page-1', requestKind: 'initial',
      generationMode: 'thinking', prompt, quality: 'high', internalPlan: 'p'.repeat(PAGE_IMAGE_PROMPT_MAX_CHARACTERS), inputImages: [],
    });

    const request = postJson.mock.calls[0]?.[1] as { prompt: string };
    expect(request.prompt).toBe(`${prompt}\n\n${PAGE_VISUAL_INTEGRITY_POLICY}`);
  });

  it('/images/edits でも上限超過を provider 呼出し前に拒否する', async () => {
    const postFormData = vi.fn();
    const renderer = new OpenAIPageImageRenderer({ postJson: vi.fn(), postFormData } as unknown as OpenAIClient);
    const prompt = 'a'.repeat(PAGE_IMAGE_PROMPT_MAX_CHARACTERS - Array.from(PAGE_VISUAL_INTEGRITY_POLICY).length - 1);

    await expect(renderer.render({
      jobId: 'job-1', userId: 'user-1', pageId: 'page-1', requestKind: 'initial',
      generationMode: 'standard', prompt, quality: 'medium', internalPlan: null,
      inputImages: [{ role: 'entity_reference', label: 'Aoi', dataUrl: 'data:image/png;base64,cmVm' }],
    })).rejects.toEqual(new ValidationError('Page image prompt exceeds the provider character limit'));
    expect(postFormData).not.toHaveBeenCalled();
  });

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
      providerPromptSha256: '08a7d981768296dea5e955fc886b53c0957dae39f9f17c318b9ecb027b5f79f2',
      providerPromptBytes: 1440,
    });
    expect(postJson).toHaveBeenCalledWith(
      '/images/generations',
      expect.objectContaining({
        model: 'gpt-image-2',
      }),
    );
    const request = postJson.mock.calls[0]?.[1] as { prompt: string };
    expect(request.prompt).toContain(PAGE_VISUAL_INTEGRITY_POLICY);
    expect(request.prompt.match(new RegExp(PAGE_VISUAL_INTEGRITY_POLICY, 'g'))).toHaveLength(1);
    expect(request.prompt).toBe(`page prompt\n\nInternal generation plan:\nkeep panel 1 wide\n\n${PAGE_VISUAL_INTEGRITY_POLICY}`);
    expect(result).toMatchObject({
      providerPromptSha256: buildPersistedPromptDiagnostics(request.prompt).sha256,
      providerPromptBytes: buildPersistedPromptDiagnostics(request.prompt).bytes,
    });
  });

  it('計画にポリシーが含まれていても最終プロンプトに一度だけ保持する', async () => {
    const postJson = vi.fn().mockResolvedValue({
      body: { data: [{ b64_json: Buffer.from('png-bytes').toString('base64') }] },
      requestId: 'req-1',
    });
    const renderer = new OpenAIPageImageRenderer({
      postJson,
      postFormData: vi.fn(),
    } as unknown as OpenAIClient);

    const result = await renderer.render({
      jobId: 'job-1', userId: 'user-1', pageId: 'page-1', requestKind: 'initial',
      generationMode: 'thinking', prompt: `page prompt\n\n${PAGE_VISUAL_INTEGRITY_POLICY}`,
      quality: 'high', internalPlan: `plan\n${PAGE_VISUAL_INTEGRITY_POLICY}`, inputImages: [],
    });

    const request = postJson.mock.calls[0]?.[1] as { prompt: string };
    expect(request.prompt.match(new RegExp(PAGE_VISUAL_INTEGRITY_POLICY, 'g'))).toHaveLength(1);
    expect(request.prompt).toBe(`page prompt\n\nInternal generation plan:\nplan\n\n${PAGE_VISUAL_INTEGRITY_POLICY}`);
    expect(result.providerPromptSha256).toBe(buildPersistedPromptDiagnostics(request.prompt).sha256);
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

    const result = await renderer.render({
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
    const prompt = formData.get('prompt');
    expect(typeof prompt).toBe('string');
    expect(result).toMatchObject({
      providerPromptSha256: buildPersistedPromptDiagnostics(prompt as string).sha256,
      providerPromptBytes: buildPersistedPromptDiagnostics(prompt as string).bytes,
    });
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
