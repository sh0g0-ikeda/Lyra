import { describe, expect, it } from 'vitest';
import type {
  EpisodePagePlanContext,
  EpisodePagePlanSuggestion,
  PageAutofillEntityContext,
  PageAutofillPanelContext,
} from '../../../../src/domain/types/page.js';
import {
  buildEpisodeAutofillCharacterReferences,
  resolveEpisodeAutofillDialogueSpeakers,
} from '../../../../src/services/page/EpisodeAutofillCharacterResolution.js';

describe('EpisodeAutofillCharacterResolution', () => {
  it('エンティティ順やページ分割に依存せず entityId 順の固定参照を作る', () => {
    const context = buildContext({
      entities: [entity('entity-b', '同名'), entity('entity-a', '同名'), entity('entity-b', '重複')],
    });

    expect(buildEpisodeAutofillCharacterReferences(context)).toEqual([
      { ref: 'E1', entityId: 'entity-a', name: '同名', entityType: 'character' },
      { ref: 'E2', entityId: 'entity-b', name: '重複', entityType: 'character' },
    ]);
    expect(buildEpisodeAutofillCharacterReferences({ ...context, entities: [...context.entities].reverse() }))
      .toEqual(buildEpisodeAutofillCharacterReferences(context));
    expect(buildEpisodeAutofillCharacterReferences({
      ...context,
      pages: [...context.pages, { ...context.pages[0]!, pageId: 'page-2', pageNumber: 2 }],
    })).toEqual(buildEpisodeAutofillCharacterReferences(context));
  });

  it('foreign、null、別名 speaker を許可済み話者へ修正し、本文と種別を保持する', () => {
    const context = buildContext({
      entities: [entity('entity-a', '主人公'), entity('entity-b', '相棒', 'nonhuman')],
      panels: [savedPanel(1, [line('entity-b', '同文'), line('entity-a', '別の台詞')])],
    });
    const suggestion = plan([{
      order: 1,
      entities: [assignment('entity-a')],
      dialogue: [line('foreign', '同文'), line(null, '別の台詞', 'thought'), line('E2', '別名', 'shout')],
    }]);

    const result = resolveEpisodeAutofillDialogueSpeakers(context, suggestion);
    const dialogue = result.suggestion.pages[0]!.panels[0]!.dialogue!;

    expect(result.repairedSpeakerCount).toBe(3);
    expect(dialogue.map((entry) => entry.entityId)).toEqual(['entity-b', 'entity-a', 'entity-b']);
    expect(dialogue.map((entry) => [entry.text, entry.type])).toEqual([
      ['同文', 'speech'], ['別の台詞', 'thought'], ['別名', 'shout'],
    ]);
  });

  it('保存済み候補がなくても provider alias を対応する許可済み entityId に解決する', () => {
    const context = buildContext({
      entities: [entity('entity-a', '主人公'), entity('entity-b', '相棒')],
    });
    const suggestion = plan([{ order: 1, dialogue: [line('E2', '別名だけで指定された台詞')] }]);

    const result = resolveEpisodeAutofillDialogueSpeakers(context, suggestion);

    expect(result.repairedSpeakerCount).toBe(1);
    expect(result.suggestion.pages[0]!.panels[0]!.dialogue![0]).toEqual(
      line('entity-b', '別名だけで指定された台詞'),
    );
  });

  it('ナレーションの話者だけを null にし、画面外でも有効な既存話者を保持する', () => {
    const context = buildContext({ entities: [entity('entity-a', '主人公'), entity('entity-b', '画面外')] });
    const suggestion = plan([{ order: 1, entities: [assignment('entity-a')], dialogue: [
      line('entity-b', '画面外から', 'speech'),
      line('entity-a', '地の文', 'narration'),
    ] }]);

    const result = resolveEpisodeAutofillDialogueSpeakers(context, suggestion);

    expect(result.repairedSpeakerCount).toBe(1);
    expect(result.suggestion.pages[0]!.panels[0]!.dialogue).toEqual([
      line('entity-b', '画面外から', 'speech'), line(null, '地の文', 'narration'),
    ]);
  });

  it('提案や状態・参照割当を変更せず、入力も変更しない', () => {
    const context = buildContext({
      entities: [entity('entity-a', '主人公')],
      scenes: [scene('scene-1', ['entity-a'])],
    });
    const suggestion = plan([{
      order: 1,
      entities: [{ ...assignment('entity-a'), stateId: 'state-1' }],
      dialogue: [line('foreign', '保持する本文')],
    }], ['scene-1']);
    const before = structuredClone({ context, suggestion });

    const result = resolveEpisodeAutofillDialogueSpeakers(context, suggestion);

    expect(result.suggestion.pages[0]!.panels[0]!.entities).toEqual(suggestion.pages[0]!.panels[0]!.entities);
    expect(context).toEqual(before.context);
    expect(suggestion).toEqual(before.suggestion);
    expect(result.suggestion.pages[0]!.panels[0]!.dialogue![0]).toMatchObject({
      entityId: 'entity-a', text: '保持する本文', type: 'speech',
    });
  });

  it('許可済みエンティティがなければ未解決話者と null の dialogue 配列をそのまま残す', () => {
    const context = buildContext({ entities: [] });
    const suggestion = plan([{ order: 1, dialogue: [line('foreign', '未解決')] }, { order: 2 }]);
    const nullDialoguePlan = suggestion as unknown as { pages: Array<{ panels: Array<{ dialogue?: unknown }> }> };
    nullDialoguePlan.pages[0]!.panels[1]!.dialogue = null;

    const result = resolveEpisodeAutofillDialogueSpeakers(context, suggestion);

    expect(result.repairedSpeakerCount).toBe(0);
    expect(result.suggestion).toBe(suggestion);
    expect(nullDialoguePlan.pages[0]!.panels[1]!.dialogue).toBeNull();
  });
});

