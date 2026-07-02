import { z } from 'zod';

const organizationName = z.string().trim().min(1).max(120);
const nullableOrganizationText = z.string().trim().min(1).max(200).nullable().optional();
const email = z.string().trim().email().max(320);
const uuid = z.string().uuid();
const organizationRoleSchema = z.enum(['owner', 'admin', 'billing', 'editor', 'creator', 'viewer']);
const enterprisePlanSchema = z.enum(['enterprise_a', 'enterprise_b', 'enterprise_c']);

export const organizationUuidParamSchema = uuid;

export const createOrganizationBodySchema = z
  .object({
    name: organizationName,
    legal_name: nullableOrganizationText,
    billing_email: email.nullable().optional(),
  })
  .strict();

export const updateOrganizationBodySchema = z
  .object({
    name: organizationName.optional(),
    legal_name: nullableOrganizationText,
    billing_email: email.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  });

export const createOrganizationInvitationBodySchema = z
  .object({
    email,
    role: organizationRoleSchema,
  })
  .strict();

export const updateOrganizationMemberBodySchema = z
  .object({
    role: organizationRoleSchema.optional(),
    status: z.enum(['active', 'suspended', 'removed']).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  });

export const acceptInvitationBodySchema = z
  .object({
    token: z.string().trim().min(32).max(300),
  })
  .strict();

export const organizationBillingCheckoutBodySchema = z
  .object({
    plan_code: enterprisePlanSchema,
  })
  .strict();

export const organizationCreditCheckoutBodySchema = z
  .object({
    package_code: z.enum(['credits_200', 'credits_1000', 'credits_3000']),
  })
  .strict();

export const adminOrganizationContractBodySchema = z
  .object({
    plan_key: enterprisePlanSchema.optional(),
    status: z.enum(['active', 'trialing', 'past_due', 'suspended', 'canceled']).optional(),
    billing_email: email.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  });

export const adminOrganizationCreditGrantBodySchema = z
  .object({
    bucket: z.enum(['monthly', 'purchased']),
    amount: z.number().int().positive().max(1_000_000),
    description: z.string().trim().min(3).max(500),
    package_code: z.enum(['credits_200', 'credits_1000', 'credits_3000']).nullable().optional(),
  })
  .strict();
