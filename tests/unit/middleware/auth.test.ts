import { requireAuthorizedWebImageClient } from '../../../src/domain/generation/ImageAccessPolicy.js';
import { Hono } from 'hono';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { AppError, UnauthorizedError } from '../../../src/domain/errors/index.js';
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

  it('email_verified が false の token は既存ユーザー紐付け前に拒否する', async () => {
    const fixture = await createCognitoFixture();
    const app = createProtectedApp(new FakeUserProvisioningService(), fixture.jwks);
    const token = await fixture.signToken({ email_verified: false });

    const response = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(401);
  });

  it('Cognitoが署名したGoogleユーザー名を外部IdPとしてprovisioningへ渡す', async () => {
    const fixture = await createCognitoFixture();
    const provisioningService = new FakeUserProvisioningService();
    const app = createProtectedApp(provisioningService, fixture.jwks);
    const token = await fixture.signToken({ username: 'Google_123456' });

    const response = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(provisioningService.claims).toEqual({
      sub: 'cognito-user-1',
      email: 'user@example.com',
      identityProvider: 'federated',
    });
  });

  it('Cognito ID tokenのGoogle identitiesを外部IdPとしてprovisioningへ渡す', async () => {
    const fixture = await createCognitoFixture();
    const provisioningService = new FakeUserProvisioningService();
    const app = createProtectedApp(provisioningService, fixture.jwks, {
      ...cognitoConfig,
      tokenUse: 'id',
      requiredScopes: [],
    });
    const token = await fixture.signToken({
      aud: cognitoConfig.clientId,
      token_use: 'id',
      identities: [{ providerName: 'Google', userId: 'google-user-1' }],
    });

    const response = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(provisioningService.claims).toEqual({
      sub: 'cognito-user-1',
      email: 'user@example.com',
      identityProvider: 'federated',
    });
  });

  it('email_verified が欠けている token は拒否する', async () => {
    const fixture = await createCognitoFixture();
    const app = createProtectedApp(new FakeUserProvisioningService(), fixture.jwks);
    const token = await fixture.signToken({ email_verified: undefined });

    const response = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(401);
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

  it('許可リストに含まれる別 client_id の access token を許可する', async () => {
    const fixture = await createCognitoFixture();
    const provisioningService = new FakeUserProvisioningService();
    const app = createProtectedApp(provisioningService, fixture.jwks, {
      ...cognitoConfig,
      clientIds: ['mobile-client-123'],
    });
    const token = await fixture.signToken({ client_id: 'mobile-client-123' });

    const response = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(provisioningService.claims).toEqual({
      sub: 'cognito-user-1',
      email: 'user@example.com',
    });
  });

  it('Authorization header に余計な要素がある場合は拒否する', async () => {
    const fixture = await createCognitoFixture();
    const app = createProtectedApp(new FakeUserProvisioningService(), fixture.jwks);
    const malformedToken = await fixture.signToken();

    const response = await app.request('/protected', {
      headers: { Authorization: `Bearer ${malformedToken} trailing` },
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

  it('id token 運用でも許可リストに含まれる別 audience を許可する', async () => {
    const fixture = await createCognitoFixture();
    const provisioningService = new FakeUserProvisioningService();
    const app = createProtectedApp(provisioningService, fixture.jwks, {
      ...cognitoConfig,
      tokenUse: 'id',
      requiredScopes: [],
      requiredGroups: [],
      clientIds: ['mobile-client-123'],
    });
    const token = await fixture.signToken({
      aud: 'mobile-client-123',
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

describe('verified identity-link authentication proof', () => {
  it('exposes only verified ID-token proof internally, without passing it to provisioning', async () => {
    const fixture = await createCognitoFixture();
    const provisioning = new FakeUserProvisioningService();
    const app = new Hono<AppEnv>();
    app.use('*', createAuthMiddleware(provisioning, { authProvider: 'cognito', enableDevBypass: false,
      cognito: { ...cognitoConfig, tokenUse: 'id', requiredGroups: [], requiredScopes: [] }, cognitoJwks: fixture.jwks }));
    app.get('/', (c) => c.json(c.get('cognitoIdentity') ?? null));
    const authTime = Math.floor(Date.now() / 1000);
    const token = await fixture.signToken({ token_use: 'id', aud: cognitoConfig.clientId, 'cognito:username': 'native-username', auth_time: authTime });
    const response = await app.request('/', { headers: { Authorization: `Bearer ${token}` } });
    const result = await response.json() as Record<string, unknown>;
    expect(result).toMatchObject({ subject: 'cognito-user-1', username: 'native-username', email: 'user@example.com', authTime });
    expect(result.tokenFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(provisioning.claims).toEqual({ sub: 'cognito-user-1', email: 'user@example.com' });
  });
  it('ordinary ID tokens lacking recent-auth claims continue to authenticate without link proof', async () => {
    const fixture = await createCognitoFixture();
    const app = new Hono<AppEnv>();
    app.use('*', createAuthMiddleware(new FakeUserProvisioningService(), { authProvider: 'cognito', enableDevBypass: false,
      cognito: { ...cognitoConfig, tokenUse: 'id', requiredGroups: [], requiredScopes: [] }, cognitoJwks: fixture.jwks }));
    app.get('/', (c) => c.json(c.get('cognitoIdentity') ?? null));
    const token = await fixture.signToken({ token_use: 'id', aud: cognitoConfig.clientId });
    const response = await app.request('/', { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);expect(await response.json()).toBeNull();
  });
});

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
        email_verified: true,
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


describe('署名済みclient IDによるWeb画像配信', () => {
  it.each(['id', 'access'] as const)('検証済み%s tokenからだけclient IDを抽出する', async (tokenUse) => {
    const fixture = await createCognitoFixture();
    const provisioning = new FakeUserProvisioningService();
    const app = new Hono<AppEnv>();
    app.onError((error,c) => error instanceof AppError ? c.json({code:error.code},error.statusCode) : c.json({},500));
    app.use('*', createAuthMiddleware(provisioning, {authProvider:'cognito',enableDevBypass:false,
      cognito:{...cognitoConfig,tokenUse,clientIds:['web-client'],requiredScopes:[],requiredGroups:[]},cognitoJwks:fixture.jwks}));
    app.get('/', c => { requireAuthorizedWebImageClient(c.get('authenticatedClientId'), ['web-client']); return c.json({client:c.get('authenticatedClientId')}); });
    const valid=await fixture.signToken({token_use:tokenUse,client_id:'web-client',aud:'web-client'});
    expect((await app.request('/',{headers:{Authorization:`Bearer ${valid}`}})).status).toBe(200);
    const mobile=await fixture.signToken({token_use:tokenUse,client_id:cognitoConfig.clientId,aud:cognitoConfig.clientId});
    expect((await app.request('/',{headers:{Authorization:`Bearer ${mobile}`,'X-Client-Platform':'web','X-Client-Id':'web-client'}})).status).toBe(403);
    const unknown=await fixture.signToken({token_use:tokenUse,client_id:'unknown',aud:'unknown'});
    expect((await app.request('/',{headers:{Authorization:`Bearer ${unknown}`}})).status).toBe(401);
    expect((await app.request('/',{headers:{'X-Client-Id':'web-client'}})).status).toBe(401);
    expect(provisioning.claims).not.toHaveProperty('authenticatedClientId');
    expect(provisioning.claims).not.toHaveProperty('verifiedClientId');
  });
  it('Supabaseのclient申告はWeb配信権限に昇格しない', async () => {
    const secret='test-only-supabase-secret';const app=new Hono<AppEnv>();
    app.onError((error,c) => error instanceof AppError ? c.json({code:error.code},error.statusCode) : c.json({},500));
    app.use('*',createAuthMiddleware(new FakeUserProvisioningService(),{authProvider:'supabase',jwtSecret:secret,enableDevBypass:false}));
    app.get('/',c=>{requireAuthorizedWebImageClient(c.get('authenticatedClientId'),['web-client']);return c.json({ok:true});});
    const token=await new SignJWT({sub:'user',email:'user@example.com',client_id:'web-client',aud:'web-client'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode(secret));
    expect((await app.request('/',{headers:{Authorization:`Bearer ${token}`}})).status).toBe(403);
  });
});
