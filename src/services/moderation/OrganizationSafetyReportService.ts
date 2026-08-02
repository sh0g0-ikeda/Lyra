import crypto from 'node:crypto';
import { z } from 'zod';

export const organizationSafetyReportBodySchema = z.object({
  organization_id: z.uuid(),
  target_kind: z.enum(['workspace_content', 'member']),
  reason: z.literal('unsafe_or_inappropriate'),
}).strict();

export type OrganizationSafetyReportBody = z.infer<typeof organizationSafetyReportBodySchema>;

export interface SubmitOrganizationSafetyReportInput {
  organizationId: string;
  reporterUserId: string;
  targetKind: OrganizationSafetyReportBody['target_kind'];
  reason: OrganizationSafetyReportBody['reason'];
  requestId: string | null;
}

export interface OrganizationSafetyReportEvent extends SubmitOrganizationSafetyReportInput {
  reportId: string;
  receivedAt: Date;
}

export interface OrganizationSafetyReportReceipt {
  reportId: string;
  status: 'received';
}

export interface OrganizationSafetyReportSink {
  record(report: OrganizationSafetyReportEvent): Promise<void>;
}

export interface OrganizationSafetyReportServicePort {
  submit(input: SubmitOrganizationSafetyReportInput): Promise<OrganizationSafetyReportReceipt>;
}

export class OrganizationSafetyReportService implements OrganizationSafetyReportServicePort {
  public constructor(
    private readonly sink: OrganizationSafetyReportSink,
    private readonly createReportId: () => string = crypto.randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async submit(input: SubmitOrganizationSafetyReportInput): Promise<OrganizationSafetyReportReceipt> {
    const reportId = this.createReportId();

    await this.sink.record({
      reportId,
      organizationId: input.organizationId,
      reporterUserId: input.reporterUserId,
      targetKind: input.targetKind,
      reason: input.reason,
      requestId: input.requestId,
      receivedAt: this.now(),
    });

    return { reportId, status: 'received' };
  }
}
