import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';

describe('OpenAIClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('5xx の後に成功した場合はリトライする', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'temporary failure' } }), { status: 500 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'response-1' }), {
          status: 200,
          headers: { 'x-request-id': 'req-1' },
        }),
      );
    const client = new OpenAIClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn,
    });

    const response = await client.postJson<{ id: string }>('/responses', {
      model: 'gpt-5.4-mini',
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(response).toEqual({
      body: { id: 'response-1' },
      requestId: 'req-1',
    });
  });

  it('4xx は ConfigurationError を返す', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 }),
    );
    const client = new OpenAIClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn,
    });

    await expect(
      client.postJson('/responses', {
        model: 'gpt-5.4-mini',
      }),
    ).rejects.toEqual(new ConfigurationError('bad request'));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('4xx の provider error に含まれる機密値を伏せる', async () => {
    const fakeApiKey = ['sk', 'test-secret'].join('-');
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: `bad request Authorization: Bearer ${fakeApiKey} X-Amz-Signature=abc123`,
          },
        }),
        { status: 400 },
      ),
    );
    const client = new OpenAIClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn,
    });

    await expect(client.postJson('/responses', { model: 'gpt-5.4-mini' })).rejects.toEqual(
      new ConfigurationError(
        'bad request Authorization: Bearer [redacted] X-Amz-Signature=[redacted]',
      ),
    );
  });

  it('multipart request を送信できる', async () => {
    let capturedBody: RequestInit['body'] | undefined;
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      capturedBody = init?.body;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'x-request-id': 'req-form' },
      });
    });
    const client = new OpenAIClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn,
    });

    const response = await client.postFormData<{ ok: boolean }>('/images/edits', () => {
      const formData = new FormData();
      formData.append('model', 'gpt-image-1-mini');
      formData.append('prompt', 'draw');
      return formData;
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(capturedBody).toBeInstanceOf(FormData);
    expect(response).toEqual({
      body: { ok: true },
      requestId: 'req-form',
    });
  });

  it('maxRetries が 1 の場合は 5xx を自動リトライしない', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'temporary failure' } }), { status: 500 }),
    );
    const client = new OpenAIClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn,
      maxRetries: 1,
    });

    await expect(
      client.postJson('/images/generations', {
        model: 'gpt-image-2',
      }),
    ).rejects.toEqual(new ConfigurationError('temporary failure'));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('maxRetries が 1 の場合は timeout を自動リトライしない', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const client = new OpenAIClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1,
      fetchFn,
      maxRetries: 1,
    });

    await expect(
      client.postJson('/images/generations', {
        model: 'gpt-image-2',
      }),
    ).rejects.toEqual(new ConfigurationError('OpenAI request timed out'));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('timeout は通常設定でも自動リトライしない', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const client = new OpenAIClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1,
      fetchFn,
    });

    await expect(
      client.postJson('/responses', {
        model: 'gpt-4o-2024-08-06',
      }),
    ).rejects.toEqual(new ConfigurationError('OpenAI request timed out'));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('insufficient quota の 429 は自動リトライしない', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'insufficient_quota',
            message: 'You exceeded your current quota, please check your plan and billing details.',
          },
        }),
        { status: 429 },
      ),
    );
    const client = new OpenAIClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn,
    });

    await expect(client.postJson('/responses', { model: 'gpt-4o-2024-08-06' })).rejects.toEqual(
      new ConfigurationError('You exceeded your current quota, please check your plan and billing details.'),
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rate limit の 429 は成功するまでリトライする', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'rate_limit_exceeded',
              message: 'Rate limit reached for requests.',
            },
          }),
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'response-2' }), {
          status: 200,
          headers: { 'x-request-id': 'req-2' },
        }),
      );
    const client = new OpenAIClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn,
    });

    const response = await client.postJson<{ id: string }>('/responses', {
      model: 'gpt-4o-2024-08-06',
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(response.body.id).toBe('response-2');
  });
});
