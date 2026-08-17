import { describe, expect, it } from 'vitest';
import type { EpisodePagePlanContext, EpisodePagePlanSuggestion } from '../../../../src/domain/types/page.js';
import type { PageSkeletonPageDraft } from '../../../../src/domain/types/storyAi.js';
import {
  buildVirtualEpisodePlanContext,
  remapEpisodePlanSuggestionToPersistedContext,
} from '../../../../src/services/page/EpisodeSkeletonPlan.js';

const baseContext: EpisodePagePlanContext = {
  episodeId: '33333333-3333-4333-8333-333333333333',
  workId: '11111111-1111-4111-8111-111111111111',
  chapter: {
    id: '22222222-2222-4222-8222-222222222222',
    title: '第一章',
    purpose: null,
    startingState: null,
    endingState: null,
    emotionCurve: null,
    keyBeats: [],
  },
  episode: {
    title: '第一話',
    purpose: '対立を描く',
    introduction: '二人が出会う。',
    middle: '対立する。',
    climax: '剣を抜く。',
    endingHook: '光が走る。',
    estimatedPages: 1,
  },
  scenes: [],
  entities: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      name: '澪',
      entityType: 'character',
      freeDescription: null,
      promptSupplement: null,
      structuredFields: {},
    },
  ],
  pages: [],
};

const skeleton: PageSkeletonPageDraft[] = [
  {
    pageNumber: 1,
    purpose: '対立の始まり',
    suggestedPanelCount: 2,
    suggestedLayout: 'vertical_2',
    panels: [
      {
        order: 1,
        panelRole: 'establish',
        suggestedSize: 'large',
        situationHint: '屋上に澪が立つ。',
        suggestedEntities: ['44444444-4444-4444-8444-444444444444'],
        suggestedDialogueHint: null,
      },
      {
        order: 2,
        panelRole: 'reaction',
        suggestedSize: 'standard',
        situationHint: '澪が振り返る。',
        suggestedEntities: ['44444444-4444-4444-8444-444444444444'],
        suggestedDialogueHint: '誰？',
      },
    ],
  },
];

describe('EpisodeSkeletonPlan', () => {
  it('未保存の骨格を完全な仮想 planning context に変換する', () => {
    let sequence = 0;
    const context = buildVirtualEpisodePlanContext(baseContext, skeleton, () => `virtual-${++sequence}`);

    expect(context.pages).toHaveLength(1);
    expect(context.pages[0]).toMatchObject({
      pageId: 'virtual-1',
      pageNumber: 1,
      frameCount: 2,
      status: 'designing',
      dialogueMode: 'image_baked',
      pageDialogueToggle: true,
    });
    expect(context.pages[0]?.panels.map((panel) => panel.id)).toEqual(['virtual-2', 'virtual-3']);
    expect(context.pages[0]?.panels[0]?.entities[0]?.entityId).toBe(
      '44444444-4444-4444-8444-444444444444',
    );
  });

  it('仮ページIDの提案をpage_numberで永続化後のIDへ変換する', () => {
    const virtual = buildVirtualEpisodePlanContext(baseContext, skeleton, () => 'virtual-id');
    const actual: EpisodePagePlanContext = {
      ...virtual,
      pages: virtual.pages.map((page) => ({ ...page, pageId: 'actual-page-1' })),
    };
    const suggestion: EpisodePagePlanSuggestion = {
      pages: [
        {
          pageId: virtual.pages[0]!.pageId,
          pageNumber: 1,
          sourceSceneIds: [],
          pagePurpose: '対立を強める',
          continuityNote: null,
          page: {},
          panels: [{ order: 1 }],
        },
      ],
    };

    expect(remapEpisodePlanSuggestionToPersistedContext(virtual, actual, suggestion).pages[0]?.pageId)
      .toBe('actual-page-1');
  });

  it('永続化後のページ番号やコマ構造が仮想骨格と違えば拒否する', () => {
    const virtual = buildVirtualEpisodePlanContext(baseContext, skeleton, () => 'virtual-id');
    const missingPage: EpisodePagePlanContext = { ...virtual, pages: [] };
    const suggestion: EpisodePagePlanSuggestion = { pages: [] };

    expect(() => remapEpisodePlanSuggestionToPersistedContext(virtual, missingPage, suggestion))
      .toThrowError(/page structure changed/i);
  });
});
