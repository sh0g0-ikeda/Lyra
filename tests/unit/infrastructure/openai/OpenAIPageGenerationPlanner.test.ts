import { describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIPageGenerationPlanner } from '../../../../src/infrastructure/openai/OpenAIPageGenerationPlanner.js';

describe('OpenAIPageGenerationPlanner', () => {
  it('output_textを内部計画として返す', async () => {
    const client = {
      postJson: vi.fn().mockResolvedValue({
        body: { output_text: 'panel flow plan' },
        requestId: 'req-1',
      }),
    } as unknown as OpenAIClient;
    const planner = new OpenAIPageGenerationPlanner(client);

    const result = await planner.buildPlan({
      jobId: 'job-1',
      userId: 'user-1',
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'thinking',
      prompt: 'page prompt',
    });

    expect(result).toBe('panel flow plan');
    expect(client.postJson).toHaveBeenCalledWith(
      '/responses',
      expect.objectContaining({
        max_output_tokens: expect.any(Number),
      }),
    );
  });

  it('テキストが無い場合はConfigurationErrorを投げる', async () => {
    const client = {
      postJson: vi.fn().mockResolvedValue({
        body: { output: [] },
        requestId: 'req-1',
      }),
    } as unknown as OpenAIClient;
    const planner = new OpenAIPageGenerationPlanner(client);

    await expect(
      planner.buildPlan({
        jobId: 'job-1',
        userId: 'user-1',
        pageId: 'page-1',
        requestKind: 'initial',
        generationMode: 'thinking',
        prompt: 'page prompt',
      }),
    ).rejects.toEqual(new ConfigurationError('OpenAI planner returned no text output'));
  });
});
