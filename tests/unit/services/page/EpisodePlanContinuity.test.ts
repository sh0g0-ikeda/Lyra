import { describe, expect, it } from 'vitest';
import type {
  EpisodePagePlanContext,
  EpisodePagePlanSuggestion,
} from '../../../../src/domain/types/page.js';
import {
  buildEpisodeBeatPlanCompilerBrief,
  buildEpisodeDetailContinuitySupplement,
  buildEpisodePlanAuditArtifacts,
  buildEpisodePlanAuditBrief,
  buildEpisodePlanAuditCoverageCatalog,
  detectDeterministicContinuityIssues,
  validateEpisodeBeatPlanCoverage,
} from '../../../../src/services/page/EpisodePlanContinuity.js';
import type { EpisodeBeatPlan } from '../../../../src/services/page/EpisodeBeatPlanCompiler.js';

const PAGE_COUNT = 32;
const PANELS_PER_PAGE = 20;
const DIALOGUE_LINES_PER_PANEL = 20;
const MAX_CONTINUITY_BRIEF_CHARS = 150_000;

describe('EpisodePlanContinuity', () => {
  it('audits true dialogue counts, complete voice IDs and frame area before shortened visuals',()=>{
    const context=buildContext();const plan=buildBeatPlan();const suggestion=buildVerboseSuggestion();
    suggestion.pages=suggestion.pages.slice(0,1);suggestion.pages[0]!.panels=suggestion.pages[0]!.panels.slice(0,1);
    suggestion.pages[0]!.panels[0]!.dialogue=Array.from({length:5},(_,i)=>({entityId:'voice-id',text:`exact-${i}`,type:'thought',position:'right'}));
    expect(detectDeterministicContinuityIssues(suggestion)).toContainEqual(expect.objectContaining({code:'dialogue_density',severity:'error'}));
    const brief=buildEpisodePlanAuditBrief({context,plan,suggestion,language:'ja'});
    expect(brief).toContain('[TEXT DISTRIBUTION]');expect(brief).toContain('lines=5');
    expect(brief).toContain('p1.d5="exact-4"|thought:voice-id@right');
  });

  it('coverage catalogは原作sourceと実panel出力だけを短いrefで列挙する', () => {
    const context = buildContext();
    const plan = buildBeatPlan();
    const suggestion = buildVerboseSuggestion();
    context.pages = context.pages.slice(0, 1);
    plan.pages = plan.pages.slice(0, 1);
    suggestion.pages = suggestion.pages.slice(0, 1);
    suggestion.pages[0]!.panels = suggestion.pages[0]!.panels.slice(0, 1);
    suggestion.pages[0]!.panels[0]!.dialogue = suggestion.pages[0]!.panels[0]!.dialogue?.slice(0, 1);
    const catalog = buildEpisodePlanAuditCoverageCatalog({ context, plan, suggestion });

    expect(catalog.pages).toHaveLength(1);
    expect(catalog.pages[0]?.sources.map((source) => source.ref)).toEqual(['source', 'ledger']);
    expect(catalog.pages[0]?.outputs.length).toBeGreaterThan(0);
    expect(catalog.pages[0]?.outputs.every((output) => output.panelOrder !== null)).toBe(true);
    expect(catalog.pages[0]?.outputs.some((output) => output.ref.startsWith('page.'))).toBe(false);
    expect(buildEpisodePlanAuditBrief({ context, plan, suggestion, language: 'ja' })).toContain(
      'dN=the Nth COMPLETE DIALOGUE line',
    );
  });

  it('監査表示の空白正規化をvisual・dialogueとcoverage catalogで共有する', () => {
    const context = buildContext();
    context.pages = context.pages.slice(0, 1);
    context.episode.storyFullDraft = '原作の改行は\n  そのまま保持する。';
    const plan = buildBeatPlan();
    plan.pages = plan.pages.slice(0, 1);
    plan.pages[0]!.storyBeats = ['再び\n   押す'];
    const suggestion = buildVerboseSuggestion();
    suggestion.pages = suggestion.pages.slice(0, 1);
    suggestion.pages[0]!.panels = [{
      order: 1,
      situationText: '再び\n   押す',
      backgroundNote: '雨\t\tの   港',
      composition: {
        source: 'custom',
        compositionPrompt: '扉を\r\n  中央へ置く',
        customNote: '暗部を   保つ',
      },
      panelNotes: '動作を\n 継続',
      dialogue: [{
        entityId: null,
        text: 'もう一度\n   押す',
        type: 'narration',
        position: 'top',
      }],
      entities: [],
    }];

    const artifacts = buildEpisodePlanAuditArtifacts({ context, plan, suggestion, language: 'ja' });
    const page = artifacts.coverageCatalog.pages[0];

    expect(artifacts.compilerBrief).toContain('p1.s="再び 押す"');
    expect(artifacts.compilerBrief).toContain('p1.b="雨 の 港"');
    expect(artifacts.compilerBrief).toContain('p1.c="扉を 中央へ置く"');
    expect(artifacts.compilerBrief).toContain('p1.x="暗部を 保つ"');
    expect(artifacts.compilerBrief).toContain('p1.n="動作を 継続"');
    expect(artifacts.compilerBrief).toContain('p1.d1="もう一度 押す"');
    expect(artifacts.compilerBrief).toContain('narrator label below is the display alias for entity_id=null');
    expect(artifacts.compilerBrief).toContain('Copy each source_quote and output quote');
    expect(page?.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: 'p1.s', text: '再び 押す' }),
      expect.objectContaining({ ref: 'p1.b', text: '雨 の 港' }),
      expect.objectContaining({ ref: 'p1.c', text: '扉を 中央へ置く' }),
      expect.objectContaining({ ref: 'p1.x', text: '暗部を 保つ' }),
      expect.objectContaining({ ref: 'p1.n', text: '動作を 継続' }),
      expect.objectContaining({ ref: 'p1.d1', text: 'もう一度 押す' }),
    ]));
    expect(artifacts.compilerBrief).toContain(context.episode.storyFullDraft);
    expect(page?.sources.find((source) => source.ref === 'source')?.text)
      .toContain(context.episode.storyFullDraft);
    const ledger = page?.sources.find((source) => source.ref === 'ledger')?.text;
    expect(ledger).toContain('beats=再び 押す');
    expect(artifacts.compilerBrief).toContain(ledger);
    expect(suggestion.pages[0]?.panels[0]?.dialogue?.[0]?.text).toBe('もう一度\n   押す');
    expect(context.episode.storyFullDraft).toBe('原作の改行は\n  そのまま保持する。');
  });

  it('動的budgetで切り詰めたvisualはsynthetic ellipsisをcatalogへ入れない', () => {
    const context = buildContext();
    context.pages = context.pages.slice(0, 1);
    const plan = buildBeatPlan();
    plan.pages = plan.pages.slice(0, 1);
    const suggestion = buildVerboseSuggestion();
    suggestion.pages = suggestion.pages.slice(0, 1);
    suggestion.pages[0]!.panels = suggestion.pages[0]!.panels.slice(0, 1);
    suggestion.pages[0]!.panels[0]!.dialogue = [];

    const artifacts = buildEpisodePlanAuditArtifacts({ context, plan, suggestion, language: 'ja' });
    const situation = artifacts.coverageCatalog.pages[0]?.outputs.find(
      (output) => output.ref === 'p1.s',
    );

    expect(situation?.text.endsWith('...')).toBe(false);
    expect(artifacts.compilerBrief).toContain(`p1.s="${situation?.text}"…`);
    expect(situation?.text).not.toContain('固有の状況'.repeat(300));
  });

  it('切り詰めていない実fieldのliteral ellipsisはcatalogに保持する', () => {
    const context = buildContext();
    context.pages = context.pages.slice(0, 1);
    const plan = buildBeatPlan();
    plan.pages = plan.pages.slice(0, 1);
    const suggestion = buildVerboseSuggestion();
    suggestion.pages = suggestion.pages.slice(0, 1);
    suggestion.pages[0]!.panels = [{
      order: 1,
      situationText: '扉を閉じる...',
      dialogue: [],
      entities: [],
    }];

    const artifacts = buildEpisodePlanAuditArtifacts({ context, plan, suggestion, language: 'ja' });
    const situation = artifacts.coverageCatalog.pages[0]?.outputs.find(
      (output) => output.ref === 'p1.s',
    );

    expect(situation?.text).toBe('扉を閉じる...');
    expect(artifacts.compilerBrief).toContain('p1.s="扉を閉じる..."|');
  });

  it('直接ref・短い台詞の非引用注記・literal ellipsisを同じartifactで示す', () => {
    const context = buildContext();
    context.pages = context.pages.slice(0, 1);
    const plan = buildBeatPlan();
    plan.pages = plan.pages.slice(0, 1);
    const suggestion = buildVerboseSuggestion();
    suggestion.pages = suggestion.pages.slice(0, 1);
    suggestion.pages[0]!.panels = [{
      order: 3,
      situationText: '扉を閉じる...',
      dialogue: [{ entityId: null, type: 'narration', position: 'right', text: '届いた' }],
      entities: [],
    }];

    const artifacts = buildEpisodePlanAuditArtifacts({ context, plan, suggestion, language: 'ja' });
    const outputs = artifacts.coverageCatalog.pages[0]?.outputs ?? [];
    const panelLine = artifacts.compilerBrief.split('\n').find((line) => line.includes('Panel 3'));

    expect(panelLine).toContain('p3.s="扉を閉じる..."');
    expect(panelLine?.length).toBeLessThanOrEqual(702);
    expect(artifacts.compilerBrief).toContain('p3.d1="届いた" (not citable: fewer than 4 characters)');
    expect(artifacts.compilerBrief).toContain('source_ref=source ranges only over SOURCE DATA');
    expect(artifacts.compilerBrief).toContain('source_ref=ledger ranges only over that page');
    expect(outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ ref: 'p3.s', text: '扉を閉じる...' }),
      expect.objectContaining({ ref: 'p3.d1', text: '届いた' }),
    ]));
    expect(suggestion.pages[0]?.panels[0]?.dialogue?.[0]?.text).toBe('届いた');
  });

  it('JSON escape後の直接ref表示も各panel 700文字と全体150k以内へ切り詰める', () => {
    const context = buildContext();
    context.pages = context.pages.slice(0, 6);
    const plan = buildBeatPlan();
    plan.pages = plan.pages.slice(0, 6);
    const suggestion = buildVerboseSuggestion();
    suggestion.pages = suggestion.pages.slice(0, 6).map((page) => ({
      ...page,
      panels: page.panels.slice(0, 20).map((panel) => ({
        ...panel,
        situationText: `状況${'"\\'.repeat(500)}`,
        backgroundNote: `背景${'"\\'.repeat(500)}`,
        composition: {
          source: 'custom' as const,
          compositionPrompt: `構図${'"\\'.repeat(500)}`,
          customNote: `演出${'"\\'.repeat(500)}`,
        },
        panelNotes: `注記${'"\\'.repeat(500)}`,
        dialogue: [],
        entities: [],
      })),
    }));

    const artifacts = buildEpisodePlanAuditArtifacts({ context, plan, suggestion, language: 'ja' });
    const panelLines = artifacts.compilerBrief.split('\n').filter((line) => /^  Panel \d+\|/u.test(line));

    expect(artifacts.compilerBrief.length).toBeLessThanOrEqual(MAX_CONTINUITY_BRIEF_CHARS);
    expect(panelLines).toHaveLength(120);
    expect(panelLines.every((line) => line.length <= 702)).toBe(true);
    expect(artifacts.coverageCatalog.pages.flatMap((page) => page.outputs)
      .every((output) => !output.text.endsWith('…'))).toBe(true);
    expect(suggestion.pages[0]?.panels[0]?.situationText).toBe(`状況${'"\\'.repeat(500)}`);
  });

  it('監査 brief は全15ページで所有台帳と実パネルを同じページ entry に並べる', () => {
    const context = buildContext();
    context.pages = context.pages.slice(0, 15);
    const plan = buildBeatPlan();
    plan.pages = plan.pages.slice(0, 15);
    const suggestion = buildVerboseSuggestion();
    suggestion.pages = suggestion.pages.slice(0, 15).map((page) => ({
      ...page,
      panels: [{
        order: 1,
        situationText: `実パネル-${page.pageNumber}`,
        dialogue: [],
        entities: [],
      }],
    }));

    for (const page of plan.pages) {
      page.storyBeats = [`所有出来事-${page.pageNumber}`];
      page.newInformation = [`新情報-${page.pageNumber}`];
      page.textPlan = {
        requiredTextBeats: [`必須テキスト-${page.pageNumber}`],
        visualOnlyBeats: [`必須映像-${page.pageNumber}`],
        densityReason: `密度理由-${page.pageNumber}`,
      };
    }

    const brief = buildEpisodePlanAuditBrief({ context, plan, suggestion, language: 'ja' });
    const compiledDraft = brief.slice(
      brief.indexOf('[COMPILED EPISODE DRAFT]'),
      brief.indexOf('[TEXT DISTRIBUTION]'),
    );

    for (const page of plan.pages) {
      const header = `Page ${page.pageNumber} (${page.pageId})`;
      const nextPage = plan.pages.find((candidate) => candidate.pageNumber === page.pageNumber + 1);
      const start = compiledDraft.indexOf(header);
      const end = nextPage === undefined
        ? compiledDraft.length
        : compiledDraft.indexOf(`Page ${nextPage.pageNumber} (${nextPage.pageId})`, start + header.length);
      const pageEntry = compiledDraft.slice(start, end);

      expect(start).toBeGreaterThanOrEqual(0);
      expect(pageEntry).toContain(`owner_page_id=${page.pageId}`);
      expect(pageEntry).toContain(`story_beats=所有出来事-${page.pageNumber}`);
      expect(pageEntry).toContain(`new_information=新情報-${page.pageNumber}`);
      expect(pageEntry).toContain(`required_text=必須テキスト-${page.pageNumber}`);
      expect(pageEntry).toContain(`visual_only=必須映像-${page.pageNumber}`);
      expect(pageEntry).toContain(`Panel 1`);
    }
    expect(brief.length).toBeLessThanOrEqual(MAX_CONTINUITY_BRIEF_CHARS);
  });

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

    expect(()=>buildEpisodePlanAuditBrief({context,plan,suggestion,language:'ja'})).toThrow('complete dialogue');
    for(const page of suggestion.pages) { page.panels=page.panels.slice(0,8); for(const panel of page.panels) panel.dialogue=[{entityId:null,type:'narration',position:'right',text:`page-${page.pageNumber}-panel-${panel.order}`}]; }
    const brief = buildEpisodePlanAuditBrief({
      context,
      plan,
      suggestion,
      language: 'ja',
    });

    expect(brief.length).toBeLessThanOrEqual(MAX_CONTINUITY_BRIEF_CHARS);
    expect(briefContainsPage(brief, 1)).toBe(true);
    expect(briefContainsPage(brief, PAGE_COUNT)).toBe(true);
    expect(brief).toContain(`Panel 8`);
  }, 20_000);

  it('局所台帳の追加分だけが上限を超える場合は旧必須情報を保って補足だけを省く', () => {
    const context = buildContext();
    const sourceEndMarker = 'FULL-SOURCE-END-MARKER';
    context.episode.storyFullDraft = `FULL-SOURCE-BEGIN-${'原文'.repeat(3_970)}-${sourceEndMarker}`;
    const plan = buildBeatPlan();
    const suggestion = buildVerboseSuggestion();
    const finalDialogueMarker = 'FINAL-COMPLETE-DIALOGUE-MARKER';
    for (const page of suggestion.pages) {
      page.panels = page.panels.slice(0, 8);
      for (const panel of page.panels) {
        const isFinal = page.pageNumber === PAGE_COUNT && panel.order === 8;
        panel.dialogue = [{
          entityId: null,
          type: 'narration',
          position: 'right',
          text: `${isFinal ? finalDialogueMarker : 'BOUNDARY-DIALOGUE'}-${page.pageNumber}-${panel.order}-${'情報'.repeat(30)}`,
        }];
      }
    }

    const brief = buildEpisodePlanAuditBrief({ context, plan, suggestion, language: 'ja' });
    const compiledDraft = brief.slice(
      brief.indexOf('[COMPILED EPISODE DRAFT]'),
      brief.indexOf('[TEXT DISTRIBUTION]'),
    );

    expect(brief.length).toBeLessThanOrEqual(MAX_CONTINUITY_BRIEF_CHARS);
    expect(brief).toContain(sourceEndMarker);
    expect(brief).toContain('[GLOBAL EPISODE LEDGER]');
    expect(brief).toContain(finalDialogueMarker);
    expect(brief).toContain('[TEXT DISTRIBUTION]');
    expect(briefContainsPage(compiledDraft, 1)).toBe(true);
    expect(briefContainsPage(compiledDraft, PAGE_COUNT)).toBe(true);
    expect(compiledDraft).not.toContain('owner_page_id=');
  }, 20_000);

  it('上限付近で主体属性と構図・演出メモの最小予約が入らない場合は監査を失敗させる', () => {
    const entityId = '10000000-0000-4000-8000-000000000001';
    const context = buildContext();
    context.entities = [
      {
        id: entityId,
        name: '春香',
        entityType: 'character',
        freeDescription: null,
        promptSupplement: null,
        structuredFields: {},
      },
    ];
    const plan = buildBeatPlan();
    const suggestion = buildVerboseSuggestion();
    for (const page of suggestion.pages) {
      page.panels = page.panels.slice(0, 8);
      for (const panel of page.panels) {
        const marker = `${page.pageNumber}-${panel.order}`;
        panel.dialogue = [{
          entityId: null,
          type: 'narration',
          position: 'right',
          text: `台詞${marker}:${'固有の説明'.repeat(8)}`,
        }];
        panel.composition = {
          source: 'custom',
          galleryItemId: null,
          shotType: 'wide',
          angle: 'front',
          compositionPrompt: `外景${marker}:建物全体と港を遠景で見せる。`,
          customNote: `演出${marker}:人物を画面に出さない。`,
        };
        panel.panelNotes = `継続${marker}:作業は室内で続いている。`;
        panel.entities = [{
          entityId,
          role: 'primary',
          expression: 'determined',
          customExpression: null,
          action: 'custom',
          customAction: 'ハンドルを一定速度で回し続ける',
          position: 'center',
          facingDirection: 'front',
          effectNote: null,
          stateId: null,
        }];
      }
    }

    expect(() => buildEpisodePlanAuditBrief({ context, plan, suggestion, language: 'ja' }))
      .toThrow('Episode audit cannot fit complete dialogue within its safe input limit');
  }, 20_000);

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

    expect(brief).toContain('p1.e="司カサネ');
    expect(brief).toContain('p1.d1="これは私に届いた手紙だ。"');
  });

  it('監査 brief は構図と演出メモ、可視主体の役割・動作・位置、off-panel 話者を保持する', () => {
    const entityId = '10000000-0000-4000-8000-000000000001';
    const context = buildContext();
    context.pages = context.pages.slice(0, 1);
    context.entities = [
      {
        id: entityId,
        name: '春香',
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
        panelRole: 'establish',
        situationText: '建物の外観と港を遠景で見せる。',
        composition: {
          source: 'custom',
          galleryItemId: null,
          shotType: 'wide',
          angle: 'bird_eye',
          compositionPrompt: '建物の外から港までを広く見渡す。',
          customNote: '人物ではなく建物と光を主役にする。',
        },
        panelNotes: '直前の人物は建物内で作業を続けている。',
        backgroundNote: '夕暮れの港。',
        entities: [
          {
            entityId,
            role: 'primary',
            expression: 'calm',
            customExpression: null,
            action: 'standing_firm',
            customAction: null,
            position: 'center',
            facingDirection: 'front',
            effectNote: null,
            stateId: null,
          },
        ],
      },
      {
        order: 2,
        panelRole: 'transition',
        situationText: '港だけを映す。',
        dialogue: [
          {
            entityId,
            type: 'thought',
            position: 'right',
            text: '届いた。',
          },
        ],
        entities: [],
      },
    ];

    const brief = buildEpisodePlanAuditBrief({ context, plan, suggestion, language: 'ja' });

    expect(brief).toContain('p1.c="建物の外から港までを広く見渡す。"');
    expect(brief).toContain('p1.x="人物ではなく建物と光を主役にする。"');
    expect(brief).toContain('p1.n="直前の人物は建物内で作業を続けている。"');
    expect(brief).toContain('春香{role=primary,action=standing_firm,position=center}');
    expect(brief).toContain('p2.e=none');
    expect(brief).toContain('p2.d1="届いた。"');
    // v19 design: the bounded two-fact sidecar samples actual omissions or
    // contradictions before easy present dialogue, while the body still audits all facts.
    expect(brief).toContain(
      'reserve a check for it before sampling dialogue or an already-obvious present fact',
    );
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
