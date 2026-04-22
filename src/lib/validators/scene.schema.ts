import { z } from 'zod';

const nullableText200 = z.string().trim().min(1).max(200).nullable();
const nullableText2000 = z.string().trim().min(1).max(2000).nullable();
const uuidArray = z.array(z.string().uuid()).max(100);
const statusSchema = z.enum(['draft', 'ready']);

export const sceneUuidParamSchema = z.string().uuid();

export const createSceneBodySchema = z.object({
  order: z.number().int().min(1).max(1000),
  location: nullableText200.optional(),
  time: nullableText200.optional(),
  atmosphere: nullableText200.optional(),
  involved_entity_ids: uuidArray.optional(),
});

export const updateSceneBodySchema = z
  .object({
    order: z.number().int().min(1).max(1000).optional(),
    location: nullableText200.optional(),
    time: nullableText200.optional(),
    atmosphere: nullableText200.optional(),
    involved_entity_ids: uuidArray.optional(),
    status: statusSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  });

export const createEntityStateBodySchema = z.object({
  scene_id: z.string().uuid().nullable().optional(),
  costume_note: nullableText2000.optional(),
  costume_ref_id: nullableText200.optional(),
  condition_note: nullableText2000.optional(),
  hair_note: nullableText2000.optional(),
  expression_default: z.string().trim().min(1).max(100).default('neutral'),
  extra_note: nullableText2000.optional(),
});

export const updateEntityStateBodySchema = z
  .object({
    scene_id: z.string().uuid().nullable().optional(),
    costume_note: nullableText2000.optional(),
    costume_ref_id: nullableText200.optional(),
    condition_note: nullableText2000.optional(),
    hair_note: nullableText2000.optional(),
    expression_default: z.string().trim().min(1).max(100).optional(),
    extra_note: nullableText2000.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  });
