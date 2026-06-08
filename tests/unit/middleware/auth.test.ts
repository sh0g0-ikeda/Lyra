import { Hono } from 'hono';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../../../src/domain/errors/index.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import { createAuthMiddleware, type CognitoVerifierConfig } from '../../../src/middleware/auth.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';
import type { AppEnv } from '../../../src/types/app.js';

const cognitoConfig: CognitoVerifierConfig = {
  issuer: 'https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_pool',
  clientId: 'client-123',
  tokenUse: 'access',
  requiredScopes: ['lyra/api'],
  requiredGroups: ['customers'],
};

const user: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: 'cognito-user-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};

class FakeUserProvisioningService implements UserProvisioningPort {
  public claims: SupabaseJwtClaims | null = null;

  public async provisionFromSupabaseClaims(claims: SupabaseJwtClaims): Promise<ProvisionedUser> {
    this.claims = claims;
    return {
      user: {
        ...user,
        supabaseId: claims.sub,
        email: claims.email,
      },
      isNewUser: false,
    };
  }
}

describe('createAuthMiddleware Cognito mode', () => {
  it('署名・issuer・client_id・token_use・scope・group が正しい access token を許可する', async () => {
    const fixture = await createCognitoFixture();
    const provisioningService = new FakeUserProvisioningService();
    const app = createProtectedApp(provisioningService, fixture.jwks);
    const token = await fixture.signToken();

    const response = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(provisioningService.claims).toEqual({
      sub: 'cognito-user-1',
      email: 'user@example.com',
    });
  });

  it('client_id が一致しない access token を拒否する', async () => {
    const fixture = await createCognitoFixture();
    const app = createProtectedApp(new FakeUserProvisioningService(), fixture.jwks);
    const token = await fixture.signToken({ client_id: 'other-client' });

    const response = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(401);
  });

  it('token_use が access でない token を拒否する', async () => {
    const fixture = await createCognitoFixture();
    const app = createProtectedApp(new FakeUserProvisioningService(), fixture.jwks);
    const token = await fixture.signToken({ token_use: 'id' });

    const response = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(401);
  });

  it('必須 scope が欠けている token を拒否する', async () => {
    const fixture = await createCognitoFixture();
    const app = createProtectedApp(new FakeUserProvisioningService(), fixture.jwks);
    const token = await fixture.signToken({ scope: 'openid profile' });

    const response = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(401);
  });

  it('id token 運用では audience と email を検証し scope は要求しない', async () => {
    const fixture = await createCognitoFixture();
    const provisioningService = new FakeUserProvisioningService();
    const app = createProtectedApp(provisioningService, fixture.jwks, {
      ...cognitoConfig,
      tokenUse: 'id',
      requiredScopes: ['admin-only'],
      requiredGroups: [],
    });
    const token = await fixture.signToken({
      aud: cognitoConfig.clientId,
      token_use: 'id',
      scope: undefined,
    });

    const response = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(provisioningService.claims).toEqual({
      sub: 'cognito-user-1',
      email: 'user@example.com',
    });
  });
});

function createProtectedApp(
  provisioningService: UserProvisioningPort,
  cognitoJwks: ReturnType<typeof createLocalJWKSet>,
  config: CognitoVerifierConfig = cognitoConfig,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError((error, c) => {
    if (error instanceof UnauthorizedError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.statusCode);
    }

    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } }, 500);
  });
  app.use(
    '/protected',
    createAuthMiddleware(provisioningService, {
      authProvider: 'cognito',
      cognito: config,
      cognitoJwks,
      enableDevBypass: false,
    }),
  );
  app.get('/protected', (c) => c.json({ user_id: c.get('user').id }));
  return app;
}

async function createCognitoFixture(): Promise<{
  jwks: ReturnType<typeof createLocalJWKSet>;
  signToken: (overrides?: Record<string, unknown>) => Promise<string>;
}> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  const keyId = 'unit-test-key';
  const jwks = createLocalJWKSet({ keys: [{ ...publicJwk, kid: keyId }] });

  return {
    jwks,
    async signToken(overrides: Record<string, unknown> = {}): Promise<string> {
      const payload = removeUndefinedValues({
        sub: 'cognito-user-1',
        email: 'user@example.com',
        iss: cognitoConfig.issuer,
        client_id: cognitoConfig.clientId,
        token_use: 'access',
        scope: 'openid profile lyra/api',
        'cognito:groups': ['customers'],
        ...overrides,
      });

      return new SignJWT(payload)
        .setProtectedHeader({ alg: 'RS256', kid: keyId })
        .setIssuer(cognitoConfig.issuer)
        .setSubject('cognito-user-1')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey);
    },
  };
}

function removeUndefinedValues(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
