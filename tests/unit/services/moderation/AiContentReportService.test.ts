import { describe, expect, it } from 'vitest';
import {
  AiContentReportService,
  type AiContentReportEvent,
  type AiContentReportSink,
} from '../../../../src/services/moderation/AiContentReportService.js';

class RecordingAiContentReportSink implements AiContentReportSink {
  public readonly reports: AiContentReportEvent[] = [];

  public async record(report: AiContentReportEvent): Promise<void> {
    this.reports.push(report);
  }
}

describe('AiContentReportService', () => {
  it('認証済みユーザーの報告を不透明な受付IDと最小限のメタデータで記録する', async () => {
    const sink = new RecordingAiContentReportSink();
    const receivedAt = new Date('2026-08-02T12:00:00.000Z');
    const service = new AiContentReportService(
      sink,
      () => '6d4aeb9d-5271-4b22-8075-255f212f3b30',
      () => receivedAt,
    );

    const receipt = await service.submit({
      userId: 'opaque-user-id',
      contentKind: 'generated_image',
      contentId: 'd2719e3d-f6b2-4501-9919-d64076d6c0fe',
      reason: 'unsafe_or_inappropriate',
      requestId: '2fc04279-d6db-4ba5-a5c1-bbe445b768fc',
    });

    expect(receipt).toEqual({
      reportId: '6d4aeb9d-5271-4b22-8075-255f212f3b30',
      status: 'received',
    });
    expect(sink.reports).toEqual([
      {
        reportId: '6d4aeb9d-5271-4b22-8075-255f212f3b30',
        userId: 'opaque-user-id',
        contentKind: 'generated_image',
        contentId: 'd2719e3d-f6b2-4501-9919-d64076d6c0fe',
        reason: 'unsafe_or_inappropriate',
        requestId: '2fc04279-d6db-4ba5-a5c1-bbe445b768fc',
        receivedAt,
      },
    ]);
    expect(Object.keys(sink.reports[0] ?? {})).toEqual([
      'reportId',
      'userId',
      'contentKind',
      'contentId',
      'reason',
      'requestId',
      'receivedAt',
    ]);
  });
});
