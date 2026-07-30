import { describe, expect, it } from 'vitest';
import {
  organizationInvitationPreviewResponseSchema,
  organizationInvitationResponseSchema,
  organizationInvitationResultResponseSchema,
  organizationInvitationsResponseSchema,
  organizationMemberResponseSchema,
  organizationMembersResponseSchema,
  organizationResponseSchema,
  organizationWorkspaceSchema,
  organizationsResponseSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

const organization = {
  id: 'org-1',
  type: 'business',
  name: 'Lyra Studio',
  legal_name: null,
  status: 'active',
  plan_key: 'enterprise_a',
  billing_email: null,
  created_by_user_id: 'user-1',
  created_at: '2026-07-30T00:00:00.000Z',
  updated_at: '2026-07-30T00:00:00.000Z',
};

const member = {
  id: 'member-1',
  organization_id: 'org-1',
  user_id: 'user-1',
  email: 'owner@example.com',
  display_name: null,
  role: 'owner',
  status: 'active',
  invited_by_user_id: null,
  joined_at: null,
  created_at: '2026-07-30T00:00:00.000Z',
  updated_at: '2026-07-30T00:00:00.000Z',
};

const invitation = {
  id: 'invitation-1',
  organization_id: 'org-1',
  email: 'member@example.com',
  role: 'editor',
  status: 'pending',
  send_status: 'not_sent',
  send_error_code: null,
  send_error_message: null,
  sent_at: null,
  last_sent_at: null,
  resend_count: 0,
  invited_by_user_id: 'user-1',
  accepted_by_user_id: null,
  expires_at: '2026-08-06T00:00:00.000Z',
  accepted_at: null,
  revoked_at: null,
  revoked_by_user_id: null,
  created_at: '2026-07-30T00:00:00.000Z',
  updated_at: '2026-07-30T00:00:00.000Z',
};

describe('Organization core response contract', () => {
  it('null balance・空一覧・delivery error境界を受理する', () => {
    const workspace = {
      organization,
      membership: member,
      balance: null,
    };
    expect(organizationWorkspaceSchema.safeParse(workspace).success).toBe(true);
    expect(organizationsResponseSchema.safeParse({ organizations: [] }).success).toBe(true);
    expect(organizationResponseSchema.safeParse({ organization }).success).toBe(true);
    expect(organizationMembersResponseSchema.safeParse({ members: [] }).success).toBe(true);
    expect(organizationMemberResponseSchema.safeParse({ member }).success).toBe(true);
    expect(organizationInvitationsResponseSchema.safeParse({ invitations: [] }).success).toBe(true);
    expect(organizationInvitationResponseSchema.safeParse({ invitation }).success).toBe(true);
    expect(
      organizationInvitationResultResponseSchema.safeParse({
        invitation,
        invitation_url: 'https://app.example.com/invite/token',
        email_delivery: {
          status: 'failed',
          errorMessage: 'Delivery failed',
        },
      }).success,
    ).toBe(true);
    expect(
      organizationInvitationPreviewResponseSchema.safeParse({
        organization: { id: 'org-1', name: 'Lyra Studio' },
        invitation: {
          email: 'member@example.com',
          role: 'editor',
          status: 'pending',
          expires_at: '2026-08-06T00:00:00.000Z',
        },
      }).success,
    ).toBe(true);
  });

  it('Stripe内部ID・生token・未知enum・負数を拒否する', () => {
    expect(
      organizationWorkspaceSchema.safeParse({
        organization: {
          ...organization,
          stripe_customer_id: 'cus_private',
        },
        membership: member,
        balance: null,
      }).success,
    ).toBe(false);
    expect(
      organizationInvitationResultResponseSchema.safeParse({
        invitation,
        invitation_url: 'https://app.example.com/invite/token',
        invitation_token: 'raw-token',
        email_delivery: { status: 'sent' },
      }).success,
    ).toBe(false);
    expect(
      organizationMemberResponseSchema.safeParse({
        member: { ...member, role: 'super_admin' },
      }).success,
    ).toBe(false);
    expect(
      organizationInvitationResponseSchema.safeParse({
        invitation: { ...invitation, resend_count: -1 },
      }).success,
    ).toBe(false);
  });
});
