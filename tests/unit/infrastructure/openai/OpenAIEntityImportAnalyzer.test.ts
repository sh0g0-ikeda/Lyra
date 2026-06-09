import { describe, expect, it } from 'vitest';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIEntityImportAnalyzer } from '../../../../src/infrastructure/openai/OpenAIEntityImportAnalyzer.js';

describe('OpenAIEntityImportAnalyzer', () => {
  it('uses strict structured output with a token cap and converts field paths to suggested fields', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = new OpenAIClient({
      apiKey: 'test',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              field_suggestions: [
                { path: 'art_style', value: 'anime' },
                { path: 'hair.color', value: 'black' },
                { path: 'character_identity.aliases', value: ['Aki'] },
                { path: 'base_form', value: 'dragon' },
              ],
              prompt_supplement: 'anime heroine',
            }),
          }),
          {
            status: 200,
            headers: { 'x-request-id': 'req-1', 'Content-Type': 'application/json' },
          },
        );
      },
      maxRetries: 1,
    });
    const analyzer = new OpenAIEntityImportAnalyzer(client);

    const result = await analyzer.analyze({
      entityType: 'character',
      dataUrl: 'data:image/png;base64,YWJj',
    });

    expect(result).toEqual({
      suggestedFields: {
        art_style: 'anime',
        hair: { color: 'black' },
        character_identity: { aliases: ['Aki'] },
      },
      promptSupplement: 'anime heroine',
    });
    expect(requests[0]).toMatchObject({
      max_output_tokens: 700,
      text: {
        format: {
          type: 'json_schema',
          name: 'entity_import_analysis',
          strict: true,
        },
      },
    });
  });
});
