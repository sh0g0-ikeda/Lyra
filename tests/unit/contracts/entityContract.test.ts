import { describe, expect, it } from 'vitest';
import {
  entitiesResponseSchema,
  entitySchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

const validEntity = {
  id: 'entity-1',
  work_id: 'work-1',
  entity_type: 'character',
  name: 'ミヅキ',
  free_description: null,
  structured_fields: {},
  prompt_supplement: null,
  speech_profile: {},
  status: 'draft',
  created_at: '2026-07-30T00:00:00.000Z',
  updated_at: '2026-07-30T00:00:00.000Z',
};

describe('Entity response contract', () => {
  it('現行3typeのEntityと空一覧wrapperを受理する', () => {
    expect(entitySchema.safeParse(validEntity).success).toBe(true);
    expect(
      entitySchema.safeParse({ ...validEntity, entity_type: 'nonhuman', status: 'ready' }).success,
    ).toBe(true);
    expect(entitySchema.safeParse({ ...validEntity, entity_type: 'object' }).success).toBe(true);
    expect(entitiesResponseSchema.safeParse({ entities: [] }).success).toBe(true);
  });

  it('空ID・未知type/status・objectでないstructured fieldsを拒否する', () => {
    expect(entitySchema.safeParse({ ...validEntity, id: '' }).success).toBe(false);
    expect(entitySchema.safeParse({ ...validEntity, entity_type: 'location' }).success).toBe(false);
    expect(entitySchema.safeParse({ ...validEntity, status: 'archived' }).success).toBe(false);
    expect(entitySchema.safeParse({ ...validEntity, structured_fields: [] }).success).toBe(false);
  });
});
