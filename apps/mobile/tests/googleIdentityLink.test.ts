import { describe, expect, it, vi } from 'vitest';
import { GoogleIdentityLinkFlow, googleAllowedOnPlatform, parseGoogleLinkReturn, validateGoogleAuthorizationUrl } from '@/lib/googleIdentityLink';

const id = 'af1a66da-a1a1-4b4a-8a8a-6b906a785493';
const key = 'bb1a66da-a1a1-4b4a-8a8a-6b906a785493';
const url = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=dedicated&state=opaque';
const expires = '2026-10-01T13:10:00Z';
function fixture() {
  let userId: string | null = 'user-one';
  const client = {
    getCurrentSession: vi.fn().mockResolvedValue({ user: { id: 'user-one' } }),
    startGoogleIdentityLink: vi.fn().mockResolvedValue({ challenge_id: id, status: 'pending', authorization_url: url, expires_at: expires, requires_reauthentication: false }),
    getGoogleIdentityLinkStatus: vi.fn().mockResolvedValue({ challenge_id: id, status: 'linked', expires_at: expires, requires_reauthentication: true })
  };
  const ports = { expectedUserId: 'user-one', currentUserId: () => userId, reauthenticate: vi.fn().mockResolvedValue({ idToken: 'fresh-native-token' }), createClient: vi.fn().mockReturnValue(client), createRequestKey: () => key, openBrowser: vi.fn().mockResolvedValue({ type: 'success', url: `lyra-mobile://auth/identity-link?challenge_id=${id}` }) };
  return { client, ports, flow: new GoogleIdentityLinkFlow(ports), switchUser: () => { userId = 'another-user'; } };
}
describe('GoogleIdentityLinkFlow', () => {
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
    expect(googleAllowedOnPlatform({ google_sign_in: true, google_linking: true, google_ios: false }, 'ios', 'google_sign_in')).toBe(false);
    expect(googleAllowedOnPlatform({ google_sign_in: true, google_linking: true, google_ios: false }, 'android', 'google_linking')).toBe(true);
  });
  it('native callbackはUUIDだけを受け付けtokenや追加queryを拒否する', () => {
    expect(parseGoogleLinkReturn(`lyra-mobile://auth/identity-link?challenge_id=${id}`)).toBe(id);
    for (const extra of ['&id_token=x', '&code=x', '#access_token=x', '&challenge_id='+key]) {
      expect(parseGoogleLinkReturn(`lyra-mobile://auth/identity-link?challenge_id=${id}${extra}`)).toBeNull();
    }
  });
});