function entity(id: string, name: string, entityType: PageAutofillEntityContext['entityType'] = 'character'): PageAutofillEntityContext {
  return { id, name, entityType, freeDescription: null, promptSupplement: null, structuredFields: {} };
}

function line(entityId: string | null, text: string, type: 'speech' | 'thought' | 'narration' | 'shout' = 'speech') {
  return { entityId, text, type, position: 'top' as const };
}

function assignment(entityId: string) {
  return { entityId, role: 'primary' as const, expression: 'calm' as const, customExpression: null, action: 'standing_firm' as const, customAction: null, position: 'center' as const, facingDirection: null, effectNote: null, stateId: null };
}

function savedPanel(order: number, dialogue: ReturnType<typeof line>[]): PageAutofillPanelContext {
  return { id: `saved-${order}`, order, panelRole: 'action', panelSize: 'standard', situationText: null, composition: { source: 'ai_auto', galleryItemId: null, compositionPrompt: null, shotType: null, angle: null, customNote: null }, dialogueInPanel: true, dialogue, sfxText: null, backgroundNote: null, panelNotes: null, entities: [] };
}

function scene(id: string, involvedEntityIds: string[]): EpisodePagePlanContext['scenes'][number] {
  return { id, order: 1, location: null, time: null, atmosphere: null, involvedEntityIds, entityStates: [] };
}

function plan(panels: EpisodePagePlanSuggestion['pages'][number]['panels'], sourceSceneIds?: string[]): EpisodePagePlanSuggestion {
  return { pages: [{ pageId: 'page-1', pageNumber: 1, sourceSceneIds, panels }] };
}

function buildContext(overrides: Partial<Pick<EpisodePagePlanContext, 'entities' | 'scenes'>> & { panels?: PageAutofillPanelContext[] } = {}): EpisodePagePlanContext {
  return {
    episodeId: 'episode-1', workId: 'work-1',
    chapter: { id: 'chapter-1', title: null, purpose: null, startingState: null, endingState: null, emotionCurve: null, keyBeats: [] },
    episode: { title: null, purpose: null, introduction: null, middle: null, climax: null, endingHook: null, estimatedPages: 1 },
    entities: overrides.entities ?? [entity('entity-a', '主人公')], scenes: overrides.scenes ?? [],
    pages: [{ pageId: 'page-1', pageNumber: 1, frameCount: 2, layoutConfig: {}, status: 'designing', dialogueMode: 'mixed', pageDialogueToggle: true, panels: overrides.panels ?? [] }],
  };
}
