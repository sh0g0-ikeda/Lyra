import { describe, expect, it } from 'vitest';
import { detectDeterministicContinuityIssues, buildEpisodePlanAuditBrief, buildEpisodeDetailContinuitySupplement } from '../../../../src/services/page/EpisodePlanContinuity.js';
import { episodePlanAuditSchema } from '../../../../src/lib/validators/episodePlanAudit.schema.js';
import { pageAutofillSuggestionSchema } from '../../../../src/lib/validators/pageAutofill.schema.js';
import { episodePagePlanAiResponseSchema, episodePagePlanSuggestionSchema } from '../../../../src/lib/validators/episodePagePlan.schema.js';
import type { EpisodePagePlanSuggestion, EpisodePagePlanContext } from '../../../../src/domain/types/page.js';
import type { EpisodeBeatPlan } from '../../../../src/services/page/EpisodeBeatPlanCompiler.js';

const pageId = '11111111-1111-4111-8111-111111111111';
function draft(count: number): EpisodePagePlanSuggestion {
  return { pages: [{ pageId, pageNumber: 1, panels: [{ order: 1, dialogue: Array.from({ length: count }, (_, i) => ({ entityId: null, type: 'narration', position: 'top', text: `必要な情報${i}` })) }] }] };
}
const context: EpisodePagePlanContext = {
  episodeId: 'episode', workId: 'work',
  chapter: { id: 'chapter', title: null, purpose: null, startingState: null, endingState: null, emotionCurve: null, keyBeats: [] },
  episode: { title: '物語', purpose: null, introduction: null, middle: null, climax: null, endingHook: null, estimatedPages: 1 },
  scenes: [], entities: [], pages: [{ pageId, pageNumber: 1, frameCount: 1, layoutConfig: { frame_definitions: [{ readingOrder: 1, vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }] }, status: 'designing', dialogueMode: 'image_baked', pageDialogueToggle: true, panels: [] }],
};
const plan: EpisodeBeatPlan = { pages: [{ pageId, pageNumber: 1, storyBeats: ['手紙を読む'], entryState: '手紙は未開封', exitState: '知らせを知る', newInformation: ['知らせ'], dialogueIntent: null, handoff: null }] };

describe('全話の文字量を保存可能な内容として検証する', () => {
  it.each([0, 1, 4])('%i本の場合は文字量エラーにならない', (count) => {
    expect(detectDeterministicContinuityIssues(draft(count)).filter(x => x.code === 'dialogue_density')).toEqual([]);
  });
  it.each([5, 11, 20])('%i本の場合はLLMの判定と無関係にエラーになる', (count) => {
    expect(detectDeterministicContinuityIssues(draft(count))).toContainEqual(expect.objectContaining({ code: 'dialogue_density', severity: 'error', pageIds: [pageId] }));
  });
  it('単ページAI出力は5本を受理せず4本は受理する', () => {
    const payload = (n: number): unknown => ({ panels: [{ order: 1, dialogue: draft(n).pages[0]!.panels[0]!.dialogue!.map(l => ({ entity_id: null, text: l.text, type: l.type, position: l.position })) }] });
    expect(pageAutofillSuggestionSchema.safeParse(payload(4)).success).toBe(true);
    expect(pageAutofillSuggestionSchema.safeParse(payload(5)).success).toBe(false);
  });
  it('全話のAI応答と監査対象の内部draftは上限を分離する', () => {
    const payload = { pages: [{ page_id: pageId, page_number: 1, panels: [{ order: 1, dialogue: draft(5).pages[0]!.panels[0]!.dialogue!.map(l => ({ entity_id: null, text: l.text, type: l.type, position: l.position })) }] }] };
    expect(episodePagePlanSuggestionSchema.safeParse(payload).success).toBe(true);
    expect(episodePagePlanAiResponseSchema.safeParse(payload).success).toBe(false);
  });
  it('監査は9本目以降の全文と話者も保持する', () => {
    const suggestion = draft(12);
    const speakerId = '22222222-2222-4222-8222-222222222222';
    suggestion.pages[0]!.panels[0]!.dialogue![11] = { entityId: speakerId, type: 'thought', position: 'top', text: '最後の発話にだけある重要な答え' };
    const brief = buildEpisodePlanAuditBrief({ context, plan, suggestion, language: 'ja' });
    expect(brief).toContain('[COMPLETE DIALOGUE]');
    expect(brief).toContain('最後の発話にだけある重要な答え');
    expect(brief).toContain(speakerId);
  });
  it('監査は本文要約があってもコマ別の総行数と文字数を受け取る', () => {
    const brief = buildEpisodePlanAuditBrief({ context, plan, suggestion: draft(11), language: 'ja' });
    expect(brief).toContain('[TEXT DISTRIBUTION]');
    expect(brief).toContain('Panel 1: lines=11');
    expect(brief).toMatch(/chars=\d+/);
    expect(brief).toContain('dialogue_density');
  });
  it('監査修正が上限を破る場合は受理しない', () => {
    const payload = { accepted: false, issues: [{ code: 'dialogue_density', severity: 'error', page_ids: [pageId], message: '多すぎる', repair_instruction: '再配分' }], page_repairs: [], panel_repairs: [{ page_id: pageId, panel_order: 1, changed_fields: ['dialogue'], patch: { panel_role: null, panel_size: null, situation_text: null, composition: null, dialogue_in_panel: null, dialogue: draft(5).pages[0]!.panels[0]!.dialogue!.map(l => ({ entity_id: null, text: l.text, type: l.type, position: l.position })), sfx_text: null, background_note: null, panel_notes: null, entities: null } }] };
    expect(episodePlanAuditSchema.safeParse(payload).success).toBe(false);
    payload.panel_repairs[0]!.patch.dialogue.pop();
    expect(episodePlanAuditSchema.safeParse(payload).success).toBe(true);
  });
  it('台帳の文字担当と無言担当を詳細生成まで保持する', () => {
    const planned = { pages: [{ ...plan.pages[0]!, textPlan: { requiredTextBeats: ['手紙の日時だけは文字で示す'], visualOnlyBeats: ['手紙を握る手で緊張を示す'], densityReason: '日時以外は画像で分かる' } }] };
    const brief = buildEpisodeDetailContinuitySupplement({ context, plan: planned, currentPageIds: new Set([pageId]), completedPages: [] });
    expect(brief).toContain('手紙の日時だけは文字で示す');
    expect(brief).toContain('手紙を握る手で緊張を示す');
  });
  it('保存された非等分の面積を詳細生成へ伝える', () => {
    const brief = buildEpisodeDetailContinuitySupplement({ context, plan, currentPageIds: new Set([pageId]), completedPages: [] });
    expect(brief).toContain('[SAVED FRAME CAPACITY]');
    expect(brief).toContain('Panel 1: area=1.000');
  });
});
