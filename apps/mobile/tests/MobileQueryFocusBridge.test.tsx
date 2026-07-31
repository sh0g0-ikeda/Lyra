import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileQueryFocusBridge } from '../src/components/MobileQueryFocusBridge';

const mocks = vi.hoisted(() => ({
  addEventListener: vi.fn(),
  currentState: 'active',
  handler: null as ((state: string) => void) | null,
  remove: vi.fn(),
  setFocused: vi.fn(),
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (...args: unknown[]) => mocks.addEventListener(...args),
    get currentState(): string {
      return mocks.currentState;
    },
  },
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    focusManager: { setFocused: mocks.setFocused },
  };
});

describe('MobileQueryFocusBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentState = 'active';
    mocks.handler = null;
    mocks.addEventListener.mockImplementation((_event, handler) => {
      mocks.handler = handler;
      return { remove: mocks.remove };
    });
  });

  it('AppStateに合わせてquery pollingを停止・再開しlistenerを解放する', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<MobileQueryFocusBridge />);
    });

    expect(mocks.setFocused).toHaveBeenCalledWith(true);
    await act(async () => {
      mocks.handler?.('background');
    });
    expect(mocks.setFocused).toHaveBeenLastCalledWith(false);
    await act(async () => {
      mocks.handler?.('active');
    });
    expect(mocks.setFocused).toHaveBeenLastCalledWith(true);

    await act(async () => {
      renderer!.unmount();
    });
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
});
