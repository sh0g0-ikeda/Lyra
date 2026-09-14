import { describe, expect, it } from 'vitest';
import { PANEL_FRAME_TEMPLATE_IDS, getPanelFrameTemplate } from '../../../../src/domain/constants/panelFrameTemplates.js';
import { assemblePageRenderPrompt, resolvePageGenerationLayoutControl } from '../../../../src/services/page/PageGenerationLayoutControl.js';

describe('PageGenerationLayoutControl', () => {
  it.each(PANEL_FRAME_TEMPLATE_IDS)('%s の場合にカタログの頂点と読み順を変更せず全コマを説明する', (templateId) => {
    const template = getPanelFrameTemplate(templateId);
    const before = JSON.stringify(template);
    const control = resolvePageGenerationLayoutControl({ type: 'template', template_id: templateId }, template.panelCount);
    expect(control).not.toBeNull();
    expect(control?.frames.map(({ readingOrder, vertices }) => ({ readingOrder, vertices }))).toEqual(
      template.frames.map(({ readingOrder, vertices }) => ({ readingOrder, vertices })),
    );
    for (const frame of template.frames) {
      expect(control?.finalSuffix.match(new RegExp(`^P${frame.readingOrder}:`, 'gm'))).toHaveLength(1);
    }
    expect(control?.detailedInstruction).toContain('origin (0,0) is the upper-left');
    expect(control?.finalSuffix).toContain('Do not print P labels');
    expect(JSON.stringify(template)).toBe(before);
  });

  it.each([
    ['standard_4', ['upper-right', 'upper-left', 'lower-right', 'lower-left']],
    ['split_6', ['upper-right', 'middle-right', 'lower-right', 'upper-left', 'middle-left', 'lower-left']],
    ['stacked_wide_4', ['full-width top band', 'full-width middle band', 'full-width middle band', 'full-width bottom band']],
  ] as const)('%s の場合にコマごとの物理的位置を示す', (templateId, expected) => {
    const control = resolvePageGenerationLayoutControl({ type: 'template', template_id: templateId }, expected.length);
    expected.forEach((position, index) => expect(control?.frames[index]?.physicalPlacement).toContain(position));
  });

  it.each([
    ['action_5', 5, 'full-height left column'],
    ['tall_left_4', 4, 'full-height left column'],
    ['right_tall_4', 1, 'full-height right column'],
    ['middle_wide_5', 3, 'full-width middle band'],
  ] as const)('%s の非対称コマの場合に列や帯の配置を維持する', (templateId, order, position) => {
    const template = getPanelFrameTemplate(templateId);
    const control = resolvePageGenerationLayoutControl({ type: 'template', template_id: templateId }, template.panelCount);
    expect(control?.frames.find((frame) => frame.readingOrder === order)?.physicalPlacement).toContain(position);
  });

  it('custom の場合に入力配列の順序に依存せず保存済み番号と枠を保持する', () => {
    const frames = getPanelFrameTemplate('standard_4').frames.map((frame) => ({
      reading_order: frame.readingOrder, vertices: frame.vertices,
      border_style: 'dashed', border_width: 6, border_color: '#112233',
    })).reverse();
    const before = JSON.stringify(frames);
    const control = resolvePageGenerationLayoutControl({ type: 'custom', frame_definitions: frames }, 4);
    expect(control?.frames.map((frame) => frame.readingOrder)).toEqual([1, 2, 3, 4]);
    expect(control?.frames[0]).toMatchObject({ borderStyle: 'dashed', borderWidth: 6, borderColor: '#112233', physicalPlacement: expect.stringContaining('upper-right') });
    expect(JSON.stringify(frames)).toBe(before);
    expect(resolvePageGenerationLayoutControl({ type: 'custom', frame_definitions: getPanelFrameTemplate('standard_4').frames }, 4)?.frames).toHaveLength(4);
  });

  it('未対応またはコマ数不一致や壊れた保存枠の場合に部分的なガイドを捏造しない', () => {
    const frame = getPanelFrameTemplate('splash_1').frames[0]!;
    for (const config of [
      { type: 'template', template_id: 'unknown' },
      { type: 'template', template_id: 'standard_4' },
      { type: 'custom', frame_definitions: [frame, { ...frame, readingOrder: 2, vertices: [{ x: NaN, y: 0 }] }] },
      { type: 'custom', frame_definitions: [{ ...frame, readingOrder: 2 }] },
    ]) expect(resolvePageGenerationLayoutControl(config, 1)).toBeNull();
  });

  it.each([null, 'Plan: use a wide establishing shot.'])('planner が %s の場合にレイアウト指定を最後に一度だけ連結する', (plan) => {
    const control = resolvePageGenerationLayoutControl({ type: 'template', template_id: 'standard_4' }, 4)!;
    const prompt = assemblePageRenderPrompt('Keep dialogue verbatim: 「こんにちは」', plan, control, 4);
    expect(prompt).toMatch(/^Keep dialogue verbatim: 「こんにちは」/u);
    expect(prompt.endsWith(control.finalSuffix)).toBe(true);
    expect(prompt.match(/FINAL AUTHORITATIVE PAGE LAYOUT/gu)).toHaveLength(1);
    if (plan !== null) expect(prompt.indexOf(plan)).toBeLessThan(prompt.indexOf(control.finalSuffix));
  });

  it('不完全レイアウトとplannerがある場合にも実コマ数によるRTL制御を最後に残す', () => {
    const prompt = assemblePageRenderPrompt('Story', 'Plan: start on the left', null, 5);
    const suffix = prompt.split('\n\n').at(-1)!;
    expect(suffix).toContain('FINAL AUTHORITATIVE PAGE READING ORDER');
    expect(suffix).toContain('never western left-to-right');
    expect(suffix).toContain('Keep exactly 5 panels');
    expect(suffix).not.toContain('last input image');
    expect(suffix).not.toContain('guide frame');
  });

  it.each(['custom', 'ai_generated', 'ai_auto'])('%s の狭小枠でも保存された座標対応を最終指示に残す', (type) => {
    const control = resolvePageGenerationLayoutControl({ type, frame_definitions: [{
      reading_order: 1,
      vertices: [{ x: 0.497, y: 0.2 }, { x: 0.502, y: 0.2 }, { x: 0.502, y: 0.8 }, { x: 0.497, y: 0.8 }],
    }] }, 1);
    expect(control).not.toBeNull();
    expect(control?.finalSuffix).toContain('x=0.497..0.502');
    expect(control?.finalSuffix).toContain('the coordinate map above supplies the assignment');
  });
});
