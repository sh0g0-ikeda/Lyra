import { describe, expect, it } from 'vitest';

import type {
  EpisodePagePlanContext,
  EpisodePagePlanSuggestion,
  PageAutofillPanelSuggestion,
} from '../../../../src/domain/types/page.js';
import { repairEpisodePlanIdentifierReferences } from '../../../../src/services/page/EpisodePlanIdentifierRepair.js';

const ENTITY_MINERVA = '11111111-1111-4111-8111-111111111111';
const ENTITY_EMILE = '22222222-2222-4222-8222-222222222222';
const ENTITY_UNKNOWN = '99999999-9999-4999-8999-999999999999';
const STATE_MINERVA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STATE_EMILE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('EpisodePlanIdentifierRepair', () => {
  it('作品外キャラIDがある場合は会話とキャラ割当を信頼済み案へまとめて戻す', () => {
    const context = buildContext();
    const trustedFallback = buildSuggestion({
      situationText: '信頼済みの状況説明',
      dialogue: [buildDialogue(ENTITY_MINERVA, '信頼済みの台詞')],
      entities: [buildAssignment(ENTITY_MINERVA, STATE_MINERVA)],
    });
    const candidate = buildSuggestion({
      situationText: 'AIが改善した状況説明',
      dialogue: [buildDialogue(ENTITY_UNKNOWN, '不正な話者の台詞')],
      entities: [buildAssignment(ENTITY_UNKNOWN, null)],
    });

    const result = repairEpisodePlanIdentifierReferences({
      context,
      candidate,
      trustedFallback,
    });

    expect(result.revertedPanelIdentifierBundleCount).toBe(1);
    expect(result.suggestion.pages[0]?.panels[0]).toMatchObject({
      situationText: 'AIが改善した状況説明',
      dialogue: trustedFallback.pages[0]?.panels[0]?.dialogue,
      entities: trustedFallback.pages[0]?.panels[0]?.entities,
    });
  });

  it('別キャラの状態IDが指定された場合は識別子を含む組を信頼済み案へ戻す', () => {
    const context = buildContext();
    const trustedFallback = buildSuggestion({
      dialogue: [buildDialogue(ENTITY_MINERVA, '信頼済みの台詞')],
      entities: [buildAssignment(ENTITY_MINERVA, STATE_MINERVA)],
    });
    const candidate = buildSuggestion({
      dialogue: [buildDialogue(ENTITY_MINERVA, '候補の台詞')],
      entities: [buildAssignment(ENTITY_MINERVA, STATE_EMILE)],
    });

    const result = repairEpisodePlanIdentifierReferences({
      context,
      candidate,
      trustedFallback,
    });

    expect(result.revertedPanelIdentifierBundleCount).toBe(1);
    expect(result.suggestion.pages[0]?.panels[0]?.entities).toEqual(
      trustedFallback.pages[0]?.panels[0]?.entities,
    );
  });

  it('話の外のシーンIDがある場合は配列全体を信頼済み案へ戻す', () => {
    const context = buildContext();
    const trustedFallback = buildSuggestion({ sourceSceneIds: ['scene-1'] });
    const candidate = buildSuggestion({ sourceSceneIds: ['scene-1', 'scene-outside'] });

    const result = repairEpisodePlanIdentifierReferences({
      context,
      candidate,
      trustedFallback,
    });

    expect(result.revertedSourceSceneCount).toBe(1);
    expect(result.suggestion.pages[0]?.sourceSceneIds).toEqual(['scene-1']);
  });

  it('信頼済み案にも不正なIDがある場合は値を捏造せず拒否する', () => {
    const context = buildContext();
    const invalidFallback = buildSuggestion({
      dialogue: [buildDialogue(ENTITY_UNKNOWN, '信頼できない台詞')],
      entities: [buildAssignment(ENTITY_UNKNOWN, null)],
    });
    const candidate = buildSuggestion({
      dialogue: [buildDialogue(ENTITY_UNKNOWN, '不正な話者の台詞')],
      entities: [buildAssignment(ENTITY_UNKNOWN, null)],
    });

    expect(() =>
      repairEpisodePlanIdentifierReferences({
        context,
        candidate,
        trustedFallback: invalidFallback,
      }),
    ).toThrow('trusted fallback contains invalid identifier references');
  });

  it('同じコマの重複キャラ割当は信頼済み案へ戻す', () => {
    const context = buildContext();
    const trustedFallback = buildSuggestion({
      entities: [buildAssignment(ENTITY_MINERVA, STATE_MINERVA)],
    });
    const candidate = buildSuggestion({
      entities: [
        buildAssignment(ENTITY_MINERVA, STATE_MINERVA),
        buildAssignment(ENTITY_MINERVA, null),
      ],
    });

    const result = repairEpisodePlanIdentifierReferences({
      context,
      candidate,
      trustedFallback,
    });

    expect(result.revertedPanelIdentifierBundleCount).toBe(1);
    expect(result.suggestion.pages[0]?.panels[0]?.entities).toEqual(
      trustedFallback.pages[0]?.panels[0]?.entities,
    );
  });
});

