import { describe, expect, it } from 'vitest';
import { OpenAIEntityReferencePromptCompiler } from '../../../../src/infrastructure/openai/OpenAIEntityReferencePromptCompiler.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';

describe('OpenAIEntityReferencePromptCompiler', () => {
  it('GPT Image 2 向けの system prompt で brief をコンパイルする', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);

        return {
          body: {
            output_text: 'A clean full-body manga character reference with stable silhouette and subtle tension in the eyes.',
          },
          requestId: 'req-1',
        };
      },
    } as unknown as OpenAIClient;
    const compiler = new OpenAIEntityReferencePromptCompiler(client);

    const result = await compiler.compilePrompt({
      context: {
        entityId: 'entity-1',
        workId: 'work-1',
        userId: 'user-1',
        entityType: 'character',
        name: 'Yuki',
        freeDescription: null,
        structuredFields: {},
        promptSupplement: null,
        status: 'draft',
        referenceSet: {
          entityId: 'entity-1',
          images: [],
          primaryRefId: null,
          status: 'empty',
          updatedAt: new Date('2026-05-25T00:00:00.000Z'),
        },
      },
      draftPrompt: 'draft prompt',
      compilerBrief: 'Character visual anchor: compact rounded bob\nPersonality-to-visual cue: calm expression with faint tension',
    });

    expect(result).toEqual({
      prompt: 'A clean full-body manga character reference with stable silhouette and subtle tension in the eyes.',
      compilerProvider: 'openai',
      compilerModel: 'gpt-5.4-mini',
      compilerPromptVersion: 'entity_ref_v2',
    });

    const request = requests[0];
    const input = request.input as Array<{ content: Array<{ text: string }> }>;
    const systemPrompt = input[0].content[0].text;
    const userPrompt = input[1].content[0].text;

    expect(systemPrompt).toContain('Convert abstract personality traits into visible design cues');
    expect(systemPrompt).toContain('Keep the final prompt between 150 and 220 words');
    expect(systemPrompt).toContain('Avoid vague praise words like beautiful, cool, high-quality, masterpiece, cinematic, or stunning');
    expect(userPrompt).toContain('Character visual anchor: compact rounded bob');
    expect(userPrompt).toContain('Write the final GPT Image 2 prompt now.');
  });

  it('人外の brief では人間の手足を要求せず実在する部位と輪郭を保持する', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        return {
          body: { output_text: 'A floating asymmetric creature reference.' },
          requestId: 'req-nonhuman',
        };
      },
    } as unknown as OpenAIClient;
    const compiler = new OpenAIEntityReferencePromptCompiler(client);

    await compiler.compilePrompt({
      context: {
        entityId: 'entity-nonhuman-1',
        workId: 'work-1',
        userId: 'user-1',
        entityType: 'nonhuman',
        name: 'Luca',
        freeDescription: 'A limbless floating creature with an asymmetric left-side marking.',
        structuredFields: {},
        promptSupplement: null,
        status: 'draft',
        referenceSet: {
          entityId: 'entity-nonhuman-1',
          images: [],
          primaryRefId: null,
          status: 'empty',
          updatedAt: new Date('2026-05-25T00:00:00.000Z'),
        },
      },
      draftPrompt: 'draft prompt',
      compilerBrief: 'Target image: manga creature reference',
    });

    const request = requests[0];
    const input = request.input as Array<{ content: Array<{ text: string }> }>;
    const systemPrompt = input[0].content[0].text;

    expect(systemPrompt).toContain('preserve its overall silhouette, anatomy, part count, connections, proportions, and markings');
    expect(systemPrompt).toContain('Do not invent a human head, hands, feet, limbs, clothing, hair, or humanoid pose');
    expect(systemPrompt).not.toContain('with both hands and both feet visible');
  });
});
