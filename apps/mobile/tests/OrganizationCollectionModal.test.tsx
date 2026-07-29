import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { OrganizationCollectionModal } from '@/components/OrganizationCollectionModal';

vi.mock('react-native', () => ({
  AccessibilityInfo: { setAccessibilityFocus: vi.fn() },
  ActivityIndicator: 'activity-indicator',
  findNodeHandle: () => null,
  FlatList: ({
    data,
    renderItem,
    ...props
  }: {
    data: { id: string }[];
    renderItem: (input: { item: { id: string }; index: number }) => React.ReactNode;
  }) => React.createElement(
    'flat-list',
    props,
    data.map((item, index) => renderItem({ item, index }))
  ),
  Modal: ({
    children,
    visible,
    ...props
  }: {
    children: React.ReactNode;
    visible: boolean;
  }) => visible ? React.createElement('modal', props, children) : null,
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) =>
    React.createElement('safe-area', null, children)
}));

vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({
    label,
    onPress
  }: {
    label: string;
    onPress: () => void;
  }) => React.createElement('button', { onClick: onPress }, label)
}));

describe('OrganizationCollectionModal', () => {
  it('閉じている間は大量一覧を mount しない', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <OrganizationCollectionModal
          data={[{ id: 'member-1' }]}
          emptyLabel="メンバーはいません。"
          fetchingNextPage={false}
          hasNextPage={false}
          onClose={vi.fn()}
          onEndReached={vi.fn()}
          renderItem={({ item }) => React.createElement('row', { id: item.id })}
          title="メンバー"
          visible={false}
        />
      );
    });

    expect(renderer!.root.findAllByType('flat-list')).toHaveLength(0);
  });

  it('独立した FlatList の末尾到達時に次ページを一度取得する', () => {
    const onEndReached = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <OrganizationCollectionModal
          data={[{ id: 'member-1' }]}
          emptyLabel="メンバーはいません。"
          fetchingNextPage={false}
          hasNextPage
          onClose={vi.fn()}
          onEndReached={onEndReached}
          renderItem={({ item }) => React.createElement('row', { id: item.id })}
          title="メンバー"
          visible
        />
      );
    });

    const list = renderer!.root.findByType('flat-list');
    act(() => list.props.onEndReached());
    expect(onEndReached).toHaveBeenCalledOnce();
  });

  it('次ページ取得中は末尾イベントを重複送信しない', () => {
    const onEndReached = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <OrganizationCollectionModal
          data={[{ id: 'member-1' }]}
          emptyLabel="メンバーはいません。"
          fetchingNextPage
          hasNextPage
          onClose={vi.fn()}
          onEndReached={onEndReached}
          renderItem={({ item }) => React.createElement('row', { id: item.id })}
          title="メンバー"
          visible
        />
      );
    });

    act(() => renderer!.root.findByType('flat-list').props.onEndReached());
    expect(onEndReached).not.toHaveBeenCalled();
  });
});
