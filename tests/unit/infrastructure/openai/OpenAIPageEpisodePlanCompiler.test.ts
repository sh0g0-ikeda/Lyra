import { describe, expect, it } from 'vitest';
import { STORY_AI_LIMITS } from '../../../../src/domain/constants/storyAi.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIPageEpisodePlanCompiler } from '../../../../src/infrastructure/openai/OpenAIPageEpisodePlanCompiler.js';

describe('OpenAIPageEpisodePlanCompiler', () => {
  it('chapter/episode/scene brief を episode page plan JSON にコンパイルする', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);

        return {
          body: {
            output_text: JSON.stringify({
              pages: [
                {
                  page_id: '11111111-1111-4111-8111-111111111111',
                  page_number: 1,
                  source_scene_ids: ['22222222-2222-4222-8222-222222222222'],
                  page_purpose: 'Open the rooftop meeting with quiet tension.',
                  continuity_note: 'Keep the emotional escalation controlled.',
                  panels: [
                    {
                      order: 1,
                      panel_role: 'establish',
                      panel_size: 'large',
                      situation_text: 'Two rivals face each other on the rooftop at night.',
                      composition: {
                        source: 'custom',
                        shot_type: 'wide',
                        angle: 'front',
                        composition_prompt: 'Show both characters and the open rooftop space.',
                      },
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

    const compiler = new OpenAIPageEpisodePlanCompiler(client);
    const result = await compiler.compilePlan({
      compilerBrief: [
        '[TASK]',
        'Plan editable page and panel draft fields for the entire episode.',
        '',
        '[CHAPTER ARC]',
        'Purpose: Push the rivalry forward without contradiction.',
        '',
        '[CURRENT PAGES]',
        'Page 1 (11111111-1111-4111-8111-111111111111)',
      ].join('\n'),
      language: 'ja',
    });

    expect(result).toEqual({
      suggestion: {
        pages: [
          {
            pageId: '11111111-1111-4111-8111-111111111111',
            pageNumber: 1,
            sourceSceneIds: ['22222222-2222-4222-8222-222222222222'],
            pagePurpose: 'Open the rooftop meeting with quiet tension.',
            continuityNote: 'Keep the emotional escalation controlled.',
            page: undefined,
            panels: [
              {
                order: 1,
                panelRole: 'establish',
                panelSize: 'large',
                situationText: 'Two rivals face each other on the rooftop at night.',
                composition: {
                  source: 'custom',
                  galleryItemId: null,
                  compositionPrompt: 'Show both characters and the open rooftop space.',
                  shotType: 'wide',
                  angle: 'front',
                  customNote: null,
                },
                dialogueInPanel: undefined,
                dialogue: undefined,
                sfxText: undefined,
                backgroundNote: undefined,
                panelNotes: undefined,
                entities: undefined,
              },
            ],
          },
        ],
      },
      compilerProvider: 'openai',
      compilerModel: 'gpt-5',
      compilerPromptVersion: 'episode_page_plan_v2',
    });

    const request = requests[0];
    const input = request.input as Array<{ content: Array<{ text: string }> }>;
    const text = request.text as {
      format: { type: string; name: string; strict: boolean; schema: Record<string, unknown> };
    };
    const systemPrompt = input[0].content[0].text;
    const userPrompt = input[1].content[0].text;

    expect(systemPrompt).toContain('do not invent new events, props, weapons, locations, or surprise twists');
    expect(systemPrompt).toContain('Convert abstract chapter and episode intent');
    expect(systemPrompt).toContain('Narration may be used more freely');
    expect(systemPrompt).toContain('prefer a short narration line over forcing extra character dialogue');
    expect(systemPrompt).toContain('provide at least one short speech or thought line');
    expect(systemPrompt).toContain('assume some dialogue is usually natural');
    expect(systemPrompt).toContain('infer what information the whole page must communicate');
    expect(systemPrompt).toContain('make it sound like natural Japanese');
    expect(systemPrompt).toContain('feel like a real response to the earlier line');
    expect(text.format).toMatchObject({
      type: 'json_schema',
      name: 'episode_page_plan',
      strict: true,
    });
    const schema = text.format.schema as {
      properties: {
        pages: {
          maxItems: number;
          items: {
            properties: {
              source_scene_ids: { maxItems: number };
              page: {
                anyOf: Array<{ required?: string[] }>;
              };
              panels: {
                maxItems: number;
                items: {
                  properties: {
                    dialogue: { anyOf: Array<{ maxItems?: number }> };
                    entities: { anyOf: Array<{ maxItems?: number }> };
                  };
                };
              };
            };
          };
        };
      };
    };
    expect(schema.properties.pages.maxItems).toBe(STORY_AI_LIMITS.maxSkeletonPages);
    expect(schema.properties.pages.items.properties.source_scene_ids.maxItems).toBe(100);
    expect(schema.properties.pages.items.properties.page.anyOf[0]?.required).toEqual([
      'dialogue_mode',
      'page_dialogue_toggle',
    ]);
    expect(schema.properties.pages.items.properties.panels.maxItems).toBe(20);
    expect(schema.properties.pages.items.properties.panels.items.properties.dialogue.anyOf[0]?.maxItems).toBe(20);
    expect(schema.properties.pages.items.properties.panels.items.properties.entities.anyOf[0]?.maxItems).toBe(20);
    expect(userPrompt).toContain('[CHAPTER ARC]');
    expect(userPrompt).toContain('[CURRENT PAGES]');
  });

  it('JSON の前後に余計な文章があっても最初の JSON object を読める', async () => {
    const client = {
      postJson: async () => ({
        body: {
          output_text: [
            'Here is the plan.',
            JSON.stringify({
              pages: [
                {
                  page_id: '11111111-1111-4111-8111-111111111111',
                  page_number: 1,
                  panels: [{ order: 1 }],
                },
              ],
            }),
            'Use it as needed.',
          ].join('\n'),
        },
        requestId: 'req-2',
      }),
    } as unknown as OpenAIClient;

    const compiler = new OpenAIPageEpisodePlanCompiler(client);
    const result = await compiler.compilePlan({ compilerBrief: '[TASK]\nReturn JSON.', language: 'ja' });

    expect(result.suggestion.pages[0]).toMatchObject({
      pageId: '11111111-1111-4111-8111-111111111111',
      pageNumber: 1,
      panels: [{ order: 1 }],
    });
  });
});
