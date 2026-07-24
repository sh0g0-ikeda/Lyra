import { afterEach, describe, expect, it, vi } from 'vitest';

import { generationJobSchema } from '@/domain/apiSchemas';
import { LyraMobileApiClient } from '@/lib/api';
import { jobQueryKey, jobsQueryKey } from '@/lib/queryKeys';

describe('mobile job API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('一覧取得に組織、状態、種別、カーソルを付ける', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jobs: [], next_cursor: null }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(
      (client as unknown as {
        listJobs: (input: unknown) => Promise<unknown>;
      }).listJobs({
        organizationId: '22222222-2222-4222-8222-222222222222',
        limit: 25,
        cursor: 'cursor-1',
        statuses: ['queued', 'failed'],
        jobTypes: ['page_generate'],
      }),
    ).resolves.toEqual({ jobs: [], next_cursor: null });

    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/jobs?');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('organization_id=22222222-2222-4222-8222-222222222222');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('status=queued%2Cfailed');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('type=page_generate');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('cursor=cursor-1');
  });

  it('ジョブの query key はユーザーと組織ごとに分離する', () => {
    expect(jobQueryKey('user-a', 'job-1', null)).not.toEqual(
      jobQueryKey('user-a', 'job-1', 'organization-a'),
    );
    expect(jobsQueryKey('user-a', null)).not.toEqual(jobsQueryKey('user-a', 'organization-a'));
  });

  it('取消済みと安全な失敗情報を検証する', () => {
    expect(
      generationJobSchema.parse({
        id: 'job-1',
        job_type: 'page_generate',
        status: 'canceled',
        generation_mode: null,
        credit_cost: 3,
        credit_settlement: {
          charged_credits: 3,
          refunded_credits: 3,
          net_credits: 0,
          status: 'refunded',
        },
        params: {},
        result: null,
        error_message: 'The job was canceled.',
        error_code: 'JOB_CANCELLED',
        message_key: 'job.error.cancelled',
        retryable: false,
        support_id: 'J-123',
        progress_stage: null,
        progress_percent: null,
        progress_updated_at: null,
        updated_at: '2026-07-25T00:00:00.000Z',
        actions: {
          cancel: { available: false, reason_key: null },
          hide: { available: true, reason_key: null },
        },
        retry_count: 0,
        created_at: '2026-07-25T00:00:00.000Z',
        started_at: null,
        completed_at: '2026-07-25T00:00:00.000Z',
        expires_at: null,
      }),
    ).toMatchObject({
      credit_settlement: {
        charged_credits: 3,
        refunded_credits: 3,
        net_credits: 0,
        status: 'refunded',
      },
      status: 'canceled',
      retryable: false,
    });
  });
});
