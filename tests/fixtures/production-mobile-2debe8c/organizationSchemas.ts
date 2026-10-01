// Frozen production Mobile source; do not modernize this compatibility oracle.
// Source: 2debe8c:apps/mobile/src/domain/apiSchemas.ts (organization collection schemas and exact dependencies)
// Full source SHA-256: 55136e342f0bfdf983785d7861b4f65c1e9eff6c668f17726d139160136f9185
import { z } from 'zod';

const id = z.string().min(1);
const timestamp = z.string().min(1);
const nullableString = z.string().nullable();
const nextCursor = z.string().min(1).max(1024).nullable().optional().default(null);
const unknownRecord = z.record(z.string(), z.unknown());
const organizationRoleSchema = z.enum(['owner', 'admin', 'billing', 'editor', 'viewer']);
const organizationMemberStatusSchema = z.enum(['invited', 'active', 'suspended', 'removed']);
const organizationInvitationStatusSchema = z.enum(['pending', 'accepted', 'revoked', 'expired']);
const organizationInvitationSendStatusSchema = z.enum(['not_sent', 'sending', 'sent', 'failed']);
export const organizationMemberSchema = z.object({
  id,
  organization_id: id,
  user_id: id,
  email: z.string().email().max(320),
  display_name: nullableString,
  role: organizationRoleSchema,
  status: organizationMemberStatusSchema,
  invited_by_user_id: nullableString,
  joined_at: nullableString,
  created_at: timestamp,
  updated_at: timestamp
});

const organizationInvitationWireSchema = z.object({
  id,
  organization_id: id,
  email: z.string().email().max(320),
  role: organizationRoleSchema,
  status: organizationInvitationStatusSchema,
  send_status: organizationInvitationSendStatusSchema,
  send_error_code: nullableString,
  send_error_message: nullableString,
  sent_at: nullableString,
  last_sent_at: nullableString,
  resend_count: z.number().int().nonnegative(),
  invited_by_user_id: id,
  accepted_by_user_id: nullableString,
  expires_at: timestamp,
  accepted_at: nullableString,
  revoked_at: nullableString,
  revoked_by_user_id: nullableString,
  created_at: timestamp,
  updated_at: timestamp
});

export const organizationInvitationSchema = organizationInvitationWireSchema.transform((invitation) => ({
  id: invitation.id,
  organization_id: invitation.organization_id,
  email: invitation.email,
  role: invitation.role,
  status: invitation.status,
  send_status: invitation.send_status,
  sent_at: invitation.sent_at,
  last_sent_at: invitation.last_sent_at,
  resend_count: invitation.resend_count,
  expires_at: invitation.expires_at,
  accepted_at: invitation.accepted_at,
  revoked_at: invitation.revoked_at,
  created_at: invitation.created_at,
  updated_at: invitation.updated_at
}));

export const organizationMembersResponseSchema = z.object({
  members: z.array(organizationMemberSchema),
  next_cursor: nextCursor
});

export const organizationInvitationsResponseSchema = z.object({
  invitations: z.array(organizationInvitationSchema),
  next_cursor: nextCursor
});
const organizationUsageSummaryItemSchema = z.object({
  key: z.string().min(1).max(512),
  credits: z.number().int()
});

export const organizationUsageResponseSchema = z.object({
  usage_events: z.array(
    z.object({
      id,
      organization_id: id,
      user_id: nullableString,
      work_id: nullableString,
      generation_job_id: nullableString,
      event_type: z.string().min(1).max(200),
      credit_amount: z.number().int(),
      metadata: unknownRecord,
      created_at: timestamp
    })
  ),
  next_cursor: nextCursor,
  summary: z.object({
    current_month_total_credits: z.number().int(),
    by_member: z.array(organizationUsageSummaryItemSchema),
    by_work: z.array(organizationUsageSummaryItemSchema),
    by_generation_type: z.array(organizationUsageSummaryItemSchema)
  })
});

export const organizationAuditLogsResponseSchema = z.object({
  audit_logs: z.array(
    z.object({
      id,
      organization_id: id,
      actor_user_id: nullableString,
      action: z.string().min(1).max(200),
      target_type: z.string().min(1).max(200),
      target_id: nullableString,
      metadata: unknownRecord,
      created_at: timestamp
    })
  ),
  next_cursor: nextCursor
});
