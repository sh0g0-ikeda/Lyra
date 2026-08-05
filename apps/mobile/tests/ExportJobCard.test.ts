import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { ExportJobCard } from '@/components/ExportJobCard';
import { MobileFileTransferError } from '@/lib/fileTransferError';

const { useQueryMock } = vi.hoisted(() => ({ useQueryMock: vi.fn() }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View'
}));

vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
    React.createElement('button', { onClick: onPress }, label)
}));

const completedJob = {
  id: 'export-job-1',
  episode_id: 'episode-1',
  format: 'pdf' as const,
  filename: 'lyra-export.pdf',
  status: 'completed' as const,
  progress_stage: 'completed',
  progress_percent: 100,
  error_code: null,
  message_key: null,
  expires_at: '2026-07-25T01:00:00.000Z',
  completed_at: '2026-07-25T00:30:00.000Z',
  cancel_supported: false as const,
  cancel_reason_code: null,
  download_url: 'https://downloads.example.test/lyra-export.pdf?signature=safe'
};

describe('ExportJobCard', () => {
  it('保存ボタン押下時に最新の短命URLを再取得してから保存処理へ渡す', async () => {
    const onDownload = vi.fn();
    const refreshedJob = {
      ...completedJob,
      download_url: 'https://downloads.example.test/lyra-export.pdf?signature=fresh'
    };
    const getExportJob = vi.fn().mockResolvedValue(refreshedJob);
    useQueryMock.mockReturnValue({ data: completedJob, error: null, isLoading: false });
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(ExportJobCard, {
          api: { getExportJob } as never,
          jobId: 'export-job-1',
          language: 'en',
          onDownload,
          sessionKey: 'session-a'
        })
      );
    });

    const button = renderer!.root.findByType('button');
    expect(button.children).toEqual(['Download export']);
    await act(async () => {
      await button.props.onClick();
    });

    expect(getExportJob).toHaveBeenCalledWith('export-job-1', null);
    expect(onDownload).toHaveBeenCalledWith(refreshedJob.download_url, refreshedJob);
  });

  it('カード内のURLが欠けていても完了済みジョブは保存時に最新URLを取得できる', async () => {
    const completedWithoutUrl = { ...completedJob, download_url: undefined };
    const getExportJob = vi.fn().mockResolvedValue(completedJob);
    const onDownload = vi.fn();
    useQueryMock.mockReturnValue({ data: completedWithoutUrl, error: null, isLoading: false });
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(ExportJobCard, {
          api: { getExportJob } as never,
          jobId: 'export-job-1',
          language: 'ja',
          onDownload,
          sessionKey: 'session-a'
        })
      );
    });

    const button = renderer!.root.findByType('button');
    await act(async () => {
      await button.props.onClick();
    });

    expect(onDownload).toHaveBeenCalledWith(completedJob.download_url, completedJob);
  });

  it('shows a stable safe message instead of a raw provider error for failed exports', () => {
    useQueryMock.mockReturnValue({
      data: {
        ...completedJob,
        status: 'failed',
        progress_stage: 'failed',
        progress_percent: 0,
        error_code: 'AWS_SIGNATURE_FAILURE',
        message_key: 'export.error.failed',
        completed_at: null,
        download_url: undefined
      },
      error: null,
      isLoading: false
    });
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(ExportJobCard, {
          api: { getExportJob: vi.fn() } as never,
          jobId: 'export-job-1',
          language: 'en',
          sessionKey: 'session-a'
        })
      );
    });
    const rendered = JSON.stringify(renderer!.toJSON());

    expect(rendered).toContain('Export failed. Try again shortly.');
    expect(rendered).not.toContain('AWS_SIGNATURE_FAILURE');
    expect(rendered).not.toContain('https://downloads.example.test/lyra-export.pdf?signature=safe');
  });

  it('shows a safe actionable download error without exposing the thrown error', async () => {
    const onDownload = vi.fn().mockRejectedValue(new MobileFileTransferError('NETWORK_UNAVAILABLE'));
    useQueryMock.mockReturnValue({ data: completedJob, error: null, isLoading: false });
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(ExportJobCard, {
          api: { getExportJob: vi.fn().mockResolvedValue(completedJob) } as never,
          jobId: 'export-job-1',
          language: 'en',
          onDownload,
          sessionKey: 'session-a'
        })
      );
    });

    const button = renderer!.root.findByType('button');
    await act(async () => {
      await button.props.onClick();
    });

    const rendered = JSON.stringify(renderer!.toJSON());
    expect(rendered).toContain('The network connection is unavailable. Check your connection and try again.');
    expect(rendered).not.toContain('NETWORK_UNAVAILABLE');
  });
});
