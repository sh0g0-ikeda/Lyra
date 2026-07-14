import { describe, expect, it } from 'vitest';
import type {
  EpisodePagePlanContext,
  EpisodePagePlanSuggestion,
} from '../../../../src/domain/types/page.js';
import {
  buildEpisodeBeatPlanCompilerBrief,
  buildEpisodeDetailContinuitySupplement,
  buildEpisodePlanAuditBrief,
  detectDeterministicContinuityIssues,
  validateEpisodeBeatPlanCoverage,
} from '../../../../src/services/page/EpisodePlanContinuity.js';
import type { EpisodeBeatPlan } from '../../../../src/services/page/EpisodeBeatPlanCompiler.js';

const PAGE_COUNT = 32;
const PANELS_PER_PAGE = 20;
const DIALOGUE_LINES_PER_PANEL = 20;
const MAX_CONTINUITY_BRIEF_CHARS = 150_000;

describe('EpisodePlanContinuity', () => {
  it('全話台帳 brief にページ容量とシーン内のキャラ状態を含める', () => {
    const context = buildContext();
    context.entities = [
      {
        id: '10000000-0000-4000-8000-000000000001',
        name: '春香',
        entityType: 'character',
        freeDescription: null,
        promptSupplement: null,
        structuredFields: {},
      },
    ];
    context.scenes = [
      {
        id: '20000000-0000-4000-8000-000000000001',
        order: 1,
        location: '駅前',
        time: '夕方',
        atmosphere: '緊迫',
        involvedEntityIds: ['10000000-0000-4000-8000-000000000001'],
        entityStates: [
          {
            entityId: '10000000-0000-4000-8000-000000000001',
            stateId: '30000000-0000-4000-8000-000000000001',
            costumeNote: '制服',
            costumeRefId: null,
            conditionNote: '左頬に新しい傷がある',
            hairNote: null,
            expressionDefault: '痛みをこらえる',
            extraNote: null,
          },
        ],
      },
    ];

    const brief = buildEpisodeBeatPlanCompilerBrief(context, 'ja');

    expect(brief).toContain(`Page 1 (${pageId(1)}) | frame_count=${PANELS_PER_PAGE}`);
    expect(brief).toContain('春香: costume=制服 / condition=左頬に新しい傷がある / expression=痛みをこらえる');
  });

  it('現在 chunk の所有情報は許可上限の最後の story beat まで保持する', () => {
    const context = buildContext();
    const plan = buildBeatPlan();
    const finalBeatMarker = 'CURRENT-OWNERSHIP-FINAL-BEAT';
    plan.pages[0]!.storyBeats = Array.from(
      { length: 8 },
      (_unused, index) => `${index + 1}:${'ページ固有の出来事'.repeat(18)}${index === 7 ? finalBeatMarker : ''}`,
    );

    const brief = buildEpisodeDetailContinuitySupplement({
      context,
      plan,
      currentPageIds: new Set([pageId(1)]),
      completedPages: [],
    });

    expect(brief).toContain(finalBeatMarker);
    expect(brief.length).toBeLessThanOrEqual(MAX_CONTINUITY_BRIEF_CHARS);
  });

  it('同じページ内でも重複した story beat を台帳として採用しない', () => {
    const context = buildContext();
    context.pages = context.pages.slice(0, 1);
    const plan = buildBeatPlan();
    plan.pages = plan.pages.slice(0, 1);
    plan.pages[0]!.storyBeats = [
      '主人公が閉ざされた扉を初めて発見する。',
      '主人公が閉ざされた扉を初めて発見する。',
    ];

    expect(() => validateEpisodeBeatPlanCoverage(context, plan)).toThrow(
      'duplicate story beat',
    );
  });

  it('最大構成でも監査 brief を上限内に収めつつ全ページを残す', () => {
    const context = buildContext();
    const plan = buildBeatPlan();
    const suggestion = buildVerboseSuggestion();

    const brief = buildEpisodePlanAuditBrief({
      context,
      plan,
      suggestion,
      language: 'ja',
    });

    expect(brief.length).toBeLessThanOrEqual(MAX_CONTINUITY_BRIEF_CHARS);
    expect(briefContainsPage(brief, 1)).toBe(true);
    expect(briefContainsPage(brief, PAGE_COUNT)).toBe(true);
    expect(brief).toContain(`Panel ${PANELS_PER_PAGE}`);
  });

  it('監査 brief は UUID ではなくキャラ名で登場人物と話者を識別できる', () => {
    const entityId = '10000000-0000-4000-8000-000000000001';
    const context = buildContext();
    context.pages = context.pages.slice(0, 1);
    context.entities = [
      {
        id: entityId,
        name: '司カサネ',
        entityType: 'character',
        freeDescription: null,
        promptSupplement: null,
        structuredFields: {},
      },
    ];
    const plan = buildBeatPlan();
    plan.pages = plan.pages.slice(0, 1);
    const suggestion = buildVerboseSuggestion();
    suggestion.pages = suggestion.pages.slice(0, 1);
    suggestion.pages[0]!.panels = [
      {
        order: 1,
        situationText: '司カサネが窓辺で手紙を開く。',
        dialogue: [
          {
            entityId,
            type: 'speech',
            position: 'right',
            text: 'これは私に届いた手紙だ。',
          },
        ],
        entities: [
          {
            entityId,
            role: 'primary',
            expression: 'surprised',
            customExpression: null,
            action: 'custom',
            customAction: '手紙を開く',
            position: 'right',
            facingDirection: 'three_quarter_left',
            effectNote: null,
            stateId: null,
          },
        ],
      },
    ];

    const brief = buildEpisodePlanAuditBrief({ context, plan, suggestion, language: 'ja' });

    expect(brief).toContain('entities=司カサネ');
    expect(brief).toContain('speech:司カサネ:これは私に届いた手紙だ。');
  });

  it('決定論的に検出した重複を同じ監査で必ず修復する対象として渡す', () => {
    const context = buildContext();
    context.pages = context.pages.slice(0, 2);
    const plan = buildBeatPlan();
    plan.pages = plan.pages.slice(0, 2);
    const suggestion = buildVerboseSuggestion();
    suggestion.pages = suggestion.pages.slice(0, 2).map((page) => ({
      ...page,
      panels: [
        {
          order: 1,
          situationText: `ページ${page.pageNumber}だけの状況。`,
          dialogue: [
            {
              entityId: null,
              type: 'narration',
              position: 'top',
              text: 'そこにいるの？',
            },
          ],
        },
      ],
    }));

    const brief = buildEpisodePlanAuditBrief({ context, plan, suggestion, language: 'ja' });

    expect(brief).toContain('[DETERMINISTIC FINDINGS THAT MUST BE REPAIRED]');
    expect(brief).toContain(`duplicate_dialogue | pages=${pageId(2)}`);
  });

  it('最大構成でも後続 chunk 用 brief を上限内に収めつつ既出ページを残す', () => {
    const context = buildContext();
    const plan = buildBeatPlan();
    const suggestion = buildVerboseSuggestion();
    const currentPageId = pageId(PAGE_COUNT);

    const brief = buildEpisodeDetailContinuitySupplement({
      context,
      plan,
      currentPageIds: new Set([currentPageId]),
      completedPages: suggestion.pages.filter((page) => page.pageId !== currentPageId),
    });

    expect(brief.length).toBeLessThanOrEqual(MAX_CONTINUITY_BRIEF_CHARS);
    expect(briefContainsPage(brief, 1)).toBe(true);
    expect(briefContainsPage(brief, PAGE_COUNT - 1)).toBe(true);
    expect(briefContainsPage(brief, PAGE_COUNT)).toBe(true);
  });

  it('最大構成の修復 brief でも既出ページと修復対象 chunk を上限内に保持する', () => {
    const context = buildContext();
    const plan = buildBeatPlan();
    const suggestion = buildVerboseSuggestion();
    const currentDraftPages = suggestion.pages.slice(-3);
    const currentPageIds = new Set(currentDraftPages.map((page) => page.pageId));
    const completedPages = suggestion.pages.filter((page) => !currentPageIds.has(page.pageId));
    const completedMarker = 'COMPLETED-PAGE-MARKER';
    const draftMarker = 'CURRENT-DRAFT-MARKER';
    completedPages[0]!.panels[0]!.situationText = completedMarker;
    currentDraftPages[1]!.panels[0]!.situationText = draftMarker;

    const brief = buildEpisodeDetailContinuitySupplement({
      context,
      plan,
      currentPageIds,
      completedPages,
      currentDraftPages,
      repairIssues: [
        {
          code: 'page_handoff_break',
          severity: 'error',
          pageIds: [pageId(PAGE_COUNT)],
          message: '最終ページへの接続が急すぎる。',
          repairInstruction: '前ページの終了状態から連続する導入へ修正する。',
        },
      ],
    });

    expect(brief.length).toBeLessThanOrEqual(MAX_CONTINUITY_BRIEF_CHARS);
    expect(brief).toContain('[CURRENT CHUNK DRAFT TO REPAIR]');
    expect(brief).toContain(completedMarker);
    expect(brief).toContain(draftMarker);
    expect(briefContainsPage(brief, PAGE_COUNT)).toBe(true);
  });

  it('修復 brief は修復前の対象 chunk を示して問題のないコマを維持させる', () => {
    const context = buildContext();
    context.pages = context.pages.slice(0, 3);
    const plan = buildBeatPlan();
    plan.pages = plan.pages.slice(0, 3);
    const suggestion = buildVerboseSuggestion();
    suggestion.pages = suggestion.pages.slice(0, 3);
    const preservedSituation = 'このコマは監査対象ではないので内容を維持する。';
    suggestion.pages[1]!.panels[0]!.situationText = preservedSituation;
    suggestion.pages[1]!.panels[0]!.composition = {
      source: 'custom',
      galleryItemId: null,
      shotType: 'close_up',
      angle: 'worm_eye',
      compositionPrompt: '手前の封筒から奥の人物へ視線を誘導する。',
      customNote: '人物の右目だけを光らせる。',
    };
    suggestion.pages[1]!.panels[0]!.backgroundNote = '夕暮れの郵便局と赤いポスト。';
    suggestion.pages[1]!.panels[0]!.panelNotes = '次のコマへ手紙の向きをつなぐ。';
    suggestion.pages[1]!.panels[0]!.sfxText = 'カサ';

    const brief = buildEpisodeDetailContinuitySupplement({
      context,
      plan,
      currentPageIds: new Set(plan.pages.map((page) => page.pageId)),
      completedPages: [],
      currentDraftPages: suggestion.pages,
      repairIssues: [
        {
          code: 'duplicate_dialogue',
          severity: 'error',
          pageIds: [pageId(3)],
          message: 'ページ3のセリフが重複している。',
          repairInstruction: 'ページ3だけを前進するセリフへ直す。',
        },
      ],
    });

    expect(brief).toContain('[CURRENT CHUNK DRAFT TO REPAIR]');
    expect(brief).toContain(preservedSituation);
    expect(brief).toContain('shot=close_up');
    expect(brief).toContain('angle=worm_eye');
    expect(brief).toContain('composition=手前の封筒から奥の人物へ視線を誘導する。');
    expect(brief).toContain('background=夕暮れの郵便局と赤いポスト。');
    expect(brief).toContain('notes=次のコマへ手紙の向きをつなぐ。');
    expect(brief).toContain('sfx=カサ');
  });

  it('隣接ページを含むページ横断の同一状況を重複として検出する', () => {
    const repeatedSituation = '同じ駅のホームで主人公が到着を待っている。';
    const suggestion = buildVerboseSuggestion();
    suggestion.pages = suggestion.pages.slice(0, 3).map((page) => ({
      ...page,
      panels: [
        {
          order: 1,
          situationText: repeatedSituation,
          dialogue: [
            {
              entityId: null,
              type: 'narration',
              position: 'top',
              text: `ページ${page.pageNumber}だけの異なるナレーション。`,
            },
          ],
        },
      ],
    }));

    const issues = detectDeterministicContinuityIssues(suggestion);

    expect(issues.filter((issue) => issue.code === 'duplicate_visual_beat')).toEqual([
      expect.objectContaining({ pageIds: [pageId(2)] }),
      expect.objectContaining({ pageIds: [pageId(3)] }),
    ]);
  });

  it('短くても意味を持つ同一セリフをページ横断で検出する', () => {
    const suggestion = buildVerboseSuggestion();
    suggestion.pages = suggestion.pages.slice(0, 2).map((page) => ({
      ...page,
      panels: [
        {
          order: 1,
          situationText: `ページ${page.pageNumber}だけの異なる状況。`,
          dialogue: [
            {
              entityId: null,
              type: 'narration',
              position: 'top',
              text: 'そこにいるの？',
            },
          ],
        },
      ],
    }));

    const issues = detectDeterministicContinuityIssues(suggestion);

    expect(issues.filter((issue) => issue.code === 'duplicate_dialogue')).toEqual([
      expect.objectContaining({ pageIds: [pageId(2)] }),
    ]);
  });
});

