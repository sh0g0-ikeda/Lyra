import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { signInWithCognito } from '@/lib/auth';

const mocks = vi.hoisted(() => ({
  authRequestConfig: null as Record<string, unknown> | null,
  promptAsync: vi.fn(),
  saveAuthTokens: vi.fn()
}));

vi.mock('expo-auth-session', () => ({
  AuthRequest: class AuthRequest {
    public readonly codeVerifier = 'code-verifier';

    public constructor(config: Record<string, unknown>) {
      mocks.authRequestConfig = config;
    }

    public promptAsync = mocks.promptAsync;
  },
  ResponseType: {
    Code: 'code'
  }
}));

vi.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: vi.fn(),
  openAuthSessionAsync: vi.fn()
}));

vi.mock('@/lib/config', () => ({
  config: {
    cognitoClientId: 'mobile-client',
    cognitoDomain: 'https://auth.example.test',
    cognitoLogoutRedirectUri: 'lyra-mobile://logout',
    cognitoRedirectUri: 'lyra-mobile://callback',
    cognitoScopes: ['openid', 'email']
  }
}));

vi.mock('@/lib/storage', () => ({
  clearAuthTokens: vi.fn(),
  saveAuthTokens: mocks.saveAuthTokens
}));

describe('Cognito認証画面の言語', () => {
  beforeEach(() => {
    mocks.authRequestConfig = null;
    mocks.promptAsync.mockReset();
    mocks.promptAsync.mockResolvedValue({
      params: { code: 'authorization-code' },
      type: 'success'
    });
    mocks.saveAuthTokens.mockReset();
    mocks.saveAuthTokens.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access-token',
      expires_in: 3600,
      id_token: 'id-token',
      refresh_token: 'refresh-token',
      token_type: 'Bearer'
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    })));
  });

  it.each(['ja', 'en'] as const)('認証画面へ現在言語 %s を渡す', async (language) => {
    await signInWithCognito(language);

    expect(mocks.authRequestConfig).toMatchObject({
      extraParams: { lang: language }
    });
  });

  it('ログイン操作は現在のアプリ言語でCognito認証を開始する', () => {
    const authScreenPath = fileURLToPath(
      new URL('../src/screens/AuthScreen.tsx', import.meta.url)
    );
    const source = readFileSync(authScreenPath, 'utf8');

    expect(source).toContain('signInWithCognito(language)');
  });
});
