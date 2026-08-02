import { afterEach, describe, expect, it, vi } from 'vitest';
import { StructuredLogOrganizationSafetyReportSink } from '../../../../src/infrastructure/moderation/StructuredLogOrganizationSafetyReportSink.js';

describe('StructuredLogOrganizationSafetyReportSink', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('組織安全報告を許可された最小限の構造化ログだけで出力する', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const sink = new StructuredLogOrganizationSafetyReportSink();

    await sink.record({
      reportId: '8980e697-fc5e-4612-ac0d-9c2619f9cd51',
      organizationId: 'fc6eaf92-d02d-4d18-ae12-68e16ecf8e03',
      reporterUserId: 'opaque-reporter-id',
      targetKind: 'workspace_content',
      reason: 'unsafe_or_inappropriate',
      requestId: null,
      receivedAt: new Date('2026-08-02T13:00:00.000Z'),
    });

    expect(info).toHaveBeenCalledOnce();
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
      level: 'info',
      event: 'organization_safety_report_received',
      report_id: '8980e697-fc5e-4612-ac0d-9c2619f9cd51',
      organization_id: 'fc6eaf92-d02d-4d18-ae12-68e16ecf8e03',
      reporter_user_id: 'opaque-reporter-id',
      target_kind: 'workspace_content',
      reason: 'unsafe_or_inappropriate',
      request_id: null,
      received_at: '2026-08-02T13:00:00.000Z',
    });
  });
});
