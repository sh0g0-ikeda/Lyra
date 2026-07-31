import { describe, expect, it } from 'vitest';
import type { AuthTokens } from '../src/domain/auth';
import {
  AuthError,
  CognitoAuthService,
  type CognitoAuthDependencies,
} from '../src/lib/auth';

describe('CognitoAuthService', () => {
  it('PKCE authorization codeをtokenへ交換して保存する', async () => {
    const dependencies = new FakeCognitoDependencies();
    const service = new CognitoAuthService(buildConfig(), dependencies);

    const tokens = await service.signIn();

    expect(tokens.idToken).toBe('id-token');
    expect(dependencies.authorizationInputs).toEqual([
      expect.objectContaining({ usePkce: true }),
    ]);
    expect(dependencies.tokenBodies[0]?.get('code_verifier')).toBe('verifier');
    expect(dependencies.savedTokens).toEqual([tokens]);
  });

  it('同時refreshを1回のtoken requestへ集約する', async () => {
    const dependencies = new FakeCognitoDependencies();
    const service = new CognitoAuthService(buildConfig(), dependencies);
    const tokens = buildTokens();

    const [first, second] = await Promise.all([
      service.refresh(tokens),
      service.refresh(tokens),
    ]);

    expect(first).toEqual(second);
    expect(dependencies.tokenBodies).toHaveLength(1);
    expect(dependencies.tokenBodies[0]?.get('grant_type')).toBe('refresh_token');
    expect(dependencies.savedTokens).toHaveLength(0);
  });

  it('logout通信が失敗しても端末tokenを先に削除する', async () => {
    const dependencies = new FakeCognitoDependencies();
    dependencies.logoutError = new Error('network');
    const service = new CognitoAuthService(buildConfig(), dependencies);

    await expect(service.signOut()).rejects.toMatchObject({
      code: 'REMOTE_LOGOUT_FAILED',
    });
    expect(dependencies.clearCalls).toBe(1);
  });

  it('不正token responseをraw値なしのfatal errorにする', async () => {
    const dependencies = new FakeCognitoDependencies();
    dependencies.tokenResponse = {
      id_token: 'x'.repeat(32_769),
      refresh_token: 'secret-refresh',
    };
    const service = new CognitoAuthService(buildConfig(), dependencies);

    await expect(service.signIn()).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AuthError
        && error.code === 'INVALID_TOKEN_RESPONSE'
        && error.fatal
        && !error.message.includes('secret-refresh'),
    );
  });
});

class FakeCognitoDependencies implements CognitoAuthDependencies {
  public readonly authorizationInputs: { usePkce: boolean }[] = [];
  public readonly tokenBodies: URLSearchParams[] = [];
  public readonly savedTokens: AuthTokens[] = [];
  public clearCalls = 0;
  public logoutError: Error | null = null;
  public tokenResponse: unknown = {
    id_token: 'id-token',
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 3600,
    token_type: 'Bearer',
  };

  public async authorize(input: {
    usePkce: boolean;
  }): Promise<{ code: string; codeVerifier: string }> {
    this.authorizationInputs.push(input);
    return { code: 'authorization-code', codeVerifier: 'verifier' };
  }

  public async requestTokens(_endpoint: string, body: URLSearchParams): Promise<unknown> {
    this.tokenBodies.push(body);
    await Promise.resolve();
    return this.tokenResponse;
  }

  public async openLogout(): Promise<void> {
    if (this.logoutError !== null) {
      throw this.logoutError;
    }
  }

  public async saveTokens(tokens: AuthTokens): Promise<void> {
    this.savedTokens.push(tokens);
  }

  public async clearTokens(): Promise<void> {
    this.clearCalls += 1;
  }
}

function buildConfig(): {
  cognitoDomain: string;
  cognitoClientId: string;
  cognitoRedirectUri: string;
  cognitoLogoutRedirectUri: string;
  cognitoScopes: string[];
} {
  return {
    cognitoDomain: 'https://example.auth.ap-northeast-1.amazoncognito.com',
    cognitoClientId: 'clientid1234567890',
    cognitoRedirectUri: 'lyra-mobile://auth/mobile/callback',
    cognitoLogoutRedirectUri: 'lyra-mobile://auth/mobile/logout',
    cognitoScopes: ['openid', 'email', 'profile'],
  };
}

function buildTokens(): AuthTokens {
  return {
    idToken: 'id-token',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: 1_800_000_000_000,
    tokenType: 'Bearer',
  };
}
