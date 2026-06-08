import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
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

export type AuthProvider = 'supabase' | 'cognito';
export type CognitoTokenUse = 'access' | 'id';

export interface CognitoVerifierConfig {
  issuer: string;
  clientId: string;
  jwksUri?: string;
  tokenUse: CognitoTokenUse;
  requiredScopes: string[];
  requiredGroups: string[];
}

export interface AuthMiddlewareOptions {
  authProvider?: AuthProvider;
  jwtSecret?: string;
  enableDevBypass?: boolean;
  devBypassClaims?: SupabaseJwtClaims;
  cognito?: CognitoVerifierConfig;
  cognitoJwks?: JWTVerifyGetKey;
}

export function createAuthMiddleware(
  userProvisioningService: UserProvisioningPort,
  options: AuthMiddlewareOptions = {},
): MiddlewareHandler<AppEnv> {
  const authProvider = options.authProvider ?? env.AUTH_PROVIDER;
  const jwtSecret = options.jwtSecret ?? env.SUPABASE_JWT_SECRET;
  const enableDevBypass = options.enableDevBypass ?? env.DEV_AUTH_BYPASS;
  const devBypassClaims = options.devBypassClaims ?? {
    sub: env.DEV_AUTH_BYPASS_SUPABASE_ID ?? 'dev-local-user',
    email: env.DEV_AUTH_BYPASS_EMAIL ?? 'dev@local.lyra',
  };
  const cognitoConfig = options.cognito ?? resolveCognitoVerifierConfig();
  const cognitoJwks =
    options.cognitoJwks ??
    (cognitoConfig === null
      ? null
      : createRemoteJWKSet(new URL(cognitoConfig.jwksUri ?? `${cognitoConfig.issuer}/.well-known/jwks.json`)));

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

    const claims =
      authProvider === 'cognito'
        ? await verifyCognitoToken(c.req.header('Authorization'), cognitoConfig, cognitoJwks)
        : await verifySupabaseToken(c.req.header('Authorization'), jwtSecret);
    const { user } = await userProvisioningService.provisionFromSupabaseClaims(claims);
    c.set('user', user);
    await next();
  };
}

async function verifySupabaseToken(
  authorizationHeader: string | undefined,
  jwtSecret: string | undefined,
): Promise<SupabaseJwtClaims> {
  if (jwtSecret === undefined) {
    throw new ConfigurationError('SUPABASE_JWT_SECRET is not set');
  }

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

async function verifyCognitoToken(
  authorizationHeader: string | undefined,
  config: CognitoVerifierConfig | null,
  jwks: JWTVerifyGetKey | null,
): Promise<SupabaseJwtClaims> {
  if (config === null || jwks === null) {
    throw new ConfigurationError('Cognito auth is not configured');
  }

  const token = extractBearerToken(authorizationHeader);

  try {
    const verifyOptions =
      config.tokenUse === 'id'
        ? { issuer: config.issuer, audience: config.clientId, algorithms: ['RS256'] }
        : { issuer: config.issuer, algorithms: ['RS256'] };
    const result = await jwtVerify(token, jwks, verifyOptions);
    const claims = parseCognitoClaims(result.payload, config);

    return {
      sub: claims.sub,
      email: claims.email,
    };
  } catch (error) {
    if (error instanceof ConfigurationError || error instanceof UnauthorizedError) {
      throw error;
    }

    throw new UnauthorizedError();
  }
}

function parseCognitoClaims(
  payload: Record<string, unknown>,
  config: CognitoVerifierConfig,
): SupabaseJwtClaims {
  const tokenUse = payload.token_use;
  if (tokenUse !== config.tokenUse) {
    throw new UnauthorizedError();
  }

  if (config.tokenUse === 'access' && payload.client_id !== config.clientId) {
    throw new UnauthorizedError();
  }

  const parsed = supabaseJwtSchema.safeParse(payload);
  if (!parsed.success) {
    throw new UnauthorizedError('Cognito JWT has invalid user claims');
  }

  if (config.tokenUse === 'access') {
    assertRequiredScopes(payload.scope, config.requiredScopes);
  }
  assertRequiredGroups(payload['cognito:groups'], config.requiredGroups);

  return parsed.data;
}

function assertRequiredScopes(scopeClaim: unknown, requiredScopes: string[]): void {
  if (requiredScopes.length === 0) {
    return;
  }

  const scopes =
    typeof scopeClaim === 'string'
      ? new Set(scopeClaim.split(/\s+/u).filter((value) => value.length > 0))
      : new Set<string>();
  const missingScopes = requiredScopes.filter((scope) => !scopes.has(scope));
  if (missingScopes.length > 0) {
    throw new UnauthorizedError();
  }
}

function assertRequiredGroups(groupClaim: unknown, requiredGroups: string[]): void {
  if (requiredGroups.length === 0) {
    return;
  }

  const groups = Array.isArray(groupClaim)
    ? new Set(groupClaim.filter((value): value is string => typeof value === 'string'))
    : new Set<string>();
  const missingGroups = requiredGroups.filter((group) => !groups.has(group));
  if (missingGroups.length > 0) {
    throw new UnauthorizedError();
  }
}

export function resolveCognitoVerifierConfig(): CognitoVerifierConfig | null {
  if (env.AUTH_PROVIDER !== 'cognito') {
    return null;
  }

  const issuer = resolveCognitoIssuer();
  if (env.COGNITO_CLIENT_ID === undefined) {
    throw new ConfigurationError('COGNITO_CLIENT_ID is required when AUTH_PROVIDER=cognito');
  }

  return {
    issuer,
    clientId: env.COGNITO_CLIENT_ID,
    jwksUri: env.COGNITO_JWKS_URI,
    tokenUse: env.COGNITO_TOKEN_USE,
    requiredScopes: parseListEnv(env.COGNITO_REQUIRED_SCOPES),
    requiredGroups: parseListEnv(env.COGNITO_REQUIRED_GROUPS),
  };
}

function resolveCognitoIssuer(): string {
  if (env.COGNITO_ISSUER !== undefined) {
    return env.COGNITO_ISSUER;
  }

  if (env.AWS_REGION === undefined || env.COGNITO_USER_POOL_ID === undefined) {
    throw new ConfigurationError(
      'COGNITO_ISSUER or both AWS_REGION and COGNITO_USER_POOL_ID are required when AUTH_PROVIDER=cognito',
    );
  }

  return `https://cognito-idp.${env.AWS_REGION}.amazonaws.com/${env.COGNITO_USER_POOL_ID}`;
}

function parseListEnv(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(/[,\s]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
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
