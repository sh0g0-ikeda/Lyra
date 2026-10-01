import { describe, expect, it } from 'vitest';
import type { EpisodePagePlanContext } from '../../../../src/domain/types/page.js';
import type { EpisodeStateTransition } from '../../../../src/domain/types/episodeStateTransition.js';
import { EpisodeStatePlanError } from '../../../../src/services/page/EpisodeStateAssignmentResolver.js';
import { validateEpisodeStateTransitionPlan } from '../../../../src/services/page/EpisodeStateTransitionPlan.js';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const INJURED = '33333333-3333-4333-8333-333333333333';
const SCENE = '44444444-4444-4444-8444-444444444444';
const PANEL = '55555555-5555-4555-8555-555555555555';

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
