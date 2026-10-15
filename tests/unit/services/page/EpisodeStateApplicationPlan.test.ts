import { describe, expect, it } from 'vitest';
import type { EpisodePagePlanContext, EpisodePagePlanSuggestion } from '../../../../src/domain/types/page.js';
import type { PanelEntityAssignment } from '../../../../src/domain/types/panelEntityAssignment.js';
import { EpisodeStatePlanError } from '../../../../src/services/page/EpisodeStateAssignmentResolver.js';
import {
  applyEpisodeStateVisualDirectives,
  resolveEpisodePlanStateAssignments,
} from '../../../../src/services/page/EpisodeStateApplicationPlan.js';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const INJURED = '22222222-2222-4222-8222-222222222222';
const MANUAL = '55555555-5555-4555-8555-555555555555';
const FIRST = '33333333-3333-4333-8333-333333333333';
const SECOND = '44444444-4444-4444-8444-444444444444';
const THIRD = '66666666-6666-4666-8666-666666666666';
const FOURTH = '99999999-9999-4999-8999-999999999999';
const PAGE_ONE = '77777777-7777-4777-8777-777777777777';
const PAGE_TWO = '88888888-8888-4888-8888-888888888888';
const GHOST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function assignment(stateId: string | null): PanelEntityAssignment {
  return {
    entityId: ACTOR, role: 'primary', expression: 'calm', customExpression: null,
    action: 'standing_firm', customAction: null, position: 'center', facingDirection: null,
    effectNote: null, stateId,
  };
}

function input(policy: 'preserve_existing' | 'overwrite_existing') {
  return {
    pages: [{
      pageId: 'page-1', pageNumber: 1,
      panels: [
        { id: FIRST, order: 1, entities: [assignment(null)] },
        { id: SECOND, order: 2, entities: [assignment(null)] },
      ],
    }],
    suggestion: { pages: [{
      pageId: 'page-1', pageNumber: 1,
      panels: [{ order: 1, entities: [assignment(null)] }, { order: 2, entities: [assignment(null)] }],
    }] },
    startingStates: [],
    transitions: [{
      entityId: ACTOR, stateId: INJURED, startsAtPanelId: SECOND,
      sourceSceneId: null, sourceField: 'middle' as const, sourceQuote: '負傷',
    }],
    policy,
  };
}

describe('resolveEpisodePlanStateAssignments', () => {
  it('同じページの途中から状態を切り替え最終assignmentsをpanel IDに対応させる', () => {
    const result = resolveEpisodePlanStateAssignments(input('overwrite_existing'));
    expect(result.get(FIRST)?.[0]?.stateId).toBeNull();
    expect(result.get(SECOND)?.[0]?.stateId).toBe(INJURED);
  });

  it('手動状態が計画と違う場合は上書き指定まで全体を拒否する', () => {
    const request = input('preserve_existing');
    request.pages[0]!.panels[1]!.entities[0]!.stateId = MANUAL;
    request.suggestion.pages[0]!.panels[1]!.entities[0]!.stateId = null;
    expect(() => resolveEpisodePlanStateAssignments(request)).toThrowError(EpisodeStatePlanError);
    expect(resolveEpisodePlanStateAssignments({ ...request, policy: 'overwrite_existing' }).get(SECOND)?.[0]?.stateId)
      .toBe(INJURED);
  });

  it('server default経路だけはnullを未割当として計画状態を補完する', () => {
    const request = input('preserve_existing');
    expect(() => resolveEpisodePlanStateAssignments(request)).toThrowError(EpisodeStatePlanError);

    const result = resolveEpisodePlanStateAssignments({
      ...request,
      allowUnassignedStateFill: true,
    });

    expect(result.get(FIRST)?.[0]?.stateId).toBeNull();
    expect(result.get(SECOND)?.[0]?.stateId).toBe(INJURED);
  });

  it('明示的な空の人物一覧を上書きする場合に既存配置を削除する', () => {
    const request = input('overwrite_existing');
    request.suggestion.pages[0]!.panels[0]!.entities = [];
    const result = resolveEpisodePlanStateAssignments(request);
    expect(result.get(FIRST)).toEqual([]);
    expect(result.get(SECOND)?.[0]?.entityId).toBe(ACTOR);
    expect(result.get(SECOND)?.[0]?.stateId).toBe(INJURED);
  });

  it('空の人物一覧が手動状態の保存方針と競合する場合に全体を拒否する', () => {
    const request = {
      ...input('preserve_existing'),
      startingStates: [{ entityId: ACTOR, stateId: MANUAL }],
    };
    request.pages[0]!.panels[0]!.entities[0]!.stateId = MANUAL;
    request.pages[0]!.panels[1]!.entities[0]!.stateId = INJURED;
    request.suggestion.pages[0]!.panels[0]!.entities = [];
    expect(() => resolveEpisodePlanStateAssignments(request)).toThrowError(EpisodeStatePlanError);
    expect(resolveEpisodePlanStateAssignments({ ...request, policy: 'overwrite_existing' }).get(FIRST))
      .toEqual([]);
  });

  it('人物一覧を省略した旧形式の場合に既存配置を維持する', () => {
    const request = input('overwrite_existing');
    const result = resolveEpisodePlanStateAssignments({
      ...request,
      suggestion: { pages: [{
        ...request.suggestion.pages[0]!,
        panels: [{ order: 1 }, request.suggestion.pages[0]!.panels[1]!],
      }] },
    });
    expect(result.get(FIRST)?.[0]?.entityId).toBe(ACTOR);
    expect(result.get(FIRST)?.[0]?.stateId).toBeNull();
  });
});

