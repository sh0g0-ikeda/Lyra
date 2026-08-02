import crypto from 'node:crypto';
import { z } from 'zod';

export const aiContentReportBodySchema = z.object({
  content_kind: z.enum(['generated_image', 'story_proposal']),
  content_id: z.uuid().optional(),
  reason: z.literal('unsafe_or_inappropriate'),
}).strict();

export type AiContentReportBody = z.infer<typeof aiContentReportBodySchema>;

export interface SubmitAiContentReportInput {
  userId: string;
  contentKind: AiContentReportBody['content_kind'];
  contentId: string | null;
  reason: AiContentReportBody['reason'];
  requestId: string | null;
}

export interface AiContentReportEvent extends SubmitAiContentReportInput {
  reportId: string;
  receivedAt: Date;
}

export interface AiContentReportReceipt {
  reportId: string;
  status: 'received';
}

export interface AiContentReportSink {
  record(report: AiContentReportEvent): Promise<void>;
}

export interface AiContentReportServicePort {
  submit(input: SubmitAiContentReportInput): Promise<AiContentReportReceipt>;
}

export class AiContentReportService implements AiContentReportServicePort {
  public constructor(
    private readonly sink: AiContentReportSink,
    private readonly createReportId: () => string = crypto.randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async submit(input: SubmitAiContentReportInput): Promise<AiContentReportReceipt> {
    const reportId = this.createReportId();

    await this.sink.record({
      reportId,
      userId: input.userId,
      contentKind: input.contentKind,
      contentId: input.contentId,
      reason: input.reason,
      requestId: input.requestId,
      receivedAt: this.now(),
    });

    return { reportId, status: 'received' };
  }
}
