import { describe, expect, it } from 'vitest';
import type { EpisodePagePlanContext } from '../../../../src/domain/types/page.js';
import { OpenAIClient } from '../../../../src/infrastructure/openai/OpenAIClient.js';
import { OpenAIEpisodeStateTransitionCompiler } from '../../../../src/infrastructure/openai/OpenAIEpisodeStateTransitionCompiler.js';

const ENTITY = '11111111-1111-4111-8111-111111111111';
const STATE = '22222222-2222-4222-8222-222222222222';
const PANEL = '33333333-3333-4333-8333-333333333333';

describe('OpenAIEpisodeStateTransitionCompiler', () => {
  it('final draft modeは音叉を握るだけの一時動作をstateにせず空planを保持する', async () => {
    let request: Record<string, unknown> | undefined;
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        request = payload;
        return { body: { output_text: JSON.stringify({
          plan_version: 'episode_state_plan_v1', state_transitions: [], unresolved_state_transitions: [],
        }) } };
      },
    } as unknown as OpenAIClient;
    const stateContext = context();
    stateContext.episode.storyFullDraft = '主人公は音叉を握る。';
    const finalSuggestion = { pages: [{ pageId: stateContext.pages[0]!.pageId, pageNumber: 1, panels: [{
      order: 1, situationText: '音叉を握る', entities: [{
        entityId: ENTITY, role: 'primary' as const, expression: 'determined' as const,
        customExpression: null, action: 'custom' as const, customAction: '音叉を握る',
        position: 'center' as const, facingDirection: null, effectNote: null, stateId: null,
      }],
    }] }] };

    await expect(new OpenAIEpisodeStateTransitionCompiler(client).compileStateTransitions({
      context: stateContext, language: 'ja', finalSuggestion, strictEvidence: true,
    })).resolves.toMatchObject({ plan: { transitions: [], unresolved: [] } });
    expect(JSON.stringify(request?.input)).toContain('holding an item');
  });

  it('final draft modeは外見deltaと開始コマのliteral証拠を必須にしてdomain planへ残す', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        return { body: { output_text: JSON.stringify({
          plan_version: 'episode_state_plan_v1', state_transitions: [],
          unresolved_state_transitions: [{
            entity_id: ENTITY, candidate_state_id: null, starts_at_panel_id: PANEL,
            source_scene_id: null, source_field: 'story_full_draft',
            source_quote: '髪が青白く発光する', suggested_name: '発光',
            suggested_description: '髪が青白く発光する',
            panel_evidence_quote: '髪が青白く発光する', replaces_deltas: [],
            reason: 'missing_reference',
          }],
        }) } };
      },
    } as unknown as OpenAIClient;
    const stateContext = context();
    stateContext.episode.storyFullDraft = '最後に髪が青白く発光する。';
    const finalSuggestion = {
      pages: [{ pageId: stateContext.pages[0]!.pageId, pageNumber: 1, panels: [{
        order: 1, situationText: '髪が青白く発光する', entities: [{
          entityId: ENTITY, role: 'primary' as const, expression: 'calm' as const,
          customExpression: null, action: 'standing_firm' as const, customAction: null,
          position: 'center' as const, facingDirection: null, effectNote: '髪が青白く発光する', stateId: null,
        }],
      }] }],
    };

    const result = await new OpenAIEpisodeStateTransitionCompiler(client).compileStateTransitions({
      context: stateContext, language: 'ja', finalSuggestion, strictEvidence: true,
    });

    expect(result.plan.unresolved[0]).toMatchObject({
      suggestedDescription: '髪が青白く発光する', panelEvidenceQuote: '髪が青白く発光する',
    });
    const request = requests[0]!;
    const schema = (request.text as { format: { schema: { properties: Record<string, unknown> } } }).format.schema;
    const unresolved = schema.properties.unresolved_state_transitions as { items: { required: string[] } };
    expect(unresolved.items.required).toContain('panel_evidence_quote');
    expect(unresolved.items.required).toContain('replaces_deltas');
    expect(JSON.stringify(request.input)).toContain('FINAL AUDITED PANELS');
    expect(JSON.stringify(request.input)).toContain('persistent visible appearance delta');
    expect(JSON.stringify(request.input)).toContain('separate unresolved entries');
  });

  it('final draft evidence不一致は既存2attempt内でfeedback後に再試行する', async () => {
    let requestCount = 0;
    let checkpointCount = 0;
    const client = {
      postJson: async () => {
        requestCount += 1;
        const panelEvidenceQuote = requestCount === 1 ? 'まだ光っていない' : '髪が青白く発光する';
        return { body: { output_text: JSON.stringify({
          plan_version: 'episode_state_plan_v1', state_transitions: [],
          unresolved_state_transitions: [{
            entity_id: ENTITY, candidate_state_id: null, starts_at_panel_id: PANEL,
            source_scene_id: null, source_field: 'story_full_draft', source_quote: '髪が青白く発光する',
            suggested_name: '発光', suggested_description: '髪が青白く発光する',
            panel_evidence_quote: panelEvidenceQuote, replaces_deltas: [],
            reason: 'missing_reference',
          }],
        }) } };
      },
    } as unknown as OpenAIClient;
    const stateContext = context();
    stateContext.episode.storyFullDraft = '最後に髪が青白く発光する。';
    const visibleEntity = {
      entityId: ENTITY, role: 'primary' as const, expression: 'calm' as const,
      customExpression: null, action: 'standing_firm' as const, customAction: null,
      position: 'center' as const, facingDirection: null, effectNote: '髪が青白く発光する', stateId: null,
    };
    const finalSuggestion = { pages: [{ pageId: stateContext.pages[0]!.pageId, pageNumber: 1, panels: [{
      order: 1, situationText: '髪が青白く発光する', entities: [visibleEntity],
    }] }] };

    await expect(new OpenAIEpisodeStateTransitionCompiler(client).compileStateTransitions({
      context: stateContext, language: 'ja', finalSuggestion, strictEvidence: true,
      beforeRetry: async () => { checkpointCount += 1; },
    })).resolves.toMatchObject({ plan: { unresolved: [{ startsAtPanelId: PANEL }] } });
    expect(requestCount).toBe(2);
    expect(checkpointCount).toBe(1);
  });
  it('新しい状態抽出モデルの場合にlow推論と既存schemaを一回の要求で送る', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        return { body: { output_text: JSON.stringify({
          plan_version: 'episode_state_plan_v1', state_transitions: [], unresolved_state_transitions: [],
        }) }, requestId: 'req-v2-state' };
      },
    } as unknown as OpenAIClient;
    const result = await new OpenAIEpisodeStateTransitionCompiler(client, 'gpt-6.1-sol', 'low')
      .compileStateTransitions({ context: context(), language: 'ja' });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: 'gpt-6.1-sol', reasoning: { effort: 'low' }, max_output_tokens: 12_000,
      text: { format: { name: 'episode_state_transition_plan', strict: true } },
    });
    expect(result.compilerModel).toBe('gpt-6.1-sol');
  });

  it('strict schemaで状態遷移を検証してdomain planへ変換し、S3 keyを送らない', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        return {
          body: { output_text: JSON.stringify({
            plan_version: 'episode_state_plan_v1',
            state_transitions: [{ entity_id: ENTITY, state_id: STATE, starts_at_panel_id: PANEL, source_scene_id: null, source_field: 'middle', source_quote: '腕を負傷した' }],
            unresolved_state_transitions: [],
          }) },
          requestId: 'req-state-transition',
        };
      },
    } as unknown as OpenAIClient;

    const result = await new OpenAIEpisodeStateTransitionCompiler(client).compileStateTransitions({
      context: context(), language: 'ja',
    });

    expect(result.plan.transitions).toEqual([{ entityId: ENTITY, stateId: STATE, startsAtPanelId: PANEL, sourceSceneId: null, sourceField: 'middle', sourceQuote: '腕を負傷した' }]);
    expect(result.compilerPromptVersion).toBe('episode_state_transition_v6');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.model).toBe('gpt-5');
    expect(requests[0]!.reasoning).toBeUndefined();
    const request = requests[0]!;
    const input = request.input as Array<{ content: Array<{ text: string }> }>;
    const userBrief = input[1]!.content[0]!.text;
    const systemPrompt = input[0]!.content[0]!.text;
    expect(userBrief).not.toContain('private/state.png');
    expect(userBrief).not.toContain('owner-secret');
    expect(systemPrompt).toContain('visual-only fallback');
    expect(systemPrompt).toContain('Do not request or create a new state');
    expect(systemPrompt).toContain('Do not drop an earlier unended visible change');
    expect(systemPrompt).toContain('Keep suggested_description concise');
    const schema = (request.text as { format: { strict: boolean; schema: Record<string, unknown> } }).format;
    expect(schema.strict).toBe(true);
    const properties = schema.schema.properties as Record<string, unknown>;
    const transitions = properties.state_transitions as { items: { properties: Record<string, unknown> } };
    expect(transitions.items.properties.entity_id).toEqual({ type: 'string', enum: [ENTITY] });
    expect(transitions.items.properties.starts_at_panel_id).toEqual({ type: 'string', enum: [PANEL] });
  });

  it('retryableなstructured payload失敗だけを一度retryする', async () => {
    const outputs = [
      { output_text: '{"plan_version":"episode_state_plan_v1"}' },
      { output_text: JSON.stringify({ plan_version: 'episode_state_plan_v1', state_transitions: [], unresolved_state_transitions: [] }) },
    ];
    let retries = 0;
    const client = {
      postJson: async () => ({ body: outputs.shift(), requestId: `req-${outputs.length}` }),
    } as unknown as OpenAIClient;

    await expect(new OpenAIEpisodeStateTransitionCompiler(client).compileStateTransitions({
      context: context(), language: 'ja', beforeRetry: async () => { retries += 1; },
    })).resolves.toMatchObject({ plan: { transitions: [], unresolved: [] } });
    expect(retries).toBe(1);
  });

  it('未確定stateをstate transition候補に出さず、blank outputをZodと同じ規則でretryする', async () => {
    const outputs = [
      { output_text: JSON.stringify({ plan_version: 'episode_state_plan_v1', state_transitions: [{ entity_id: ENTITY, state_id: null, starts_at_panel_id: PANEL, source_scene_id: null, source_field: 'middle', source_quote: '   ' }], unresolved_state_transitions: [] }) },
      { output_text: JSON.stringify({ plan_version: 'episode_state_plan_v1', state_transitions: [], unresolved_state_transitions: [] }) },
    ];
    const requests: Array<Record<string, unknown>> = [];
    let retries = 0;
    const client = {
      postJson: async (_path: string, payload: Record<string, unknown>) => {
        requests.push(payload);
        return { body: outputs.shift(), requestId: `req-${requests.length}` };
      },
    } as unknown as OpenAIClient;
    const pending = context();
    pending.stateLibrary![0]!.referenceReady = false;

    await expect(new OpenAIEpisodeStateTransitionCompiler(client).compileStateTransitions({
      context: pending, language: 'ja', beforeRetry: async () => { retries += 1; },
    })).resolves.toMatchObject({ plan: { transitions: [] } });
    expect(retries).toBe(1);
    const schema = ((requests[0]!.text as { format: { schema: Record<string, unknown> } }).format.schema.properties as Record<string, unknown>);
    const transitionItems = (schema.state_transitions as { items: { properties: Record<string, unknown> } }).items;
    expect(transitionItems.properties.state_id).toEqual({ type: 'null' });
    expect(transitionItems.properties.source_quote).toMatchObject({ pattern: '.*\\S.*' });
  });

  it('未確定stateはcandidate_state_id付きのunresolvedとして変換する', async () => {
    const client = {
      postJson: async () => ({ body: { output_text: JSON.stringify({
        plan_version: 'episode_state_plan_v1',
        state_transitions: [],
        unresolved_state_transitions: [{ entity_id: ENTITY, candidate_state_id: STATE, starts_at_panel_id: PANEL, source_scene_id: null, source_field: 'middle', source_quote: '腕を負傷した', suggested_name: '負傷', suggested_description: '腕に包帯', reason: 'missing_reference' }],
      }) }, requestId: 'req-candidate' }),
    } as unknown as OpenAIClient;
    const pending = context();
    pending.stateLibrary![0]!.referenceReady = false;

    await expect(new OpenAIEpisodeStateTransitionCompiler(client).compileStateTransitions({
      context: pending, language: 'ja',
    })).resolves.toMatchObject({
      plan: { unresolved: [{ candidateStateId: STATE, reason: 'missing_reference' }] },
    });
  });

  it('空の識別子enumや過大なinputをproviderへ送らず明示エラーにする', async () => {
    let calls = 0;
    const client = { postJson: async () => { calls += 1; return { body: {}, requestId: 'unexpected' }; } } as unknown as OpenAIClient;
    const empty = context();
    empty.pages = [];

    await expect(new OpenAIEpisodeStateTransitionCompiler(client).compileStateTransitions({
      context: empty, language: 'ja',
    })).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(calls).toBe(0);
  });
});

