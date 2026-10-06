import { z } from 'zod';
const current = z.object({
  confirmation: z.literal('DELETE'),
  acknowledge_personal_subscriptions: z.boolean(),
  acknowledge_store_billing: z.boolean(),
  acknowledge_personal_assets: z.boolean(),
}).strict();
const deployed = z.object({
  confirmation: z.literal('DELETE'),
  acknowledge_active_subscription: z.boolean().default(false),
  acknowledge_confirmed_assets: z.boolean().default(false),
}).strict();
// Distinct strict alternatives prevent contradictory mixed acknowledgements.
export const accountDeletionRequestBodySchema = z.union([current, deployed]).transform((body) => {
  if ('acknowledge_personal_subscriptions' in body) return { ...body, legacy_contract: false };
  return { confirmation: body.confirmation,
    acknowledge_personal_subscriptions: body.acknowledge_active_subscription,
    acknowledge_store_billing: body.acknowledge_active_subscription,
    acknowledge_personal_assets: body.acknowledge_confirmed_assets,
    legacy_contract: true };
});
