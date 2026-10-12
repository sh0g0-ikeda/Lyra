import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { requestStructuredOpenAIResponse } from '../../../../src/infrastructure/openai/StructuredOpenAIResponse.js';

// Audit capacity must be measured without storing authored text, provider output,
// credentials, or request IDs. Observability must never change retry/validation.
describe('原文照合の安全な容量計測', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('照合成功の場合に本文を出さず使用量と処理時間だけを記録する', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    await expect(request(body({ input_tokens: 120, output_tokens: 90,
      input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 70 } })))
      .resolves.toEqual({ ok: true });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('episode_plan_audit_request_metrics', expect.objectContaining({
      schemaName: 'episode_plan_audit', status: 'completed', incompleteReason: null,
      inputTokens: 120, cachedInputTokens: 40, outputTokens: 90, reasoningTokens: 70,
      inputCharacters: 27, maxOutputTokens: 20_000,
    }));
    const metrics = log.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(metrics.elapsedMs).toEqual(expect.any(Number));
    expect(metrics.schemaBytes).toEqual(expect.any(Number));
    const recorded = JSON.stringify(log.mock.calls);
    expect(recorded).not.toContain('private-source');
    expect(recorded).not.toContain('private-provider');
    expect(recorded).not.toContain('private-request');
  });

  it('出力上限に達した場合に使用量を記録して元の再試行可能な失敗を維持する', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    await expect(request({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
      usage: { input_tokens: 120, output_tokens: 20_000,
        output_tokens_details: { reasoning_tokens: 19_500 } }, output_text: 'private-provider' }))
      .rejects.toMatchObject({ reason: 'incomplete_max_output_tokens', retryable: true });
    expect(log).toHaveBeenCalledWith('episode_plan_audit_request_metrics', expect.objectContaining({
      status: 'incomplete', incompleteReason: 'max_output_tokens', outputTokens: 20_000, reasoningTokens: 19_500,
    }));
  });

  it('欠損または不正な使用量の場合にゼロと推定せずnullを記録する', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    await request(body({ input_tokens: -1, output_tokens: 'private-provider',
      input_tokens_details: { cached_tokens: 1.5 }, output_tokens_details: { reasoning_tokens: Infinity } }));
    expect(log).toHaveBeenCalledWith('episode_plan_audit_request_metrics', expect.objectContaining({
      inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null,
    }));
  });

  it('ログが失敗した場合にも正常な結果と検証失敗を変えない', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('log failure'); });
    await expect(request(body())).resolves.toEqual({ ok: true });
    await expect(request({ status: 'completed', output_text: 'private-provider' }))
      .rejects.toMatchObject({ reason: 'invalid_json', retryable: true });
  });

  it('照合以外のスキーマの場合に新しい計測ログを追加しない', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    await request(body(), 'page_autofill');
    expect(log).not.toHaveBeenCalled();
  });

  it.each(['episode_plan_audit_coverage', 'episode_plan_audit_quote_correction'])(
    '%sの場合に引用修正の使用量も記録する', async (schemaName) => {
      const log = vi.spyOn(console, 'info').mockImplementation(() => {});
      await request(body(), schemaName);
      expect(log).toHaveBeenCalledWith('episode_plan_audit_request_metrics', expect.objectContaining({
        schemaName, status: 'completed', inputTokens: null, reasoningTokens: null,
      }));
    },
  );

  it('通信失敗の場合に本文や例外を出さず失敗時間を記録する', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const failure = new Error('private-provider');
    const client = { postJson: async () => { throw failure; } } as unknown as OpenAIClient;
    await expect(request(body(), 'episode_plan_audit', client)).rejects.toBe(failure);
    expect(log).toHaveBeenCalledWith('episode_plan_audit_request_metrics', expect.objectContaining({
      status: 'request_failed', inputTokens: null, outputTokens: null, reasoningTokens: null,
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-provider');
  });
});

function body(usage?: Record<string, unknown>): Record<string, unknown> {
  return { status: 'completed', output_text: '{"ok":true}', usage };
}

function request(responseBody: Record<string, unknown>, schemaName = 'episode_plan_audit', injected?: OpenAIClient): Promise<{ ok: boolean }> {
  const client = injected ?? { postJson: async () => ({ body: responseBody, requestId: 'private-request' }) } as unknown as OpenAIClient;
  return requestStructuredOpenAIResponse({ client, model: 'gpt-test', schemaName,
    maxOutputTokens: 20_000, jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    responseSchema: z.object({ ok: z.boolean() }), errorLabel: 'Audit test',
    input: [{ role: 'system', content: [{ type: 'input_text', text: 'Audit rules.' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'private-source.' }] }],
  });
}
