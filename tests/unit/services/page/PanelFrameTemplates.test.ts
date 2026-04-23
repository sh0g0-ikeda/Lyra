import { describe, expect, it } from 'vitest';
import {
  PANEL_FRAME_TEMPLATE_IDS,
  buildPanelFrameTemplateInputs,
  getPanelFrameTemplate,
} from '../../../../src/domain/constants/panelFrameTemplates.js';

const expectedPanelCounts = {
  standard_4: 4,
  top_wide_3: 3,
  standard_6: 6,
  dense_8: 8,
  climax_2: 2,
  splash_1: 1,
  action_5: 5,
  battle_7: 7,
} as const;

describe('PanelFrame templates', () => {
  it('Specで定義された8種類のテンプレートを持つ', () => {
    expect(PANEL_FRAME_TEMPLATE_IDS).toEqual([
      'standard_4',
      'top_wide_3',
      'standard_6',
      'dense_8',
      'climax_2',
      'splash_1',
      'action_5',
      'battle_7',
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
});
