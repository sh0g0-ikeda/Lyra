import { describe, expect, it, vi } from 'vitest';

import {
  acceptGenerationBatchWithReconciliation,
  generationBatchQuoteRequestSchema,
  type GenerationBatch,
} from '../../../packages/api-contract/src/generationBatch.js';

const batchId = '11111111-1111-4111-8111-111111111111';
const workId = '22222222-2222-4222-8222-222222222222';
const episodeId = '33333333-3333-4333-8333-333333333333';
const requestKey = '44444444-4444-4444-8444-444444444444';

function batch(status: GenerationBatch['status'], acceptedAt: string | null): GenerationBatch {
  return {
    batch_id: batchId,
    work_id: workId,
    kind: 'pages',
    episode_id: episodeId,
    status,
    selection: 'missing_only',
    render_style: 'color',
    image_model: 'gpt-image-2.5-sunburst',
    pricing_version: 'v1',
    maximum_credits: 2.5,
    auto_confirm: true,
    expires_at: '2026-11-22T00:10:00.000Z',
    accepted_at: acceptedAt,
    created_at: '2026-11-22T00:00:00.000Z',
    updated_at: '2026-11-22T00:00:00.000Z',
    progress: { total: 1, completed: 0, skipped: 0, failed: 0, active: 1, pending: 0 },
    items: [],
    blockers: [],
    active_job_ids: [],
  };
}

describe('generation batch contract', () => {
  it('ページ一括生成ではepisode_idが必須になる', () => {
    expect(generationBatchQuoteRequestSchema.safeParse({
      work_id: workId,
      kind: 'pages',
      selection: 'missing_only',
      render_style: 'color',
    }).success).toBe(false);
  });

  it('キャラクター一括生成ではepisode_idを拒否する', () => {
    expect(generationBatchQuoteRequestSchema.safeParse({
      work_id: workId,
      episode_id: episodeId,
      kind: 'character_references',
      selection: 'missing_only',
      render_style: 'color',
    }).success).toBe(false);
  });

  it('accept通信失敗後に同じbatchが開始済みならGET結果を採用する', async () => {
    const acceptError = new Error('connection lost');
    const running = batch('running', '2026-11-22T00:01:00.000Z');
    const accept = vi.fn().mockRejectedValue(acceptError);
    const get = vi.fn().mockResolvedValue(running);

    await expect(acceptGenerationBatchWithReconciliation({ accept, get }, batch('quoted', null), requestKey)).resolves.toBe(running);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith(batchId, { request_key: requestKey, auto_confirm: true });
    expect(get).toHaveBeenCalledWith(batchId);
  });

  it('照合後も未acceptなら元の通信エラーを返し新しいquoteを作らない', async () => {
    const acceptError = new Error('connection lost');
    const accept = vi.fn().mockRejectedValue(acceptError);
    const get = vi.fn().mockResolvedValue(batch('quoted', null));

    await expect(acceptGenerationBatchWithReconciliation({ accept, get }, batch('quoted', null), requestKey)).rejects.toBe(acceptError);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
