import { describe, expect, it } from 'vitest';
import {
  framesResponseSchema,
  frameTemplateResponseSchema,
  panelFrameSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

const validFrame = {
  id: '33333333-3333-4333-8333-333333333333',
  page_id: '11111111-1111-4111-8111-111111111111',
  panel_id: null,
  vertices: [
    { x: 0, y: 0 },
    { x: 1.2, y: 0 },
    { x: 0.5, y: 1.1 },
  ],
  border_style: 'solid',
  border_width: 3,
  border_color: '#000000',
  z_index: 1,
  reading_order: 1,
};

describe('Panel frame response contract', () => {
  it('現行frameと一覧・テンプレートwrapperを受理する', () => {
    expect(panelFrameSchema.safeParse(validFrame).success).toBe(true);
    expect(framesResponseSchema.safeParse({ frames: [validFrame] }).success).toBe(true);
    expect(
      frameTemplateResponseSchema.safeParse({
        template_id: 'standard_4',
        panel_count: 1,
        frames: [validFrame],
      }).success,
    ).toBe(true);
  });

  it('既存DBで表現可能な3頂点と座標範囲外を互換性のため受理する', () => {
    expect(panelFrameSchema.safeParse(validFrame).success).toBe(true);
  });

  it('壊れた頂点・負の幅・不正enumを拒否する', () => {
    expect(
      panelFrameSchema.safeParse({
        ...validFrame,
        vertices: validFrame.vertices.slice(0, 2),
      }).success,
    ).toBe(false);
    expect(panelFrameSchema.safeParse({ ...validFrame, border_width: -1 }).success).toBe(false);
    expect(panelFrameSchema.safeParse({ ...validFrame, border_style: 'double' }).success).toBe(false);
  });
});
