import { z } from 'zod';

export const compositionGalleryQuerySchema = z.object({
  category: z.string().trim().min(1).max(100).optional(),
  entity_count: z.coerce.number().int().min(1).max(20).optional(),
  tag: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(250).default(100),
});
