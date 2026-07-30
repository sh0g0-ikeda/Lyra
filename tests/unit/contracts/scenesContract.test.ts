import { describe, expect, it } from 'vitest';
import {
  entityStateSchema,
  sceneSchema,
  scenesResponseSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

const validScene = {
  id: '44444444-4444-4444-8444-444444444444',
  episode_id: '33333333-3333-4333-8333-333333333333',
  order: 1,
  location: null,
  time: null,
  atmosphere: null,
  involved_entity_ids: [],
  entity_states: [],
  status: 'draft',
  created_at: '2026-04-22T00:00:00.000Z',
  updated_at: '2026-04-22T00:00:00.000Z',
};

const validEntityState = {
  id: '66666666-6666-4666-8666-666666666666',
  entity_id: '55555555-5555-4555-8555-555555555555',
  scene_id: null,
  costume_note: null,
  costume_ref_id: null,
  condition_note: null,
  hair_note: null,
  expression_default: 'neutral',
  extra_note: null,
  created_at: '2026-04-22T00:00:00.000Z',
};

describe('Scene response contract', () => {
  it('空の任意配列を含むSceneと一覧wrapperを受理する', () => {
    expect(sceneSchema.safeParse(validScene).success).toBe(true);
    expect(scenesResponseSchema.safeParse({ scenes: [validScene] }).success).toBe(true);
  });

  it('scene未選択とnullable noteを持つEntity stateを受理する', () => {
    expect(entityStateSchema.safeParse(validEntityState).success).toBe(true);
  });

  it('非正order・不正status・不完全なstate referenceを拒否する', () => {
    expect(sceneSchema.safeParse({ ...validScene, order: 0 }).success).toBe(false);
    expect(sceneSchema.safeParse({ ...validScene, status: 'published' }).success).toBe(false);
    expect(
      sceneSchema.safeParse({
        ...validScene,
        entity_states: [{ entity_id: validEntityState.entity_id }],
      }).success,
    ).toBe(false);
  });

  it('空または上限超過のexpression_defaultを拒否する', () => {
    expect(entityStateSchema.safeParse({ ...validEntityState, expression_default: '' }).success).toBe(false);
    expect(
      entityStateSchema.safeParse({
        ...validEntityState,
        expression_default: 'x'.repeat(101),
      }).success,
    ).toBe(false);
  });
});
