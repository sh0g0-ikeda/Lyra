import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';

describe('OpenAIClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('5xx後の再試行で成功した場合はレスポンスを返す', async () => {
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

  it('4xxは再試行せずConfigurationErrorを投げる', async () => {
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
});
