import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResilientAuthenticatedImage } from '../src/components/ResilientAuthenticatedImage';

vi.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => React.createElement('expo-image', props),
}));

const publicSource = { uri: 'https://cdn.example.com/image.png' };
const protectedSource = {
  uri: 'https://api.example.com/api/entities/entity-1/reference/ref-1/image',
  cacheKey: 'private-reference:user-1:personal:entity-1:ref-1:revision-1',
  headers: { Authorization: 'Bearer old-token' },
};

describe('ResilientAuthenticatedImage', () => {
  const refreshProtectedSource = vi.fn().mockResolvedValue({
    ...protectedSource,
    cacheKey: `${protectedSource.cacheKey}:refresh-1`,
    headers: { Authorization: 'Bearer new-token' },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function renderImage(
    overrides: Partial<React.ComponentProps<typeof ResilientAuthenticatedImage>> = {},
  ): Promise<ReactTestRenderer> {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ResilientAuthenticatedImage
          accessibilityLabel="ホームズの参照画像"
          identity="reference-1"
          onExhausted={vi.fn()}
          protectedSource={protectedSource}
          publicSource={publicSource}
          refreshProtectedSource={refreshProtectedSource}
          style={{ width: 100 }}
          {...overrides}
        />,
      );
    });
    return renderer!;
  }

  it('署名URLの失敗後だけ認証付きsourceへ切り替える', async () => {
    const renderer = await renderImage();
    expect(renderer.root.findByType('expo-image').props.source).toEqual(publicSource);

    await act(async () => {
      renderer.root.findByType('expo-image').props.onError();
    });

    expect(renderer.root.findByType('expo-image').props.source).toEqual(protectedSource);
    expect(refreshProtectedSource).not.toHaveBeenCalled();
  });

  it('protected source失敗時だけ認証更新を1回行い新tokenで1回再試行する', async () => {
    const onExhausted = vi.fn();
    const renderer = await renderImage({ publicSource: null, onExhausted });

    await act(async () => {
      renderer.root.findByType('expo-image').props.onError();
      await Promise.resolve();
    });

    expect(refreshProtectedSource).toHaveBeenCalledOnce();
    expect(renderer.root.findByType('expo-image').props.source).toEqual(expect.objectContaining({
      headers: { Authorization: 'Bearer new-token' },
    }));

    await act(async () => {
      renderer.root.findByType('expo-image').props.onError();
    });
    expect(refreshProtectedSource).toHaveBeenCalledOnce();
    expect(onExhausted).toHaveBeenCalledOnce();
  });

  it('protected errorが連続しても同じ画像の認証更新を多重実行しない', async () => {
    let resolveRefresh: ((source: typeof protectedSource) => void) | undefined;
    const refresh = vi.fn().mockReturnValue(new Promise<typeof protectedSource>((resolve) => {
      resolveRefresh = resolve;
    }));
    const renderer = await renderImage({
      publicSource: null,
      refreshProtectedSource: refresh,
    });
    const onError = renderer.root.findByType('expo-image').props.onError;

    await act(async () => {
      onError();
      onError();
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledOnce();

    await act(async () => {
      resolveRefresh?.({
        ...protectedSource,
        headers: { Authorization: 'Bearer refreshed-token' },
      });
      await Promise.resolve();
    });
  });

  it('認証更新失敗はraw errorを投げず安定したexhaustedへ移る', async () => {
    const onExhausted = vi.fn();
    const renderer = await renderImage({
      publicSource: null,
      onExhausted,
      refreshProtectedSource: vi.fn().mockRejectedValue(new Error('refresh secret')),
    });

    await act(async () => {
      renderer.root.findByType('expo-image').props.onError();
      await Promise.resolve();
    });

    expect(onExhausted).toHaveBeenCalledOnce();
    expect(renderer.root.findAllByType('expo-image')).toHaveLength(0);
  });

  it('identity切替時は古いexhausted状態を再利用しない', async () => {
    const onExhausted = vi.fn();
    const renderer = await renderImage({
      publicSource: null,
      onExhausted,
      refreshProtectedSource: vi.fn().mockRejectedValue(new Error('failed')),
    });
    await act(async () => {
      renderer.root.findByType('expo-image').props.onError();
      await Promise.resolve();
    });
    expect(renderer.root.findAllByType('expo-image')).toHaveLength(0);

    await act(async () => {
      renderer.update(
        <ResilientAuthenticatedImage
          accessibilityLabel="ワトスンの参照画像"
          identity="reference-2"
          onExhausted={onExhausted}
          protectedSource={{ ...protectedSource, uri: `${protectedSource.uri}-2` }}
          publicSource={null}
          refreshProtectedSource={refreshProtectedSource}
          style={{ width: 100 }}
        />,
      );
    });

    expect(renderer.root.findByType('expo-image').props.source.uri).toContain('-2');
  });
});
