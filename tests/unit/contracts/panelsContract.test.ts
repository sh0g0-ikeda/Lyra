import { describe, expect, it } from 'vitest';
import {
  panelSchema,
  panelsResponseSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

const validPanel = {
  id: '22222222-2222-4222-8222-222222222222',
  page_id: '11111111-1111-4111-8111-111111111111',
  order: 1,
  panel_role: 'action',
  panel_size: 'standard',
  situation_text: 'A dramatic action panel',
  entities: [
    {
      entity_id: '33333333-3333-4333-8333-333333333333',
      role: 'primary',
      expression: 'determined',
      custom_expression: null,
      action: 'attacking',
      custom_action: null,
      position: 'center',
      facing_direction: null,
      effect_note: null,
      state_id: null,
    },
  ],
  composition: {
    source: 'custom',
    gallery_item_id: null,
    composition_prompt: null,
    shot_type: null,
    angle: null,
    custom_note: null,
  },
  dialogue_in_panel: true,
  dialogue: [
    {
      entity_id: null,
      text: 'BOOM',
      type: 'sfx',
      position: 'center',
    },
  ],
  sfx_text: null,
  background_note: null,
  panel_notes: null,
  created_at: '2026-04-23T00:00:00.000Z',
  updated_at: '2026-04-23T00:00:00.000Z',
};

describe('Panel response contract', () => {
  it('現行Panelと一覧wrapperを受理する', () => {
    expect(panelSchema.safeParse(validPanel).success).toBe(true);
    expect(panelsResponseSchema.safeParse({ panels: [validPanel] }).success).toBe(true);
  });

  it('nullable fieldとsfxのnull speakerを受理する', () => {
    expect(panelSchema.safeParse(validPanel).success).toBe(true);
  });

  it('非正orderと不正な入れ子enumを拒否する', () => {
    expect(panelSchema.safeParse({ ...validPanel, order: 0 }).success).toBe(false);
    expect(panelSchema.safeParse({ ...validPanel, panel_role: 'unknown' }).success).toBe(false);
    expect(
      panelSchema.safeParse({
        ...validPanel,
        entities: [{ ...validPanel.entities[0], role: 'lead' }],
      }).success,
    ).toBe(false);
    expect(
      panelSchema.safeParse({
        ...validPanel,
        dialogue: [{ ...validPanel.dialogue[0], type: 'caption' }],
      }).success,
    ).toBe(false);
  });
});
