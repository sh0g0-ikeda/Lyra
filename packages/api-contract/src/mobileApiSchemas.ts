import { z } from 'zod';

const idSchema = z.string().min(1);
const nullableStringSchema = z.string().nullable();
const timestampSchema = z.string().min(1);
const organizationRoleSchema = z.enum(['owner', 'admin', 'billing', 'editor', 'viewer']);
const organizationStatusSchema = z.enum([
  'active',
  'trialing',
  'past_due',
  'suspended',
  'canceled',
]);
const organizationPlanSchema = z.enum(['enterprise_a', 'enterprise_b', 'enterprise_c']);
const organizationMembershipStatusSchema = z.enum([
  'invited',
  'active',
  'suspended',
  'removed',
]);

const creditBalanceSchema = z.object({
  monthly_credits: z.number().int().nonnegative(),
  purchased_credits: z.number().int().nonnegative(),
  total_credits: z.number().int().nonnegative(),
  monthly_expires_at: nullableStringSchema,
});

const subscriptionPlanSchema = z.object({
  plan_code: z.enum(['standard', 'premium', 'enterprise_a', 'enterprise_b', 'enterprise_c']),
  display_name_ja: z.string(),
  display_name_en: z.string(),
  monthly_credits: z.number().int().nonnegative(),
  amount_jpy: z.number().int().nonnegative(),
  minimum_contract_months: z.number().int().nonnegative(),
  trial_days: z.number().int().nonnegative(),
  is_enterprise: z.boolean(),
  configured: z.boolean(),
});

export const billingBalanceSchema = z.object({
  monthly_credits: z.number().int().nonnegative(),
  purchased_credits: z.number().int().nonnegative(),
  total_credits: z.number().int().nonnegative(),
  monthly_expires_at: nullableStringSchema,
  plan_code: z.enum(['free', 'standard', 'premium', 'enterprise_a', 'enterprise_b', 'enterprise_c']),
  current_period_end: nullableStringSchema,
  cancel_at_period_end: z.boolean(),
  subscription_plans: z.array(subscriptionPlanSchema),
});

export const currentSessionSchema = z.object({
  user: z.object({
    id: idSchema,
    email: z.string().email(),
    display_name: nullableStringSchema,
    plan_code: z.string().min(1),
  }),
  personal_credits: creditBalanceSchema.nullable(),
  organizations: z.array(
    z.object({
      id: idSchema,
      name: z.string().min(1),
      status: organizationStatusSchema,
      plan_key: organizationPlanSchema,
      role: organizationRoleSchema,
      membership_status: organizationMembershipStatusSchema,
      monthly_credits: z.number().int().nonnegative(),
      purchased_credits: z.number().int().nonnegative(),
      total_credits: z.number().int().nonnegative(),
      monthly_expires_at: nullableStringSchema,
    }),
  ),
});

export const compositionSchema = z.object({
  id: idSchema,
  name: z.string(),
  category: z.string(),
  entity_count: z.number().int().nonnegative(),
  preview_cdn_url: nullableStringSchema,
  composition_prompt: z.string(),
  shot_type: nullableStringSchema,
  angle: nullableStringSchema,
  tags: z.array(z.string()),
  created_at: timestampSchema,
});

export const compositionsResponseSchema = z.object({
  compositions: z.array(compositionSchema),
});
