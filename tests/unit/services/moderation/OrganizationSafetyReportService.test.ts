import { describe, expect, it } from 'vitest';
import {
  OrganizationSafetyReportService,
  type OrganizationSafetyReportEvent,
  type OrganizationSafetyReportSink,
} from '../../../../src/services/moderation/OrganizationSafetyReportService.js';

class RecordingOrganizationSafetyReportSink implements OrganizationSafetyReportSink {
  public readonly reports: OrganizationSafetyReportEvent[] = [];

  public async record(report: OrganizationSafetyReportEvent): Promise<void> {
    this.reports.push(report);
  }
}

describe('OrganizationSafetyReportService', () => {
  it('組織安全報告を不透明な受付IDと最小限のメタデータで記録する', async () => {
    const sink = new RecordingOrganizationSafetyReportSink();
    const receivedAt = new Date('2026-08-02T13:00:00.000Z');
    const service = new OrganizationSafetyReportService(
      sink,
      () => '8980e697-fc5e-4612-ac0d-9c2619f9cd51',
      () => receivedAt,
    );

    const receipt = await service.submit({
      organizationId: 'fc6eaf92-d02d-4d18-ae12-68e16ecf8e03',
      reporterUserId: 'opaque-reporter-id',
      targetKind: 'member',
      reason: 'unsafe_or_inappropriate',
      requestId: '7d8fdd8c-3be8-4394-a513-4b1d3df0a0f6',
    });

    expect(receipt).toEqual({ reportId: '8980e697-fc5e-4612-ac0d-9c2619f9cd51', status: 'received' });
    expect(sink.reports).toEqual([
      {
        reportId: '8980e697-fc5e-4612-ac0d-9c2619f9cd51',
        organizationId: 'fc6eaf92-d02d-4d18-ae12-68e16ecf8e03',
        reporterUserId: 'opaque-reporter-id',
        targetKind: 'member',
        reason: 'unsafe_or_inappropriate',
        requestId: '7d8fdd8c-3be8-4394-a513-4b1d3df0a0f6',
        receivedAt,
      },
    ]);
    expect(Object.keys(sink.reports[0] ?? {})).toEqual([
      'reportId',
      'organizationId',
      'reporterUserId',
      'targetKind',
      'reason',
      'requestId',
      'receivedAt',
    ]);
  });
});
