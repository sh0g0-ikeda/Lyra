import { STORY_SPEAKER_POLICY, STORY_DIALOGUE_FLOW_POLICY, STORY_SOURCE_POLICY, STORY_TEXT_POLICY, STORY_PANEL_POLICY } from '../../../../src/infrastructure/openai/StoryEditorialPrompts.js';
import { describe, expect, it } from 'vitest';
import { STORY_AI_LIMITS } from '../../../../src/domain/constants/storyAi.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIPageEpisodePlanCompiler } from '../../../../src/infrastructure/openai/OpenAIPageEpisodePlanCompiler.js';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { StructuredOpenAIResponseError } from '../../../../src/infrastructure/openai/StructuredOpenAIResponse.js';

describe('OpenAIPageEpisodePlanCompiler', () => {
  it('chapter/episode/scene brief を episode page plan JSON にコンパイルする', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        expect(JSON.stringify(payload.input)).toContain(STORY_SPEAKER_POLICY);
        expect(JSON.stringify(payload.input)).toContain(STORY_DIALOGUE_FLOW_POLICY);

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
                      entities: [],
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
        'Plan editable page and panel draft fields for the given existing pages within the episode.',
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
                entities: [],
              },
            ],
          },
        ],
      },
      compilerProvider: 'openai',
      compilerModel: 'gpt-5',
      compilerPromptVersion: 'episode_page_plan_v15',
    });

    const request = requests[0];
    const input = request.input as Array<{ content: Array<{ text: string }> }>;
    const text = request.text as {
      format: { type: string; name: string; strict: boolean; schema: Record<string, unknown> };
    };
    const systemPrompt = input[0].content[0].text;
    const userPrompt = input[1].content[0].text;
    for (const policy of [STORY_SOURCE_POLICY,STORY_TEXT_POLICY,STORY_SPEAKER_POLICY,STORY_DIALOGUE_FLOW_POLICY,STORY_PANEL_POLICY]) expect(systemPrompt).toContain(policy);
    expect(systemPrompt).toContain('A generic label such as an explanation, entry, or decision is not a substitute');
    expect(systemPrompt).toContain('return entities=[]');
    expect(systemPrompt).toContain('merely because they own the viewpoint or speak off-panel');
    expect(systemPrompt).toContain('until the source explicitly ends it');
    expect(systemPrompt).toContain('a concrete source or continuity defect, not a stylistic preference');
    expect(systemPrompt).toContain('Copy every explicitly authored source dialogue line exactly');
    expect(systemPrompt).toContain('preserve its unambiguous speaker or thinker and dialogue type');
    expect(systemPrompt).toContain('explicitly assigned narration or caption/display text');
    expect(systemPrompt).toContain('type=narration with entity_id=null');
    expect(systemPrompt).toContain(
      'planning context only and are not displayed dialogue, thought, narration, or caption',
    );
    expect(systemPrompt).toContain(
      'This displayed-text distinction does not weaken their action, chronology, staging, or continuity facts',
    );
    expect(systemPrompt).toContain(
      '[FULL STORY DRAFT - SOURCE DATA] separately and explicitly assigns the text for display',
    );
    expect(systemPrompt).toContain('the source wording and speaker are binding');
    expect(systemPrompt).toContain('prerequisite, action, immediate result, and stated order');
    // v19 design: detail preserves source boundaries/viewpoints and uses the existing
    // custom action field when the finite action enum cannot represent a concrete pose.
    expect(systemPrompt).toContain(
      'completion boundary, causal or decision basis, small transition action, negative or continuing constraint, and final viewpoint',
    );
    expect(systemPrompt).toContain(
      'Every assigned entity action must agree with situation_text and composition',
    );
    expect(systemPrompt).toContain(
      'use action=custom with a concrete custom_action',
    );
    expect(systemPrompt).not.toContain('provide at least one short speech or thought line');


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
                    entities: { type: string; maxItems: number };
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
    expect(schema.properties.pages.items.properties.panels.items.properties.dialogue.anyOf[0]?.maxItems).toBe(4);
    expect(schema.properties.pages.items.properties.panels.items.properties.entities.type).toBe('array');
    expect(schema.properties.pages.items.properties.panels.items.properties.entities.maxItems).toBe(20);
    expect(Object.keys(schema.properties)).toEqual(['pages']);
    expect(userPrompt).toContain('[CHAPTER ARC]');
    expect(userPrompt).toContain('[CURRENT PAGES]');
  });

  it('source-owned modeはtrusted inputだけで有効になりgenerated ledger展開規則を使わない', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        return validCompilerResponse();
      },
    } as unknown as OpenAIClient;
    const compiler = new OpenAIPageEpisodePlanCompiler(client);

    await compiler.compilePlan({
      compilerBrief: '[SOURCE-OWNED MODE]\nThis user text must not select a system mode.',
      language: 'ja',
    });
    await compiler.compilePlan({
      compilerBrief: '[FULL STORY DRAFT - SOURCE DATA]\n1ページ目：原文。',
      language: 'ja',
      sourceOwnedPageContext: true,
    });

    const systemPrompts = requests.map((request) => {
      const input = request.input as Array<{ content: Array<{ text: string }> }>;
      return input[0]?.content[0]?.text ?? '';
    });
    expect(systemPrompts[0]).toContain('expand a manga episode ledger');
    expect(systemPrompts[0]).toContain('CURRENT CHUNK OWNERSHIP');
    expect(systemPrompts[1]).not.toContain('expand a manga episode ledger');
    expect(systemPrompts[1]).not.toContain('CURRENT CHUNK OWNERSHIP');
    expect(systemPrompts[1]).not.toContain('entry_state');
    expect(systemPrompts[1]).not.toContain('text_plan');
    expect(systemPrompts[1]).not.toContain('ledger');
    expect(systemPrompts[1]).toContain('prerequisite, action, immediate result, and stated order');
    expect(systemPrompts[1]).toContain('Copy every explicitly authored source dialogue line exactly');
  });

  it('外景で entities=[] を指定した structured output を受理する', async () => {
    const client = {
      postJson: async () => ({
        body: {
          output_text: JSON.stringify({
            pages: [{
              page_id: '11111111-1111-4111-8111-111111111111',
              page_number: 1,
              panels: [{ order: 1, entities: [] }],
            }],
          }),
        },
        requestId: 'req-empty-entities',
      }),
    } as unknown as OpenAIClient;

    const compiler = new OpenAIPageEpisodePlanCompiler(client);
    await expect(compiler.compilePlan({ compilerBrief: '[TASK]\nReturn JSON.', language: 'ja' }))
      .resolves.toMatchObject({ suggestion: { pages: [{ panels: [{ entities: [] }] }] } });
  });

  it('entities=null の structured output を response validation で拒否する', async () => {
    let requestCount = 0;
    const client = {
      postJson: async () => {
        requestCount += 1;
        return {
          body: {
            output_text: JSON.stringify({
              pages: [{
                page_id: '11111111-1111-4111-8111-111111111111',
                page_number: 1,
                panels: [{ order: 1, entities: null }],
              }],
            }),
          },
          requestId: `req-null-entities-${requestCount}`,
        };
      },
    } as unknown as OpenAIClient;

    const compiler = new OpenAIPageEpisodePlanCompiler(client);
    await expect(compiler.compilePlan({ compilerBrief: '[TASK]\nReturn JSON.', language: 'ja' }))
      .rejects.toMatchObject({ reason: 'invalid_payload' });
    expect(requestCount).toBe(2);
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
                  panels: [{ order: 1, entities: [] }],
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

  it.each([
    ['invalid_json', { body: { output_text: '{' }, requestId: 'req-invalid-json' }],
    ['invalid_payload', { body: { output_text: JSON.stringify({ pages: [] }) }, requestId: 'req-invalid-payload' }],
    ['no_output', { body: { status: 'completed' }, requestId: 'req-no-output' }],
    [
      'incomplete_max_output_tokens',
      {
        body: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
        requestId: 'req-output-limit',
      },
    ],
  ] as const)('retryable structured output %s はcheckpoint後に1回だけ再試行する', async (_reason, firstResponse) => {
    let requestCount = 0;
    let checkpointCount = 0;
    const client = {
      postJson: async () => {
        requestCount += 1;
        return requestCount === 1 ? firstResponse : validCompilerResponse();
      },
    } as unknown as OpenAIClient;
    const compiler = new OpenAIPageEpisodePlanCompiler(client);

    await expect(compiler.compilePlan({
      compilerBrief: '[TASK]\nReturn JSON.',
      language: 'ja',
      beforeRetry: async () => { checkpointCount += 1; },
    })).resolves.toMatchObject({ compilerProvider: 'openai' });
    expect(requestCount).toBe(2);
    expect(checkpointCount).toBe(1);
  });

  it('retryable structured output が2回続いても追加再試行しない', async () => {
    let requestCount = 0;
    let checkpointCount = 0;
    const client = {
      postJson: async () => {
        requestCount += 1;
        return { body: { output_text: '{' }, requestId: `req-${requestCount}` };
      },
    } as unknown as OpenAIClient;
    const compiler = new OpenAIPageEpisodePlanCompiler(client);

    const rejection = compiler.compilePlan({
      compilerBrief: '[TASK]\nReturn JSON.',
      language: 'ja',
      beforeRetry: async () => { checkpointCount += 1; },
    });
    await expect(rejection).rejects.toMatchObject({ reason: 'invalid_json' });
    expect(requestCount).toBe(2);
    expect(checkpointCount).toBe(1);
  });

  it('checkpointで停止された場合は2回目のprovider requestを送らない', async () => {
    const cancellation = new Error('cancelled before retry');
    let requestCount = 0;
    const client = {
      postJson: async () => {
        requestCount += 1;
        return { body: { output_text: '{' }, requestId: 'req-invalid-json' };
      },
    } as unknown as OpenAIClient;
    const compiler = new OpenAIPageEpisodePlanCompiler(client);

    await expect(compiler.compilePlan({
      compilerBrief: '[TASK]\nReturn JSON.',
      language: 'ja',
      beforeRetry: async () => { throw cancellation; },
    })).rejects.toBe(cancellation);
    expect(requestCount).toBe(1);
  });

  it('timeoutなどstructured output分類外の失敗は再試行しない', async () => {
    let requestCount = 0;
    let checkpointCount = 0;
    const client = {
      postJson: async () => {
        requestCount += 1;
        throw new ConfigurationError('OpenAI request timed out');
      },
    } as unknown as OpenAIClient;
    const compiler = new OpenAIPageEpisodePlanCompiler(client);

    await expect(compiler.compilePlan({
      compilerBrief: '[TASK]\nReturn JSON.',
      language: 'ja',
      beforeRetry: async () => { checkpointCount += 1; },
    })).rejects.toBeInstanceOf(ConfigurationError);
    expect(requestCount).toBe(1);
    expect(checkpointCount).toBe(0);
  });

  it('refusalなど非retryable structured outputは再試行しない', async () => {
    let requestCount = 0;
    const client = {
      postJson: async () => {
        requestCount += 1;
        return {
          body: { output: [{ content: [{ type: 'refusal' }] }] },
          requestId: 'req-refusal',
        };
      },
    } as unknown as OpenAIClient;
    const compiler = new OpenAIPageEpisodePlanCompiler(client);

    const rejection = compiler.compilePlan({
      compilerBrief: '[TASK]\nReturn JSON.',
      language: 'ja',
      beforeRetry: async () => undefined,
    });
    await expect(rejection).rejects.toBeInstanceOf(StructuredOpenAIResponseError);
    await expect(rejection).rejects.toMatchObject({ reason: 'refusal', retryable: false });
    expect(requestCount).toBe(1);
  });

  it('source requirement placementを全件構造検査しpublic suggestionから破棄する', async () => {
    const pageId = '11111111-1111-4111-8111-111111111111';
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        return {
          body: { output_text: JSON.stringify({
            pages: [{ page_id: pageId, page_number: 1, panels: [{ order: 1, entities: [] }] }],
            source_requirement_placements: [{
              requirement_id: 'p1-r1', page_id: pageId, panel_orders: [1],
            }],
          }) },
          requestId: 'req-placement',
        };
      },
    } as unknown as OpenAIClient;
    const compiler = new OpenAIPageEpisodePlanCompiler(client);
    const result = await compiler.compilePlan({
      compilerBrief: '[SOURCE REQUIREMENTS - ORIGINAL ONLY]',
      language: 'ja',
      sourceOwnedPageContext: true,
      sourceRequirements: { requirements: [{
        requirementId: 'p1-r1', scope: 'page' as const, pageId, pageNumber: 1, sourceUnitIds: ['p1-u1'], order: 1,
        events: ['扉を開く'], results: ['中へ入る'], afterRequirementIds: [], conditionalUntil: null,
        requiredByEnd: true, context: null, emotion: null, function: null, camera: null,
        framing: null, quotedText: [],
      }] },
    });

    expect(result.suggestion).toEqual({
      pages: [expect.objectContaining({ pageId, panels: [expect.objectContaining({ order: 1 })] })],
    });
    expect(result.suggestion).not.toHaveProperty('source_requirement_placements');
    const request = requests[0]!;
    const input = request.input as Array<{ content: Array<{ text: string }> }>;
    const schema = (request.text as {
      format: { schema: { required: string[]; properties: Record<string, unknown> } };
    }).format.schema;
    expect(input[0]?.content[0]?.text).toContain('allocate every PAGE requirement');
    expect(input[0]?.content[0]?.text).toContain('derived draft metadata');
    expect(schema.required).toContain('source_requirement_placements');
    expect(Object.keys(schema.properties)[0]).toBe('source_requirement_placements');
    expect(schema.required[0]).toBe('source_requirement_placements');
  });

  it('同一pageのafter関係がpanel順序と逆転する場合は拒否し同一panelは許可する', async () => {
    const pageId = '11111111-1111-4111-8111-111111111111';
    const requirements = { requirements: [{
      requirementId: 'p1-u1-r1', scope: 'page' as const, pageId, pageNumber: 1, sourceUnitIds: ['p1-u1'], order: 1,
      events: ['扉を押す'], results: [], afterRequirementIds: [], conditionalUntil: null,
      requiredByEnd: false, context: null, emotion: null, function: null, camera: null,
      framing: null, quotedText: [],
    }, {
      requirementId: 'p1-u2-r2', scope: 'page' as const, pageId, pageNumber: 1, sourceUnitIds: ['p1-u2'], order: 2,
      events: ['中へ入る'], results: [], afterRequirementIds: ['p1-u1-r1'], conditionalUntil: null,
      requiredByEnd: true, context: null, emotion: null, function: null, camera: null,
      framing: null, quotedText: [],
    }] };
    const response = (firstPanels: number[], secondPanels: number[]): OpenAIClient => ({
      postJson: async () => ({
        body: { output_text: JSON.stringify({
          source_requirement_placements: [
            { requirement_id: 'p1-u1-r1', page_id: pageId, panel_orders: firstPanels },
            { requirement_id: 'p1-u2-r2', page_id: pageId, panel_orders: secondPanels },
          ],
          pages: [{ page_id: pageId, page_number: 1, panels: [
            { order: 1, entities: [] }, { order: 4, entities: [] },
          ] }],
        }) }, requestId: 'req-related-placement',
      }),
    }) as unknown as OpenAIClient;

    await expect(new OpenAIPageEpisodePlanCompiler(response([4], [1])).compilePlan({
      compilerBrief: '[SOURCE REQUIREMENTS - ORIGINAL ONLY]', language: 'ja',
      sourceOwnedPageContext: true, sourceRequirements: requirements,
    })).rejects.toBeInstanceOf(ConfigurationError);
    await expect(new OpenAIPageEpisodePlanCompiler(response([1], [1])).compilePlan({
      compilerBrief: '[SOURCE REQUIREMENTS - ORIGINAL ONLY]', language: 'ja',
      sourceOwnedPageContext: true, sourceRequirements: requirements,
    })).resolves.toBeDefined();
  });

  it('跨頁after関係がpage順序と逆転する場合は拒否する', async () => {
    const page1 = '11111111-1111-4111-8111-111111111111';
    const page2 = '22222222-2222-4222-8222-222222222222';
    const client = {
      postJson: async () => ({
        body: { output_text: JSON.stringify({
          source_requirement_placements: [
            { requirement_id: 'p1-u1-r1', page_id: page1, panel_orders: [1] },
            { requirement_id: 'p2-u1-r2', page_id: page2, panel_orders: [1] },
          ],
          pages: [
            { page_id: page1, page_number: 1, panels: [{ order: 1, entities: [] }] },
            { page_id: page2, page_number: 2, panels: [{ order: 1, entities: [] }] },
          ],
        }) }, requestId: 'req-cross-page-order',
      }),
    } as unknown as OpenAIClient;
    const common = {
      results: [], conditionalUntil: null, requiredByEnd: true, context: null, emotion: null,
      function: null, camera: null, framing: null, quotedText: [],
    };

    await expect(new OpenAIPageEpisodePlanCompiler(client).compilePlan({
      compilerBrief: '[SOURCE REQUIREMENTS - ORIGINAL ONLY]', language: 'ja',
      sourceOwnedPageContext: true, sourceRequirementPlacementPageIds: [page1, page2],
      sourceRequirements: { requirements: [{
        ...common, requirementId: 'p1-u1-r1', scope: 'page', pageId: page1, pageNumber: 1,
        sourceUnitIds: ['p1-u1'], order: 1, events: ['先行'], afterRequirementIds: ['p2-u1-r2'],
      }, {
        ...common, requirementId: 'p2-u1-r2', scope: 'page', pageId: page2, pageNumber: 2,
        sourceUnitIds: ['p2-u1'], order: 1, events: ['後続'], afterRequirementIds: [],
      }] },
    })).rejects.toThrow('relation contradicts page order');
  });

  it('source requirement placementが存在しないpanelを参照する場合は構造検査で拒否する', async () => {
    const pageId = '11111111-1111-4111-8111-111111111111';
    const client = {
      postJson: async () => ({
        body: { output_text: JSON.stringify({
          pages: [{ page_id: pageId, page_number: 1, panels: [{ order: 1, entities: [] }] }],
          source_requirement_placements: [{
            requirement_id: 'p1-u1-r1', page_id: pageId, panel_orders: [2],
          }],
        }) },
        requestId: 'req-invalid-placement',
      }),
    } as unknown as OpenAIClient;

    await expect(new OpenAIPageEpisodePlanCompiler(client).compilePlan({
      compilerBrief: '[SOURCE REQUIREMENTS - ORIGINAL ONLY]',
      language: 'ja',
      sourceOwnedPageContext: true,
      sourceRequirements: { requirements: [{
        requirementId: 'p1-u1-r1', scope: 'page' as const, pageId, pageNumber: 1, sourceUnitIds: ['p1-u1'], order: 1,
        events: ['扉を開く'], results: ['中へ入る'], afterRequirementIds: [], conditionalUntil: null,
        requiredByEnd: true, context: null, emotion: null, function: null, camera: null,
        framing: null, quotedText: [],
      }] },
    })).rejects.toBeInstanceOf(ConfigurationError);
  });

  it('global contextだけの場合はvisible eventのpanel placementを要求しない', async () => {
    const pageId = '11111111-1111-4111-8111-111111111111';
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        return {
          body: { output_text: JSON.stringify({
            source_requirement_placements: [],
            pages: [{ page_id: pageId, page_number: 1, panels: [{ order: 1, entities: [] }] }],
          }) }, requestId: 'req-global-context',
        };
      },
    } as unknown as OpenAIClient;

    await expect(new OpenAIPageEpisodePlanCompiler(client).compilePlan({
      compilerBrief: '[GLOBAL SOURCE CONTEXT/STYLE/CONSTRAINTS]', language: 'ja',
      sourceOwnedPageContext: true,
      sourceRequirementPlacementPageIds: [pageId],
      sourceRequirements: { requirements: [{
        requirementId: 'global-u1-r1', scope: 'global', pageId: null, pageNumber: null,
        sourceUnitIds: ['global-u1'], order: 1, events: [], results: [], afterRequirementIds: [],
        conditionalUntil: null, requiredByEnd: false, context: '全頁同じ衣装', emotion: null,
        function: null, camera: null, framing: null, quotedText: [],
      }] },
    })).resolves.toBeDefined();
    const schema = (requests[0]?.text as {
      format: { schema: { properties: { source_requirement_placements: { maxItems: number } } } };
    }).format.schema;
    expect(schema.properties.source_requirement_placements.maxItems).toBe(0);
  });
});

function validCompilerResponse(): {
  body: { output_text: string };
  requestId: string;
} {
  return {
    body: {
      output_text: JSON.stringify({
        pages: [{
          page_id: '11111111-1111-4111-8111-111111111111',
          page_number: 1,
          panels: [{ order: 1, entities: [] }],
        }],
      }),
    },
    requestId: 'req-success',
  };
}