function buildContext(): EpisodePagePlanContext {
  return {
    episodeId: 'episode-1',
    workId: 'work-1',
    chapter: {
      id: 'chapter-1',
      title: '長編テスト',
      purpose: '全ページを通して物語を前進させる。',
      startingState: '主人公は出発前にいる。',
      endingState: '主人公は目的地へ到着する。',
      emotionCurve: '静かな始まりから緊張が高まる。',
      keyBeats: ['出発する', '障害を越える', '目的地へ着く'],
    },
    episode: {
      title: '長い旅',
      purpose: '旅の変化を描く。',
      introduction: '主人公が旅立つ。',
      middle: '障害を順番に越える。',
      climax: '最後の障害と向き合う。',
      endingHook: '目的地で新しい事実を知る。',
      estimatedPages: PAGE_COUNT,
    },
    scenes: [],
    entities: [],
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
}

function buildBeatPlan(): EpisodeBeatPlan {
  return {
    pages: Array.from({ length: PAGE_COUNT }, (_unused, index) => ({
      pageId: pageId(index + 1),
      pageNumber: index + 1,
      storyBeats: Array.from(
        { length: 12 },
        (_unusedBeat, beatIndex) =>
          `ページ${index + 1}の出来事${beatIndex + 1}:${'固有の物語情報'.repeat(30)}`,
      ),
      entryState: `ページ${index + 1}の開始状態:${'前ページから継続する状態'.repeat(35)}`,
      exitState: `ページ${index + 1}の終了状態:${'次ページへ渡す状態'.repeat(35)}`,
      newInformation: Array.from(
        { length: 12 },
        (_unusedInformation, informationIndex) =>
          `新情報${informationIndex + 1}:${'このページで初めて判明する情報'.repeat(20)}`,
      ),
      dialogueIntent: `会話意図:${'このページだけの会話目的'.repeat(35)}`,
      handoff: `引き継ぎ:${'次ページへつなぐ未解決事項'.repeat(35)}`,
    })),
  };
}

function buildVerboseSuggestion(): EpisodePagePlanSuggestion {
  return {
    pages: Array.from({ length: PAGE_COUNT }, (_unused, pageIndex) => ({
      pageId: pageId(pageIndex + 1),
      pageNumber: pageIndex + 1,
      pagePurpose: `ページ${pageIndex + 1}の目的:${'固有の目的'.repeat(80)}`,
      continuityNote: `ページ${pageIndex + 1}の連続性:${'前後関係'.repeat(160)}`,
      panels: Array.from({ length: PANELS_PER_PAGE }, (_unusedPanel, panelIndex) => ({
        order: panelIndex + 1,
        panelRole: 'action',
        situationText: `ページ${pageIndex + 1}コマ${panelIndex + 1}:${'固有の状況'.repeat(300)}`,
        composition: {
          shotType: 'wide',
          angle: 'front',
        },
        backgroundNote: `背景:${'その場固有の背景'.repeat(300)}`,
        dialogue: Array.from(
          { length: DIALOGUE_LINES_PER_PANEL },
          (_unusedLine, lineIndex) => ({
            entityId: null,
            type: 'narration',
            position: 'top',
            text: `台詞${lineIndex + 1}:${'その場だけの長い台詞'.repeat(80)}`,
          }),
        ),
        entities: [],
      })),
    })),
  };
}

function pageId(pageNumber: number): string {
  return `00000000-0000-4000-8000-${String(pageNumber).padStart(12, '0')}`;
}

function briefContainsPage(brief: string, pageNumber: number): boolean {
  return brief.includes(`Page ${pageNumber} (${pageId(pageNumber)})`);
}
