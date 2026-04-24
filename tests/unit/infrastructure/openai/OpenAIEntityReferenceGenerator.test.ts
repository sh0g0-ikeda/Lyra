import { describe, expect, it } from 'vitest';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIEntityReferenceGenerator } from '../../../../src/infrastructure/openai/OpenAIEntityReferenceGenerator.js';

describe('OpenAIEntityReferenceGenerator', () => {
  it('3 candidates を生成する', async () => {
    let callCount = 0;
    const client = new OpenAIClient({
      apiKey: 'test',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn: async () => {
        callCount += 1;
        return new Response(
          JSON.stringify({
            output: [
              {
                type: 'image_generation_call',
                result: Buffer.from(`image-${callCount}`).toString('base64'),
              },
            ],
          }),
          {
            status: 200,
            headers: { 'x-request-id': `req-${callCount}`, 'Content-Type': 'application/json' },
          },
        );
      },
      maxRetries: 1,
    });
    const generator = new OpenAIEntityReferenceGenerator(client);

    const result = await generator.generateCandidates({ prompt: 'entity prompt' });

    expect(callCount).toBe(3);
    expect(result.openaiRequestId).toBe('req-1');
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]?.mimeType).toBe('image/png');
  });
});
