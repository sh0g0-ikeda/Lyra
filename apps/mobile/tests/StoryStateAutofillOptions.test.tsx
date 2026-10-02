import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoryStateAutofillOptions } from '@/components/StoryStateAutofillOptions';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({ Pressable: 'button', Text: 'text', View: 'view', StyleSheet: { create: <T,>(styles: T): T => styles } }));
let root: ReactTestRenderer | undefined;
afterEach(async () => { await act(async () => root?.unmount()); });
describe('状態自動入力のopt-in操作', () => {
  it('能力がOFFなら新AI操作を表示しない', async () => {
    await act(async () => { root = create(<StoryStateAutofillOptions available={false} disabled={false} language="ja" value={{ enabled: true, overwrite: true }} onChange={vi.fn()} />); });
    expect(root?.toJSON()).toBeNull();
  });
  it('明示enableは必ず保護設定で始まり上書きは別の明示操作になる', async () => {
    const change = vi.fn();
    await act(async () => { root = create(<StoryStateAutofillOptions available disabled={false} language="ja" value={{ enabled: false, overwrite: true }} onChange={change} />); });
    await act(async () => root?.root.findByType('button').props.onPress());
    expect(change).toHaveBeenCalledWith({ enabled: true, overwrite: false });
    await act(async () => { root?.update(<StoryStateAutofillOptions available disabled={false} language="ja" value={{ enabled: true, overwrite: false }} onChange={change} />); });
    await act(async () => root?.root.findByProps({ testID: 'state-autofill-overwrite' }).props.onPress());
    expect(change).toHaveBeenLastCalledWith({ enabled: true, overwrite: true });
  });
  it('viewerや進行中jobでは全操作を無効にする', async () => {
    await act(async () => { root = create(<StoryStateAutofillOptions available disabled language="en" value={{ enabled: true, overwrite: false }} onChange={vi.fn()} />); });
    expect(root?.root.findAllByType('button').every((button) => button.props.disabled)).toBe(true);
  });
});
