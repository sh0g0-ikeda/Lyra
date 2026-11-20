import { describe, expect, it } from 'vitest';
import { STORY_AI_LIMITS } from '../../../../src/domain/constants/storyAi.js';
import { OpenAIStoryAiClient } from '../../../../src/infrastructure/openai/OpenAIStoryAiClient.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';

const validPageSkeletonPayload = {
  pages: [
    {
      page_number: 1,
      purpose: 'Open on the roof.',
      suggested_panel_count: 1,
      suggested_layout: 'splash_1',
      panels: [
        {
          order: 1,
          panel_role: 'establish',
          suggested_size: 'large',
          situation_hint: 'Aki steps onto the moonlit roof.',
          suggested_entities: ['11111111-1111-4111-8111-111111111111'],
          suggested_dialogue_hint: null,
        },
      ],
    },
  ],
};

describe('OpenAIStoryAiClient', () => {
  it('指示保持本文改善をID付きstrict structured outputで返す', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        return {
          body: { output_text: '{"fragments":[{"id":"introduction-1","text":"改善本文"}]}' },
          requestId: 'req-manuscript-improvement',
        };
      },
    } as unknown as OpenAIClient;

    await expect(new OpenAIStoryAiClient(client).improveEpisodeManuscript({
      systemPrompt: 'system', userPrompt: 'user',
    })).resolves.toEqual([{ id: 'introduction-1', text: '改善本文' }]);
    expect(requests[0]).toMatchObject({
      max_output_tokens: 16000,
      text: { format: { name: 'episode_manuscript_improvement', strict: true } },
    });
  });

  it('指示保持本文改善の空・型不一致provider payloadを拒否する', async () => {
    for (const output_text of ['', '{"fragments":[]}', '{"fragments":[{"id":"x","text":3}]}']) {
      const client = {
        postJson: async () => ({ body: { output_text }, requestId: 'req-invalid-manuscript' }),
      } as unknown as OpenAIClient;
      await expect(new OpenAIStoryAiClient(client).improveEpisodeManuscript({
        systemPrompt: 'system', userPrompt: 'user',
      })).rejects.toThrow();
    }
  });

  it('ページ見積もりをgpt-6-luna lowのbounded structured outputで返す', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        return { body: { output_text: '{"blocks":[{"block_id":"segment-1","panel_count":8}]}' }, requestId: 'req-estimate' };
      },
    } as unknown as OpenAIClient;

    const result = await new OpenAIStoryAiClient(client).estimateEpisodePanelCount({
      systemPrompt: 'system', userPrompt: 'user',
    });

    expect(result).toEqual([{ blockId: 'segment-1', panelCount: 8 }]);
    expect(requests[0]).toMatchObject({
      model: 'gpt-6-luna',
      reasoning: { effort: 'low' },
      max_output_tokens: 8192,
      text: { format: { name: 'episode_panel_count_estimate', strict: true } },
    });
  });

  it('ページ見積もりの空または不正なprovider payloadを受理しない', async () => {
    for (const output_text of [
      '',
      '{"blocks":[{"block_id":"segment-1","panel_count":0}]}',
      '{"blocks":[{"block_id":"segment-1","panel_count":1001}]}',
      '{"blocks":[{"block_id":"segment-1","panel_count":"8"}]}',
    ]) {
      const client = {
        postJson: async () => ({ body: { output_text }, requestId: 'req-invalid-estimate' }),
      } as unknown as OpenAIClient;
      await expect(new OpenAIStoryAiClient(client).estimateEpisodePanelCount({
        systemPrompt: 'system', userPrompt: 'user',
      })).rejects.toThrow();
    }
  });

  it('page skeleton を strict structured output で返す', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        return {
          body: {
            output_text: JSON.stringify(validPageSkeletonPayload),
          },
          requestId: 'req-1',
        };
      },
    } as unknown as OpenAIClient;

    const storyAiClient = new OpenAIStoryAiClient(client);
    const result = await storyAiClient.generatePageSkeleton({
      systemPrompt: 'system',
      userPrompt: 'user',
    });

    expect(result[0]?.panels[0]?.situationHint).toBe('Aki steps onto the moonlit roof.');
    expect(requests[0]?.text).toMatchObject({
      format: {
        type: 'json_schema',
        name: 'page_skeleton',
        strict: true,
        schema: {
          properties: {
            pages: {
              maxItems: STORY_AI_LIMITS.maxSkeletonPages,
              items: {
                properties: {
                  page_number: {
                    maximum: STORY_AI_LIMITS.maxSkeletonPages,
                  },
                  suggested_panel_count: {
                    maximum: STORY_AI_LIMITS.maxPanelsPerPage,
                  },
                  suggested_layout: {
                    enum: expect.arrayContaining(['top_wide_3', 'standard_4']),
                  },
                  panels: {
                    maxItems: STORY_AI_LIMITS.maxPanelsPerPage,
                    items: {
                      properties: {
                        order: {
                          maximum: STORY_AI_LIMITS.maxPanelsPerPage,
                        },
                        panel_role: {
                          enum: expect.arrayContaining(['establish', 'impact']),
                        },
                        suggested_size: {
                          enum: expect.arrayContaining(['standard', 'splash']),
                        },
                        suggested_entities: {
                          maxItems: STORY_AI_LIMITS.maxEntitiesPerPanel,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('page skeleton の JSON が途中で壊れた場合だけ token を増やして 1 回だけ再試行する', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);

        if (requests.length === 1) {
          return {
            body: {
              output_text:
                '{"pages":[{"page_number":1,"purpose":"Open on the roof.","suggested_panel_count":1,"suggested_layout":"splash_1","panels":[{"order":1,"panel_role":"establish","suggested_size":"large","situation_hint":"Aki steps onto the moonlit roof.","suggested_entities":["11111111-1111-4111-8111-111111111111"],"suggested_dialogue_hint":null}',
            },
            requestId: 'req-1',
          };
        }

        return {
          body: {
            output_text: JSON.stringify(validPageSkeletonPayload),
          },
          requestId: 'req-2',
        };
      },
    } as unknown as OpenAIClient;

    const storyAiClient = new OpenAIStoryAiClient(client);
    const result = await storyAiClient.generatePageSkeleton({
      systemPrompt: 'system',
      userPrompt: 'user',
    });

    expect(result).toHaveLength(1);
    expect(requests).toHaveLength(2);
    expect(Number(requests[1]?.max_output_tokens)).toBeGreaterThan(
      Number(requests[0]?.max_output_tokens),
    );
  });

  it('page skeleton の payload が schema 不一致なら追加リトライしない', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        return {
          body: {
            output_text: JSON.stringify({
              pages: [
                {
                  page_number: 1,
                  purpose: 'Open on the roof.',
                  suggested_panel_count: 1,
                  suggested_layout: 'splash_1',
                  panels: [
                    {
                      order: 1,
                      panel_role: 'detail',
                      suggested_size: 'small',
                      situation_hint: 'Aki steps onto the moonlit roof.',
                      suggested_entities: ['11111111-1111-4111-8111-111111111111'],
                      suggested_dialogue_hint: null,
                    },
                  ],
                },
              ],
            }),
          },
          requestId: 'req-invalid-payload',
        };
      },
    } as unknown as OpenAIClient;

    const storyAiClient = new OpenAIStoryAiClient(client);
    await expect(
      storyAiClient.generatePageSkeleton({
        systemPrompt: 'system',
        userPrompt: 'user',
      }),
    ).rejects.toThrow('OpenAI page skeleton compiler returned an invalid payload');

    expect(requests).toHaveLength(1);
  });

  it('page skeleton の suggested_entities に UUID ではない値が混じっても service 修復に渡せる', async () => {
    const client = {
      postJson: async () => ({
        body: {
          output_text: JSON.stringify({
            pages: [
              {
                page_number: 1,
                purpose: 'Open on the roof.',
                suggested_panel_count: 1,
                suggested_layout: 'splash_1',
                panels: [
                  {
                    order: 1,
                    panel_role: 'establish',
                    suggested_size: 'large',
                    situation_hint: 'Aki steps onto the moonlit roof.',
                    suggested_entities: [
                      '11111111-1111-4111-8111-111111111111',
                      'Kasane',
                      'not-a-uuid',
                    ],
                    suggested_dialogue_hint: null,
                  },
                ],
              },
            ],
          }),
        },
        requestId: 'req-invalid-entity-id',
      }),
    } as unknown as OpenAIClient;

    const storyAiClient = new OpenAIStoryAiClient(client);
    const result = await storyAiClient.generatePageSkeleton({
      systemPrompt: 'system',
      userPrompt: 'user',
    });

    expect(result[0]?.panels[0]?.suggestedEntities).toEqual([
      '11111111-1111-4111-8111-111111111111',
      'Kasane',
      'not-a-uuid',
    ]);
  });

  it('episode draft improvement を strict structured output で返す', async () => {
    const client = {
      postJson: async () => ({
        body: {
          output_text: JSON.stringify({
            introduction: 'Improved intro',
            middle: 'Improved middle',
            climax: 'Improved climax',
            ending_hook: 'Improved hook',
          }),
        },
        requestId: 'req-2',
      }),
    } as unknown as OpenAIClient;

    const storyAiClient = new OpenAIStoryAiClient(client);
    const result = await storyAiClient.improveEpisodeDraft({
      systemPrompt: 'system',
      userPrompt: 'user',
    });

    expect(result).toEqual({
      introduction: 'Improved intro',
      middle: 'Improved middle',
      climax: 'Improved climax',
      endingHook: 'Improved hook',
    });
  });

  it('collaboration は OpenAI text output を 1 chunk で返す', async () => {
    const client = {
      postJson: async () => ({
        body: {
          output_text: 'Revised draft text.',
        },
        requestId: 'req-3',
      }),
    } as unknown as OpenAIClient;

    const storyAiClient = new OpenAIStoryAiClient(client);
    const chunks: string[] = [];
    for await (const chunk of storyAiClient.streamCollaboration({
      systemPrompt: 'system',
      userPrompt: 'user',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Revised draft text.']);
  });
});
