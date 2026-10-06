import { afterEach, describe, expect, it, vi } from 'vitest';
import { LyraMobileApiClient } from '@/lib/api';
import { googleLinkStartSchema } from '@/domain/googleAuth';
const id = 'af1a66da-a1a1-4b4a-8a8a-6b906a785493';
const key = 'bb1a66da-a1a1-4b4a-8a8a-6b906a785493';
const expires = '2026-10-01T13:10:00Z';
afterEach(() => vi.unstubAllGlobals());
describe('Google auth API contracts', () => {
  it('public能力を読み、開始にはplatformとidempotency keyだけを送りstatusは認証済で読む', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 2, google_sign_in: true, google_linking: true, google_ios: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ challenge_id: id, status: 'pending', authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=opaque', expires_at: expires, requires_reauthentication: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ challenge_id: id, status: 'linked', expires_at: expires, requires_reauthentication: true })));
    vi.stubGlobal('fetch', fetchMock);
    const api = new LyraMobileApiClient(() => 'native-cognito-token');
    await api.getGoogleAuthCapabilities();
    await api.startGoogleIdentityLink({ platform: 'mobile', request_key: key });
    await api.getGoogleIdentityLinkStatus(id);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/auth/capabilities?version=2');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/api/auth/identity-links/google/start');
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toEqual({ platform: 'mobile', request_key: key });
    expect(fetchMock.mock.calls[2]?.[0]).toContain(`/api/auth/identity-links/google/${id}`);
    expect(new Headers(fetchMock.mock.calls[2]?.[1].headers).get('Authorization')).toBe('Bearer native-cognito-token');
  });
  it('changed-session開始receiptを受け取り必須の再認証flagと任意message codeを維持する', async () => {
    const receipt = { challenge_id: id, status: 'pending', authorization_url: null, expires_at: expires, requires_reauthentication: true, message_code: 'RECENT_AUTH_REQUIRED' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(receipt))));
    await expect(new LyraMobileApiClient(() => 'native').startGoogleIdentityLink({ platform: 'mobile', request_key: key })).resolves.toEqual(receipt);
    const { requires_reauthentication: _flag, ...missingFlag } = receipt;
    expect(googleLinkStartSchema.safeParse(missingFlag).success).toBe(false);
    expect(googleLinkStartSchema.safeParse({ ...receipt, challenge_id: '../other' }).success).toBe(false);
    expect(googleLinkStartSchema.safeParse({ ...receipt, id_token: 'unexpected' }).success).toBe(false);
  });
  it('review済みv2 iOS解禁を受け取りunknown statusと旧v1 responseは契約違反として扱う', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 2, google_sign_in: true, google_linking: true, google_ios: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ challenge_id: id, status: 'success', expires_at: expires, requires_reauthentication: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ google_sign_in: true, google_linking: true, google_ios: false })));
    vi.stubGlobal('fetch', fetchMock); const api = new LyraMobileApiClient(() => 'native');
    await expect(api.getGoogleAuthCapabilities()).resolves.toMatchObject({ version: 2, google_ios: true });
    await expect(api.getGoogleIdentityLinkStatus(id)).rejects.toThrow();
    await expect(api.getGoogleAuthCapabilities()).rejects.toThrow();
    expect(() => api.getGoogleIdentityLinkStatus('../other')).toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
