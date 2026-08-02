import { afterEach, describe, expect, it, vi } from 'vitest';
import { StructuredLogAiContentReportSink } from '../../../../src/infrastructure/moderation/StructuredLogAiContentReportSink.js';

describe('StructuredLogAiContentReportSink', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('報告受領イベントを許可された最小限の構造化ログだけで出力する', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const sink = new StructuredLogAiContentReportSink();

    await sink.record({
      reportId: '6d4aeb9d-5271-4b22-8075-255f212f3b30',
      userId: 'opaque-user-id',
      contentKind: 'story_proposal',
      contentId: null,
      reason: 'unsafe_or_inappropriate',
      requestId: null,
      receivedAt: new Date('2026-08-02T12:00:00.000Z'),
    });

    expect(info).toHaveBeenCalledOnce();
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
      level: 'info',
      event: 'ai_content_report_received',
      report_id: '6d4aeb9d-5271-4b22-8075-255f212f3b30',
      user_id: 'opaque-user-id',
      content_kind: 'story_proposal',
      content_id: null,
      reason: 'unsafe_or_inappropriate',
      request_id: null,
      received_at: '2026-08-02T12:00:00.000Z',
    });
  });
});
