import { describe, expect, it } from 'vitest';
import {
  balloonSchema,
  balloonsResponseSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

const validBalloon = {
  id: '11111111-1111-4111-8111-111111111111',
  page_id: '33333333-3333-4333-8333-333333333333',
  speaker_entity_id: null,
  balloon_type: 'speech',
  writing_mode: 'vertical',
  text: 'hello',
  position: {
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.2,
  },
  tail: {
    base_x: 0.2,
    base_y: 0.3,
    tip_x: 0.4,
    tip_y: 0.5,
  },
  font_size: 18,
  font_family: 'manga_gothic',
  panel_order_reference: 1,
  z_index: 10,
};

describe('Balloon response contract', () => {
  it('現行の通常Balloonと一覧wrapperを受理する', () => {
    expect(balloonSchema.safeParse(validBalloon).success).toBe(true);
    expect(
      balloonsResponseSchema.safeParse({
        balloons: [validBalloon],
      }).success,
    ).toBe(true);
  });

  it.each(['sfx', 'caption'] as const)('現行Domainのballoon_type %sを受理する', (balloonType) => {
    expect(
      balloonSchema.safeParse({
        ...validBalloon,
        balloon_type: balloonType,
      }).success,
    ).toBe(true);
  });

  it('正でないsizeとfont、不正enumを拒否する', () => {
    expect(
      balloonSchema.safeParse({
        ...validBalloon,
        position: {
          ...validBalloon.position,
          width: 0,
        },
      }).success,
    ).toBe(false);
    expect(
      balloonSchema.safeParse({
        ...validBalloon,
        font_size: 0,
      }).success,
    ).toBe(false);
    expect(
      balloonSchema.safeParse({
        ...validBalloon,
        balloon_type: 'unknown',
      }).success,
    ).toBe(false);
  });
});
