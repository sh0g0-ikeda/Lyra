import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { PageWorkflowSection } from '@/components/PageCreationWorkflow';
vi.mock('react-native', () => ({ View: 'view', Text: 'text', Pressable: 'button', StyleSheet: { create: <T,>(styles: T): T => styles } }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: () => null }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe('ページ工程切替の入力保持', () => {
  it('非表示工程をunmountせず読み上げから除外する', async () => {
    const mount = vi.fn(); const unmount = vi.fn();
    function Editor(): React.JSX.Element { const [text, setText] = React.useState(''); React.useEffect(() => { mount(); return unmount; }, []); return React.createElement('editor', { text, setText }); }
    let root: ReactTestRenderer;
    await act(async () => { root = create(<PageWorkflowSection active><Editor /></PageWorkflowSection>); });
    await act(async () => root!.root.findByType('editor').props.setText('未保存'));
    await act(async () => root!.update(<PageWorkflowSection active={false}><Editor /></PageWorkflowSection>));
    expect(root!.root.findByType('editor').props.text).toBe('未保存');
    expect(root!.root.findByType('view').props).toMatchObject({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants', style: { display: 'none' } });
    await act(async () => root!.update(<PageWorkflowSection active><Editor /></PageWorkflowSection>));
    expect(mount).toHaveBeenCalledOnce(); expect(unmount).not.toHaveBeenCalled();
    await act(async () => root!.unmount());
  });
});
