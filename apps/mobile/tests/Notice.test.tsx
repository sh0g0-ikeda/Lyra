import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { Notice } from '@/components/Notice';

vi.mock('react-native', () => ({
  Pressable: 'pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

describe('Notice', () => {
  it('renders a labelled recovery command when both label and handler are present', async () => {
    const onAction = vi.fn();
    let tree: ReturnType<typeof create> | null = null;

    await act(async () => {
      tree = create(
        <Notice
          actionLabel="Retry"
          actionTestID="notice-retry"
          message="Unable to connect."
          onAction={onAction}
          tone="danger"
        />
      );
    });

    const action = tree!.root.findByType('pressable');
    expect(action.props.accessibilityRole).toBe('button');
    expect(action.props.accessibilityLabel).toBe('Retry');
    expect(action.props.testID).toBe('notice-retry');

    await act(async () => {
      action.props.onPress();
    });
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('does not render a dead command when a handler is absent', async () => {
    let tree: ReturnType<typeof create> | null = null;

    await act(async () => {
      tree = create(<Notice actionLabel="Retry" message="Unable to connect." />);
    });

    expect(tree!.root.findAllByType('pressable')).toHaveLength(0);
  });

  it('renders danger messages with the review-safe warning palette', async () => {
    let tree: ReturnType<typeof create> | null = null;

    await act(async () => {
      tree = create(<Notice message="Unable to connect." tone="danger" />);
    });

    const container = tree!.root.findByType('view');
    const message = tree!.root.findByType('text');
    expect(JSON.stringify(container.props.style)).not.toContain('244, 67, 54');
    expect(JSON.stringify(message.props.style)).not.toContain('FF9E96');
  });
});
