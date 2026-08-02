import type {
  AiContentReportEvent,
  AiContentReportSink,
} from '../../services/moderation/AiContentReportService.js';

export class StructuredLogAiContentReportSink implements AiContentReportSink {
  public async record(report: AiContentReportEvent): Promise<void> {
    console.info(
      JSON.stringify({
        level: 'info',
        event: 'ai_content_report_received',
        report_id: report.reportId,
        user_id: report.userId,
        content_kind: report.contentKind,
        content_id: report.contentId,
        reason: report.reason,
        request_id: report.requestId,
        received_at: report.receivedAt.toISOString(),
      }),
    );
  }
}