function visualContext(): EpisodePagePlanContext {
  const panels = [FIRST, SECOND, THIRD, FOURTH].map((id, index) => ({
    id,
    order: index < 2 ? index + 1 : index - 1,
    panelRole: 'action' as const,
    panelSize: 'standard' as const,
    situationText: null,
    composition: {
      source: 'ai_auto' as const, galleryItemId: null, compositionPrompt: null,
      shotType: null, angle: null, customNote: null,
    },
    dialogueInPanel: false,
    dialogue: [],
    sfxText: null,
    backgroundNote: null,
    panelNotes: null,
    entities: [assignment(null)],
  }));
  return {
    episodeId: 'episode-1', workId: 'work-1',
    chapter: {
      id: 'chapter-1', title: null, purpose: null, startingState: null, endingState: null,
      emotionCurve: null, keyBeats: [],
    },
    episode: {
      title: null, purpose: null, storyFullDraft: '負傷した後も進み、最後に回復した。',
      introduction: null, middle: '負傷した後も進む', climax: null, endingHook: '最後に回復した',
      estimatedPages: 2, startingEntityStates: [],
    },
    scenes: [],
    entities: [{
      id: ACTOR, name: '主人公', entityType: 'character', freeDescription: null,
      promptSupplement: null, structuredFields: {},
    }],
    stateLibrary: [
      {
        entityId: ACTOR, stateId: GHOST, name: '鬼', description: '額に二本の角がある',
        revision: '2026-10-13T00:00:00.000Z', baseRefId: 'base-ref',
        baseRefUpdatedAt: '2026-10-13T00:00:00.000Z', referenceReady: true,
        referenceImage: {
          refId: 'ghost-ref', s3Key: 'private/ghost.png', storageOwnerUserId: ACTOR,
          imageModel: 'gpt-image-2', baseRefId: 'base-ref',
          createdAt: '2026-10-13T00:00:00.000Z', inputFingerprint: 'ghost-fingerprint',
        },
      },
      {
        entityId: ACTOR, stateId: INJURED, name: '負傷', description: '左腕に包帯を巻いている',
        revision: '2026-10-13T00:00:00.000Z', baseRefId: 'base-ref',
        baseRefUpdatedAt: '2026-10-13T00:00:00.000Z', referenceImage: null, referenceReady: false,
      },
    ],
    pages: [
      { pageId: PAGE_ONE, pageNumber: 1, frameCount: 2, layoutConfig: {}, status: 'designing',
        dialogueMode: 'mixed', pageDialogueToggle: true, panels: panels.slice(0, 2) },
      { pageId: PAGE_TWO, pageNumber: 2, frameCount: 2, layoutConfig: {}, status: 'designing',
        dialogueMode: 'mixed', pageDialogueToggle: true, panels: panels.slice(2) },
    ],
  };
}

function visualSuggestion(): EpisodePagePlanSuggestion {
  return {
    pages: [
      { pageId: PAGE_ONE, pageNumber: 1, panels: [
        { order: 1, situationText: '走り出す', composition: { compositionPrompt: '全身を映す' }, entities: [assignment(null)] },
        { order: 2, situationText: '前へ進む', composition: { compositionPrompt: '横から映す' }, entities: [assignment(null)] },
      ] },
      { pageId: PAGE_TWO, pageNumber: 2, panels: [
        { order: 1, situationText: '立ち止まる', composition: { compositionPrompt: '正面から映す' }, entities: [assignment(null)] },
        { order: 2, situationText: '元の姿に戻る', composition: { compositionPrompt: '引いて映す' }, entities: [assignment(null)] },
      ] },
    ],
  };
}

