import { describe, expect, it } from 'vitest';
import { OpenAIPageAutofillCompiler } from '../../../../src/infrastructure/openai/OpenAIPageAutofillCompiler.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';

describe('OpenAIPageAutofillCompiler', () => {
  it('scene brief を panel suggestion JSON にコンパイルする', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);

        return {
          body: {
            output_text: JSON.stringify({
              panels: [
                {
                  order: 1,
                  panel_role: 'establish',
                  panel_size: 'large',
                  situation_text: 'Moonlit rooftop confrontation.',
                  composition: {
                    source: 'custom',
                    shot_type: 'wide',
                    angle: 'front',
                    composition_prompt: 'Show both rivals with rooftop space around them.',
                  },
                  entities: [
                    {
                      entity_id: '11111111-1111-4111-8111-111111111111',
                      role: 'primary',
                      expression: 'calm',
                      action: 'standing_firm',
                      position: 'center',
                    },
                  ],
                },
              ],
            }),
          },
          requestId: 'req-1',
        };
      },
    } as unknown as OpenAIClient;
    const compiler = new OpenAIPageAutofillCompiler(client);

    const result = await compiler.compileSuggestions({
      compilerBrief: '[TASK]\nFill page 1 of 3\n\n[SCENES]\nScene 1 | location=Rooftop',
      language: 'ja',
    });

    expect(result).toEqual({
      suggestion: {
        panels: [
          {
            order: 1,
            panelRole: 'establish',
            panelSize: 'large',
            situationText: 'Moonlit rooftop confrontation.',
            composition: {
              source: 'custom',
              galleryItemId: null,
              compositionPrompt: 'Show both rivals with rooftop space around them.',
              shotType: 'wide',
              angle: 'front',
              customNote: null,
            },
            entities: [
              {
                entityId: '11111111-1111-4111-8111-111111111111',
                role: 'primary',
                expression: 'calm',
                customExpression: null,
                action: 'standing_firm',
                customAction: null,
                position: 'center',
                facingDirection: null,
                effectNote: null,
                stateId: null,
              },
            ],
          },
        ],
      },
      compilerProvider: 'openai',
      compilerModel: 'gpt-4o-2024-08-06',
      compilerPromptVersion: 'page_autofill_v2',
    });

    const request = requests[0];
    expect(request.text).toMatchObject({
      format: {
        type: 'json_schema',
        name: 'page_autofill',
        strict: true,
        schema: {
          properties: {
            panels: {
              maxItems: 20,
              items: {
                properties: {
                  dialogue: {
                    anyOf: [
                      expect.objectContaining({ maxItems: 20 }),
                      expect.any(Object),
                    ],
                  },
                  entities: {
                    anyOf: [
                      expect.objectContaining({ maxItems: 20 }),
                      expect.any(Object),
                    ],
                  },
                },
              },
            },
          },
        },
      },
    });
    const input = request.input as Array<{ content: Array<{ text: string }> }>;
    const systemPrompt = input[0].content[0].text;
    const userPrompt = input[1].content[0].text;

    expect(systemPrompt).toContain('Return JSON only');
    expect(systemPrompt).toContain('Use only the provided entity IDs');
    expect(systemPrompt).toContain('Narration may be used more freely');
    expect(systemPrompt).toContain('prefer a short narration line rather than forcing extra dialogue');
    expect(systemPrompt).toContain('provide at least one short speech or thought line');
    expect(systemPrompt).toContain('assume some dialogue is usually natural');
    expect(systemPrompt).toContain('infer what information the full page still needs');
    expect(systemPrompt).toContain('natural Japanese a character would actually say or think');
    expect(systemPrompt).toContain('reads like an actual conversation');
    expect(systemPrompt).toContain('composition.custom_note');
    expect(systemPrompt).toContain('do not require scenes to produce a useful page draft');
    expect(systemPrompt).toContain('Treat chapter information only as a consistency guard');
    expect(userPrompt).toContain('[TASK]');
    expect(userPrompt).toContain('Return the final JSON now.');
  });
});
