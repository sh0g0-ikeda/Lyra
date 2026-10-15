import type { EpisodePagePlanContext, EpisodePagePlanSuggestion } from '../../src/domain/types/page.js';
import type { EpisodeBeatPlan } from '../../src/services/page/EpisodeBeatPlanCompiler.js';

const PAGE_COUNT = 16;
const PANELS_PER_PAGE = 4;
const SPEAKER_ID = '10000000-0000-4000-8000-000000000001';

/**
 * Capacity regression fixture: each page has a causal source unit and exact
 * draft dialogue. This checks capacity/refs, not semantic acceptance of the draft.
 */
export function buildEpisodeAuditCapacityFixture(): {
  context: EpisodePagePlanContext;
  plan: EpisodeBeatPlan;
  suggestion: EpisodePagePlanSuggestion;
} {
  const pageSource = Array.from({ length: PAGE_COUNT }, (_unused, index) => {
    const pageNumber = index + 1;
    return `${pageNumber}ページ目：鍵${pageNumber}を確認して扉${pageNumber}を開ける。扉が開いた結果、主人公は廊下${pageNumber}へ進む。進行中の足音${pageNumber}は次のページまで続く。`;
  });
  const context: EpisodePagePlanContext = {
    episodeId: 'episode-audit-capacity',
    workId: 'work-audit-capacity',
    chapter: {
      id: 'chapter-audit-capacity',
      title: '監査容量',
      purpose: '各ページの因果と継続を監査する。',
      startingState: '主人公は入口にいる。',
      endingState: '主人公は最後の廊下に到着する。',
      emotionCurve: '確認から前進へ変化する。',
      keyBeats: ['確認', '開扉', '前進'],
    },
    episode: {
      title: '十六の扉',
      purpose: '連続する扉を通る。',
      introduction: '最初の鍵を確認する。',
      middle: '各扉を順に開ける。',
      climax: '最後の扉を開ける。',
      endingHook: '次の場所へ進む。',
      estimatedPages: PAGE_COUNT,
      storyFullDraft: pageSource.join('\n'),
    },
    scenes: [],
    entities: [{
      id: SPEAKER_ID,
      name: '綾',
      entityType: 'character',
      freeDescription: '青い上着を着た主人公。',
      promptSupplement: null,
      structuredFields: {},
    }],
    pages: Array.from({ length: PAGE_COUNT }, (_unused, index) => ({
      pageId: pageId(index + 1),
      pageNumber: index + 1,
      frameCount: PANELS_PER_PAGE,
      layoutConfig: {},
      status: 'designing',
      dialogueMode: 'image_baked',
      pageDialogueToggle: true,
      panels: [],
    })),
  };
  const plan: EpisodeBeatPlan = {
    pages: Array.from({ length: PAGE_COUNT }, (_unused, index) => {
      const pageNumber = index + 1;
      return {
        pageId: pageId(pageNumber),
        pageNumber,
        storyBeats: [`鍵${pageNumber}を確認して扉${pageNumber}を開ける。`],
        entryState: `鍵${pageNumber}を手にした状態。`,
        exitState: `廊下${pageNumber}へ入った状態。`,
        newInformation: [`扉${pageNumber}の先は廊下${pageNumber}である。`],
        dialogueIntent: `綾が開扉${pageNumber}の決意を言葉にする。`,
        handoff: `足音${pageNumber}を次ページへ継続する。`,
      };
    }),
  };
  const suggestion: EpisodePagePlanSuggestion = {
    pages: Array.from({ length: PAGE_COUNT }, (_unused, pageIndex) => {
      const pageNumber = pageIndex + 1;
      return {
        pageId: pageId(pageNumber),
        pageNumber,
        pagePurpose: `鍵${pageNumber}から廊下${pageNumber}へ因果をつなぐ。`,
        continuityNote: `足音${pageNumber}を次ページへ継続する。`,
        panels: Array.from({ length: PANELS_PER_PAGE }, (_unusedPanel, panelIndex) => {
          const panelNumber = panelIndex + 1;
          return {
            order: panelNumber,
            panelRole: panelNumber === 1 ? 'establish' : 'action',
            situationText: `綾が鍵${pageNumber}を確認して扉${pageNumber}を開け、廊下${pageNumber}へ進む。`,
            backgroundNote: `廊下${pageNumber}の壁に扉${pageNumber}の影が伸びる。`,
            composition: {
              source: 'custom',
              shotType: 'half_body',
              angle: 'front',
              compositionPrompt: `鍵${pageNumber}、綾の手、開いた扉${pageNumber}を同一画面に置く。`,
              customNote: `進行中の足音${pageNumber}を床の連続線で示す。`,
            },
            panelNotes: `結果の廊下${pageNumber}を次のコマへ見せる。`,
            dialogue: [{
              entityId: SPEAKER_ID,
              type: 'speech',
              position: 'right',
              text: `台詞${pageNumber}-${panelNumber}：鍵${pageNumber}を確かめた。扉${pageNumber}を開けて先へ進む。`,
            }],
            entities: [{
              entityId: SPEAKER_ID,
              role: 'primary',
              expression: 'determined',
              customExpression: null,
              action: 'custom',
              customAction: `鍵${pageNumber}を持ち扉${pageNumber}を押す`,
              position: 'center',
              facingDirection: 'front',
              effectNote: null,
              stateId: null,
            }],
          };
        }),
      };
    }),
  };
  return { context, plan, suggestion };
}

function pageId(pageNumber: number): string {
  return `00000000-0000-4000-8000-${String(pageNumber).padStart(12, '0')}`;
}
