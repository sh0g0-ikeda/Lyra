import { z } from 'zod';

const signedTransactionSchema = z.string().trim().min(1).max(32_768);
const purchaseTokenSchema = z.string().trim().min(8).max(8_192);

export const mobileAppleVerifyBodySchema = z
  .object({
    signed_transaction: signedTransactionSchema,
    environment: z.enum(['sandbox', 'production']),
  })
  .strict();

export const mobileGoogleVerifyBodySchema = z
  .object({
    purchase_token: purchaseTokenSchema,
  })
  .strict();

export const mobileRestoreBodySchema = z
  .object({
    apple_signed_transactions: z.array(signedTransactionSchema).max(50).default([]),
    google_purchase_tokens: z.array(purchaseTokenSchema).max(50).default([]),
  })
  .strict()
  .refine(
    (value) => value.apple_signed_transactions.length + value.google_purchase_tokens.length > 0,
    'At least one store purchase record is required',
  );