describe('applyEpisodeStateVisualDirectives', () => {
  it('READY参照でも状態名がnullまたは空白なら表示名を補わず拒否する', () => {
    for (const name of [null, '   ']) {
      const context = visualContext();
      context.stateLibrary![0] = { ...context.stateLibrary![0]!, name };

      expect(() => applyEpisodeStateVisualDirectives({
        context,
        suggestion: visualSuggestion(),
        transitions: [{
          entityId: ACTOR, stateId: GHOST, startsAtPanelId: FIRST,
          sourceSceneId: null, sourceField: 'middle', sourceQuote: '鬼化した',
        }],
        visualFallbacks: [],
        language: 'ja',
      })).toThrowError(expect.objectContaining({ code: 'STATE_REFERENCE_REQUIRED' }));
    }
  });

  it('参照未準備の登録状態を新規作成せず開始コマからページをまたいで視覚描写へ反映する', () => {
    const result = applyEpisodeStateVisualDirectives({
      context: visualContext(),
      suggestion: visualSuggestion(),
      transitions: [],
      visualFallbacks: [{
        entityId: ACTOR, candidateStateId: INJURED, startsAtPanelId: SECOND,
        suggestedName: '負傷', suggestedDescription: '左腕を押さえている',
        sourceSceneId: null, sourceField: 'middle', sourceQuote: '負傷した',
        reason: 'missing_reference',
      }],
      language: 'ja',
    });

    expect(result.pages[0]!.panels[0]!.situationText).not.toContain('左腕に包帯');
    expect(result.pages[0]!.panels[1]!.situationText).toContain('左腕を押さえている');
    expect(result.pages[1]!.panels[0]!.composition?.compositionPrompt).toContain('左腕を押さえている');
    expect(JSON.stringify(result)).not.toContain('左腕に包帯を巻いている');
  });

  it('後続のdefault境界で視覚描写を止め、同じ計画の再適用でも重複しない', () => {
    const input = {
      context: visualContext(), suggestion: visualSuggestion(),
      transitions: [
        {
          entityId: ACTOR, stateId: GHOST, startsAtPanelId: FIRST,
          sourceSceneId: null, sourceField: 'middle' as const, sourceQuote: '負傷した',
        },
        {
          entityId: ACTOR, stateId: null, startsAtPanelId: FOURTH,
          sourceSceneId: null, sourceField: 'ending_hook' as const, sourceQuote: '回復した',
        },
      ],
      visualFallbacks: [{
        entityId: ACTOR, candidateStateId: null, startsAtPanelId: SECOND,
        suggestedName: '負傷', suggestedDescription: '右脚を引きずっている',
        sourceSceneId: null, sourceField: 'middle' as const, sourceQuote: '負傷した',
        reason: 'missing_reference' as const,
      }],
      language: 'ja' as const,
    };
    const once = applyEpisodeStateVisualDirectives(input);
    const twice = applyEpisodeStateVisualDirectives({ ...input, suggestion: once });

    expect(once.pages[0]!.panels[1]!.situationText).toContain('右脚を引きずっている');
    expect(once.pages[1]!.panels[0]!.situationText).toContain('鬼');
    expect(once.pages[1]!.panels[0]!.situationText).not.toContain('額に二本の角がある');
    expect(once.pages[1]!.panels[0]!.situationText).toContain('右脚を引きずっている');
    expect(once.pages[1]!.panels[1]!.situationText).not.toContain('鬼');
    expect(once.pages[1]!.panels[1]!.situationText).not.toContain('右脚を引きずっている');
    expect(twice).toEqual(once);

    const assignments = resolveEpisodePlanStateAssignments({
      pages: input.context.pages,
      suggestion: once,
      startingStates: [],
      transitions: input.transitions,
      policy: 'overwrite_existing',
    });
    expect(assignments.get(FIRST)?.[0]?.stateId).toBe(GHOST);
    expect(assignments.get(SECOND)?.[0]?.stateId).toBe(GHOST);
    expect(assignments.get(THIRD)?.[0]?.stateId).toBe(GHOST);
    expect(assignments.get(FOURTH)?.[0]?.stateId).toBeNull();
  });

  it('後続の恐怖overlayは未解除の負傷を含む完全外見としてREADY状態と共に継続する', () => {
    const result = applyEpisodeStateVisualDirectives({
      context: visualContext(), suggestion: visualSuggestion(), language: 'ja',
      transitions: [{
        entityId: ACTOR, stateId: GHOST, startsAtPanelId: FIRST,
        sourceSceneId: null, sourceField: 'middle', sourceQuote: '負傷した',
      }],
      visualFallbacks: [
        {
          entityId: ACTOR, candidateStateId: null, startsAtPanelId: SECOND,
          suggestedName: '負傷', suggestedDescription: '左腕を押さえている',
          sourceSceneId: null, sourceField: 'middle', sourceQuote: '負傷した',
          reason: 'missing_reference',
        },
        {
          entityId: ACTOR, candidateStateId: null, startsAtPanelId: THIRD,
          suggestedName: '負傷と恐怖', suggestedDescription: '左腕を押さえたまま恐怖で目を見開いている',
          sourceSceneId: null, sourceField: 'middle', sourceQuote: '負傷した',
          reason: 'missing_reference',
        },
      ],
    });

    expect(result.pages[1]!.panels[0]!.situationText).toContain('鬼');
    expect(result.pages[1]!.panels[0]!.situationText).not.toContain('額に二本の角');
    expect(result.pages[1]!.panels[0]!.situationText).toContain('左腕を押さえたまま');
    expect(result.pages[1]!.panels[0]!.situationText).toContain('恐怖で目を見開いている');
  });
});
