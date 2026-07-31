import { z } from 'zod';

const MAX_TOKEN_LENGTH = 32_768;

export const authTokensSchema = z.object({
  idToken: z.string().min(1).max(MAX_TOKEN_LENGTH),
  accessToken: z.string().min(1).max(MAX_TOKEN_LENGTH).nullable(),
  refreshToken: z.string().min(1).max(MAX_TOKEN_LENGTH).nullable(),
  expiresAt: z.number().int().nonnegative(),
  tokenType: z.literal('Bearer'),
});

export type AuthTokens = z.infer<typeof authTokensSchema>;
