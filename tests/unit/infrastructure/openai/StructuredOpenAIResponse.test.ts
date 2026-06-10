import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { requestStructuredOpenAIResponse } from '../../../../src/infrastructure/openai/StructuredOpenAIResponse.js';

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
});
