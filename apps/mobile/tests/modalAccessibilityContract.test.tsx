import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { OrganizationCollectionModal } from '@/components/OrganizationCollectionModal';
import { OrganizationManagementModal } from '@/components/OrganizationManagementModal';
import { PanelOrderList } from '@/components/PanelOrderList';
import type { PanelRecord } from '@/domain/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { findNodeHandle, setAccessibilityFocus } = vi.hoisted(() => ({
  findNodeHandle: vi.fn(() => 73),
  setAccessibilityFocus: vi.fn()
}));

vi.mock('react-native', () => {
  const Pressable = React.forwardRef<
    unknown,
    {
      children?: React.ReactNode;
      onPress?: () => void;
      [key: string]: unknown;
    }
  >(function MockPressable({ children, onPress, ...props }, ref) {
    React.useImperativeHandle(ref, () => ({}), []);
    return React.createElement('pressable', { ...props, onPress }, children);
  });

  return {
    AccessibilityInfo: { setAccessibilityFocus },
    ActivityIndicator: 'activity-indicator',
    findNodeHandle,
    FlatList: ({ data, renderItem, ...props }: {
      data: { id: string }[];
      renderItem: (input: { item: { id: string }; index: number }) => React.ReactNode;
    }) => React.createElement('flat-list', props, data.map((item, index) => renderItem({ item, index }))),
    Modal: ({ children, visible, ...props }: { children: React.ReactNode; visible: boolean }) =>
      visible ? React.createElement('modal', props, children) : null,
    Pressable,
    ScrollView: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) =>
      React.createElement('scroll-view', props, children),
    StyleSheet: { create: <T,>(styles: T): T => styles, hairlineWidth: 1 },
    Text: 'text',
    View: 'view'
  };
});

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) =>
    React.createElement('safe-area', props, children)
}));

vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
    React.createElement('primary-button', { accessibilityLabel: label, onPress }, label)
}));

vi.mock('@/components/Screen', () => ({
  Screen: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) =>
    React.createElement('screen', props, children)
}));

vi.mock('lucide-react-native', () => {
  const icon = (name: string) => {
    function MockIcon(props: Record<string, unknown>): React.JSX.Element {
      return React.createElement(name, props);
    }
    MockIcon.displayName = `MockIcon(${name})`;
    return MockIcon;
  };
  return {
    ArrowDown: icon('arrow-down'),
    ArrowUp: icon('arrow-up'),
    Check: icon('check'),
    MoreHorizontal: icon('more-horizontal'),
    Pencil: icon('pencil'),
    Trash2: icon('trash'),
    X: icon('x')
  };
});

const panel: PanelRecord = {
  background_note: null,
  composition: {
    angle: null,
    composition_prompt: null,
    custom_note: null,
    gallery_item_id: null,
    shot_type: null,
    source: 'ai_auto'
  },
  created_at: '2026-07-01T00:00:00.000Z',
  dialogue: [],
  dialogue_in_panel: true,
  entities: [],
  id: 'panel-1',
  order: 1,
  page_id: 'page-1',
  panel_notes: null,
  panel_role: 'establish',
  panel_size: 'standard',
  sfx_text: null,
  situation_text: 'Opening scene',
  updated_at: '2026-07-01T00:00:00.000Z'
};

describe('mobile modal accessibility contract', () => {
  it('organization collection modal traps accessibility focus, closes on escape, and restores an available trigger', () => {
    const onClose = vi.fn();
    const restoreFocusRef = { current: {} as never };
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <OrganizationCollectionModal
          data={[{ id: 'member-1' }]}
          emptyLabel="No members"
          fetchingNextPage={false}
          hasNextPage={false}
          language="en"
          onClose={onClose}
          onEndReached={vi.fn()}
          renderItem={({ item }) => React.createElement('member', { id: item.id })}
          restoreFocusRef={restoreFocusRef}
          title="Members"
          visible
        />
      );
    });

    const boundary = renderer!.root.findByProps({ accessibilityViewIsModal: true });
    act(() => boundary.props.onAccessibilityEscape());
    expect(onClose).toHaveBeenCalledOnce();

    act(() => {
      renderer!.update(
        <OrganizationCollectionModal
          data={[{ id: 'member-1' }]}
          emptyLabel="No members"
          fetchingNextPage={false}
          hasNextPage={false}
          language="en"
          onClose={onClose}
          onEndReached={vi.fn()}
          renderItem={({ item }) => React.createElement('member', { id: item.id })}
          restoreFocusRef={restoreFocusRef}
          title="Members"
          visible={false}
        />
      );
    });

    expect(findNodeHandle).toHaveBeenCalledWith(restoreFocusRef.current);
    expect(setAccessibilityFocus).toHaveBeenCalledWith(73);
  });

  it('organization management modal traps accessibility focus, closes on escape, and restores an available trigger', () => {
    const onClose = vi.fn();
    const restoreFocusRef = { current: {} as never };
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <OrganizationManagementModal language="en" onClose={onClose} restoreFocusRef={restoreFocusRef} visible>
          <organization-management />
        </OrganizationManagementModal>
      );
    });

    const boundary = renderer!.root.findByProps({ accessibilityViewIsModal: true });
    act(() => boundary.props.onAccessibilityEscape());
    expect(onClose).toHaveBeenCalledOnce();

    act(() => {
      renderer!.update(
        <OrganizationManagementModal language="en" onClose={onClose} restoreFocusRef={restoreFocusRef} visible={false}>
          <organization-management />
        </OrganizationManagementModal>
      );
    });

    expect(findNodeHandle).toHaveBeenCalledWith(restoreFocusRef.current);
    expect(setAccessibilityFocus).toHaveBeenCalledWith(73);
  });

  it('panel action sheet traps focus, closes on escape, restores the action trigger, and keeps the close target at 44pt', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PanelOrderList
          language="en"
          onChangeRole={vi.fn()}
          onDelete={vi.fn()}
          onMove={vi.fn()}
          onSelect={vi.fn()}
          panels={[panel]}
          selectedPanelId={null}
        />
      );
    });

    const menuTrigger = renderer!.root
      .findAllByType('pressable')
      .find((candidate) => candidate.props.style?.width === 48);
    expect(menuTrigger).toBeDefined();
    act(() => menuTrigger!.props.onPress());

    const boundary = renderer!.root.findByProps({ accessibilityViewIsModal: true });
    const closeButton = renderer!.root
      .findAllByType('pressable')
      .find((candidate) => candidate.props.style?.height === 44 && candidate.props.style?.width === 44);
    expect(closeButton?.props.style.height).toBeGreaterThanOrEqual(44);
    expect(closeButton?.props.style.width).toBeGreaterThanOrEqual(44);

    act(() => boundary.props.onAccessibilityEscape());
    expect(setAccessibilityFocus).toHaveBeenCalledWith(73);
  });
});
