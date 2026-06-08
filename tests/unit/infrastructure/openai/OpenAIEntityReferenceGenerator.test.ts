import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIEntityReferenceGenerator } from '../../../../src/infrastructure/openai/OpenAIEntityReferenceGenerator.js';

describe('OpenAIEntityReferenceGenerator', () => {
  it('source image がない場合は /images/generations で 1 candidate を生成する', async () => {
    let callCount = 0;
    const requestBodies: string[] = [];
    const client = new OpenAIClient({
      apiKey: 'test',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn: async (_input, init) => {
        callCount += 1;
        requestBodies.push(typeof init?.body === 'string' ? init.body : '');

        return new Response(
          JSON.stringify({
            data: [
              {
                b64_json: Buffer.from(`image-${callCount}`).toString('base64'),
              },
            ],
          }),
          {
            status: 200,
            headers: { 'x-request-id': `req-${callCount}`, 'Content-Type': 'application/json' },
          },
        );
      },
      maxRetries: 1,
    });
    const generator = new OpenAIEntityReferenceGenerator(client);

    const result = await generator.generateCandidates({ prompt: 'entity prompt', inputImages: [] });

    expect(callCount).toBe(1);
    expect(result.openaiRequestId).toBe('req-1');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.mimeType).toBe('image/png');
    expect(requestBodies[0]).toContain('"size":"1024x1536"');
  });

  it('source image がある場合は /images/edits に multipart で送る', async () => {
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
                b64_json: Buffer.from('image-1').toString('base64'),
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
    const generator = new OpenAIEntityReferenceGenerator(client);

    await generator.generateCandidates({
      prompt: 'entity prompt',
      inputImages: [{ dataUrl: 'data:image/png;base64,cmVm' }],
    });

    expect(capturedBody).toBeInstanceOf(FormData);
    const formData = capturedBody as FormData;
    expect(formData.get('model')).toBe('gpt-image-2');
    expect(formData.get('prompt')).toBeTypeOf('string');
    expect(formData.getAll('image[]')).toHaveLength(1);
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
    const generator = new OpenAIEntityReferenceGenerator(client);

    await expect(
      generator.generateCandidates({
        prompt: 'entity prompt',
        inputImages: [{ dataUrl: 'data:text/plain;base64,cmVm' }],
      }),
    ).rejects.toEqual(
      new ConfigurationError('Entity reference generator received an unsupported image input type'),
    );
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
    const generator = new OpenAIEntityReferenceGenerator(client);

    await expect(
      generator.generateCandidates({
        prompt: 'entity prompt',
        inputImages: [{ dataUrl: 'data:image/png;base64,====' }],
      }),
    ).rejects.toEqual(new ConfigurationError('Entity reference generator received an empty image input'));
  });

  it('画像データが base64 として空にしか decode できない場合は ConfigurationError を投げる', async () => {
    const client = new OpenAIClient({
      apiKey: 'test',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                b64_json: '====',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'x-request-id': 'req-1', 'Content-Type': 'application/json' },
          },
        ),
      maxRetries: 1,
    });
    const generator = new OpenAIEntityReferenceGenerator(client);

    await expect(
      generator.generateCandidates({
        prompt: 'entity prompt',
        inputImages: [],
      }),
    ).rejects.toEqual(new ConfigurationError('Entity reference generator returned invalid image data'));
  });
});
