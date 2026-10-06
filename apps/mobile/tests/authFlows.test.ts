import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), prompt: vi.fn(), save: vi.fn(), fetch: vi.fn() }));
vi.mock('expo-auth-session', () => ({
  AuthRequest: class { codeVerifier = 'pkce-verifier'; constructor(options: unknown) { mocks.request(options); } promptAsync = mocks.prompt; },
  ResponseType: { Code: 'code' }, Prompt: { Login: 'login' }
}));
vi.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: vi.fn(), openAuthSessionAsync: vi.fn() }));
vi.mock('@/lib/config', () => ({ config: { cognitoDomain: 'https://auth.example.test', cognitoClientId: 'client', cognitoRedirectUri: 'lyra-mobile://auth/mobile/callback', cognitoScopes: ['openid', 'email'] } }));
vi.mock('@/lib/storage', () => ({ saveAuthTokens: mocks.save, clearAuthTokens: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('fetch', mocks.fetch);
  mocks.prompt.mockResolvedValue({ type: 'success', params: { code: 'authorization-code' } });
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ id_token: 'cognito-id-token', access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }) });
});
describe('Cognito sign-in options', () => {
  it('既存メールログインを保持しGoogleもCognito PKCE code flowを使う', async () => {
    const { signInWithCognito } = await import('@/lib/auth');
    await signInWithCognito();
    expect(mocks.request.mock.calls[0]?.[0]).toMatchObject({ usePKCE: true, responseType: 'code' });
    expect(mocks.request.mock.calls[0]?.[0].extraParams).toBeUndefined();
    await signInWithCognito({ identityProvider: 'Google' });
    expect(mocks.request.mock.calls[1]?.[0]).toMatchObject({ extraParams: { identity_provider: 'Google' }, usePKCE: true });
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1]?.[0]).toBe('https://auth.example.test/oauth2/token');
  });
  it('連携用のfresh再認証はprompt loginとmax_age0を要求し既存保存tokenを置換しない', async () => {
    const { reauthenticateWithCognito } = await import('@/lib/auth');
    const tokens = await reauthenticateWithCognito();
    expect(tokens.idToken).toBe('cognito-id-token');
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'login', extraParams: { max_age: '0' }, usePKCE: true }));
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('cancelまたはcode欠損では交換も保存もしない', async () => {
    const { reauthenticateWithCognito } = await import('@/lib/auth');
    mocks.prompt.mockResolvedValue({ type: 'cancel' });
    await expect(reauthenticateWithCognito()).rejects.toThrow();
    mocks.prompt.mockResolvedValue({ type: 'dismiss' });
    await expect(reauthenticateWithCognito()).rejects.toThrow();
    mocks.prompt.mockResolvedValue({ type: 'success', params: {} });
    await expect(reauthenticateWithCognito()).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([
    { error: 'ACCOUNT_LINK_REQUIRED' },
    { error: 'invalid_request', error_description: 'PreSignUp failed with error Use the existing sign-in method and link this provider from your account. (Service: AWSCognitoIdentityProvider)' }
  ])('既知のcollisionだけを安全なAuthError markerへ変換しtokenを保存しない', async (params) => {
    const { signInWithCognito } = await import('@/lib/auth');
    mocks.prompt.mockResolvedValue({ type: 'error', params });

    await expect(signInWithCognito({ identityProvider: 'Google' })).rejects.toMatchObject({
      name: 'AuthError',
      code: 'ACCOUNT_LINK_REQUIRED'
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('未知のprovider errorはraw説明を捨て既存の汎用失敗を保つ', async () => {
    const { signInWithCognito } = await import('@/lib/auth');
    mocks.prompt.mockResolvedValue({
      type: 'error',
      params: { error: 'invalid_request', error_description: 'user@example.test internal_key=secret' }
    });

    await expect(signInWithCognito({ identityProvider: 'Google' })).rejects.toMatchObject({
      name: 'AuthError',
      message: 'Cognito sign-in was cancelled or failed.',
      code: null
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('state mismatchは既知guard文を含んでも連携案内へ上書きしない', async () => {
    const { signInWithCognito } = await import('@/lib/auth');
    mocks.prompt.mockResolvedValue({
      type: 'error',
      error: { code: 'state_mismatch' },
      params: {
        error: 'access_denied',
        error_description: 'Use the existing sign-in method and link this provider from your account.'
      }
    });

    await expect(signInWithCognito({ identityProvider: 'Google' })).rejects.toMatchObject({
      name: 'AuthError',
      message: 'Cognito sign-in was cancelled or failed.',
      code: null
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
