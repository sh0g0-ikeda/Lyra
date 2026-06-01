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
});
