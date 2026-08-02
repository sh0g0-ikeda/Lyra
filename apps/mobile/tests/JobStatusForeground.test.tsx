import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JobStatusCard } from '@/components/JobStatusCard';
import type { CompatibleGenerationJobRecord } from '@/domain/generationJobCompatibility';
import type { GenerationJobRecord } from '@/domain/types';
import { ApiError } from '@/lib/api';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  addEventListenerMock,
  confirmActionMock,
  recordOperationalMetricMock,
  refetchMock,
  useQueryMock
} = vi.hoisted(() => ({
  addEventListenerMock: vi.fn(),
  confirmActionMock: vi.fn(),
  recordOperationalMetricMock: vi.fn(),
  refetchMock: vi.fn().mockResolvedValue(undefined),
  useQueryMock: vi.fn()
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'activity-indicator',
  AppState: {
    addEventListener: addEventListenerMock
  },
  Pressable: ({
    children,
    onPress,
    ...props
  }: {
    children: React.ReactNode;
    onPress?: () => void;
  }) => React.createElement('button', { ...props, onClick: onPress }, children),
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({
    disabled,
    disabledReason,
    label,
    onPress
  }: {
    disabled?: boolean;
    disabledReason?: string;
    label: string;
    onPress: () => void;
  }) => React.createElement(
    'button',
    { disabled, onClick: onPress },
    label,
    disabledReason === undefined ? null : React.createElement('text', null, disabledReason)
  )
}));

vi.mock('@/lib/confirm', () => ({
  confirmAction: confirmActionMock
}));

vi.mock('@/lib/operationalEvents', () => ({
  recordOperationalMetric: recordOperationalMetricMock
}));

beforeEach(() => {
  confirmActionMock.mockReset();
  recordOperationalMetricMock.mockReset();
  useQueryMock.mockReturnValue({
    data: undefined,
    error: null,
    isError: false,
    refetch: refetchMock
  });
});

describe('JobStatusCard foreground refresh', () => {
  it('アプリがforegroundへ戻ると表示中ジョブを再取得する', async () => {
    let appStateListener: ((state: string) => void) | null = null;
    const remove = vi.fn();
    addEventListenerMock.mockImplementation((_event: string, listener: (state: string) => void) => {
      appStateListener = listener;
      return { remove };
    });
    useQueryMock.mockReturnValue({
      data: undefined,
      error: null,
      isError: false,
      refetch: refetchMock
    });

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <JobStatusCard
          api={{ getJob: vi.fn() } as never}
          jobId="job-1"
          language="ja"
          sessionKey="session-1"
        />
      );
    });
    expect(appStateListener).not.toBeNull();

    await act(async () => {
      appStateListener?.('active');
      await Promise.resolve();
    });
    expect(refetchMock).toHaveBeenCalledOnce();

    await act(async () => {
      renderer!.unmount();
    });
    expect(remove).toHaveBeenCalledOnce();
  });
});

describe('JobStatusCard load recovery', () => {
  it('初回取得中もジョブ監視を止めない', async () => {
    await act(async () => {
      create(
        <JobStatusCard
          api={{ getJob: vi.fn() } as never}
          jobId="job-1"
          language="ja"
          sessionKey="session-1"
        />
      );
    });

    const queryOptions = useQueryMock.mock.calls.at(-1)?.[0] as {
      refetchInterval: (query: {
        state: {
          data?: CompatibleGenerationJobRecord;
          status: 'error' | 'pending' | 'success';
        };
      }) => number | false;
    };

    expect(queryOptions.refetchInterval({
      state: {
        data: undefined,
        status: 'pending',
      },
    })).toBe(2_500);
  });

  it('初回のジョブ取得に失敗しても自動再取得を継続する', async () => {
    await act(async () => {
      create(
        <JobStatusCard
          api={{ getJob: vi.fn() } as never}
          jobId="job-1"
          language="ja"
          sessionKey="session-1"
        />
      );
    });

    const queryOptions = useQueryMock.mock.calls.at(-1)?.[0] as {
      refetchInterval: (query: {
        state: {
          data?: CompatibleGenerationJobRecord;
          status: 'error' | 'pending' | 'success';
        };
      }) => number | false;
    };

    expect(queryOptions.refetchInterval({
      state: {
        data: undefined,
        status: 'error',
      },
    })).toBe(5_000);
  });

  it('削除済みまたは期限切れのジョブはエラー表示を残さない', async () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      error: new ApiError('not found', 404, 'NOT_FOUND'),
      isError: true,
      refetch: refetchMock
    });
    const onMissing = vi.fn();
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(
        <JobStatusCard
          api={{ getJob: vi.fn() } as never}
          jobId="stale-job"
          language="ja"
          onMissing={onMissing}
          sessionKey="session-1"
        />
      );
    });

    expect(renderer!.toJSON()).toBeNull();
    expect(onMissing).toHaveBeenCalledOnce();
  });
});

