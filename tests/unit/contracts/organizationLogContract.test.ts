import { describe, expect, it } from 'vitest';
import {
  organizationAuditLogsResponseSchema,
  organizationUsageResponseSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

describe('Organization usage / audit response contract', () => {
  it('空一覧・null ID・正負credit・任意metadataを受理する', () => {
    expect(
      organizationUsageResponseSchema.safeParse({
        usage_events: [
          {
            id: 'usage-1',
            organization_id: 'org-1',
            user_id: null,
            work_id: null,
            generation_job_id: null,
            event_type: 'page_generate',
            credit_amount: -3,
            metadata: { generation_type: 'page_generate', nested: { value: true } },
            created_at: '2026-07-30T00:00:00.000Z',
          },
        ],
        summary: {
          current_month_total_credits: -3,
          by_member: [{ key: 'unknown', credits: -3 }],
          by_work: [],
          by_generation_type: [{ key: 'page_generate', credits: -3 }],
        },
      }).success,
    ).toBe(true);
    expect(
      organizationUsageResponseSchema.safeParse({
        usage_events: [],
        summary: {
          current_month_total_credits: 0,
          by_member: [],
          by_work: [],
          by_generation_type: [],
        },
      }).success,
    ).toBe(true);
    expect(
      organizationAuditLogsResponseSchema.safeParse({
        audit_logs: [
          {
            id: 'audit-1',
            organization_id: 'org-1',
            actor_user_id: null,
            action: 'subscription.paid',
            target_type: 'organization',
            target_id: null,
            metadata: { plan_key: 'enterprise_a', credits: 600 },
            created_at: '2026-07-30T00:00:00.000Z',
          },
        ],
      }).success,
    ).toBe(true);
    expect(organizationAuditLogsResponseSchema.safeParse({ audit_logs: [] }).success).toBe(true);
  });

  it('空ID・小数credit・未知root fieldを拒否する', () => {
    expect(
      organizationUsageResponseSchema.safeParse({
        usage_events: [
          {
            id: '',
            organization_id: 'org-1',
            user_id: null,
            work_id: null,
            generation_job_id: null,
            event_type: 'page_generate',
            credit_amount: -0.5,
            metadata: {},
            created_at: '2026-07-30T00:00:00.000Z',
          },
        ],
        summary: {
          current_month_total_credits: -0.5,
          by_member: [],
          by_work: [],
          by_generation_type: [],
        },
      }).success,
    ).toBe(false);
    expect(
      organizationAuditLogsResponseSchema.safeParse({
        audit_logs: [],
        stripe_event_id: 'evt_private',
      }).success,
    ).toBe(false);
  });
});