function context(): EpisodePagePlanContext {
  return {
    episodeId: '44444444-4444-4444-8444-444444444444', workId: '55555555-5555-4555-8555-555555555555',
    chapter: { id: '66666666-6666-4666-8666-666666666666', title: null, purpose: null, startingState: null, endingState: null, emotionCurve: null, keyBeats: [] },
    episode: { title: null, purpose: null, storyFullDraft: '主人公は腕を負傷した。', introduction: null, middle: '腕を負傷した', climax: null, endingHook: null, estimatedPages: 1, startingEntityStates: [] },
    scenes: [],
    entities: [{ id: ENTITY, name: '主人公', entityType: 'character', freeDescription: null, promptSupplement: null, structuredFields: {} }],
    stateLibrary: [{ entityId: ENTITY, stateId: STATE, name: '負傷', description: '腕に包帯', revision: null, baseRefId: null, baseRefUpdatedAt: null, referenceImage: { refId: 'ref', s3Key: 'private/state.png', storageOwnerUserId: 'owner-secret', imageModel: 'gpt-image-1', baseRefId: 'base', createdAt: '2026-09-30T00:00:00.000Z', inputFingerprint: 'fingerprint' }, referenceReady: true }],
    pages: [{ pageId: '77777777-7777-4777-8777-777777777777', pageNumber: 1, frameCount: 1, layoutConfig: {}, status: 'designing', dialogueMode: 'mixed', pageDialogueToggle: true, panels: [{ id: PANEL, order: 1, panelRole: 'action', panelSize: 'standard', situationText: null, composition: { source: 'ai_auto', galleryItemId: null, compositionPrompt: null, shotType: null, angle: null, customNote: null }, dialogueInPanel: false, dialogue: [], sfxText: null, backgroundNote: null, panelNotes: null, entities: [] }] }],
  };
}
