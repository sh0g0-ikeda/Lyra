import { z } from 'zod';

export const accountDeletionRequestBodySchema = z
  .object({
    confirmation: z.literal('DELETE'),
    acknowledge_personal_subscriptions: z.boolean(),
    acknowledge_store_billing: z.boolean(),
    acknowledge_personal_assets: z.boolean(),
  })
  .strict();
