import type {
  OrganizationSafetyReportEvent,
  OrganizationSafetyReportSink,
} from '../../services/moderation/OrganizationSafetyReportService.js';

export class StructuredLogOrganizationSafetyReportSink implements OrganizationSafetyReportSink {
  public async record(report: OrganizationSafetyReportEvent): Promise<void> {
    console.info(
      JSON.stringify({
        level: 'info',
        event: 'organization_safety_report_received',
        report_id: report.reportId,
        organization_id: report.organizationId,
        reporter_user_id: report.reporterUserId,
        target_kind: report.targetKind,
        reason: report.reason,
        request_id: report.requestId,
        received_at: report.receivedAt.toISOString(),
      }),
    );
  }
}
