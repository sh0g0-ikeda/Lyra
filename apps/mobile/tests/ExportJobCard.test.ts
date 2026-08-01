import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { ExportJobCard } from '@/components/ExportJobCard';
import { ApiError } from '@/lib/api';
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
  job_id: 'export-job-1',
  status: 'completed' as const,
  progress: { stage: 'completed', percent: 100 },
  error: null,
  created_at: '2026-07-25T00:00:00.000Z',
  started_at: '2026-07-25T00:01:00.000Z',
  expires_at: '2026-07-25T01:00:00.000Z',
  completed_at: '2026-07-25T00:30:00.000Z',
  download_ready: true
};

describe('ExportJobCard', () => {
  it('passes a completed export job ID to the authenticated download callback only after a button press', () => {
    const onDownload = vi.fn();
    useQueryMock.mockReturnValue({ data: completedJob, error: null, isLoading: false });
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(ExportJobCard, {
          api: { getExportJob: vi.fn() } as never,
          filename: 'lyra-export.pdf',
          format: 'pdf',
          jobId: 'export-job-1',
          language: 'en',
          onDownload,
          sessionKey: 'session-a'
        })
      );
    });

    const button = renderer!.root.findByType('button');
    expect(button.children).toEqual(['Download export']);
    act(() => button.props.onClick());

    expect(onDownload).toHaveBeenCalledWith('export-job-1');
  });

  it('shows a stable safe message instead of a raw provider error for failed exports', () => {
    useQueryMock.mockReturnValue({
      data: {
        ...completedJob,
        status: 'failed',
        progress: { stage: 'failed', percent: 0 },
        error: { code: 'AWS_SIGNATURE_FAILURE', message: 'provider secret' },
        completed_at: null,
        download_ready: false
      },
      error: null,
      isLoading: false
    });
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(ExportJobCard, {
          api: { getExportJob: vi.fn() } as never,
          filename: 'lyra-export.pdf',
          format: 'pdf',
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
          api: { getExportJob: vi.fn() } as never,
          filename: 'lyra-export.pdf',
          format: 'pdf',
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

  it('does not render a stale export job when the API returns not found', () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      error: new ApiError('not found', 404, 'NOT_FOUND'),
      isError: true,
      isLoading: false
    });
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        React.createElement(ExportJobCard, {
          api: { getExportJob: vi.fn() } as never,
          filename: 'lyra-export.pdf',
          format: 'pdf',
          jobId: 'stale-export-job',
          language: 'en',
          sessionKey: 'session-a'
        })
      );
    });

    expect(renderer!.toJSON()).toBeNull();
  });
});
