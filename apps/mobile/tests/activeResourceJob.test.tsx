import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { useActiveResourceJobId } from '@/hooks/useActiveResourceJobId';

const {
  addEventListenerMock,
  refetchMock,
  useFocusEffectMock,
  useQueryMock,
} = vi.hoisted(() => ({
  addEventListenerMock: vi.fn(),
  refetchMock: vi.fn().mockResolvedValue(undefined),
  useFocusEffectMock: vi.fn(),
  useQueryMock: vi.fn(),
}));

vi.mock('@react-navigation/native', () => ({
  useFocusEffect: useFocusEffectMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: addEventListenerMock,
  },
}));

interface ProbeProps {
  api: {
    listJobs: ReturnType<typeof vi.fn>;
  };
}

function Probe({ api }: ProbeProps): React.JSX.Element {
  const jobId = useActiveResourceJobId({
    api: api as never,
    jobTypes: ['page_generate'],
    organizationId: 'organization-1',
    resourceId: 'page-2',
    resourceParam: 'page_id',
    sessionKey: 'session-1',
  });
  return React.createElement('result', { jobId });
}

describe('useActiveResourceJobId', () => {
  it('画面表示時にserver active jobsを取得し対象resourceだけを復元する', async () => {
    const listJobs = vi.fn().mockResolvedValue({
      jobs: [
        { id: 'wrong-job', params: { page_id: 'page-1' } },
        { id: 'matching-job', params: { page_id: 'page-2' } },
      ],
      next_cursor: null,
    });
    useQueryMock.mockImplementation((options: {
      queryFn: () => Promise<string | null>;
    }) => ({
      data: null,
      refetch: refetchMock,
      queryFn: options.queryFn,
    }));
    useFocusEffectMock.mockImplementation((callback: () => void) => callback());
    addEventListenerMock.mockReturnValue({ remove: vi.fn() });

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Probe api={{ listJobs }} />);
    });

    const options = useQueryMock.mock.calls[0]?.[0] as {
      enabled: boolean;
      queryFn: () => Promise<string | null>;
    };
    await expect(options.queryFn()).resolves.toBe('matching-job');
    expect(options.enabled).toBe(true);
    expect(listJobs).toHaveBeenCalledWith({
      jobTypes: ['page_generate'],
      limit: 100,
      organizationId: 'organization-1',
      statuses: ['queued', 'processing'],
    });
    expect(refetchMock).toHaveBeenCalled();
    expect(renderer!).toBeDefined();
  });

  it('foreground復帰時にもactive jobsを再取得する', async () => {
    let listener: ((state: string) => void) | null = null;
    addEventListenerMock.mockImplementation(
      (_event: string, nextListener: (state: string) => void) => {
        listener = nextListener;
        return { remove: vi.fn() };
      },
    );
    useQueryMock.mockReturnValue({ data: null, refetch: refetchMock });
    useFocusEffectMock.mockImplementation(() => undefined);

    await act(async () => {
      create(<Probe api={{ listJobs: vi.fn() }} />);
    });
    await act(async () => {
      listener?.('active');
      await Promise.resolve();
    });

    expect(refetchMock).toHaveBeenCalled();
  });
});
