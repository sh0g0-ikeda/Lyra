import { STORY_SPEAKER_POLICY, STORY_DIALOGUE_FLOW_POLICY, STORY_SOURCE_POLICY, STORY_TEXT_POLICY, STORY_PANEL_POLICY } from '../../../../src/infrastructure/openai/StoryEditorialPrompts.js';
import { describe, expect, it } from 'vitest';
import { STORY_AI_LIMITS } from '../../../../src/domain/constants/storyAi.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIPageEpisodePlanCompiler } from '../../../../src/infrastructure/openai/OpenAIPageEpisodePlanCompiler.js';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { StructuredOpenAIResponseError } from '../../../../src/infrastructure/openai/StructuredOpenAIResponse.js';

const ENTITY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ENTITY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FOREIGN_ENTITY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CHARACTER_REFERENCES = [
  { ref: 'E1', entityId: ENTITY_A, name: '鍵', entityType: 'object' as const },
  { ref: 'E2', entityId: ENTITY_B, name: 'ミナ', entityType: 'character' as const },
] as const;

function readObjectValue(value: unknown): Record<string, unknown> {
  expect(value).toBeTypeOf('object');
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

function readArrayValue(value: unknown): unknown[] {
  expect(Array.isArray(value)).toBe(true);
  return value as unknown[];
}

function countEnumValues(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countEnumValues(item), 0);
  }
  if (typeof value !== 'object' || value === null) {
    return 0;
  }
  return Object.entries(value).reduce((total, [key, item]) =>
    total + (key === 'enum' && Array.isArray(item) ? item.length : countEnumValues(item)), 0);
}

