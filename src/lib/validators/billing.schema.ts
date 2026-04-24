import { z } from 'zod';

export const createSubscriptionCheckoutBodySchema = z
  .object({
    plan_code: z.enum(['standard', 'premium']),
  })
  .strict();

export const createCreditCheckoutBodySchema = z
  .object({
    package_code: z.enum(['credits_200', 'credits_1000', 'credits_3000']),
  })
  .strict();
