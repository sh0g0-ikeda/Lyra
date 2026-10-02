import React from 'react';
import { createRequire } from 'node:module';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'android' },
  caps: { data: { google_sign_in: false, google_linking: false, google_ios: false }, isError: false, refetch: vi.fn() },
  signIn: vi.fn(), setTokens: vi.fn()
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
require.extensions['.jpg'] = (module) => { module.exports = 1; };
vi.mock('react-native', () => ({
  Animated: { Value: class {}, timing: () => ({ start: (done: () => void) => done() }), Image: 'animated-image', View: 'animated-view' },
  Image: 'image', Linking: { openURL: vi.fn() }, Platform: mocks.platform, Pressable: 'pressable', StatusBar: 'status-bar', StyleSheet: { create: (style: unknown) => style }, Text: 'text', View: 'view'
}));
vi.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => React.createElement('screen', null, children) }));
vi.mock('@/components/Notice', () => ({ Notice: ({ message }: { message: string }) => React.createElement('notice', null, message) }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: (props: Record<string, unknown>) => React.createElement('button', props) }));
vi.mock('@/lib/auth', () => ({ signInWithCognito: mocks.signIn }));
vi.mock('@/lib/config', () => ({ isAuthConfigured: () => true }));
vi.mock('@/hooks/useGoogleAuthCapabilities', () => ({ useGoogleAuthCapabilities: () => mocks.caps }));
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
  mocks.signIn.mockResolvedValue({ idToken: 'cognito-token' });
  mocks.caps.refetch.mockResolvedValue({ data: { google_sign_in: true, google_linking: true, google_ios: false }, isError: false });
});
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.useRealTimers(); });
describe('AuthScreen Google capability gate', () => {
  it('Google disabledでも既存メールログインを保持する', async () => {
    await render();
    expect(renderer.root.findAllByProps({ testID: 'auth-google-button' })).toHaveLength(0);
    await press('auth-login-button');
    expect(mocks.signIn).toHaveBeenCalledWith(undefined);
    expect(mocks.setTokens).toHaveBeenCalledWith({ idToken: 'cognito-token' });
  });
  it('Androidでserver有効時だけGoogleCTAを表示しiOSでは表示しない', async () => {
    mocks.caps.data.google_sign_in = true;
    await render(); expect(renderer.root.findAllByProps({ testID: 'auth-google-button' })).not.toHaveLength(0);
    await press('auth-google-button'); expect(mocks.signIn).toHaveBeenCalledWith({ identityProvider: 'Google' });
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
});
