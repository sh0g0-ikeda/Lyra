import { z } from 'zod';

const unitInterval = z.number().min(0).max(1);

export const balloonUuidParamSchema = z.string().uuid();

export const balloonPositionSchema = z.object({
  x: unitInterval,
  y: unitInterval,
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
}).strict();

export const balloonTailSchema = z.object({
  base_x: unitInterval,
  base_y: unitInterval,
  tip_x: unitInterval,
  tip_y: unitInterval,
}).strict();

export const createBalloonBodySchema = z.object({
  speaker_entity_id: z.string().uuid().nullable().optional(),
  balloon_type: z.enum(['speech', 'thought', 'narration', 'shout', 'whisper', 'sfx', 'caption']),
  writing_mode: z.enum(['vertical', 'horizontal']).default('vertical'),
  text: z.string().min(1).max(1000),
  position: balloonPositionSchema,
  tail: balloonTailSchema.nullable().optional(),
  font_size: z.number().int().min(8).max(72).default(18),
  font_family: z.enum(['manga_gothic', 'mincho', 'rounded', 'bold']).default('manga_gothic'),
  panel_order_reference: z.number().int().min(1).max(99).nullable().optional(),
  z_index: z.number().int().min(1).max(100).default(10),
}).strict();

export const updateBalloonBodySchema = z.object({
  speaker_entity_id: z.string().uuid().nullable().optional(),
  balloon_type: z.enum(['speech', 'thought', 'narration', 'shout', 'whisper', 'sfx', 'caption']).optional(),
  writing_mode: z.enum(['vertical', 'horizontal']).optional(),
  text: z.string().min(1).max(1000).optional(),
  position: balloonPositionSchema.optional(),
  tail: balloonTailSchema.nullable().optional(),
  font_size: z.number().int().min(8).max(72).optional(),
  font_family: z.enum(['manga_gothic', 'mincho', 'rounded', 'bold']).optional(),
  panel_order_reference: z.number().int().min(1).max(99).nullable().optional(),
  z_index: z.number().int().min(1).max(100).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided',
});
