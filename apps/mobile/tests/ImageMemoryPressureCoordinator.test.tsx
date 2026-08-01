import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { ImageMemoryPressureCoordinator } from '@/components/ImageMemoryPressureCoordinator';

const mocks = vi.hoisted(() => ({
  addEventListener: vi.fn(),
  clearMemory: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn()
}));

vi.mock('react-native', () => ({
  AppState: { addEventListener: mocks.addEventListener }
}));

vi.mock('@/lib/authenticatedImageCache', () => ({
  clearAuthenticatedImageMemoryCache: mocks.clearMemory
}));

describe('ImageMemoryPressureCoordinator', () => {
  it('memory warningで画像memory cacheだけを解放しunmount時にlistenerを解除する', async () => {
    let listener: (() => void) | null = null;
    mocks.addEventListener.mockImplementation(
      (event: string, callback: () => void) => {
        expect(event).toBe('memoryWarning');
        listener = callback;
        return { remove: mocks.remove };
      }
    );

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<ImageMemoryPressureCoordinator />);
    });
    await act(async () => {
      listener?.();
      await Promise.resolve();
    });

    expect(mocks.clearMemory).toHaveBeenCalledOnce();
    act(() => renderer!.unmount());
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
});
