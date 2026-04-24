import { describe, expect, it } from 'vitest';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIEntityImportAnalyzer } from '../../../../src/infrastructure/openai/OpenAIEntityImportAnalyzer.js';

describe('OpenAIEntityImportAnalyzer', () => {
  it('responses の text JSON を解析する', async () => {
    const client = new OpenAIClient({
      apiKey: 'test',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              suggested_fields: { art_style: 'anime' },
              prompt_supplement: 'anime heroine',
            }),
          }),
          {
            status: 200,
            headers: { 'x-request-id': 'req-1', 'Content-Type': 'application/json' },
          },
        ),
      maxRetries: 1,
    });
    const analyzer = new OpenAIEntityImportAnalyzer(client);

    const result = await analyzer.analyze({
      entityType: 'character',
      dataUrl: 'data:image/png;base64,YWJj',
    });

    expect(result).toEqual({
      suggestedFields: { art_style: 'anime' },
      promptSupplement: 'anime heroine',
    });
  });
});
