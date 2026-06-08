import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { AnthropicClient } from '../../../../src/infrastructure/anthropic/AnthropicClient.js';

describe('AnthropicClient', () => {
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
        new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
          status: 200,
          headers: { 'request-id': 'anthropic-req-1' },
        }),
      );
    const client = new AnthropicClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.anthropic.test',
      apiVersion: '2023-06-01',
      timeoutMs: 1000,
      fetchFn,
    });

    const response = await client.createMessageText({ model: 'claude-sonnet-4-20250514' });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(response).toEqual({ text: 'ok', requestId: 'anthropic-req-1' });
  });

  it('timeout は自動リトライしない', async () => {
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
    const client = new AnthropicClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.anthropic.test',
      apiVersion: '2023-06-01',
      timeoutMs: 1,
      fetchFn,
    });

    await expect(client.createMessageText({ model: 'claude-sonnet-4-20250514' })).rejects.toEqual(
      new ConfigurationError('Anthropic request timed out'),
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