function buildContext(): EpisodePagePlanContext {
  return {
    episodeId: 'episode-1',
    workId: 'work-1',
    chapter: {
      id: 'chapter-1',
      title: '第一章',
      purpose: null,
      startingState: null,
      endingState: null,
      emotionCurve: null,
      keyBeats: [],
    },
    episode: {
      title: '第一話',
      purpose: null,
      introduction: null,
      middle: null,
      climax: null,
      endingHook: null,
      estimatedPages: 1,
    },
    scenes: [
      {
        id: 'scene-1',
        order: 1,
        location: null,
        time: null,
        atmosphere: null,
        involvedEntityIds: [ENTITY_MINERVA, ENTITY_EMILE],
        entityStates: [
          buildState(ENTITY_MINERVA, STATE_MINERVA),
          buildState(ENTITY_EMILE, STATE_EMILE),
        ],
      },
    ],
    entities: [
      buildEntity(ENTITY_MINERVA, 'ミネルヴァ'),
      buildEntity(ENTITY_EMILE, 'エミール'),
    ],
    pages: [
      {
        pageId: 'page-1',
        pageNumber: 1,
        frameCount: 1,
        layoutConfig: {},
        status: 'editing',
        dialogueMode: 'mixed',
        pageDialogueToggle: true,
        panels: [
          {
            id: 'panel-1',
            order: 1,
            panelRole: 'action',
            panelSize: 'standard',
            situationText: null,
            composition: {
              source: 'ai_auto',
              galleryItemId: null,
              compositionPrompt: null,
              shotType: null,
              angle: null,
              customNote: null,
            },
            dialogueInPanel: true,
            dialogue: [],
            sfxText: null,
            backgroundNote: null,
            panelNotes: null,
            entities: [],
          },
        ],
      },
    ],
  };
}

function buildSuggestion(
  input: Partial<PageAutofillPanelSuggestion> & { sourceSceneIds?: string[] } = {},
): EpisodePagePlanSuggestion {
  return {
    pages: [
      {
        pageId: 'page-1',
        pageNumber: 1,
        sourceSceneIds: input.sourceSceneIds ?? ['scene-1'],
        pagePurpose: 'この場面を進める',
        continuityNote: '前後をつなぐ',
        panels: [
          {
            order: 1,
            situationText: input.situationText ?? '候補の状況説明',
            dialogue: input.dialogue ?? [buildDialogue(ENTITY_MINERVA, '候補の台詞')],
            entities: input.entities ?? [buildAssignment(ENTITY_MINERVA, STATE_MINERVA)],
          },
        ],
      },
    ],
  };
}

function buildDialogue(entityId: string, text: string) {
  return {
    entityId,
    text,
    type: 'speech' as const,
    position: 'top' as const,
  };
}

function buildAssignment(entityId: string, stateId: string | null) {
  return {
    entityId,
    role: 'primary' as const,
    expression: 'calm' as const,
    customExpression: null,
    action: 'standing_firm' as const,
    customAction: null,
    position: 'center' as const,
    facingDirection: 'front' as const,
    effectNote: null,
    stateId,
  };
}

function buildEntity(id: string, name: string) {
  return {
    id,
    name,
    entityType: 'character' as const,
    freeDescription: null,
    promptSupplement: null,
    structuredFields: {},
  };
}

function buildState(entityId: string, stateId: string) {
  return {
    entityId,
    stateId,
    costumeNote: null,
    costumeRefId: null,
    conditionNote: null,
    hairNote: null,
    expressionDefault: null,
    extraNote: null,
  };
}
