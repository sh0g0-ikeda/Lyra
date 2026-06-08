import { describe, expect, it } from 'vitest';
import {
  buildCognitoAuthorizeUrl,
  buildCognitoLogoutUrl,
  completeCognitoRedirectIfPresent,
  getCognitoAuthConfig,
  readStoredCognitoSession,
} from '../../../apps/web/src/lib/cognitoAuth.js';

class FakeStorage {
  public readonly values = new Map<string, string>();

  public constructor(initialValues: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initialValues)) {
      this.values.set(key, value);
    }
  }

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  public removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('cognitoAuth', () => {
  it('Cognito Hosted UI 設定を env から作る', () => {
    const config = getCognitoAuthConfig(
      {
        VITE_COGNITO_DOMAIN: 'https://example.auth.ap-northeast-1.amazoncognito.com/',
        VITE_COGNITO_CLIENT_ID: 'client-1',
        VITE_COGNITO_REDIRECT_URI: 'https://app.example.com/callback',
        VITE_COGNITO_LOGOUT_URI: 'https://app.example.com/logout',
        VITE_COGNITO_SCOPES: 'openid email lyra/api lyra/api',
      },
      'https://app.example.com',
    );

    expect(config).toEqual({
      domain: 'https://example.auth.ap-northeast-1.amazoncognito.com',
      clientId: 'client-1',
      redirectUri: 'https://app.example.com/callback',
      logoutUri: 'https://app.example.com/logout',
      scopes: ['openid', 'email', 'lyra/api'],
    });
  });

  it('必須の Cognito 設定がなければ null にする', () => {
    expect(getCognitoAuthConfig({}, 'https://app.example.com')).toBeNull();
    expect(getCognitoAuthConfig({ VITE_COGNITO_DOMAIN: 'https://example.test' }, undefined)).toBeNull();
  });

  it('authorize と logout の URL を構築する', () => {
    const config = {
      domain: 'https://example.auth.ap-northeast-1.amazoncognito.com',
      clientId: 'client-1',
      redirectUri: 'https://app.example.com',
      logoutUri: 'https://app.example.com/logout',
      scopes: ['openid', 'email'],
    };

    const authorizeUrl = new URL(buildCognitoAuthorizeUrl(config, 'state-1', 'challenge-1'));
    expect(authorizeUrl.pathname).toBe('/oauth2/authorize');
    expect(authorizeUrl.searchParams.get('client_id')).toBe('client-1');
    expect(authorizeUrl.searchParams.get('response_type')).toBe('code');
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');

    const logoutUrl = new URL(buildCognitoLogoutUrl(config));
    expect(logoutUrl.pathname).toBe('/logout');
    expect(logoutUrl.searchParams.get('logout_uri')).toBe('https://app.example.com/logout');
  });

  it('保存済み session は期限切れなら破棄する', () => {
    const storage = new FakeStorage({
      'lyra:web:cognito-session': JSON.stringify({
        accessToken: 'access',
        idToken: null,
        refreshToken: null,
        expiresAt: 1_000,
      }),
    });

    expect(readStoredCognitoSession(storage, 2_000)).toBeNull();
    expect(storage.getItem('lyra:web:cognito-session')).toBeNull();
  });

  it('壊れた保存済み session は破棄する', () => {
    const storage = new FakeStorage({
      'lyra:web:cognito-session': JSON.stringify({
        accessToken: '',
        idToken: null,
        refreshToken: null,
        expiresAt: Number.NaN,
      }),
    });

    expect(readStoredCognitoSession(storage, 2_000)).toBeNull();
    expect(storage.getItem('lyra:web:cognito-session')).toBeNull();
  });

  it('callback code を token に交換して session を保存する', async () => {
    const storage = new FakeStorage({
      'lyra:web:cognito-pkce': JSON.stringify({
        state: 'state-1',
        verifier: 'verifier-1',
        createdAt: 1,
      }),
    });
    const replacedUrls: string[] = [];
    const location = {
      href: 'https://app.example.com/?code=code-1&state=state-1',
      origin: 'https://app.example.com',
      pathname: '/',
      search: '?code=code-1&state=state-1',
      hash: '',
      assign: () => undefined,
    };
    const history = {
      replaceState: (_data: unknown, _title: string, url?: string) => {
        replacedUrls.push(url ?? '');
      },
    };
    const config = {
      domain: 'https://example.auth.ap-northeast-1.amazoncognito.com',
      clientId: 'client-1',
      redirectUri: 'https://app.example.com',
      logoutUri: 'https://app.example.com',
      scopes: ['openid'],
    };

    const result = await completeCognitoRedirectIfPresent(
      config,
      storage,
      location,
      history,
      async (_url, init) => {
        expect(init.body).toContain('code=code-1');
        expect(init.body).toContain('code_verifier=verifier-1');
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              access_token: 'access-token',
              id_token: 'id-token',
              refresh_token: 'refresh-token',
              expires_in: 3600,
            };
          },
        };
      },
      10_000,
    );

    expect(result).toMatchObject({
      handled: true,
      error: null,
      session: {
        accessToken: 'access-token',
        idToken: 'id-token',
        refreshToken: 'refresh-token',
        expiresAt: 3_610_000,
      },
    });
    expect(storage.getItem('lyra:web:cognito-session')).toContain('access-token');
    expect(storage.getItem('lyra:web:cognito-pkce')).toBeNull();
    expect(replacedUrls).toEqual(['/']);
  });
});
