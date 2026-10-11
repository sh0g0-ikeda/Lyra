import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { EmbeddedScreenProvider, Screen } from '@/components/Screen';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({
  KeyboardAvoidingView: 'keyboard', ScrollView: 'scroll', StatusBar: 'status',
  Pressable: 'button', Text: 'text', View: 'view', RefreshControl: 'refresh',
  Platform: { OS: 'android' }, StyleSheet: { create: <T,>(value: T): T => value }
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'safe-area' }));
vi.mock('@/components/CreditBalanceBadge', () => ({ CreditBalanceBadge: () => React.createElement('credit-badge') }));
vi.mock('@/components/Notice', () => ({ Notice: 'notice' }));
vi.mock('@/state/appState', () => ({ useOptionalAppState: () => ({ session: { user: { id: 'user' } } }) }));
vi.mock('@/state/networkStatus', () => ({ useNetworkStatus: () => ({ language: 'ja', online: true, setLanguage: vi.fn() }) }));

// Unified Spec Mobile navigation: the workflow owns safe-area/navigation chrome;
// its embedded editors keep keyboard handling and content, without a second badge.
describe('制作工程内の画面領域', () => {
  it.each([true, false])('埋め込み=%sの場合に制作工程だけ残高と二重safe-areaを省く', async (embedded) => {
    let renderer: ReturnType<typeof create>;
    const content = <Screen title="編集"><React.Fragment>入力内容</React.Fragment></Screen>;
    await act(async () => { renderer = create(embedded ? <EmbeddedScreenProvider>{content}</EmbeddedScreenProvider> : content); });
    expect(renderer!.root.findAllByType('credit-badge')).toHaveLength(embedded ? 0 : 1);
    expect(renderer!.root.findByType('safe-area').props.edges).toEqual(embedded ? [] : ['top', 'bottom']);
    expect(renderer!.root.findByType('keyboard').props.behavior).toBe('height');
    expect(renderer!.root.findByType('scroll').props.keyboardShouldPersistTaps).toBe('handled');
    await act(async () => renderer!.unmount());
  });
});
