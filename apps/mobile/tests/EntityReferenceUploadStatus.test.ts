import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { EntityReferenceUploadStatus } from '@/components/EntityReferenceUploadStatus';
import { DirectEntityUploadError } from '@/lib/directEntityReferenceUpload';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View'
}));

vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
    React.createElement('button', { onClick: onPress }, label)
}));

describe('EntityReferenceUploadStatus', () => {
  it('upload中は進捗とcancel actionを表示する', () => {
    const onCancel = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(EntityReferenceUploadStatus, {
          error: null,
          isPending: true,
          language: 'ja',
          onCancel,
          onRetry: vi.fn(),
          progress: 42,
          stage: 'upload'
        })
      );
    });
    const rendered = JSON.stringify(renderer!.toJSON());
    const button = renderer!.root.findByType('button');

    expect(rendered).toContain('画像をアップロード中');
    expect(rendered).toContain('42%');
    expect(button.children).toEqual(['アップロードを中止']);
    act(() => button.props.onClick());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('retryable failureだけに再試行actionを表示する', () => {
    const onRetry = vi.fn();
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(EntityReferenceUploadStatus, {
          error: new DirectEntityUploadError('UPLOAD_FAILED', 'upload', true, 'safe'),
          isPending: false,
          language: 'ja',
          onCancel: vi.fn(),
          onRetry,
          progress: 30,
          stage: 'upload'
        })
      );
    });
    const button = renderer!.root.findByType('button');
    const rendered = JSON.stringify(renderer!.toJSON());

    expect(rendered).toContain('通信状態を確認して再試行してください');
    expect(button.children).toEqual(['アップロードを再試行']);
    act(() => button.props.onClick());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
