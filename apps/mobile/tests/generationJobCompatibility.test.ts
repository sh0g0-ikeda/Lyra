import { describe, expect, it } from 'vitest';

import { generationJobCompatibilitySchema } from '@/domain/generationJobCompatibility';

const transitionalJob = {
  id: '11111111-1111-4111-8111-111111111111',
  job_type: 'entity_generate' as const,
  status: 'processing' as const,
  generation_mode: 'standard' as const,
  credit_cost: 1,
  params: {
    entity_id: '22222222-2222-4222-8222-222222222222',
    entity_type: 'character',
  },
  result: null,
  error_message: null,
  retry_count: 0,
  created_at: '2026-07-29T02:00:00.000Z',
  started_at: '2026-07-29T02:00:01.000Z',
  completed_at: null,
  expires_at: null,
  cancel_requested_at: null,
  cancelled_at: null,
  commit_started_at: null,
};

describe('generation job compatibility', () => {
  it('中間APIのキャンセル項目を含むジョブ応答を受理する', () => {
    expect(generationJobCompatibilitySchema.parse(transitionalJob)).toMatchObject({
      ...transitionalJob,
      status: 'processing',
      credit_settlement: null,
      actions: {
        cancel: { available: false, reason_key: null },
        hide: { available: false, reason_key: null },
      },
    });
  });

  it('中間APIのcancelled状態をcanceledへ正規化する', () => {
    const cancelledJob = {
      ...transitionalJob,
      status: 'cancelled',
      completed_at: '2026-07-29T02:00:05.000Z',
      cancel_requested_at: '2026-07-29T02:00:03.000Z',
      cancelled_at: '2026-07-29T02:00:05.000Z',
    };

    expect(generationJobCompatibilitySchema.parse(cancelledJob)).toMatchObject({
      ...cancelledJob,
      status: 'canceled',
      progress_updated_at: cancelledJob.completed_at,
      updated_at: cancelledJob.completed_at,
    });
  });

  it('認識済みの現行項目が壊れている応答を旧形式として受理しない', () => {
    expect(() =>
      generationJobCompatibilitySchema.parse({
        ...transitionalJob,
        credit_settlement: 'invalid',
      }),
    ).toThrow();
  });
});