describe('JobStatusCard completion notification', () => {
  it('初回取得時点ですでに完了していても完了を1回通知する', async () => {
    const onCompleted = vi.fn();
    const completed: GenerationJobRecord = {
      ...buildProcessingJob({
        available: false,
        reason_key: 'job.action.cancelOnlyActive'
      }),
      status: 'completed',
      result: { image_url: 'https://cdn.lyra.test/page.png' },
      progress_stage: 'completed',
      progress_percent: 100,
      completed_at: '2026-07-25T00:02:00.000Z',
      actions: {
        cancel: {
          available: false,
          reason_key: 'job.action.cancelOnlyActive'
        },
        hide: {
          available: true,
          reason_key: null
        }
      }
    };
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(
        <JobStatusCard
          api={{ getJob: vi.fn() } as never}
          job={completed}
          jobId={completed.id}
          language="ja"
          onCompleted={onCompleted}
          sessionKey="session-1"
        />
      );
    });
    await act(async () => {
      renderer!.update(
        <JobStatusCard
          api={{ getJob: vi.fn() } as never}
          job={completed}
          jobId={completed.id}
          language="ja"
          onCompleted={onCompleted}
          sessionKey="session-1"
        />
      );
    });

    expect(onCompleted).toHaveBeenCalledOnce();
  });

  it('初回取得時点ですでに失敗していても失敗を1回通知する', async () => {
    const onFailed = vi.fn();
    const failed: GenerationJobRecord = {
      ...buildProcessingJob({ available: false, reason_key: null }),
      status: 'failed',
      progress_stage: 'failed',
      progress_percent: 100,
      completed_at: '2026-07-25T00:02:00.000Z',
    };

    await act(async () => {
      create(
        <JobStatusCard
          api={{ getJob: vi.fn() } as never}
          job={failed}
          jobId={failed.id}
          language="ja"
          onFailed={onFailed}
          sessionKey="session-1"
        />
      );
    });

    expect(onFailed).toHaveBeenCalledOnce();
  });

  it('初回取得時点ですでに中止されていても中止を1回通知する', async () => {
    const onCanceled = vi.fn();
    const canceled: GenerationJobRecord = {
      ...buildProcessingJob({ available: false, reason_key: null }),
      status: 'canceled',
      progress_stage: 'canceled',
      progress_percent: 100,
      completed_at: '2026-07-25T00:02:00.000Z',
    };

    await act(async () => {
      create(
        <JobStatusCard
          api={{ getJob: vi.fn() } as never}
          job={canceled}
          jobId={canceled.id}
          language="ja"
          onCanceled={onCanceled}
          sessionKey="session-1"
        />
      );
    });

    expect(onCanceled).toHaveBeenCalledOnce();
  });

  it('ページ表示後も続くストーリー反映段階を明示する', async () => {
    const job: GenerationJobRecord = {
      ...buildProcessingJob({ available: false, reason_key: null }),
      job_type: 'episode_page_skeleton',
      progress_stage: 'applying_story_plan',
    };
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(
        <JobStatusCard
          api={{ getJob: vi.fn() } as never}
          job={job}
          jobId={job.id}
          language="ja"
          sessionKey="session-1"
        />
      );
    });

    expect(renderer!.root.findAllByType('text').map((node) => node.children.join(' '))).toContain(
      'ページへストーリー内容を反映中です。ページが表示されても、完了になるまで処理は続きます。'
    );
  });
});

describe('JobStatusCard processing cancellation', () => {
  it('処理中の停止確認では現在の処理段階後に中止されることを説明する', async () => {
    const job = buildProcessingJob({
      available: true,
      reason_key: null
    });
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(
        <JobStatusCard
          api={{ getJob: vi.fn() } as never}
          job={job}
          jobId={job.id}
          language="ja"
          onCancel={vi.fn()}
          sessionKey="session-1"
        />
      );
    });

    const stopButton = renderer!.root.findAllByType('button')
      .find((button) => button.children.includes('生成を停止'));
    expect(stopButton).toBeDefined();

    await act(async () => {
      stopButton!.props.onClick();
    });

    expect(confirmActionMock).toHaveBeenCalledWith(expect.objectContaining({
      message: '停止を依頼します。現在の処理段階が終わった時点で生成を中止し、使用クレジットを返却します。'
    }));
  });

  it('処理中の停止依頼後は依頼済み状態を表示する', async () => {
    const job = buildProcessingJob({
      available: false,
      reason_key: 'job.action.cancelRequested'
    });
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(
        <JobStatusCard
          api={{ getJob: vi.fn() } as never}
          job={job}
          jobId={job.id}
          language="ja"
          onCancel={vi.fn()}
          sessionKey="session-1"
        />
      );
    });

    expect(renderer!.root.findAllByType('text').map((node) => node.children.join(' '))).toContain(
      '停止を依頼済みです。現在の処理段階が終わると中止されます。'
    );
  });
});