describe('OpenAIPageEpisodePlanCompiler', () => {
  it('local character refsをschemaとpromptに固定しspeakerを実IDへ復元する', async () => {
    let request: Record<string, unknown> | undefined;
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        request = payload;
        return {
          body: {
            status: 'completed',
            output_text: JSON.stringify({
              pages: [{
                page_id: '11111111-1111-4111-8111-111111111111',
                page_number: 1,
                source_scene_ids: [],
                page_purpose: null,
                continuity_note: null,
                page: null,
                panels: [{
                  order: 1,
                  panel_role: 'action',
                  panel_size: 'standard',
                  situation_text: '会話する。',
                  composition: null,
                  dialogue_in_panel: true,
                  dialogue: [
                    { entity_id: FOREIGN_ENTITY, text: '不明な参照も完了する。', type: 'speech', position: 'right' },
                    { entity_id: ENTITY_B, text: '既知UUIDも移行できる。', type: 'thought', position: 'left' },
                    { entity_id: 'E2', text: '地の文。', type: 'narration', position: 'top' },
                  ],
                  sfx_text: null,
                  background_note: null,
                  panel_notes: null,
                  entities: [{
                    entity_id: 'E2', role: 'primary', expression: 'calm', custom_expression: null,
                    action: 'standing_firm', custom_action: null, position: 'center',
                    facing_direction: null, effect_note: null, state_id: FOREIGN_ENTITY,
                  }],
                }],
              }],
            }),
          },
        };
      },
    } as unknown as OpenAIClient;

    const originalBrief = `Allowed entities:\n${ENTITY_A}: 鍵\n${ENTITY_B}: ミナ\nQuoted story: 「${ENTITY_A}」\nstate_id=${ENTITY_A}`;
    const result = await new OpenAIPageEpisodePlanCompiler(client).compilePlan({
      compilerBrief: originalBrief,
      language: 'ja',
      characterReferences: CHARACTER_REFERENCES,
    });

    expect(result.suggestion.pages[0]?.panels[0]?.dialogue).toEqual([
      { entityId: ENTITY_B, text: '不明な参照も完了する。', type: 'speech', position: 'right' },
      { entityId: ENTITY_B, text: '既知UUIDも移行できる。', type: 'thought', position: 'left' },
      { entityId: null, text: '地の文。', type: 'narration', position: 'top' },
    ]);
    expect(result.suggestion.pages[0]?.panels[0]?.entities?.[0]?.entityId).toBe(ENTITY_B);
    expect(result.suggestion.pages[0]?.panels[0]?.entities?.[0]?.stateId).toBe(FOREIGN_ENTITY);

    const text = readObjectValue(request?.text);
    const format = readObjectValue(text.format);
    const schema = readObjectValue(format.schema);
    const schemaProperties = readObjectValue(schema.properties);
    const pages = readObjectValue(schemaProperties.pages);
    const pageItems = readObjectValue(pages.items);
    const pageProperties = readObjectValue(pageItems.properties);
    const panels = readObjectValue(pageProperties.panels);
    const panelItems = readObjectValue(panels.items);
    const panelProperties = readObjectValue(panelItems.properties);
    const dialogue = readObjectValue(panelProperties.dialogue);
    const dialogueArray = readObjectValue(readArrayValue(dialogue.anyOf)[0]);
    const dialogueItems = readObjectValue(dialogueArray.items);
    expect(readObjectValue(dialogueItems.properties).entity_id).toEqual({
      anyOf: [{ type: 'string', enum: ['E1', 'E2'] }, { type: 'null' }],
    });
    const entities = readObjectValue(panelProperties.entities);
    const entityItems = readObjectValue(entities.items);
    expect(readObjectValue(entityItems.properties).entity_id).toEqual({
      type: 'string', enum: ['E1', 'E2'],
    });
    const prompt = JSON.stringify(request?.input);
    expect(prompt).toContain('E1');
    expect(prompt).toContain('E2');
    expect(prompt).toContain('鍵');
    expect(prompt).toContain('fallback ref E2');
    const requestInput = readArrayValue(request?.input);
    const userContent = readArrayValue(readObjectValue(requestInput[1]).content);
    const userText = readObjectValue(userContent[0]).text;
    expect(userText).toBeTypeOf('string');
    expect(userText as string).toContain(`${originalBrief}\n\n[SERVER ENTITY REFERENCE CATALOG]`);
    expect(prompt).toContain(`E1 | entity_id=${ENTITY_A}`);
    expect(prompt).toContain(`E2 | entity_id=${ENTITY_B}`);
  });

  it('local character refs modeは未知のvisible assignmentを推測せずbounded retryする', async () => {
    let requestCount = 0;
    const response = (entityId: string) => ({
      pages: [{
        page_id: '11111111-1111-4111-8111-111111111111', page_number: 1,
        source_scene_ids: [], page_purpose: null, continuity_note: null, page: null,
        panels: [{
          order: 1, panel_role: 'action', panel_size: 'standard', situation_text: null,
          composition: null, dialogue_in_panel: false, dialogue: [], sfx_text: null,
          background_note: null, panel_notes: null,
          entities: [{ entity_id: entityId, role: 'primary', expression: 'calm',
            custom_expression: null, action: 'standing_firm', custom_action: null,
            position: 'center', facing_direction: null, effect_note: null, state_id: null }],
        }],
      }],
    });
    const client = {
      postJson: async () => ({
        body: { status: 'completed', output_text: JSON.stringify(response(requestCount++ === 0 ? FOREIGN_ENTITY : 'E1')) },
      }),
    } as unknown as OpenAIClient;

    await expect(new OpenAIPageEpisodePlanCompiler(client).compilePlan({
      compilerBrief: 'fixture', language: 'ja', characterReferences: CHARACTER_REFERENCES,
    })).resolves.toMatchObject({ suggestion: { pages: [{ panels: [{ entities: [{ entityId: ENTITY_A }] }] }] } });
    expect(requestCount).toBe(2);
  });

  it('local character refをstate_idへ流用せずUUID契約で再試行する', async () => {
    let requestCount = 0;
    const response = (stateId: string | null) => ({
      pages: [{
        page_id: '11111111-1111-4111-8111-111111111111', page_number: 1,
        source_scene_ids: [], page_purpose: null, continuity_note: null, page: null,
        panels: [{
          order: 1, panel_role: 'action', panel_size: 'standard', situation_text: null,
          composition: null, dialogue_in_panel: false, dialogue: [], sfx_text: null,
          background_note: null, panel_notes: null,
          entities: [{ entity_id: 'E1', role: 'primary', expression: 'calm',
            custom_expression: null, action: 'standing_firm', custom_action: null,
            position: 'center', facing_direction: null, effect_note: null, state_id: stateId }],
        }],
      }],
    });
    const client = {
      postJson: async () => ({
        body: { status: 'completed', output_text: JSON.stringify(response(requestCount++ === 0 ? 'E2' : null)) },
      }),
    } as unknown as OpenAIClient;

    await expect(new OpenAIPageEpisodePlanCompiler(client).compilePlan({
      compilerBrief: 'fixture', language: 'ja', characterReferences: CHARACTER_REFERENCES,
    })).resolves.toMatchObject({ suggestion: { pages: [{ panels: [{ entities: [{
      entityId: ENTITY_A, stateId: null,
    }] }] }] } });
    expect(requestCount).toBe(2);
  });

  it('1000件超のcatalogでもenum上限を避けlate refをallowlistで復元する', async () => {
    const references = Array.from({ length: 1_001 }, (_, index) => ({
      ref: `E${index + 1}`,
      entityId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: `Entity ${index + 1}`,
      entityType: index === 0 ? 'object' as const : 'character' as const,
    }));
    const fallbackEntityId = references[1]!.entityId;
    const lateEntityId = references[1_000]!.entityId;
    let request: Record<string, unknown> | undefined;
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        request = payload;
        return { body: { status: 'completed', output_text: JSON.stringify({ pages: [{
          page_id: '11111111-1111-4111-8111-111111111111', page_number: 1,
          source_scene_ids: [], page_purpose: null, continuity_note: null, page: null,
          panels: [{
            order: 1, panel_role: 'action', panel_size: 'standard', situation_text: null,
            composition: null, dialogue_in_panel: true,
            dialogue: [
              { entity_id: FOREIGN_ENTITY, text: 'fallback', type: 'speech', position: 'right' },
              { entity_id: 'E1001', text: 'late ref', type: 'speech', position: 'left' },
            ],
            sfx_text: null, background_note: null, panel_notes: null,
            entities: [{ entity_id: 'E1001', role: 'primary', expression: 'calm',
              custom_expression: null, action: 'standing_firm', custom_action: null,
              position: 'center', facing_direction: null, effect_note: null, state_id: null }],
          }],
        }] }) } };
      },
    } as unknown as OpenAIClient;

    const result = await new OpenAIPageEpisodePlanCompiler(client).compilePlan({
      compilerBrief: 'large catalog', language: 'ja', characterReferences: references,
    });

    expect(result.suggestion.pages[0]?.panels[0]?.dialogue?.map((line) => line.entityId))
      .toEqual([fallbackEntityId, lateEntityId]);
    expect(result.suggestion.pages[0]?.panels[0]?.entities?.[0]?.entityId).toBe(lateEntityId);
    const schema = readObjectValue(readObjectValue(readObjectValue(request?.text).format).schema);
    expect(countEnumValues(schema)).toBeLessThanOrEqual(1_000);
    expect(JSON.stringify(schema)).toContain('^[A-Z][A-Z0-9_-]{0,31}$');
    expect(JSON.stringify(schema)).not.toContain('"E1001"');
  });

  it('entity catalogが空の場合はnarrationと空のvisible entitiesだけを許可する', async () => {
    let request: Record<string, unknown> | undefined;
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        request = payload;
        return { body: { status: 'completed', output_text: JSON.stringify({
          pages: [{
            page_id: '11111111-1111-4111-8111-111111111111', page_number: 1,
            source_scene_ids: [], page_purpose: null, continuity_note: null, page: null,
            panels: [{
              order: 1, panel_role: 'narration', panel_size: 'standard', situation_text: null,
              composition: null, dialogue_in_panel: true,
              dialogue: [{ entity_id: null, text: '静かな夜。', type: 'narration', position: 'top' }],
              sfx_text: null, background_note: null, panel_notes: null, entities: [],
            }],
          }],
        }) } };
      },
    } as unknown as OpenAIClient;

    await expect(new OpenAIPageEpisodePlanCompiler(client).compilePlan({
      compilerBrief: 'fixture', language: 'ja', characterReferences: [],
    })).resolves.toMatchObject({ suggestion: { pages: [{ panels: [{
      dialogue: [{ entityId: null, type: 'narration' }], entities: [],
    }] }] } });

    const schema = readObjectValue(readObjectValue(readObjectValue(request?.text).format).schema);
    const pages = readObjectValue(readObjectValue(schema.properties).pages);
    const panels = readObjectValue(readObjectValue(readObjectValue(pages.items).properties).panels);
    const panelProperties = readObjectValue(readObjectValue(panels.items).properties);
    const dialogueArray = readObjectValue(readArrayValue(readObjectValue(panelProperties.dialogue).anyOf)[0]);
    const dialogueProperties = readObjectValue(readObjectValue(dialogueArray.items).properties);
    expect(dialogueProperties.entity_id).toEqual({ type: 'null' });
    expect(dialogueProperties.type).toEqual({ type: 'string', enum: ['narration'] });
    expect(readObjectValue(panelProperties.entities).maxItems).toBe(0);
  });

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
      compilerPromptVersion: 'episode_page_plan_v18',
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

  it('nullable自由記述の空白だけをnullへ正規化し必須台詞の空白は拒否する', async () => {
    let returnBlankDialogue = false;
    const client = {
      postJson: async () => ({
        body: {
          output_text: JSON.stringify({
            pages: [{
              page_id: '11111111-1111-4111-8111-111111111111',
              page_number: 1,
              source_scene_ids: [],
              page_purpose: '   ',
              continuity_note: '\t',
              page: null,
              panels: [{
                order: 1,
                panel_role: 'action',
                panel_size: 'standard',
                situation_text: '  ',
                composition: {
                  source: 'custom',
                  gallery_item_id: ' ',
                  composition_prompt: '\n',
                  shot_type: null,
                  angle: null,
                  custom_note: '\t ',
                },
                dialogue_in_panel: true,
                dialogue: returnBlankDialogue
                  ? [{ entity_id: null, text: '  ', type: 'narration', position: 'top' }]
                  : [],
                sfx_text: ' ',
                background_note: '\n',
                panel_notes: '\t',
                entities: [{
                  entity_id: '22222222-2222-4222-8222-222222222222',
                  role: 'primary',
                  expression: 'custom',
                  custom_expression: ' ',
                  action: 'custom',
                  custom_action: '\t',
                  position: 'center',
                  facing_direction: null,
                  effect_note: '\n',
                  state_id: null,
                }],
              }],
            }],
          }),
        },
        requestId: 'req-blank-nullable-text',
      }),
    } as unknown as OpenAIClient;
    const compiler = new OpenAIPageEpisodePlanCompiler(client);

    await expect(compiler.compilePlan({ compilerBrief: '[TASK]\nReturn JSON.', language: 'ja' }))
      .resolves.toMatchObject({
        suggestion: {
          pages: [{
            pagePurpose: null,
            continuityNote: null,
            panels: [{
              situationText: null,
              composition: {
                galleryItemId: null,
                compositionPrompt: null,
                customNote: null,
              },
              sfxText: null,
              backgroundNote: null,
              panelNotes: null,
              entities: [{ customExpression: null, customAction: null, effectNote: null }],
            }],
          }],
        },
      });

    returnBlankDialogue = true;
    await expect(compiler.compilePlan({ compilerBrief: '[TASK]\nReturn JSON.', language: 'ja' }))
      .rejects.toMatchObject({ reason: 'invalid_payload' });
  });

  it('nullable自由記述は非空を既存trimで保持し上限超過を切り捨てずID空文字も拒否する', async () => {
    type ResponseVariant = 'valid_text' | 'oversized_sfx' | 'blank_state_id';
    let variant: ResponseVariant = 'valid_text';
    let requestCount = 0;
    const client = {
      postJson: async () => {
        requestCount += 1;
        const entities = variant === 'blank_state_id'
          ? [{
              entity_id: '22222222-2222-4222-8222-222222222222',
              role: 'primary',
              expression: 'calm',
              custom_expression: null,
              action: 'standing_firm',
              custom_action: null,
              position: 'center',
              facing_direction: null,
              effect_note: null,
              state_id: ' ',
            }]
          : [];
        return {
          body: {
            output_text: JSON.stringify({
              pages: [{
                page_id: '11111111-1111-4111-8111-111111111111',
                page_number: 1,
                panels: [{
                  order: 1,
                  sfx_text: variant === 'oversized_sfx' ? 'x'.repeat(201) : '  ドン  ',
                  entities,
                }],
              }],
            }),
          },
          requestId: `req-bounded-nullable-text-${requestCount}`,
        };
      },
    } as unknown as OpenAIClient;
    const compiler = new OpenAIPageEpisodePlanCompiler(client);

    await expect(compiler.compilePlan({ compilerBrief: '[TASK]\nReturn JSON.', language: 'ja' }))
      .resolves.toMatchObject({
        suggestion: { pages: [{ panels: [{ sfxText: 'ドン' }] }] },
      });
    expect(requestCount).toBe(1);

    variant = 'oversized_sfx';
    requestCount = 0;
    await expect(compiler.compilePlan({ compilerBrief: '[TASK]\nReturn JSON.', language: 'ja' }))
      .rejects.toMatchObject({ reason: 'invalid_payload' });
    expect(requestCount).toBe(2);

    variant = 'blank_state_id';
    requestCount = 0;
    await expect(compiler.compilePlan({ compilerBrief: '[TASK]\nReturn JSON.', language: 'ja' }))
      .rejects.toMatchObject({ reason: 'invalid_payload' });
    expect(requestCount).toBe(2);
  });

  it('state_idを既存UUIDまたはdefault用nullに限定してproviderへ要求する', async () => {
    const requests: Array<Record<string, unknown>> = [];
    let responseStateId: string | null = '33333333-3333-4333-8333-333333333333';
    let responseDialogueEntityId: string | null = '22222222-2222-4222-8222-222222222222';
    let requestCount = 0;
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        requestCount += 1;
        return {
          body: {
            output_text: JSON.stringify({
              pages: [{
                page_id: '11111111-1111-4111-8111-111111111111',
                page_number: 1,
                panels: [{
                  order: 1,
                  dialogue: [{ entity_id: responseDialogueEntityId, text: '確認する。', type: 'speech', position: 'top' }],
                  entities: [{
                    entity_id: '22222222-2222-4222-8222-222222222222',
                    role: 'primary',
                    expression: 'calm',
                    custom_expression: null,
                    action: 'standing_firm',
                    custom_action: null,
                    position: 'center',
                    facing_direction: null,
                    effect_note: null,
                    state_id: responseStateId,
                  }],
                }],
              }],
            }),
          },
          requestId: `req-state-id-contract-${requestCount}`,
        };
      },
    } as unknown as OpenAIClient;
    const compiler = new OpenAIPageEpisodePlanCompiler(client);

    await expect(compiler.compilePlan({ compilerBrief: '[TASK]\nReturn JSON.', language: 'ja' }))
      .resolves.toMatchObject({
        suggestion: { pages: [{ panels: [{ entities: [{ stateId: responseStateId }] }] }] },
      });
    responseStateId = null;
    responseDialogueEntityId = null;
    await expect(compiler.compilePlan({ compilerBrief: '[TASK]\nReturn JSON.', language: 'ja' }))
      .resolves.toMatchObject({
        suggestion: { pages: [{ panels: [{ entities: [{ stateId: null }] }] }] },
      });

    const schema = (requests[0]?.text as {
      format: {
        schema: {
          properties: {
            pages: {
              items: {
                properties: {
                  panels: {
                    items: {
                      properties: {
                        entities: {
                          items: {
                            properties: {
                              state_id: { anyOf: Array<{ type: string; format?: string }> };
                            };
                          };
                        };
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }).format.schema;
    const stateIdSchema = schema.properties.pages.items.properties.panels.items
      .properties.entities.items.properties.state_id;
    expect(stateIdSchema.anyOf).toEqual([
      { type: 'string', format: 'uuid' },
      { type: 'null' },
    ]);
    const pageProperties = schema.properties.pages.items.properties as unknown as {
      page_id: unknown;
      source_scene_ids: { items: unknown };
      panels: { items: { properties: { entities: { items: { properties: { entity_id: unknown } } }; dialogue: { anyOf: Array<{ items: { properties: { entity_id: unknown } } }> } } } };
    };
    expect(pageProperties.page_id).toEqual({ type: 'string', format: 'uuid' });
    expect(pageProperties.source_scene_ids.items).toEqual({ type: 'string', format: 'uuid' });
    expect(pageProperties.panels.items.properties.entities.items.properties.entity_id)
      .toEqual({ type: 'string', format: 'uuid' });
    expect(pageProperties.panels.items.properties.dialogue.anyOf[0]?.items.properties.entity_id)
      .toEqual({ anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] });
    const systemPrompt = (requests[0]?.input as Array<{ content: Array<{ text: string }> }>)[0]
      ?.content[0]?.text ?? '';
    expect(systemPrompt).toContain(
      'state_id must be an existing state UUID or JSON null for the default state; never use strings such as default or none',
    );
    expect(systemPrompt).toContain('Identifier fields must copy only supplied UUIDs; use JSON null for an ambiguous dialogue speaker');

    responseStateId = 'default';
    requestCount = 0;
    await expect(compiler.compilePlan({ compilerBrief: '[TASK]\nReturn JSON.', language: 'ja' }))
      .rejects.toMatchObject({ reason: 'invalid_payload' });
    expect(requestCount).toBe(2);
    responseStateId = null;
    for (const invalidDialogueEntityId of ['奏', 'null']) {
      responseDialogueEntityId = invalidDialogueEntityId;
      requestCount = 0;
      await expect(compiler.compilePlan({ compilerBrief: '[TASK]\nReturn JSON.', language: 'ja' }))
        .rejects.toMatchObject({ reason: 'invalid_payload' });
      expect(requestCount).toBe(2);
    }
  });

  it('provider schemaの文字列上限とpanel orderは保存時Zod契約に一致する', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        return validCompilerResponse();
      },
    } as unknown as OpenAIClient;
    await new OpenAIPageEpisodePlanCompiler(client).compilePlan({
      compilerBrief: '[TASK]\nReturn JSON.',
      language: 'ja',
    });

    type NullableTextJsonSchema = { anyOf: Array<{ maxLength?: number }> };
    const schema = (requests[0]?.text as {
      format: {
        schema: {
          properties: {
            pages: {
              items: {
                properties: {
                  page_purpose: NullableTextJsonSchema;
                  continuity_note: NullableTextJsonSchema;
                  panels: {
                    items: {
                      properties: {
                        order: { maximum: number };
                        situation_text: NullableTextJsonSchema;
                        sfx_text: NullableTextJsonSchema;
                        background_note: NullableTextJsonSchema;
                        panel_notes: NullableTextJsonSchema;
                        composition: { anyOf: Array<{ properties: {
                          gallery_item_id: NullableTextJsonSchema;
                          composition_prompt: NullableTextJsonSchema;
                          custom_note: NullableTextJsonSchema;
                        } }> };
                        dialogue: { anyOf: Array<{ items: { properties: {
                          text: { minLength: number; maxLength: number };
                        } } }> };
                        entities: { items: { properties: {
                          custom_expression: NullableTextJsonSchema;
                          custom_action: NullableTextJsonSchema;
                          effect_note: NullableTextJsonSchema;
                        } } };
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }).format.schema;
    const page = schema.properties.pages.items.properties;
    const panel = page.panels.items.properties;
    const composition = panel.composition.anyOf[0]!.properties;
    const dialogue = panel.dialogue.anyOf[0]!.items.properties;
    const assignment = panel.entities.items.properties;

    expect(page.page_purpose.anyOf[0].maxLength).toBe(500);
    expect(page.continuity_note.anyOf[0].maxLength).toBe(1_000);
    expect(panel.order.maximum).toBe(1_000);
    expect(panel.situation_text.anyOf[0].maxLength).toBe(2_000);
    expect(panel.sfx_text.anyOf[0].maxLength).toBe(200);
    expect(panel.background_note.anyOf[0].maxLength).toBe(2_000);
    expect(panel.panel_notes.anyOf[0].maxLength).toBe(2_000);
    expect(composition.gallery_item_id.anyOf[0].maxLength).toBe(100);
    expect(composition.composition_prompt.anyOf[0].maxLength).toBe(1_000);
    expect(composition.custom_note.anyOf[0].maxLength).toBe(1_000);
    expect(dialogue.text).toMatchObject({ minLength: 1, maxLength: 500 });
    expect(assignment.custom_expression.anyOf[0].maxLength).toBe(200);
    expect(assignment.custom_action.anyOf[0].maxLength).toBe(200);
    expect(assignment.effect_note.anyOf[0].maxLength).toBe(500);
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
      format: { schema: { required: string[]; properties: { source_requirement_placements: { items: { properties: { page_id: unknown } } } } } };
    }).format.schema;
    expect(input[0]?.content[0]?.text).toContain('allocate every PAGE requirement');
    expect(input[0]?.content[0]?.text).toContain('derived draft metadata');
    expect(schema.required).toContain('source_requirement_placements');
    expect(Object.keys(schema.properties)[0]).toBe('source_requirement_placements');
    expect(schema.required[0]).toBe('source_requirement_placements');
    expect(schema.properties.source_requirement_placements.items.properties.page_id)
      .toEqual({ type: 'string', format: 'uuid' });
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
