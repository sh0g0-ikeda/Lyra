import { describe, expect, it } from 'vitest';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIEntityReferenceGenerator } from '../../../../src/infrastructure/openai/OpenAIEntityReferenceGenerator.js';

describe('OpenAIEntityReferenceGenerator', () => {
  it('3 candidates を生成する', async () => {
    let callCount = 0;
    const requestBodies: string[] = [];
    const client = new OpenAIClient({
      apiKey: 'test',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn: async (_input, init) => {
        callCount += 1;
        requestBodies.push(typeof init?.body === 'string' ? init.body : '');

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

    const result = await generator.generateCandidates({ prompt: 'entity prompt', inputImages: [] });

    expect(callCount).toBe(3);
    expect(result.openaiRequestId).toBe('req-1');
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]?.mimeType).toBe('image/png');
    expect(requestBodies[0]).toContain('"size":"1024x1536"');
  });

  it('inputImages がある場合は image input を OpenAI に渡す', async () => {
    let capturedBody = '';
    const client = new OpenAIClient({
      apiKey: 'test',
      baseUrl: 'https://api.openai.test/v1',
      timeoutMs: 1000,
      fetchFn: async (_input, init) => {
        capturedBody = typeof init?.body === 'string' ? init.body : '';

        return new Response(
          JSON.stringify({
            output: [
              {
                type: 'image_generation_call',
                result: Buffer.from('image-1').toString('base64'),
              },
            ],
          }),
          {
            status: 200,
            headers: { 'x-request-id': 'req-1', 'Content-Type': 'application/json' },
          },
        );
      },
      maxRetries: 1,
    });
    const generator = new OpenAIEntityReferenceGenerator(client);

    await generator.generateCandidates({
      prompt: 'entity prompt',
      inputImages: [{ dataUrl: 'data:image/png;base64,cmVm' }],
    });

    expect(capturedBody).toContain('"type":"input_image"');
    expect(capturedBody).toContain('"image_url":"data:image/png;base64,cmVm"');
  });
});
