import { describe, expect, it } from 'vitest';
import {
  panelAssignmentsResponseSchema,
  panelEntityAssignmentSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

const validAssignment = {
  entity_id: '22222222-2222-4222-8222-222222222222',
  role: 'primary',
  expression: 'custom',
  custom_expression: 'thin smile',
  action: 'custom',
  custom_action: 'draws a sword',
  position: 'center',
  facing_direction: 'three_quarter_left',
  effect_note: 'speed lines',
  state_id: null,
};

describe('Panel entity assignment response contract', () => {
  it('現行の割り当てと一覧wrapperを受理する', () => {
    expect(panelEntityAssignmentSchema.safeParse(validAssignment).success).toBe(true);
    expect(
      panelAssignmentsResponseSchema.safeParse({
        entities: [validAssignment],
      }).success,
    ).toBe(true);
  });

  it('現行のnullable fieldをすべて受理する', () => {
    expect(
      panelEntityAssignmentSchema.safeParse({
        ...validAssignment,
        expression: 'calm',
        custom_expression: null,
        action: 'running',
        custom_action: null,
        facing_direction: null,
        effect_note: null,
        state_id: null,
      }).success,
    ).toBe(true);
  });

  it('不正なenumと欠落fieldを拒否する', () => {
    expect(
      panelEntityAssignmentSchema.safeParse({
        ...validAssignment,
        role: 'lead',
      }).success,
    ).toBe(false);

    const { position: _position, ...missingPosition } = validAssignment;
    expect(panelEntityAssignmentSchema.safeParse(missingPosition).success).toBe(false);
  });
});
