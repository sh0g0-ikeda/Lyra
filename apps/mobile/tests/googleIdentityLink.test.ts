import { describe, expect, it, vi } from 'vitest';
import { GoogleIdentityLinkFlow, googleAllowedOnPlatform, googleIdentityLinkReturnUriForRedirectUri, parseGoogleLinkReturn, validateGoogleAuthorizationUrl } from '@/lib/googleIdentityLink';

const id = 'af1a66da-a1a1-4b4a-8a8a-6b906a785493';
const key = 'bb1a66da-a1a1-4b4a-8a8a-6b906a785493';
const url = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=dedicated&state=opaque';
const expires = '2026-10-01T13:10:00Z';
function fixture(cognitoRedirectUri = 'lyra-mobile://auth/mobile/callback') {
  let userId: string | null = 'user-one';
  const client = {
    getCurrentSession: vi.fn().mockResolvedValue({ user: { id: 'user-one' } }),
    startGoogleIdentityLink: vi.fn().mockResolvedValue({ challenge_id: id, status: 'pending', authorization_url: url, expires_at: expires, requires_reauthentication: false }),
    getGoogleIdentityLinkStatus: vi.fn().mockResolvedValue({ challenge_id: id, status: 'linked', expires_at: expires, requires_reauthentication: true })
  };
  const ports = { cognitoRedirectUri, expectedUserId: 'user-one', currentUserId: () => userId, reauthenticate: vi.fn().mockResolvedValue({ idToken: 'fresh-native-token' }), createClient: vi.fn().mockReturnValue(client), createRequestKey: () => key, openBrowser: vi.fn().mockResolvedValue({ type: 'success', url: `lyra-mobile://auth/identity-link?challenge_id=${id}` }) };
  return { client, ports, flow: new GoogleIdentityLinkFlow(ports), switchUser: () => { userId = 'another-user'; } };
}
describe('GoogleIdentityLinkFlow', () => {
  it('検証APKの場合に検証schemeでブラウザから復帰し公開アプリschemeを拒否する', async () => {
    const f = fixture('lyra-mobile-staging://auth/mobile/callback');
    f.ports.openBrowser.mockResolvedValue({ type: 'success', url: 'lyra-mobile-staging://auth/identity-link?challenge_id=' + id });
    await expect(f.flow.start()).resolves.toMatchObject({ status: 'linked' });
    expect(f.ports.openBrowser).toHaveBeenCalledWith(url, 'lyra-mobile-staging://auth/identity-link');
    expect(parseGoogleLinkReturn('lyra-mobile://auth/identity-link?challenge_id=' + id, 'lyra-mobile-staging://auth/mobile/callback')).toBeNull();
    expect(parseGoogleLinkReturn('lyra-mobile-staging://auth/identity-link?challenge_id=' + id, 'lyra-mobile-staging://auth/mobile/callback')).toBe(id);
  });
  it('許可したCognito callbackだけからGoogle連携の戻り先を導出する', () => {
    expect(googleIdentityLinkReturnUriForRedirectUri('lyra-mobile://auth/mobile/callback')).toBe('lyra-mobile://auth/identity-link');
    expect(googleIdentityLinkReturnUriForRedirectUri('lyra-mobile-staging://auth/mobile/callback')).toBe('lyra-mobile-staging://auth/identity-link');
    for (const invalid of ['https://evil.example/auth/mobile/callback', 'lyra-mobile://evil/mobile/callback', 'lyra-mobile://auth/mobile/callback?redirect=evil']) {
      expect(() => googleIdentityLinkReturnUriForRedirectUri(invalid)).toThrow('INVALID_RETURN_CONFIGURATION');
    }
  });
  it('fresh同userを確認し開始→browser→認証済statusでのみ成功を判定する', async () => {
    const { flow, client, ports } = fixture();
    await expect(flow.start()).resolves.toMatchObject({ status: 'linked' });
    expect(ports.reauthenticate).toHaveBeenCalledOnce();
    expect(client.startGoogleIdentityLink).toHaveBeenCalledWith({ platform: 'mobile', request_key: key });
    expect(client.getGoogleIdentityLinkStatus).toHaveBeenCalledWith(id);
    expect(ports.openBrowser).toHaveBeenCalledWith(url, 'lyra-mobile://auth/identity-link');
  });
  it('不明POSTは同keyとfreshclientで明示retryし新しい再認証やchallengeを増やさない', async () => {
    const { flow, client, ports } = fixture();
    client.startGoogleIdentityLink.mockRejectedValueOnce(new Error('timeout'));
    await expect(flow.start()).rejects.toThrow();
    expect(flow.canRetryStart).toBe(true);
    await flow.start();
    expect(ports.reauthenticate).toHaveBeenCalledOnce();
    expect(client.startGoogleIdentityLink.mock.calls.map(([body]) => body.request_key)).toEqual([key, key]);
  });
  it('別user再認証・logout後はstartやbrowserを実行しない', async () => {
    const wrong = fixture(); wrong.client.getCurrentSession.mockResolvedValue({ user: { id: 'wrong-user' } });
    await expect(wrong.flow.start()).rejects.toThrow('ACCOUNT_MISMATCH');
    expect(wrong.client.startGoogleIdentityLink).not.toHaveBeenCalled();
    const changed = fixture(); changed.switchUser();
    await expect(changed.flow.start()).rejects.toThrow('SESSION_CHANGED');
    expect(changed.ports.reauthenticate).not.toHaveBeenCalled();
  });
  it('browser cancel後も未連携を断言せずserver statusを確認する', async () => {
    const { flow, client, ports } = fixture(); ports.openBrowser.mockResolvedValue({ type: 'cancel' });
    client.getGoogleIdentityLinkStatus.mockResolvedValue({ challenge_id: id, status: 'pending', expires_at: expires, requires_reauthentication: false });
    await expect(flow.start()).resolves.toMatchObject({ status: 'pending' });
    expect(client.getGoogleIdentityLinkStatus).toHaveBeenCalledOnce();
  });
  it('変更sessionのreceiptはstatus照会後も明示再認証を要求し旧URLや新keyを自動生成しない', async () => {
    const { flow, client, ports } = fixture();
    client.startGoogleIdentityLink.mockResolvedValue({ challenge_id: id, status: 'pending', authorization_url: null, expires_at: expires, requires_reauthentication: true });
    client.getGoogleIdentityLinkStatus.mockResolvedValue({ challenge_id: id, status: 'pending', expires_at: expires, requires_reauthentication: false });
    await expect(flow.start()).resolves.toMatchObject({ status: 'pending', requires_reauthentication: true });
    await expect(flow.check()).resolves.toMatchObject({ requires_reauthentication: true });
    await expect(flow.start()).resolves.toMatchObject({ requires_reauthentication: true });
    expect(ports.openBrowser).not.toHaveBeenCalled();
    expect(ports.reauthenticate).toHaveBeenCalledOnce();
    expect(client.startGoogleIdentityLink).toHaveBeenCalledOnce();
    expect(flow.canRetryStart).toBe(false);
    client.getGoogleIdentityLinkStatus.mockResolvedValue({ challenge_id: id, status: 'linked', expires_at: expires, requires_reauthentication: false });
    await expect(flow.check()).resolves.toMatchObject({ status: 'linked', requires_reauthentication: false });
  });
  it('外部hostや別challengeのcallbackから成功を作らない', async () => {
    const { flow, ports, client } = fixture();
    ports.openBrowser.mockResolvedValue({ type: 'success', url: `lyra-mobile://auth/identity-link?challenge_id=${key}` });
    await expect(flow.start()).rejects.toThrow('INVALID_RETURN');
    expect(client.getGoogleIdentityLinkStatus).not.toHaveBeenCalled();
    await expect(flow.check()).resolves.toMatchObject({ status: 'linked' });
    expect(() => validateGoogleAuthorizationUrl('https://accounts.google.com.evil.test/o/oauth2/v2/auth')).toThrow();
    expect(() => validateGoogleAuthorizationUrl('http://accounts.google.com/o/oauth2/v2/auth')).toThrow();
  });
  it('二重tapは1回のreauth/startで処理し、途中logoutではその後の操作を止める', async () => {
    const repeated = fixture();
    const first = repeated.flow.start(); const second = repeated.flow.start();
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(repeated.ports.reauthenticate).toHaveBeenCalledOnce();
    expect(repeated.client.startGoogleIdentityLink).toHaveBeenCalledOnce();
    const stopped = fixture();
    let finish: (tokens: unknown) => void = () => undefined;
    stopped.ports.reauthenticate.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = stopped.flow.start();
    stopped.flow.invalidate(); finish({ idToken: 'fresh-native-token' });
    await expect(pending).rejects.toThrow('SESSION_CHANGED');
    expect(stopped.client.getCurrentSession).not.toHaveBeenCalled();
    expect(stopped.client.startGoogleIdentityLink).not.toHaveBeenCalled();
  });
  it('iOS・未確認capability・disabledはGoogleを提供しない', () => {
    expect(googleAllowedOnPlatform(undefined, 'android', 'google_sign_in')).toBe(false);
    expect(googleAllowedOnPlatform({ version: 2, google_sign_in: true, google_linking: true, google_ios: false }, 'ios', 'google_sign_in')).toBe(false);
    expect(googleAllowedOnPlatform({ version: 2, google_sign_in: true, google_linking: true, google_ios: false }, 'android', 'google_linking')).toBe(true);
  });
  it('v2で審査済みiOS capabilityが有効な場合にGoogleを提供する', () => {
    const capabilities = { version: 2 as const, google_sign_in: true, google_linking: true, google_ios: true };
    expect(googleAllowedOnPlatform(capabilities, 'ios', 'google_sign_in')).toBe(true);
    expect(googleAllowedOnPlatform(capabilities, 'ios', 'google_linking')).toBe(true);
    expect(googleAllowedOnPlatform({ ...capabilities, google_sign_in: false }, 'ios', 'google_sign_in')).toBe(false);
    expect(googleAllowedOnPlatform({ ...capabilities, google_linking: false }, 'ios', 'google_linking')).toBe(false);
  });
  it('native callbackはUUIDだけを受け付けtokenや追加queryを拒否する', () => {
    expect(parseGoogleLinkReturn(`lyra-mobile://auth/identity-link?challenge_id=${id}`)).toBe(id);
    for (const extra of ['&id_token=x', '&code=x', '#access_token=x', '&challenge_id='+key]) {
      expect(parseGoogleLinkReturn(`lyra-mobile://auth/identity-link?challenge_id=${id}${extra}`)).toBeNull();
    }
  });
});
