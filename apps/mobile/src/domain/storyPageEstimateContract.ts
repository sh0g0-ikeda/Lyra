// GENERATED FILE. Run `npm run mobile:contracts:generate`; do not edit directly.
import { z } from 'zod';

export const storyPageEstimateSchema = z.object({
  panel_count: z.number().int().min(1).max(1000),
  calculated_pages: z.number().int().min(1).max(250),
  estimated_pages: z.number().int().min(1).max(282),
  explicit_page_count: z.number().int().min(1).max(32).nullable(),
}).strict();

export type StoryPageEstimate = z.infer<typeof storyPageEstimateSchema>;