describe('JobStatusCard failure observability', () => {
  it('active jobがfailedへ遷移した時だけopaque IDのmetricを1回記録する', async () => {
    const processing = buildProcessingJob({
      available: false,
      reason_key: 'job.action.cancelRequested'
    });
    const failed: GenerationJobRecord = {
      ...processing,
      status: 'failed',
      error_code: 'GENERATION_FAILED',
      message_key: 'job.error.generationFailed',
      retryable: true,
      support_id: 'support_123',
      progress_stage: 'failed',
      progress_percent: 100,
      completed_at: '2026-07-25T00:02:00.000Z',
      actions: {
        cancel: {
          available: false,
          reason_key: 'job.action.cancelOnlyActive'
        },
        hide: {
          available: true,
          reason_key: null
        }
      }
    };
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <JobStatusCard
          api={{ getJob: vi.fn() } as never}
          job={processing}
          jobId={processing.id}
          language="ja"
          sessionKey="session-1"
        />
      );
    });
    await act(async () => {
      renderer!.update(
        <JobStatusCard
          api={{ getJob: vi.fn() } as never}
          job={failed}
          jobId={failed.id}
          language="ja"
          sessionKey="session-1"
        />
      );
    });
    await act(async () => {
      renderer!.update(
        <JobStatusCard
          api={{ getJob: vi.fn() } as never}
          job={failed}
          jobId={failed.id}
          language="ja"
          sessionKey="session-1"
        />
      );
    });

    expect(recordOperationalMetricMock).toHaveBeenCalledOnce();
    expect(recordOperationalMetricMock).toHaveBeenCalledWith({
      name: 'job_failure',
      jobId: failed.id,
      requestId: 'support_123'
    });
  });
});

describe('JobStatusCard legacy job compatibility', () => {
  it('旧APIのジョブでは不明な課金情報と未対応操作を表示しない', async () => {
    const job: CompatibleGenerationJobRecord = {
      ...buildProcessingJob({
        available: false,
        reason_key: null,
      }),
      credit_settlement: null,
      actions: {
        cancel: { available: false, reason_key: null },
        hide: { available: false, reason_key: null },
      },
    };
    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(
        <JobStatusCard
          api={{ getJob: vi.fn() } as never}
          job={job}
          jobId={job.id}
          language="ja"
          onCancel={vi.fn()}
          onHide={vi.fn()}
          onRetry={vi.fn()}
          sessionKey="session-1"
        />
      );
    });

    const text = renderer!.root
      .findAllByType('text')
      .map((node) => node.children.join(' '));
    expect(text).not.toContain('クレジット精算');
    expect(
      renderer!.root
        .findAllByType('button')
        .some((button) => button.children.includes('生成を停止')),
    ).toBe(false);
  });
});

function buildProcessingJob(
  cancel: GenerationJobRecord['actions']['cancel']
): GenerationJobRecord {
  return {
    id: 'job-processing-1',
    job_type: 'page_generate',
    status: 'processing',
    generation_mode: 'standard',
    credit_cost: 3,
    credit_settlement: {
      charged_credits: 3,
      refunded_credits: 0,
      net_credits: 3,
      status: 'charged'
    },
    params: {},
    result: null,
    error_message: null,
    error_code: null,
    message_key: null,
    retryable: false,
    support_id: null,
    progress_stage: 'generating',
    progress_percent: 50,
    progress_updated_at: '2026-07-25T00:01:00.000Z',
    updated_at: '2026-07-25T00:01:00.000Z',
    actions: {
      cancel,
      hide: {
        available: false,
        reason_key: 'job.action.hideOnlyTerminal'
      }
    },
    retry_count: 0,
    created_at: '2026-07-25T00:00:00.000Z',
    started_at: '2026-07-25T00:00:30.000Z',
    completed_at: null,
    expires_at: null
  };
}
