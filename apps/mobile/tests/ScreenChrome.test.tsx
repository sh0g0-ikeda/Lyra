import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbeddedScreenProvider, Screen } from '@/components/Screen';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({
  language: 'ja' as 'ja' | 'en',
  session: { user: { id: 'user' } } as { user: { id: string } } | null,
  setLanguage: vi.fn()
}));
vi.mock('react-native', () => ({
  KeyboardAvoidingView: 'keyboard', ScrollView: 'scroll', StatusBar: 'status',
  Pressable: 'button', Text: 'text', View: 'view', RefreshControl: 'refresh',
  Platform: { OS: 'android' }, StyleSheet: { create: <T,>(value: T): T => value }
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'safe-area' }));
vi.mock('@/components/CreditBalanceBadge', () => ({ CreditBalanceBadge: () => React.createElement('credit-badge') }));
vi.mock('@/components/Notice', () => ({ Notice: 'notice' }));
vi.mock('@/state/appState', () => ({ useOptionalAppState: () => ({ session: mocks.session }) }));
vi.mock('@/state/networkStatus', () => ({ useNetworkStatus: () => ({ language: mocks.language, online: true, setLanguage: mocks.setLanguage }) }));

// Unified Spec Mobile navigation: the workflow owns safe-area/navigation chrome;
// its embedded editors keep keyboard handling and content, without a second badge.
// The signed-in default must not expose billing chrome outside Manga; Manga opts into
// language chrome explicitly so pre-auth and home language selection stay available.
describe('制作工程内の画面領域', () => {
  beforeEach(() => {
    mocks.language = 'ja';
    mocks.session = { user: { id: 'user' } };
    mocks.setLanguage.mockReset();
  });
  it.each([true, false])('埋め込み=%sの場合に制作工程だけ残高と二重safe-areaを省く', async (embedded) => {
    let renderer: ReturnType<typeof create>;
    const content = <Screen title="編集"><React.Fragment>入力内容</React.Fragment></Screen>;
    await act(async () => { renderer = create(embedded ? <EmbeddedScreenProvider>{content}</EmbeddedScreenProvider> : content); });
    expect(renderer!.root.findAllByType('credit-badge')).toHaveLength(0);
    expect(renderer!.root.findByType('safe-area').props.edges).toEqual(embedded ? [] : ['top', 'bottom', 'left', 'right']);
    expect(renderer!.root.findByType('keyboard').props.behavior).toBe('height');
    expect(renderer!.root.findByType('scroll').props.keyboardShouldPersistTaps).toBe('handled');
    await act(async () => renderer!.unmount());
  });

  it('language chromeはログイン後も日英切替を表示し、それ以外のchromeは表示しない', async () => {
    let renderer: ReturnType<typeof create>;
    await act(async () => { renderer = create(<Screen chrome="language" title="漫画" />); });
    const english = renderer!.root.findByProps({ accessibilityLabel: 'English' });
    expect(english.findByType('text').children).toEqual(['English']);
    expect(renderer!.root.findAllByType('credit-badge')).toHaveLength(0);
    await act(async () => renderer!.unmount());
  });

  it('ゲストのautoと言語chromeは日英選択を反映し、ログイン後auto・none・embeddedは隠す', async () => {
    mocks.session = null;
    mocks.setLanguage.mockImplementation((language: 'ja' | 'en') => { mocks.language = language; });
    let renderer: ReturnType<typeof create>;
    await act(async () => { renderer = create(<Screen title="ログイン" />); });
    const english = renderer!.root.findByProps({ accessibilityLabel: 'English' });
    const japanese = renderer!.root.findByProps({ accessibilityLabel: '日本語' });
    expect(english.props.accessibilityState).toEqual({ checked: false });
    expect(japanese.props.accessibilityState).toEqual({ checked: true });
    await act(async () => english.props.onPress());
    expect(mocks.setLanguage).toHaveBeenCalledWith('en');
    await act(async () => renderer!.update(<Screen title="ログイン" />));
    expect(renderer!.root.findByProps({ accessibilityLabel: 'English' }).props.accessibilityState).toEqual({ checked: true });
    await act(async () => renderer!.root.findByProps({ accessibilityLabel: '日本語' }).props.onPress());
    expect(mocks.setLanguage).toHaveBeenLastCalledWith('ja');

    mocks.session = { user: { id: 'user' } };
    await act(async () => renderer!.update(<Screen title="アカウント" />));
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'English' })).toHaveLength(0);
    await act(async () => renderer!.update(<Screen chrome="none" title="アカウント" />));
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'English' })).toHaveLength(0);
    await act(async () => renderer!.update(<EmbeddedScreenProvider><Screen chrome="language" title="編集" /></EmbeddedScreenProvider>));
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'English' })).toHaveLength(0);
    await act(async () => renderer!.unmount());
  });
});
