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
      model: 'gpt-5.4-mini',
      max_output_tokens: 700,
      text: {
        format: {
          type: 'json_schema',
          name: 'entity_import_analysis',
          strict: true,
        },
      },
    });
    expect(requests[0]).toMatchObject({ reasoning: { effort: 'none' } });
  });

  it('受諾済みGPT-4o quoteの指定時はreasoningなしでそのモデルを維持する', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = new OpenAIClient({
      apiKey: 'test', baseUrl: 'https://api.openai.test/v1', timeoutMs: 1000,
      fetchFn: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ output_text: JSON.stringify({ field_suggestions: [], prompt_supplement: 'round brass compass' }) }), {
          status: 200, headers: { 'x-request-id': 'req-legacy', 'Content-Type': 'application/json' },
        });
      }, maxRetries: 1,
    });

    await new OpenAIEntityImportAnalyzer(client).analyze({
      entityType: 'object', dataUrl: 'data:image/png;base64,YWJj', model: 'gpt-4o',
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ model: 'gpt-4o', max_output_tokens: 700 });
    expect(requests[0]).not.toHaveProperty('reasoning');
  });

  it('nonhuman の enum 項目を provider schema で正規値に限定する', async () => {
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
                { path: 'base_form', value: 'robot' },
                { path: 'movement', value: 'bipedal' },
                { path: 'threat_level', value: 'medium' },
                { path: 'art_style', value: 'manga' },
              ],
              prompt_supplement: 'bipedal manga robot with a sturdy silhouette',
            }),
          }),
          {
            status: 200,
            headers: { 'x-request-id': 'req-nonhuman', 'Content-Type': 'application/json' },
          },
        );
      },
      maxRetries: 1,
    });
    const analyzer = new OpenAIEntityImportAnalyzer(client);

    const result = await analyzer.analyze({
      entityType: 'nonhuman',
      dataUrl: 'data:image/png;base64,YWJj',
    });

    expect(result.suggestedFields).toEqual({
      base_form: 'robot',
      movement: 'bipedal',
      threat_level: 'medium',
      art_style: 'manga',
    });
    expect(requests[0]).toMatchObject({
      text: {
        format: {
          schema: {
            properties: {
              field_suggestions: {
                items: {
                  anyOf: expect.arrayContaining([
                    expect.objectContaining({
                      properties: {
                        path: { type: 'string', enum: ['movement'] },
                        value: {
                          type: 'string',
                          enum: ['bipedal', 'quadruped', 'flying', 'floating', 'slithering', 'custom'],
                        },
                      },
                    }),
                  ]),
                },
              },
            },
          },
        },
      },
    });
  });

  it('nonhuman の未知 enum を黙って受け入れない', async () => {
    const client = new OpenAIClient({
      apiKey: 'test',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn: async () => new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            field_suggestions: [{ path: 'movement', value: 'rolling' }],
            prompt_supplement: 'round robot rolling on one wheel',
          }),
        }),
        {
          status: 200,
          headers: { 'x-request-id': 'req-invalid-enum', 'Content-Type': 'application/json' },
        },
      ),
      maxRetries: 1,
    });
    const analyzer = new OpenAIEntityImportAnalyzer(client);

    await expect(analyzer.analyze({
      entityType: 'nonhuman',
      dataUrl: 'data:image/png;base64,YWJj',
    })).rejects.toMatchObject({ reason: 'invalid_payload' });
  });

  it('entity type に属さない項目を黙って破棄しない', async () => {
    const client = new OpenAIClient({
      apiKey: 'test',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn: async () => new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            field_suggestions: [{ path: 'base_form', value: 'dragon' }],
            prompt_supplement: 'anime heroine',
          }),
        }),
        {
          status: 200,
          headers: { 'x-request-id': 'req-wrong-path', 'Content-Type': 'application/json' },
        },
      ),
      maxRetries: 1,
    });
    const analyzer = new OpenAIEntityImportAnalyzer(client);

    await expect(analyzer.analyze({
      entityType: 'character',
      dataUrl: 'data:image/png;base64,YWJj',
    })).rejects.toMatchObject({ reason: 'invalid_payload' });
  });
});
