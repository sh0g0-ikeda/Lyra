import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { ActionableErrorNotice } from '@/components/ActionableErrorNotice';
import { ApiError } from '@/lib/api';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('@/components/Notice', () => ({
  Notice: (props: Record<string, unknown>) => React.createElement('notice', props)
}));

describe('ActionableErrorNotice', () => {
  it('renders only the recovery command supplied by the screen', async () => {
    const onCredits = vi.fn();
    let tree: ReturnType<typeof create> | null = null;

    await act(async () => {
      tree = create(
        <ActionableErrorNotice
          actions={{ credits: onCredits }}
          error={new ApiError('provider detail', 402, 'INSUFFICIENT_CREDITS')}
          language="en"
        />
      );
    });

    const notice = tree!.root.findByType('notice');
    expect(notice.props.message).toBe('Credit balance is insufficient. Review the required amount and your balance.');
    expect(notice.props.actionLabel).toBe('Review credits');
    expect(notice.props.onAction).toBe(onCredits);
  });

  it('keeps an unknown error generic and does not invent a navigation action', async () => {
    let tree: ReturnType<typeof create> | null = null;

    await act(async () => {
      tree = create(
        <ActionableErrorNotice
          actions={{ jobs: vi.fn(), retry: vi.fn() }}
          error={new Error('https://attacker.example/jobs')}
          language="en"
        />
      );
    });

    const notice = tree!.root.findByType('notice');
    expect(notice.props.actionLabel).toBeUndefined();
    expect(notice.props.onAction).toBeUndefined();
    expect(notice.props.message).not.toContain('attacker.example');
  });

  it('accepts a bounded local blocker target without deriving it from raw text', async () => {
    const onLayout = vi.fn();
    let tree: ReturnType<typeof create> | null = null;

    await act(async () => {
      tree = create(
        <ActionableErrorNotice
          actions={{ layout: onLayout }}
          error={new ApiError('raw validation detail', 422, 'VALIDATION_ERROR')}
          language="ja"
          target="layout"
        />
      );
    });

    const notice = tree!.root.findByType('notice');
    expect(notice.props.actionLabel).toBe('コマ割りを確認');
    expect(notice.props.onAction).toBe(onLayout);
  });
});
