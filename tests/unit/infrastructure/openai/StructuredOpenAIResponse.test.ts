import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import {
  requestStructuredOpenAIResponse,
  StructuredOpenAIResponseError,
} from '../../../../src/infrastructure/openai/StructuredOpenAIResponse.js';

describe('requestStructuredOpenAIResponse', () => {
  it('invalid JSON のエラーに provider 出力本文を含めない', async () => {
    const client = {
      postJson: async () => ({
        body: {
          output_text: '{"pages":[{"secret":"user story draft that should not be echoed"',
        },
        requestId: 'req-1',
      }),
    } as unknown as OpenAIClient;

    await expect(
      requestStructuredOpenAIResponse({
        client,
        model: 'gpt-test',
        maxOutputTokens: 100,
        schemaName: 'test_schema',
        jsonSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
          },
        },
        responseSchema: z.object({ ok: z.boolean() }),
        errorLabel: 'OpenAI test compiler',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Return JSON.' }],
          },
        ],
      }),
    ).rejects.toThrow('OpenAI test compiler returned invalid JSON');

    await expect(
      requestStructuredOpenAIResponse({
        client,
        model: 'gpt-test',
        maxOutputTokens: 100,
        schemaName: 'test_schema',
        jsonSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: {
            ok: { type: 'boolean' },
          },
        },
        responseSchema: z.object({ ok: z.boolean() }),
        errorLabel: 'OpenAI test compiler',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Return JSON.' }],
          },
        ],
      }),
    ).rejects.not.toThrow('user story draft');
  });

  it('出力上限で incomplete の場合に本文を解析せず再試行可能として分類する', async () => {
    const client = buildClient({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output_text: '{"ok":',
    }, 'req-incomplete');

    const error = await captureStructuredError(client);

    expect(error).toBeInstanceOf(StructuredOpenAIResponseError);
    expect(error).toMatchObject({
      reason: 'incomplete_max_output_tokens',
      retryable: true,
      requestId: 'req-incomplete',
    });
    expect(error.message).not.toContain('{"ok":');
  });

  it('refusal の場合は再試行せず provider 本文を公開しない', async () => {
    const client = buildClient({
      status: 'completed',
      output: [
        {
          content: [
            {
              type: 'refusal',
              refusal: 'private provider refusal detail',
            },
          ],
        },
      ],
    }, 'req-refusal');

    const error = await captureStructuredError(client);

    expect(error).toMatchObject({
      reason: 'refusal',
      retryable: false,
      requestId: 'req-refusal',
    });
    expect(error.message).not.toContain('private provider refusal detail');
  });
});

function buildClient(body: Record<string, unknown>, requestId: string): OpenAIClient {
  return {
    postJson: async () => ({ body, requestId }),
  } as unknown as OpenAIClient;
}

async function captureStructuredError(client: OpenAIClient): Promise<Error> {
  try {
    await requestStructuredOpenAIResponse({
      client,
      model: 'gpt-test',
      maxOutputTokens: 100,
      schemaName: 'test_schema',
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok'],
        properties: { ok: { type: 'boolean' } },
      },
      responseSchema: z.object({ ok: z.boolean() }),
      errorLabel: 'OpenAI test compiler',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Return JSON.' }] }],
    });
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error('Expected structured response request to fail');
}
