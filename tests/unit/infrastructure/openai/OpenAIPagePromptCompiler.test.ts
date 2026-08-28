import { describe, expect, it } from 'vitest';
import { OpenAIPagePromptCompiler } from '../../../../src/infrastructure/openai/OpenAIPagePromptCompiler.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';

describe('OpenAIPagePromptCompiler', () => {
  it('明示年齢を優先する安全指示を含む system prompt で page brief をコンパイルする', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);

        return {
          body: {
            output_text:
              'Create a complete manga page with stable character references, exact panel order, and readable dialogue baked only where requested.',
          },
          requestId: 'req-1',
        };
      },
    } as unknown as OpenAIClient;
    const compiler = new OpenAIPagePromptCompiler(client);

    const result = await compiler.compilePrompt({
      draftPrompt: 'draft prompt',
      compilerBrief: '[TASK]\nCreate one manga page\n\n[PANEL INSTRUCTIONS]\nPanel 1 ...',
    });

    expect(result).toEqual({
      prompt:
        'Create a complete manga page with stable character references, exact panel order, and readable dialogue baked only where requested.',
      compilerProvider: 'openai',
      compilerModel: 'gpt-5.4-mini',
      compilerPromptVersion: 'page_prompt_v4',
    });

    const request = requests[0];
    const input = request.input as Array<{ content: Array<{ text: string }> }>;
    const systemPrompt = input[0].content[0].text;
    const userPrompt = input[1].content[0].text;

    expect(systemPrompt).toContain('exact panel count and reading order');
    expect(systemPrompt).toContain('reference image mapping explicit');
    expect(systemPrompt).toContain('Treat an explicitly stated age as authoritative');
    expect(systemPrompt).toContain('girl, boy, or child');
    expect(systemPrompt).toContain('opaque, age-appropriate, context-appropriate clothing');
    expect(systemPrompt).toContain('natural story-appropriate poses');
    expect(systemPrompt).toContain('preserves the authored action and camera direction');
    expect(systemPrompt).toContain('omit speculative physical or camera details');
    expect(systemPrompt).toContain('Output the final prompt in the same language that the brief uses');
    expect(systemPrompt).toContain('Preserve the exact wording, the exact speaker assignment');
    expect(systemPrompt).toContain('panel 1 is the upper-right or rightmost top entry');
    expect(systemPrompt).toContain('follow its numbered frame map generally right-to-left and downward');
    expect(systemPrompt).toContain('frame map is authoritative for asymmetric or custom layouts');
    expect(systemPrompt).toContain('explicit authored dialogue position is also a hard lock');
    expect(systemPrompt).toContain('traditional vertical tategaki');
    expect(systemPrompt).toContain('glyphs top-to-bottom and columns right-to-left');
    expect(systemPrompt).toContain('Do not alter authored action, composition, or camera direction to fit text');
    expect(userPrompt).toContain('[TASK]');
    expect(userPrompt).not.toContain('Deterministic draft prompt:');
    expect(userPrompt).toContain('Write the final GPT Image 2 page-generation prompt now.');
  });
});
