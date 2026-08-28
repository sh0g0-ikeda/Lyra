import { describe, expect, it } from 'vitest';
import { OpenAIEntityReferencePromptCompiler } from '../../../../src/infrastructure/openai/OpenAIEntityReferencePromptCompiler.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';

describe('OpenAIEntityReferencePromptCompiler', () => {
  it('明示年齢を優先する安全指示を含む system prompt で brief をコンパイルする', async () => {
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
      compilerBrief: [
        'Core concept: 4歳女性。黒髪ボブ。黄色いパジャマ。小柄。',
        'Character visual anchor: compact rounded bob',
        'Personality-to-visual cue: calm expression with faint tension',
      ].join('\n'),
    });

    const request = requests[0];
    const input = request.input as Array<{ content: Array<{ text: string }> }>;
    const systemPrompt = input[0].content[0].text;
    const userPrompt = input[1].content[0].text;

    expect(systemPrompt).toContain('Convert abstract personality traits into visible design cues');
    expect(systemPrompt).toContain('Treat an explicitly stated age as authoritative');
    expect(systemPrompt).toContain('girl, boy, or child');
    expect(systemPrompt).toContain('opaque, age-appropriate, context-appropriate clothing');
    expect(systemPrompt).toContain('natural story-appropriate poses');
    expect(systemPrompt).toContain('preserves the authored action and camera direction');
    expect(systemPrompt).toContain('omit speculative physical or camera details');
    expect(systemPrompt).toContain('Keep the final prompt between 150 and 220 words');
    expect(systemPrompt).toContain('Avoid vague praise words like beautiful, cool, high-quality, masterpiece, cinematic, or stunning');
    expect(userPrompt).toContain('Core concept: 4歳女性。黒髪ボブ。黄色いパジャマ。小柄。');
    expect(userPrompt).toContain('Character visual anchor: compact rounded bob');
    expect(userPrompt).toContain('Write the final GPT Image 2 prompt now.');
    expect(result).toEqual({
      prompt: 'A clean full-body manga character reference with stable silhouette and subtle tension in the eyes.',
      compilerProvider: 'openai',
      compilerModel: 'gpt-5.4-mini',
      compilerPromptVersion: 'entity_ref_v3',
    });
  });
});
