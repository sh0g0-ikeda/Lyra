import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { ResilientImage } from '@/components/ResilientImage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => React.createElement('expo-image', props)
}));

describe('ResilientImage', () => {
  it('CDN画像の失敗後に認証付き画像へ切り替える', () => {
    const onSourceChange = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <ResilientImage
          contentFit="contain"
          onSourceChange={onSourceChange}
          sources={[
            { uri: 'https://cdn.lyra.test/page.png' },
            {
              uri: 'https://api.lyra.test/api/pages/page-1/export-image',
              headers: { Authorization: 'Bearer token' }
            }
          ]}
          style={{ height: 100, width: 100 }}
        />
      );
    });

    expect(renderer!.root.findByType('expo-image').props.source).toEqual({
      uri: 'https://cdn.lyra.test/page.png'
    });

    act(() => {
      renderer!.root.findByType('expo-image').props.onError();
    });

    expect(renderer!.root.findByType('expo-image').props.source).toEqual({
      uri: 'https://api.lyra.test/api/pages/page-1/export-image',
      headers: { Authorization: 'Bearer token' }
    });
    expect(onSourceChange).toHaveBeenLastCalledWith({
      uri: 'https://api.lyra.test/api/pages/page-1/export-image',
      headers: { Authorization: 'Bearer token' }
    });
  });

  it('全候補の失敗後だけ読込失敗を通知する', () => {
    const onExhausted = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <ResilientImage
          onExhausted={onExhausted}
          sources={[
            { uri: 'https://cdn.lyra.test/page.png' },
            { uri: 'https://api.lyra.test/api/pages/page-1/thumbnail' }
          ]}
          style={{ height: 100, width: 100 }}
        />
      );
    });

    act(() => {
      renderer!.root.findByType('expo-image').props.onError();
    });
    expect(onExhausted).not.toHaveBeenCalled();

    act(() => {
      renderer!.root.findByType('expo-image').props.onError();
    });
    expect(onExhausted).toHaveBeenCalledOnce();
  });
});
