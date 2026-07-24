import { z } from 'zod';

export const accountDeletionRequestSchema = z
  .object({
    confirmation: z.literal('DELETE'),
    acknowledge_active_subscription: z.boolean().default(false),
    acknowledge_confirmed_assets: z.boolean().default(false),
  })
  .strict();
