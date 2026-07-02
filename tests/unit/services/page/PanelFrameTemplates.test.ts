import { describe, expect, it } from 'vitest';
import {
  PANEL_FRAME_TEMPLATE_IDS,
  buildPanelFrameTemplateInputs,
  getPanelFrameTemplate,
  resolveDefaultPanelFrameTemplateId,
} from '../../../../src/domain/constants/panelFrameTemplates.js';

const expectedPanelCounts = {
  standard_4: 4,
  stacked_wide_4: 4,
  top_wide_3: 3,
  standard_6: 6,
  dense_8: 8,
  climax_2: 2,
  splash_1: 1,
  action_5: 5,
  battle_7: 7,
  vertical_2: 2,
  bottom_wide_3: 3,
  wide_top_4: 4,
  wide_bottom_4: 4,
  tall_left_4: 4,
  right_tall_4: 4,
  balanced_5: 5,
  middle_wide_5: 5,
  top_wide_5: 5,
  split_6: 6,
} as const;

describe('PanelFrame templates', () => {
  it('定義済みテンプレートIDを固定して持つ', () => {
    expect(PANEL_FRAME_TEMPLATE_IDS).toEqual([
      'standard_4',
      'stacked_wide_4',
      'top_wide_3',
      'standard_6',
      'dense_8',
      'climax_2',
      'splash_1',
      'action_5',
      'battle_7',
      'vertical_2',
      'bottom_wide_3',
      'wide_top_4',
      'wide_bottom_4',
      'tall_left_4',
      'right_tall_4',
      'balanced_5',
      'middle_wide_5',
      'top_wide_5',
      'split_6',
    ]);
  });

  it('各テンプレートが期待するコマ数と4頂点のFrameを生成する', () => {
    for (const templateId of PANEL_FRAME_TEMPLATE_IDS) {
      const template = getPanelFrameTemplate(templateId);
      const frames = buildPanelFrameTemplateInputs(templateId);

      expect(template.panelCount).toBe(expectedPanelCounts[templateId]);
      expect(frames).toHaveLength(expectedPanelCounts[templateId]);
      frames.forEach((frame, index) => {
        expect(frame.panelId).toBeNull();
        expect(frame.vertices).toHaveLength(4);
        expect(frame.readingOrder).toBe(index + 1);
        frame.vertices.forEach((vertex) => {
          expect(vertex.x).toBeGreaterThanOrEqual(0);
          expect(vertex.x).toBeLessThanOrEqual(1);
          expect(vertex.y).toBeGreaterThanOrEqual(0);
          expect(vertex.y).toBeLessThanOrEqual(1);
        });
      });
    }
  });

  it('漫画読み順に合わせて右上から左下へ進む標準テンプレートを生成する', () => {
    const standard4 = buildPanelFrameTemplateInputs('standard_4');
    expect(getFrameCenter(standard4[0])).toEqual({ x: 0.75, y: 0.25 });
    expect(getFrameCenter(standard4[1])).toEqual({ x: 0.25, y: 0.25 });
    expect(getFrameCenter(standard4[2])).toEqual({ x: 0.75, y: 0.75 });
    expect(getFrameCenter(standard4[3])).toEqual({ x: 0.25, y: 0.75 });

    const climax2 = buildPanelFrameTemplateInputs('climax_2');
    expect(getFrameCenter(climax2[0])).toEqual({ x: 0.75, y: 0.5 });
    expect(getFrameCenter(climax2[1])).toEqual({ x: 0.25, y: 0.5 });

    const standard6 = buildPanelFrameTemplateInputs('standard_6');
    expect(getFrameCenter(standard6[0]).x).toBeCloseTo(5 / 6);
    expect(getFrameCenter(standard6[2]).x).toBeCloseTo(1 / 6);
    expect(getFrameCenter(standard6[3]).x).toBeCloseTo(5 / 6);
  });

  it('横長4段テンプレートは上から下へ進む', () => {
    const frames = buildPanelFrameTemplateInputs('stacked_wide_4');
    expect(frames.map(getFrameCenter)).toEqual([
      { x: 0.5, y: 0.125 },
      { x: 0.5, y: 0.375 },
      { x: 0.5, y: 0.625 },
      { x: 0.5, y: 0.875 },
    ]);
  });

  it('コマ数ごとの既定テンプレートを固定する', () => {
    expect(resolveDefaultPanelFrameTemplateId(1)).toBe('splash_1');
    expect(resolveDefaultPanelFrameTemplateId(3)).toBe('top_wide_3');
    expect(resolveDefaultPanelFrameTemplateId(4)).toBe('standard_4');
    expect(resolveDefaultPanelFrameTemplateId(5)).toBe('action_5');
    expect(resolveDefaultPanelFrameTemplateId(9)).toBeNull();
  });
});

function getFrameCenter(frame: { vertices: Array<{ x: number; y: number }> }): { x: number; y: number } {
  const totals = frame.vertices.reduce(
    (current, vertex) => ({
      x: current.x + vertex.x,
      y: current.y + vertex.y,
    }),
    { x: 0, y: 0 },
  );

  return {
    x: totals.x / frame.vertices.length,
    y: totals.y / frame.vertices.length,
  };
}
