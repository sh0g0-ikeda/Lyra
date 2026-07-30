import { describe, expect, it } from 'vitest';
import { compositionsResponseSchema } from '../../../packages/api-contract/src/mobileApiSchemas.js';

const validComposition = {
  id: 'battle_single_001',
  name: 'Battle Single',
  category: 'battle',
  entity_count: 1,
  preview_cdn_url: 'https://img.lyra.app/composition/battle_single_001.png',
  composition_prompt: 'single character, full body, battle stance',
  shot_type: 'full_body',
  angle: 'front',
  tags: ['battle', 'action'],
  created_at: '2026-04-22T00:00:00.000Z',
};

describe('compositionsResponseSchema', () => {
  it('現行の構図一覧wrapperとitemを受理する', () => {
    expect(
      compositionsResponseSchema.safeParse({
        compositions: [validComposition],
      }).success,
    ).toBe(true);
  });

  it('nullableなCDN URL、shot type、angleを受理する', () => {
    expect(
      compositionsResponseSchema.safeParse({
        compositions: [
          {
            ...validComposition,
            preview_cdn_url: null,
            shot_type: null,
            angle: null,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it.each([
    ['負数entity count', { ...validComposition, entity_count: -1 }],
    ['文字列以外のtag', { ...validComposition, tags: ['battle', 1] }],
    ['空のid', { ...validComposition, id: '' }],
    ['文字列でないcreated timestamp', { ...validComposition, created_at: 1 }],
  ])('%sを拒否する', (_caseName, composition) => {
    expect(
      compositionsResponseSchema.safeParse({
        compositions: [composition],
      }).success,
    ).toBe(false);
  });

  it('一覧wrapperがないpayloadを拒否する', () => {
    expect(compositionsResponseSchema.safeParse([validComposition]).success).toBe(false);
  });
});
