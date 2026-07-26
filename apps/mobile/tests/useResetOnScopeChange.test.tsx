import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { useResetOnScopeChange } from '@/hooks/useResetOnScopeChange';

function Probe({
  reset,
  scope
}: {
  reset: () => void;
  scope: string;
}): React.JSX.Element {
  useResetOnScopeChange(scope, [reset]);
  return React.createElement('probe');
}

describe('useResetOnScopeChange', () => {
  it('同じscopeの再描画ではresetせずscope変更時だけ最新resetを実行する', async () => {
    const firstReset = vi.fn();
    const secondReset = vi.fn();
    let renderer: ReactTestRenderer | null = null;

    await act(async () => {
      renderer = create(<Probe reset={firstReset} scope="page-a" />);
    });
    await act(async () => {
      renderer?.update(<Probe reset={secondReset} scope="page-a" />);
    });

    expect(firstReset).not.toHaveBeenCalled();
    expect(secondReset).not.toHaveBeenCalled();

    await act(async () => {
      renderer?.update(<Probe reset={secondReset} scope="page-b" />);
    });

    expect(firstReset).not.toHaveBeenCalled();
    expect(secondReset).toHaveBeenCalledOnce();
  });
});
