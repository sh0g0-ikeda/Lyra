import { describe, expect, it } from 'vitest';
import type { EpisodePagePlanContext, EpisodePagePlanSuggestion } from '../../../../src/domain/types/page.js';
import type { EpisodeStateTransition } from '../../../../src/domain/types/episodeStateTransition.js';
import { EpisodeStatePlanError } from '../../../../src/services/page/EpisodeStateAssignmentResolver.js';
import {
  resolveEpisodeStateTransitionPlan,
  validateEpisodeStateTransitionPlan,
} from '../../../../src/services/page/EpisodeStateTransitionPlan.js';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const INJURED = '33333333-3333-4333-8333-333333333333';
const SCENE = '44444444-4444-4444-8444-444444444444';
const PANEL = '55555555-5555-4555-8555-555555555555';
const PANEL_TWO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function context(): EpisodePagePlanContext {
  return {
    episodeId: '66666666-6666-4666-8666-666666666666',
    workId: '77777777-7777-4777-8777-777777777777',
    chapter: {
      id: '88888888-8888-4888-8888-888888888888',
      title: null,
      purpose: null,
      startingState: null,
      endingState: null,
      emotionCurve: null,
      keyBeats: [],
    },
    episode: {
      title: null,
      purpose: null,
      storyFullDraft: '駅前で主人公は腕を負傷した。',
      introduction: '駅前で待っていた。',
      middle: '主人公は腕を負傷した。',
      climax: null,
      endingHook: null,
      estimatedPages: 1,
      startingEntityStates: [],
    },
    scenes: [{
      id: SCENE,
      order: 1,
      location: '駅前',
      time: '夕方',
      atmosphere: '緊迫',
      involvedEntityIds: [ACTOR],
      entityStates: [],
    }],
    entities: [ACTOR, OTHER].map((id) => ({
      id,
      name: id === ACTOR ? '主人公' : '友人',
      entityType: 'character' as const,
      freeDescription: null,
      promptSupplement: null,
      structuredFields: {},
    })),
    stateLibrary: [{
      entityId: ACTOR,
      stateId: INJURED,
      name: '負傷',
      description: '腕に包帯',
      revision: '2026-09-30T00:00:00.000Z',
      baseRefId: 'base-ref-1',
      baseRefUpdatedAt: '2026-09-30T00:00:00.000Z',
      referenceImage: {
        refId: 'state-ref-1',
        s3Key: 'reference/test/state.png',
        storageOwnerUserId: ACTOR,
        imageModel: 'gpt-image-2',
        baseRefId: 'base-ref-1',
        createdAt: '2026-09-30T00:00:00.000Z',
        inputFingerprint: 'fingerprint',
      },
      referenceReady: true,
    }],
    pages: [{
      pageId: '99999999-9999-4999-8999-999999999999',
      pageNumber: 1,
      frameCount: 1,
      layoutConfig: {},
      status: 'designing',
      dialogueMode: 'mixed',
      pageDialogueToggle: true,
      panels: [{
        id: PANEL,
        order: 1,
        panelRole: 'action',
        panelSize: 'standard',
        situationText: null,
        composition: {
          source: 'ai_auto', galleryItemId: null, compositionPrompt: null,
          shotType: null, angle: null, customNote: null,
        },
        dialogueInPanel: false,
        dialogue: [],
        sfxText: null,
        backgroundNote: null,
        panelNotes: null,
        entities: [],
      }],
    }],
  };
}

function injuredTransition(): EpisodeStateTransition {
  return {
    entityId: ACTOR,
    stateId: INJURED,
    startsAtPanelId: PANEL,
    sourceSceneId: null,
    sourceField: 'middle',
    sourceQuote: '腕を負傷した',
  };
}

