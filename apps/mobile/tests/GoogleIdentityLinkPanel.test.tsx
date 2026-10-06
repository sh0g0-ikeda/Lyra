import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { GoogleIdentityLinkPanel } from '@/components/GoogleIdentityLinkPanel';

const mocks = vi.hoisted(() => ({
  config: { cognitoRedirectUri: 'lyra-mobile://auth/mobile/callback' },
  platform: { OS: 'android' }, caps: { data: { google_sign_in: true, google_linking: true, google_ios: false }, isError: false },
  confirm: vi.fn(), reauthenticate: vi.fn(), openBrowser: vi.fn(), setTokens: vi.fn(), randomUUID: vi.fn(),
  api: { getGoogleAuthCapabilities: vi.fn(), getGoogleIdentityLinkStatus: vi.fn() },
  fresh: { getCurrentSession: vi.fn(), startGoogleIdentityLink: vi.fn(), getGoogleIdentityLinkStatus: vi.fn() },
  initialUrl: vi.fn(), currentToken: null as null | (() => string),
  user: { id: 'user-one' }
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({ Platform: mocks.platform, Text: 'text', Linking: { getInitialURL: mocks.initialUrl, addEventListener: () => ({ remove: vi.fn() }) } }));
vi.mock('expo-crypto', () => ({ randomUUID: mocks.randomUUID }));
vi.mock('expo-web-browser', () => ({ openAuthSessionAsync: mocks.openBrowser }));
vi.mock('@/lib/auth', () => ({ reauthenticateWithCognito: mocks.reauthenticate }));
vi.mock('@/lib/config', () => ({ config: mocks.config }));
vi.mock('@/lib/api', () => ({ ApiError: class extends Error { constructor(message: string, public status: number, public code: string) { super(message); } }, LyraMobileApiClient: class { constructor(token: () => string) { mocks.currentToken = token; } getCurrentSession = mocks.fresh.getCurrentSession; startGoogleIdentityLink = mocks.fresh.startGoogleIdentityLink; getGoogleIdentityLinkStatus = mocks.fresh.getGoogleIdentityLinkStatus; } }));
vi.mock('@/lib/confirm', () => ({ confirmAction: mocks.confirm }));
vi.mock('@/hooks/useGoogleAuthCapabilities', () => ({ useGoogleAuthCapabilities: () => mocks.caps }));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ api: mocks.api, language: 'en', session: { user: mocks.user }, setTokens: mocks.setTokens }) }));
vi.mock('@/components/Section', () => ({ Section: ({ children }: { children: React.ReactNode }) => React.createElement('section', null, children) }));
vi.mock('@/components/Notice', () => ({ Notice: ({ message }: { message: string }) => React.createElement('notice', null, message) }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: (props: Record<string, unknown>) => React.createElement('button', props) }));
const id = 'af1a66da-a1a1-4b4a-8a8a-6b906a785493';
const expires = '2026-10-01T13:10:00Z';
let renderer: ReactTestRenderer;
const render = async (): Promise<ReturnType<typeof vi.fn>> => {
  const signInAgain = vi.fn();
  await act(async () => { renderer = create(<GoogleIdentityLinkPanel onSignInAgain={signInAgain} />); });
  return signInAgain;
};
const press = async (id: string): Promise<void> => { await act(async () => { renderer.root.findByProps({ testID: id }).props.onPress(); }); };
const begin = async (): Promise<void> => {
  await press('google-link-start');
  await act(async () => { mocks.confirm.mock.calls.at(-1)?.[0].onConfirm(); });
};
beforeEach(() => {
  mocks.config.cognitoRedirectUri = 'lyra-mobile://auth/mobile/callback';
  vi.clearAllMocks(); mocks.platform.OS = 'android'; mocks.user.id = 'user-one'; mocks.caps.isError = false;
  mocks.caps.data = { google_sign_in: true, google_linking: true, google_ios: false };
  mocks.api.getGoogleAuthCapabilities.mockResolvedValue(mocks.caps.data);
  mocks.initialUrl.mockResolvedValue(null);
  mocks.reauthenticate.mockResolvedValue({ idToken: 'fresh-native-token' });
  mocks.randomUUID.mockReturnValue('bb1a66da-a1a1-4b4a-8a8a-6b906a785493');
  mocks.fresh.getCurrentSession.mockResolvedValue({ user: { id: 'user-one' } });
  mocks.fresh.startGoogleIdentityLink.mockResolvedValue({ challenge_id: id, status: 'pending', authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=opaque', expires_at: expires, requires_reauthentication: false });
  mocks.openBrowser.mockResolvedValue({ type: 'cancel' });
  mocks.fresh.getGoogleIdentityLinkStatus.mockResolvedValue({ challenge_id: id, status: 'pending', expires_at: expires, requires_reauthentication: false });
});
describe('GoogleIdentityLinkPanel', () => {
  it('検証APKのcold-returnの場合に同じ検証schemeだけを受け入れ認証済statusを照会する', async () => {
    mocks.config.cognitoRedirectUri = 'lyra-mobile-staging://auth/mobile/callback';
    mocks.initialUrl.mockResolvedValue('lyra-mobile-staging://auth/identity-link?challenge_id=' + id);
    mocks.api.getGoogleIdentityLinkStatus.mockResolvedValue({ challenge_id: id, status: 'linked', expires_at: expires, requires_reauthentication: true });
    await render(); await press('google-link-check');
    expect(mocks.api.getGoogleIdentityLinkStatus).toHaveBeenCalledWith(id);
    expect(mocks.setTokens).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
  it('検証APKが公開アプリ用cold-returnを受け取った場合に照会せず元sessionを保つ', async () => {
    mocks.config.cognitoRedirectUri = 'lyra-mobile-staging://auth/mobile/callback';
    mocks.initialUrl.mockResolvedValue('lyra-mobile://auth/identity-link?challenge_id=' + id);
    await render();
    expect(renderer.root.findAllByProps({ testID: 'google-link-check' })).toHaveLength(0);
    expect(mocks.api.getGoogleIdentityLinkStatus).not.toHaveBeenCalled();
    expect(mocks.setTokens).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
  it('disabled・capability error・iOSでは開始UIを出さず、既存sessionを変更しない', async () => {
    mocks.caps.data.google_linking = false; await render(); expect(renderer.toJSON()).toBeNull(); act(() => renderer.unmount());
    mocks.caps.data.google_linking = true; mocks.platform.OS = 'ios'; await render(); expect(renderer.toJSON()).toBeNull(); act(() => renderer.unmount());
    mocks.platform.OS = 'android'; mocks.caps.isError = true; await render(); expect(renderer.toJSON()).toBeNull(); act(() => renderer.unmount());
    expect(mocks.reauthenticate).not.toHaveBeenCalled(); expect(mocks.setTokens).not.toHaveBeenCalled();
  });
  it('明示確認後だけ再認証しcancel後のpendingを保持してstatus確認導線を残す', async () => {
    await render(); await press('google-link-start'); expect(mocks.reauthenticate).not.toHaveBeenCalled();
    await act(async () => { mocks.confirm.mock.calls.at(-1)?.[0].onConfirm(); });
    expect(JSON.stringify(renderer.toJSON())).toContain('Google linking is not complete');
    expect(renderer.root.findByProps({ testID: 'google-link-check' })).toBeDefined();
    expect(mocks.currentToken?.()).toBe('fresh-native-token'); expect(mocks.setTokens).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
  it('未知POSTのretryは同じrequest keyを使い、不明resultを成功扱いしない', async () => {
    mocks.fresh.startGoogleIdentityLink.mockRejectedValueOnce(new Error('provider secret'));
    await render(); await begin();
    expect(JSON.stringify(renderer.toJSON())).toContain('result could not be confirmed');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('provider secret');
    await press('google-link-retry-start');
    expect(mocks.reauthenticate).toHaveBeenCalledOnce();
    expect(mocks.fresh.startGoogleIdentityLink.mock.calls[0]?.[0]).toEqual(mocks.fresh.startGoogleIdentityLink.mock.calls[1]?.[0]);
    expect(mocks.setTokens).not.toHaveBeenCalled(); act(() => renderer.unmount());
  });
  it('RECENT_AUTH_REQUIREDは明示的な再認証導線を出し自動でkeyやsessionを置換しない', async () => {
    mocks.fresh.startGoogleIdentityLink.mockRejectedValueOnce(new ApiError('safe code', 401, 'RECENT_AUTH_REQUIRED'));
    await render(); await begin();
    expect(mocks.reauthenticate).toHaveBeenCalledOnce();
    expect(renderer.root.findByProps({ testID: 'google-link-start' }).props.label).toBe('Verify existing account again');
    expect(renderer.root.findAllByProps({ testID: 'google-link-retry-start' })).toHaveLength(0);
    expect(mocks.setTokens).not.toHaveBeenCalled();
    await press('google-link-start');
    expect(mocks.reauthenticate).toHaveBeenCalledOnce();
    await act(async () => { mocks.confirm.mock.calls.at(-1)?.[0].onConfirm(); });
    expect(mocks.reauthenticate).toHaveBeenCalledTimes(2);
    act(() => renderer.unmount());
  });
  it('URLを再発行できないreceiptでは状況確認を残し明示確認後だけ新しい再認証とrequestを開始する', async () => {
    mocks.randomUUID.mockReturnValueOnce('bb1a66da-a1a1-4b4a-8a8a-6b906a785493').mockReturnValueOnce('cc1a66da-a1a1-4b4a-8a8a-6b906a785493');
    mocks.fresh.startGoogleIdentityLink.mockResolvedValueOnce({ challenge_id: id, status: 'pending', authorization_url: null, expires_at: expires, requires_reauthentication: true });
    await render(); await begin();
    expect(renderer.root.findByProps({ testID: 'google-link-start' }).props.label).toBe('Verify existing account again');
    expect(renderer.root.findAllByProps({ label: 'Continue Google authorization' })).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Continue authorization');
    expect(mocks.openBrowser).not.toHaveBeenCalled();
    await press('google-link-check');
    expect(renderer.root.findByProps({ testID: 'google-link-start' }).props.label).toBe('Verify existing account again');
    await press('google-link-start');
    expect(mocks.reauthenticate).toHaveBeenCalledOnce();
    expect(mocks.randomUUID).toHaveBeenCalledOnce();
    expect(mocks.fresh.startGoogleIdentityLink).toHaveBeenCalledOnce();
    expect(renderer.root.findByProps({ testID: 'google-link-check' })).toBeDefined();
    await act(async () => { mocks.confirm.mock.calls.at(-1)?.[0].onConfirm(); });
    expect(mocks.reauthenticate).toHaveBeenCalledTimes(2);
    expect(mocks.fresh.startGoogleIdentityLink.mock.calls.map(([body]) => body.request_key)).toEqual(['bb1a66da-a1a1-4b4a-8a8a-6b906a785493', 'cc1a66da-a1a1-4b4a-8a8a-6b906a785493']);
    expect(mocks.setTokens).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
  it('再認証が必要な開始receipt後にstatus取得が失敗しても確認導線を失わない', async () => {
    mocks.fresh.startGoogleIdentityLink.mockResolvedValueOnce({ challenge_id: id, status: 'pending', authorization_url: null, expires_at: expires, requires_reauthentication: true });
    mocks.fresh.getGoogleIdentityLinkStatus.mockRejectedValueOnce(new Error('offline'));
    await render(); await begin();
    expect(renderer.root.findByProps({ testID: 'google-link-start' }).props.label).toBe('Verify existing account again');
    expect(renderer.root.findByProps({ testID: 'google-link-check' })).toBeDefined();
    expect(mocks.openBrowser).not.toHaveBeenCalled();
    expect(mocks.reauthenticate).toHaveBeenCalledOnce();
    expect(mocks.setTokens).not.toHaveBeenCalled();
    await press('google-link-check');
    expect(renderer.root.findByProps({ testID: 'google-link-start' }).props.label).toBe('Verify existing account again');
    expect(mocks.randomUUID).toHaveBeenCalledOnce();
    act(() => renderer.unmount());
  });
  it('cold-returnはtokenを取らず認証済statusでlinked確認し、再ログインは別の明示操作にする', async () => {
    mocks.initialUrl.mockResolvedValue(`lyra-mobile://auth/identity-link?challenge_id=${id}`);
    mocks.api.getGoogleIdentityLinkStatus.mockResolvedValue({ challenge_id: id, status: 'linked', expires_at: expires, requires_reauthentication: true });
    const signInAgain = await render(); await press('google-link-check');
    expect(JSON.stringify(renderer.toJSON())).toContain('server confirmed');
    expect(signInAgain).not.toHaveBeenCalled(); expect(mocks.setTokens).not.toHaveBeenCalled();
    await press('google-link-sign-in-again'); expect(signInAgain).toHaveBeenCalledOnce();
    act(() => renderer.unmount());
  });
});
