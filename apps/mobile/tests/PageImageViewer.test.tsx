import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { PageImageViewer } from '@/components/PageImageViewer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  Pressable: ({
    children,
    onPress,
    ...props
  }: {
    children: React.ReactNode;
    onPress?: () => void;
  }) => React.createElement('button', { ...props, onClick: onPress }, children),
  StyleSheet: {
    absoluteFillObject: {},
    create: <T,>(styles: T): T => styles
  },
  View: 'view'
}));

vi.mock('lucide-react-native', () => ({
  Maximize2: (props: Record<string, unknown>) => React.createElement('maximize-icon', props)
}));

vi.mock('@/components/ResilientImage', () => ({
  ResilientImage: (props: Record<string, unknown>) =>
    React.createElement('resilient-image', props)
}));

describe('PageImageViewer', () => {
  it('画像候補の通知で再描画されても通知callbackを作り直さない', () => {
    const source = { uri: 'https://cdn.lyra.test/page.png' };
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PageImageViewer
          expandLabel="ページ画像を拡大"
          onExpand={vi.fn()}
          sources={[source]}
        />
      );
    });
    const firstCallback = renderer!.root.findByType('resilient-image').props
      .onSourceChange as (nextSource: typeof source) => void;

    act(() => {
      firstCallback(source);
    });

    expect(
      renderer!.root.findByType('resilient-image').props.onSourceChange
    ).toBe(firstCallback);
  });

  it('画像本体ではなく独立した拡大ボタンだけがプレビューを開く', () => {
    const onExpand = vi.fn();
    const source = { uri: 'https://cdn.lyra.test/page.png' };
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PageImageViewer
          expandLabel="ページ画像を拡大"
          onExpand={onExpand}
          sources={[source]}
        />
      );
    });

    expect(renderer!.root.findByType('resilient-image').props.onPress).toBeUndefined();
    expect(onExpand).not.toHaveBeenCalled();

    act(() => {
      renderer!.root.findByProps({ accessibilityLabel: 'ページ画像を拡大' }).props.onPress();
    });

    expect(onExpand).toHaveBeenCalledWith(source);
  });

  it('同じURLでも認証headerが更新されたら新しいsourceを拡大に使う', () => {
    const onExpand = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <PageImageViewer
          expandLabel="ページ画像を拡大"
          onExpand={onExpand}
          sources={[
            {
              uri: 'https://api.lyra.test/api/pages/page-1/export-image',
              headers: { Authorization: 'Bearer old-token' }
            }
          ]}
        />
      );
    });

    act(() => {
      renderer!.update(
        <PageImageViewer
          expandLabel="ページ画像を拡大"
          onExpand={onExpand}
          sources={[
            {
              uri: 'https://api.lyra.test/api/pages/page-1/export-image',
              headers: { Authorization: 'Bearer new-token' }
            }
          ]}
        />
      );
    });
    act(() => {
      renderer!.root.findByProps({ accessibilityLabel: 'ページ画像を拡大' }).props.onPress();
    });

    expect(onExpand).toHaveBeenLastCalledWith({
      uri: 'https://api.lyra.test/api/pages/page-1/export-image',
      headers: { Authorization: 'Bearer new-token' }
    });
  });
});