describe('validateEpisodeStateTransitionPlan', () => {
  it('作画指示だけの外傷を原文の状態変化として認めない', () => {
    const story = context();
    story.episode.productionNotesEnabled = true;
    story.episode.middle = '主人公は歩く。＃腕を負傷した＃';
    expect(() => validateEpisodeStateTransitionPlan(story, {
      transitions: [injuredTransition()], unresolved: [],
    })).toThrow(EpisodeStatePlanError);
  });
  it.each([
    ['原文外のdescription', { suggestedDescription: '髪全体が虹色に輝く' }],
    ['完成コマ外のpanel evidence', { panelEvidenceQuote: 'まだ変化していない' }],
    ['空のpanel evidence', { panelEvidenceQuote: '' }],
  ])('final draft strict modeは%sを拒否する', (_label, override) => {
    const story = context();
    story.episode.storyFullDraft = '主人公の髪が青白く発光する。';
    const finalSuggestion: EpisodePagePlanSuggestion = { pages: [{
      pageId: story.pages[0]!.pageId, pageNumber: 1,
      panels: [{ order: 1, situationText: '髪が青白く発光する', entities: [{
        entityId: ACTOR, role: 'primary', expression: 'calm', customExpression: null,
        action: 'standing_firm', customAction: null, position: 'center', facingDirection: null,
        effectNote: '髪が青白く発光する', stateId: null,
      }] }],
    }] };
    const fallback = {
      entityId: ACTOR, candidateStateId: null, startsAtPanelId: PANEL,
      suggestedName: '発光', suggestedDescription: '髪が青白く発光する',
      panelEvidenceQuote: '髪が青白く発光する',
      replacesDeltas: [],
      sourceSceneId: null, sourceField: 'story_full_draft' as const,
      sourceQuote: '髪が青白く発光する', reason: 'missing_reference' as const,
      ...override,
    };

    expect(() => resolveEpisodeStateTransitionPlan(story, {
      transitions: [], unresolved: [fallback],
    }, { allowVisualFallback: true, strictEvidence: true, finalSuggestion }))
      .toThrowError(EpisodeStatePlanError);
  });

  it('final draft strict modeは同一quote・同一panelの独立deltaを保ち一方だけ置換する', () => {
    const story = context();
    story.episode.storyFullDraft = '左腕に傷ができ、髪が光る。やがて髪が黒に戻る。';
    story.pages[0]!.frameCount = 2;
    story.pages[0]!.panels.push({ ...story.pages[0]!.panels[0]!, id: PANEL_TWO, order: 2 });
    const finalSuggestion: EpisodePagePlanSuggestion = { pages: [{
      pageId: story.pages[0]!.pageId, pageNumber: 1, panels: [
        { order: 1, situationText: '左腕に傷ができ、髪が光る', entities: [{
          entityId: ACTOR, role: 'primary', expression: 'calm', customExpression: null,
          action: 'standing_firm', customAction: null, position: 'center', facingDirection: null,
          effectNote: '左腕に傷ができ、髪が光る', stateId: null,
        }] },
        { order: 2, situationText: '髪が黒に戻る', entities: [{
          entityId: ACTOR, role: 'primary', expression: 'calm', customExpression: null,
          action: 'standing_firm', customAction: null, position: 'center', facingDirection: null,
          effectNote: '髪が黒に戻る', stateId: null,
        }] },
      ],
    }] };
    const shared = {
      entityId: ACTOR, candidateStateId: null, startsAtPanelId: PANEL,
      sourceSceneId: null, sourceField: 'story_full_draft' as const,
      sourceQuote: '左腕に傷ができ、髪が光る',
      panelEvidenceQuote: '左腕に傷ができ、髪が光る',
      replacesDeltas: [], reason: 'missing_reference' as const,
    };
    const plan = {
      transitions: [],
      unresolved: [
        { ...shared, suggestedName: '負傷', suggestedDescription: '左腕に傷ができ' },
        { ...shared, suggestedName: '発光', suggestedDescription: '髪が光る' },
        {
          ...shared, startsAtPanelId: PANEL_TWO, sourceQuote: '髪が黒に戻る',
          panelEvidenceQuote: '髪が黒に戻る', suggestedName: '黒髪',
          suggestedDescription: '髪が黒に戻る',
          replacesDeltas: [{
            sourceQuote: '左腕に傷ができ、髪が光る', description: '髪が光る',
          }],
        },
      ],
    };

    expect(resolveEpisodeStateTransitionPlan(story, plan, {
      allowVisualFallback: true, strictEvidence: true, finalSuggestion,
    }).visualFallbacks).toHaveLength(3);
  });

  it.each([
    ['未知の過去delta', ACTOR, [{ sourceQuote: '存在しない変化', description: '存在しない変化' }], false],
    ['未来delta', ACTOR, [{ sourceQuote: '腕に包帯を巻く', description: '腕に包帯を巻く' }], true],
    ['別人物delta', OTHER, [{ sourceQuote: '髪が赤くなる', description: '髪が赤くなる' }], false],
  ] as const)('final draft strict modeは%sのreplacementを拒否する', (
    _label, secondEntityId, replacements, includeFuture,
  ) => {
    const story = context();
    story.episode.storyFullDraft = '髪が赤くなる。腕に包帯を巻く。';
    story.pages[0]!.frameCount = 2;
    story.pages[0]!.panels.push({ ...story.pages[0]!.panels[0]!, id: PANEL_TWO, order: 2 });
    const finalSuggestion: EpisodePagePlanSuggestion = { pages: [{
      pageId: story.pages[0]!.pageId, pageNumber: 1, panels: [
        { order: 1, situationText: '髪が赤くなる', entities: [{
          entityId: ACTOR, role: 'primary', expression: 'calm', customExpression: null,
          action: 'standing_firm', customAction: null, position: 'center', facingDirection: null,
          effectNote: '髪が赤くなる', stateId: null,
        }] },
        { order: 2, situationText: '腕に包帯を巻く', entities: [ACTOR, OTHER].map((entityId) => ({
          entityId, role: 'primary' as const, expression: 'calm' as const, customExpression: null,
          action: 'standing_firm' as const, customAction: null, position: 'center' as const,
          facingDirection: null, effectNote: '腕に包帯を巻く', stateId: null,
        })) },
      ],
    }] };
    const first = {
      entityId: ACTOR, candidateStateId: null, startsAtPanelId: PANEL,
      suggestedName: '赤髪', suggestedDescription: '髪が赤くなる',
      sourceSceneId: null, sourceField: 'story_full_draft' as const,
      sourceQuote: '髪が赤くなる', panelEvidenceQuote: '髪が赤くなる',
      replacesDeltas: includeFuture
        ? [{ sourceQuote: '腕に包帯を巻く', description: '腕に包帯を巻く' }]
        : [],
      reason: 'missing_reference' as const,
    };
    const second = {
      entityId: secondEntityId, candidateStateId: null, startsAtPanelId: PANEL_TWO,
      suggestedName: '包帯', suggestedDescription: '腕に包帯を巻く',
      sourceSceneId: null, sourceField: 'story_full_draft' as const,
      sourceQuote: '腕に包帯を巻く', panelEvidenceQuote: '腕に包帯を巻く',
      replacesDeltas: replacements, reason: 'missing_reference' as const,
    };

    expect(() => resolveEpisodeStateTransitionPlan(story, {
      transitions: [], unresolved: [first, second],
    }, { allowVisualFallback: true, strictEvidence: true, finalSuggestion }))
      .toThrowError(EpisodeStatePlanError);
  });
  // Spec §6/§8: automatic story autofill treats auxiliary source quotes as metadata.
  // Keep known saved-source fields, IDs, ownership, READY images and boundary structure hard;
  // a paraphrase or translation alone must not discard an otherwise usable episode.
  it('自動入力は引用の言い換えだけでは確定済み状態の反映を失敗させない', () => {
    const transition = { ...injuredTransition(), sourceQuote: 'The protagonist injured his arm.' };
    expect(resolveEpisodeStateTransitionPlan(context(), {
      transitions: [transition], unresolved: [],
    }, { allowVisualFallback: true })).toEqual({ transitions: [transition], visualFallbacks: [] });
  });

  it('自動入力は未登録状態の補助引用が要約でも既存キャラへの視覚描写を保持する', () => {
    const fallback = {
      entityId: ACTOR, candidateStateId: null, startsAtPanelId: PANEL,
      suggestedName: '負傷', suggestedDescription: '腕に包帯を巻いている',
      sourceSceneId: null, sourceField: 'story_full_draft' as const,
      sourceQuote: '主人公が腕を怪我した場面', reason: 'missing_reference' as const,
    };
    expect(resolveEpisodeStateTransitionPlan(context(), {
      transitions: [], unresolved: [fallback],
    }, { allowVisualFallback: true })).toEqual({ transitions: [], visualFallbacks: [fallback] });
  });

  it('自動入力も空の引用や未知のIDと未確定画像は拒否する', () => {
    const story = context();
    for (const transition of [
      { ...injuredTransition(), sourceQuote: '' },
      { ...injuredTransition(), startsAtPanelId: 'missing' },
      { ...injuredTransition(), entityId: OTHER },
      { ...injuredTransition(), sourceSceneId: SCENE },
    ]) {
      expect(() => resolveEpisodeStateTransitionPlan(story, {
        transitions: [transition], unresolved: [],
      }, { allowVisualFallback: true })).toThrowError(EpisodeStatePlanError);
    }
    story.stateLibrary![0]!.referenceReady = false;
    expect(() => resolveEpisodeStateTransitionPlan(story, {
      transitions: [{ ...injuredTransition(), sourceQuote: '腕を怪我した' }], unresolved: [],
    }, { allowVisualFallback: true })).toThrowError(EpisodeStatePlanError);
  });

  it('保存済み本文の引用と同一人物の確定画像が揃う場合に変化点を受理する', () => {
    expect(validateEpisodeStateTransitionPlan(context(), {
      transitions: [injuredTransition()], unresolved: [],
    })).toEqual([injuredTransition()]);
  });

  it('確定画像が古い場合に状態画像不足として拒否する', () => {
    const story = context();
    story.stateLibrary![0]!.referenceReady = false;
    expect(() => validateEpisodeStateTransitionPlan(story, {
      transitions: [injuredTransition()], unresolved: [],
    })).toThrowError(EpisodeStatePlanError);
  });

  it('引用が保存本文に存在しない場合に推測を拒否する', () => {
    expect(() => validateEpisodeStateTransitionPlan(context(), {
      transitions: [{ ...injuredTransition(), sourceQuote: '存在しない事件' }], unresolved: [],
    })).toThrowError(EpisodeStatePlanError);
  });

  it('別人物の状態や存在しないコマを拒否する', () => {
    expect(() => validateEpisodeStateTransitionPlan(context(), {
      transitions: [{ ...injuredTransition(), entityId: OTHER }], unresolved: [],
    })).toThrowError(EpisodeStatePlanError);
    expect(() => validateEpisodeStateTransitionPlan(context(), {
      transitions: [{ ...injuredTransition(), startsAtPanelId: 'missing' }], unresolved: [],
    })).toThrowError(EpisodeStatePlanError);
  });

  it('未解決の状態候補を保存せずblockerにする', () => {
    expect(() => validateEpisodeStateTransitionPlan(context(), {
      transitions: [],
      unresolved: [{
        entityId: ACTOR,
        candidateStateId: null,
        startsAtPanelId: PANEL,
        suggestedName: '負傷',
        suggestedDescription: '腕に包帯',
        sourceSceneId: null,
        sourceField: 'middle',
        sourceQuote: '腕を負傷した',
        reason: 'missing_reference',
      }],
    })).toThrowError(EpisodeStatePlanError);
  });

  it('自動入力では根拠が確認できる未登録状態を視覚描写として受理する', () => {
    const unresolved = {
      entityId: ACTOR,
      candidateStateId: null,
      startsAtPanelId: PANEL,
      suggestedName: '負傷',
      suggestedDescription: '腕に包帯を巻いている',
      sourceSceneId: null,
      sourceField: 'middle' as const,
      sourceQuote: '腕を負傷した',
      reason: 'missing_reference' as const,
    };

    expect(resolveEpisodeStateTransitionPlan(context(), {
      transitions: [],
      unresolved: [unresolved],
    }, { allowVisualFallback: true })).toEqual({
      transitions: [],
      visualFallbacks: [unresolved],
    });
  });

  it('自動入力でも存在しない根拠フィールドや別人物の候補状態は拒否する', () => {
    const base = {
      entityId: ACTOR,
      candidateStateId: null,
      startsAtPanelId: PANEL,
      suggestedName: '負傷',
      suggestedDescription: '腕に包帯を巻いている',
      sourceSceneId: null,
      sourceField: 'middle' as const,
      sourceQuote: '存在しない事件',
      reason: 'missing_reference' as const,
    };
    expect(() => resolveEpisodeStateTransitionPlan(context(), {
      transitions: [], unresolved: [{ ...base, sourceField: 'climax' }],
    }, { allowVisualFallback: true })).toThrowError(EpisodeStatePlanError);
    expect(() => resolveEpisodeStateTransitionPlan(context(), {
      transitions: [],
      unresolved: [{ ...base, entityId: OTHER, candidateStateId: INJURED, sourceQuote: '腕を負傷した' }],
    }, { allowVisualFallback: true })).toThrowError(EpisodeStatePlanError);
  });

  it('別人物の既存状態を未確定候補として報告した場合に拒否する', () => {
    let error: unknown;
    try {
      validateEpisodeStateTransitionPlan(context(), {
        transitions: [],
        unresolved: [{
          entityId: OTHER,
          candidateStateId: INJURED,
          startsAtPanelId: PANEL,
          suggestedName: '負傷',
          suggestedDescription: '腕に包帯',
          sourceSceneId: null,
          sourceField: 'middle',
          sourceQuote: '腕を負傷した',
          reason: 'missing_reference',
        }],
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EpisodeStatePlanError);
    expect((error as EpisodeStatePlanError).code).toBe('STATE_PLAN_INVALID');
  });
});
