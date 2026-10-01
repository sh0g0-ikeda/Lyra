import { STORY_SPEAKER_POLICY, STORY_DIALOGUE_FLOW_POLICY, STORY_SOURCE_POLICY, STORY_TEXT_POLICY, STORY_PANEL_POLICY } from '../../../../src/infrastructure/openai/StoryEditorialPrompts.js';
import { describe, expect, it } from 'vitest';
import { OpenAIPageAutofillCompiler } from '../../../../src/infrastructure/openai/OpenAIPageAutofillCompiler.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';

describe('OpenAIPageAutofillCompiler', () => {
  it('scene brief を panel suggestion JSON にコンパイルする', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        expect(JSON.stringify(payload.input)).toContain(STORY_SPEAKER_POLICY);
        expect(JSON.stringify(payload.input)).toContain(STORY_DIALOGUE_FLOW_POLICY);

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
      compilerPromptVersion: 'page_autofill_v6',
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
                      expect.objectContaining({ maxItems: 4 }),
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
    for (const policy of [STORY_SOURCE_POLICY,STORY_TEXT_POLICY,STORY_SPEAKER_POLICY,STORY_DIALOGUE_FLOW_POLICY,STORY_PANEL_POLICY]) expect(systemPrompt).toContain(policy);
    expect(systemPrompt).not.toContain('provide at least one short speech or thought line');


    expect(userPrompt).toContain('[TASK]');
    expect(userPrompt).toContain('Return the final JSON now.');
  });
});
