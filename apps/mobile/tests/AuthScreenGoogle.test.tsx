import React from 'react';
import { createRequire } from 'node:module';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'android' },
  caps: { data: { google_sign_in: false, google_linking: false, google_ios: false }, isError: false, refetch: vi.fn() },
  xCaps: { data: { x_sign_in: false, x_android: false, x_ios: false }, isError: false, refetch: vi.fn() },
  signIn: vi.fn(), setTokens: vi.fn()
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
require.extensions['.jpg'] = (module) => { module.exports = 1; };
vi.mock('react-native', () => ({
  Animated: { Value: class {}, timing: () => ({ start: (done: () => void) => done() }), Image: 'animated-image', View: 'animated-view' },
  Image: Object.assign((props: Record<string, unknown>) => React.createElement('image', props), { resolveAssetSource: () => ({ width: 1458, height: 709 }) }), Linking: { openURL: vi.fn() }, Platform: mocks.platform, Pressable: 'pressable', StatusBar: 'status-bar', StyleSheet: { create: (style: unknown) => style }, Text: 'text', View: 'view'
}));
vi.mock('@/components/Screen', () => ({ Screen: ({ children, ...props }: { children: React.ReactNode; chrome?: string }) => React.createElement('screen', props, children) }));
vi.mock('@/components/Notice', () => ({ Notice: ({ message }: { message: string }) => React.createElement('notice', null, message) }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: (props: Record<string, unknown>) => React.createElement('button', props) }));
vi.mock('@/lib/auth', () => ({ signInWithCognito: mocks.signIn }));
vi.mock('@/lib/config', () => ({ isAuthConfigured: () => true }));
vi.mock('@/hooks/useGoogleAuthCapabilities', () => ({ useGoogleAuthCapabilities: () => mocks.caps }));
vi.mock('@/hooks/useXAuthCapabilities', () => ({ useXAuthCapabilities: () => mocks.xCaps }));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ language: 'en', setTokens: mocks.setTokens }) }));
const { AuthScreen } = await import('@/screens/AuthScreen');
let renderer: ReactTestRenderer;
const render = async (): Promise<void> => {
  await act(async () => { renderer = create(<AuthScreen />); });
  await act(async () => { vi.advanceTimersByTime(2000); });
};
const press = async (testID: string): Promise<void> => { await act(async () => { renderer.root.findByProps({ testID }).props.onPress(); }); };
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); mocks.platform.OS = 'android'; mocks.caps.isError = false;
  mocks.caps.data = { google_sign_in: false, google_linking: false, google_ios: false };
  mocks.xCaps.isError = false;
  mocks.xCaps.data = { x_sign_in: false, x_android: false, x_ios: false };
  mocks.signIn.mockResolvedValue({ idToken: 'cognito-token' });
  mocks.caps.refetch.mockResolvedValue({ data: { google_sign_in: true, google_linking: true, google_ios: false }, isError: false });
});
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.useRealTimers(); });
describe('AuthScreen Google capability gate', () => {
  // Spec §4/§7: authentication starts with an explicit persisted language choice;
  // sign-in itself must not replace the session flow or tokens.
  it('ログイン前はlanguage chromeを明示してEnglish表記をScreenへ委譲する', async () => {
    await render();
    expect(renderer.root.findByType('screen').props.chrome).toBe('language');
  });

  it('初期splashとログイン画面でロゴ全体を同じ自然比率で表示する', async () => {
    await act(async () => { renderer = create(<AuthScreen />); });
    const splash = renderer.root.findByType('animated-image');
    expect(splash.props.resizeMode).toBe('contain');
    expect(splash.props.style[0]).toMatchObject({ aspectRatio: 1458 / 709, height: undefined, width: '100%' });

    await act(async () => { vi.advanceTimersByTime(2000); });
    const hero = renderer.root.findByType('image');
    expect(hero.props.resizeMode).toBe('contain');
    expect(hero.props.style).toMatchObject({ aspectRatio: 1458 / 709, height: undefined, width: '100%' });
  });
  it('Google disabledでも既存メールログインを保持する', async () => {
    await render();
    expect(renderer.root.findAllByProps({ testID: 'auth-google-button' })).toHaveLength(0);
    await press('auth-login-button');
    expect(mocks.signIn).toHaveBeenCalledWith({ language: 'en' });
    expect(mocks.setTokens).toHaveBeenCalledWith({ idToken: 'cognito-token' });
  });
  it('Androidでserver有効時だけGoogleCTAを表示しiOSでは表示しない', async () => {
    mocks.caps.data.google_sign_in = true;
    await render(); expect(renderer.root.findAllByProps({ testID: 'auth-google-button' })).not.toHaveLength(0);
    await press('auth-google-button'); expect(mocks.signIn).toHaveBeenCalledWith({ identityProvider: 'Google', language: 'en' });
    mocks.platform.OS = 'ios'; act(() => renderer.update(<AuthScreen />));
    expect(renderer.root.findAllByProps({ testID: 'auth-google-button' })).toHaveLength(0);
  });
  it('capability再確認失敗でcacheが残ってもGoogleを開始せず既存ログインを残す', async () => {
    mocks.caps.data.google_sign_in = true;
    mocks.caps.refetch.mockResolvedValue({ data: mocks.caps.data, isError: true });
    await render(); await press('auth-google-button');
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ testID: 'auth-login-button' })).toBeDefined();
    expect(JSON.stringify(renderer.toJSON())).toContain('existing email sign-in');
  });
  it('AndroidでX capabilityを再確認してからCognito X PKCEを開始し、既存アカウントの案内を表示する', async () => {
    mocks.xCaps.data = { x_sign_in: true, x_android: true, x_ios: false };
    mocks.xCaps.refetch.mockResolvedValue({ data: mocks.xCaps.data, isError: false });
    await render();
    expect(renderer.root.findAllByProps({ testID: 'auth-x-button' })).not.toHaveLength(0);
    await press('auth-x-button');
    expect(mocks.xCaps.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.signIn).toHaveBeenCalledWith({ identityProvider: 'X', language: 'en' });
    expect(JSON.stringify(renderer.toJSON())).toContain('Already use Lyra?');
  });
  it('X capabilityが無効、確認不能、またはiOSではCTAを表示せず既存ログインを維持する', async () => {
    mocks.xCaps.data = { x_sign_in: true, x_android: true, x_ios: false };
    mocks.platform.OS = 'ios';
    await render();
    expect(renderer.root.findAllByProps({ testID: 'auth-x-button' })).toHaveLength(0);
    mocks.platform.OS = 'android';
    mocks.xCaps.data = { x_sign_in: true, x_android: false, x_ios: false };
    act(() => renderer.update(<AuthScreen />));
    expect(renderer.root.findAllByProps({ testID: 'auth-x-button' })).toHaveLength(0);
  });
});
