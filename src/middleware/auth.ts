import type { MiddlewareHandler } from 'hono';
import { jwtVerify } from 'jose';
import { z } from 'zod';
import { ConfigurationError, UnauthorizedError } from '../domain/errors/index.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../domain/types/user.js';
import { env } from '../lib/env.js';
import type { UserProvisioningPort } from '../services/auth/UserProvisioningService.js';
import type { AppEnv } from '../types/app.js';

const supabaseJwtSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
});

export interface AuthMiddlewareOptions {
  jwtSecret?: string;
  enableDevBypass?: boolean;
  devBypassClaims?: SupabaseJwtClaims;
}

export function createAuthMiddleware(
  userProvisioningService: UserProvisioningPort,
  options: AuthMiddlewareOptions = {},
): MiddlewareHandler<AppEnv> {
  const jwtSecret = options.jwtSecret ?? env.SUPABASE_JWT_SECRET;
  const enableDevBypass = options.enableDevBypass ?? env.DEV_AUTH_BYPASS;
  const devBypassClaims = options.devBypassClaims ?? {
    sub: env.DEV_AUTH_BYPASS_SUPABASE_ID ?? 'dev-local-user',
    email: env.DEV_AUTH_BYPASS_EMAIL ?? 'dev@local.lyra',
  };

  return async (c, next) => {
    if (enableDevBypass) {
      try {
        const { user } = await userProvisioningService.provisionFromSupabaseClaims(devBypassClaims);
        c.set('user', user);
      } catch {
        c.set('user', toDevBypassUser(devBypassClaims));
      }
      await next();
      return;
    }

    if (jwtSecret === undefined) {
      throw new ConfigurationError('SUPABASE_JWT_SECRET is not set');
    }

    const claims = await verifySupabaseToken(c.req.header('Authorization'), jwtSecret);
    const { user } = await userProvisioningService.provisionFromSupabaseClaims(claims);
    c.set('user', user);
    await next();
  };
}

async function verifySupabaseToken(
  authorizationHeader: string | undefined,
  jwtSecret: string,
): Promise<SupabaseJwtClaims> {
  const token = extractBearerToken(authorizationHeader);
  const secret = new TextEncoder().encode(jwtSecret);

  try {
    const result = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    const parsedClaims = supabaseJwtSchema.safeParse(result.payload);

    if (!parsedClaims.success) {
      throw new UnauthorizedError('Supabase JWT has invalid claims');
    }

    return parsedClaims.data;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }

    throw new UnauthorizedError();
  }
}

function extractBearerToken(authorizationHeader: string | undefined): string {
  if (authorizationHeader === undefined) {
    throw new UnauthorizedError();
  }

  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme !== 'Bearer' || token === undefined || token.length === 0) {
    throw new UnauthorizedError();
  }

  return token;
}

function toDevBypassUser(claims: SupabaseJwtClaims): AuthenticatedUser {
  return {
    id: claims.sub,
    supabaseId: claims.sub,
    email: claims.email,
    displayName: null,
    planCode: 'free',
  };
}
