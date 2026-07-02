import type { EnterprisePlanCode } from '../constants/billing.js';

export type OrganizationType = 'business' | 'internal';
export type OrganizationStatus = 'active' | 'trialing' | 'past_due' | 'suspended' | 'canceled';
export type OrganizationMemberRole = 'owner' | 'admin' | 'billing' | 'editor' | 'creator' | 'viewer';
export type OrganizationMemberStatus = 'invited' | 'active' | 'suspended' | 'removed';
export type OrganizationInvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface Organization {
  id: string;
  type: OrganizationType;
  name: string;
  legalName: string | null;
  status: OrganizationStatus;
  planKey: EnterprisePlanCode;
  billingEmail: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: OrganizationMemberRole;
  status: OrganizationMemberStatus;
  invitedByUserId: string | null;
  joinedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationMemberRole;
  status: OrganizationInvitationStatus;
  invitedByUserId: string;
  acceptedByUserId: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationCreditBalance {
  organizationId: string;
  monthlyCredits: number;
  purchasedCredits: number;
  monthlyExpiresAt: Date | null;
  updatedAt: Date;
}

export interface OrganizationAuditLog {
  id: string;
  organizationId: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface OrganizationUsageEvent {
  id: string;
  organizationId: string;
  userId: string | null;
  workId: string | null;
  generationJobId: string | null;
  eventType: string;
  creditAmount: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export type OrganizationCapability =
  | 'manage_organization'
  | 'manage_members'
  | 'manage_billing'
  | 'view_billing'
  | 'view_usage'
  | 'view_audit_logs'
  | 'create_work'
  | 'edit_work'
  | 'generate'
  | 'export'
  | 'view_work';

export const ORGANIZATION_ROLE_CAPABILITIES: Record<
  OrganizationMemberRole,
  readonly OrganizationCapability[]
> = {
  owner: [
    'manage_organization',
    'manage_members',
    'manage_billing',
    'view_billing',
    'view_usage',
    'view_audit_logs',
    'create_work',
    'edit_work',
    'generate',
    'export',
    'view_work',
  ],
  admin: [
    'manage_members',
    'view_usage',
    'view_audit_logs',
    'create_work',
    'edit_work',
    'generate',
    'export',
    'view_work',
  ],
  billing: ['manage_billing', 'view_billing'],
  editor: ['create_work', 'edit_work', 'generate', 'export', 'view_work'],
  creator: ['create_work', 'edit_work', 'generate', 'view_work'],
  viewer: ['view_work'],
} as const;

export function roleHasCapability(
  role: OrganizationMemberRole,
  capability: OrganizationCapability,
): boolean {
  return ORGANIZATION_ROLE_CAPABILITIES[role].includes(capability);
}

export interface OrganizationWorkspaceSummary {
  organization: Organization;
  membership: OrganizationMember;
  balance: OrganizationCreditBalance | null;
}
