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
