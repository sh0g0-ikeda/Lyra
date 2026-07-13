import { createHash, randomBytes } from 'node:crypto';
import {
  ENTERPRISE_PLAN_DEFINITIONS,
  type CreditPackageCode,
  CREDIT_PACKAGE_DEFINITIONS,
  type EnterprisePlanCode,
} from '../../domain/constants/billing.js';
import {
  ConflictError,
  ForbiddenError,
  InsufficientCreditsError,
  NotFoundError,
  ValidationError,
} from '../../domain/errors/index.js';
import type {
  Organization,
  OrganizationAuditLog,
  OrganizationCapability,
  OrganizationCreditBalance,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationMemberRole,
  OrganizationStatus,
  OrganizationUsageEvent,
  OrganizationWorkspaceSummary,
} from '../../domain/types/organization.js';
import { roleHasCapability } from '../../domain/types/organization.js';
import type { DatabaseClient } from '../../lib/db.js';
import type { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { InvitationUrlBuilder } from './InvitationUrlBuilder.js';
import type {
  InvitationEmailDeliveryResult,
  OrganizationInvitationEmailServicePort,
} from './OrganizationInvitationEmailService.js';

const BILLING_AUDIT_ACTION_PREFIXES = ['billing.', 'credit.', 'subscription.'] as const;

export interface CreateOrganizationRequest {
  name: string;
  legalName: string | null;
  billingEmail: string | null;
}

export interface UpdateOrganizationRequest {
  name?: string;
  legalName?: string | null;
  billingEmail?: string | null;
}

export interface AdminUpdateOrganizationContractRequest {
  planKey?: EnterprisePlanCode;
  status?: OrganizationStatus;
  billingEmail?: string | null;
}

export interface CreateOrganizationInvitationResult {
  invitation: OrganizationInvitation;
  invitationUrl: string;
  emailDelivery: InvitationEmailDeliveryResult;
}

export interface ConsumeOrganizationCreditsRequest {
  userId: string;
  organizationId: string;
  cost: number;
  description: string;
  jobId?: string | null;
  workId?: string | null;
  eventType?: string;
}

export interface GrantOrganizationCreditsRequest {
  organizationId: string;
  actorUserId: string | null;
  amount: number;
  description: string;
  stripeEventId?: string | null;
}

export interface RecordOrganizationGenerationRequest {
  organizationId: string;
  userId: string;
  workId?: string | null;
  jobId: string;
  generationType: string;
  creditAmount?: number;
  metadata?: Record<string, unknown>;
}

export interface RecordOrganizationWorkExportRequest {
  organizationId: string;
  userId: string;
  workId: string;
  pageId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordOrganizationAuditEventRequest {
  organizationId: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface OrganizationServicePort {
  listWorkspaces(userId: string): Promise<OrganizationWorkspaceSummary[]>;
  createOrganization(userId: string, input: CreateOrganizationRequest): Promise<OrganizationWorkspaceSummary>;
  getOrganization(userId: string, organizationId: string): Promise<OrganizationWorkspaceSummary>;
  updateOrganization(userId: string, organizationId: string, input: UpdateOrganizationRequest): Promise<Organization>;
  adminUpdateOrganizationContract(
    actorUserId: string,
    organizationId: string,
    input: AdminUpdateOrganizationContractRequest,
  ): Promise<Organization>;
  adminGrantCredits(
    input: GrantOrganizationCreditsRequest & {
      bucket: 'monthly' | 'purchased';
      packageCode?: CreditPackageCode | null;
    },
  ): Promise<OrganizationCreditBalance>;
  listMembers(userId: string, organizationId: string): Promise<OrganizationMember[]>;
  listInvitations(userId: string, organizationId: string): Promise<OrganizationInvitation[]>;
  inviteMember(
    userId: string,
    organizationId: string,
    input: { email: string; role: OrganizationMemberRole },
  ): Promise<CreateOrganizationInvitationResult>;
  resendInvitation(
    userId: string,
    organizationId: string,
    invitationId: string,
  ): Promise<CreateOrganizationInvitationResult>;
  revokeInvitation(userId: string, organizationId: string, invitationId: string): Promise<OrganizationInvitation>;
  previewInvitation(token: string): Promise<{
    organization: Pick<Organization, 'id' | 'name'>;
    invitation: Pick<OrganizationInvitation, 'email' | 'role' | 'status' | 'expiresAt'>;
  }>;
  acceptInvitation(userId: string, email: string, token: string): Promise<OrganizationWorkspaceSummary>;
  updateMember(
    userId: string,
    organizationId: string,
    memberId: string,
    input: { role?: OrganizationMemberRole; status?: 'active' | 'suspended' | 'removed' },
  ): Promise<OrganizationMember>;
  removeMember(userId: string, organizationId: string, memberId: string): Promise<void>;
  requireMembership(
    organizationId: string,
    userId: string,
    capability?: OrganizationCapability,
    client?: DatabaseClient,
  ): Promise<OrganizationMember>;
  getCreditBalance(userId: string, organizationId: string): Promise<OrganizationCreditBalance>;
  consumeCredits(input: ConsumeOrganizationCreditsRequest): Promise<OrganizationCreditBalance>;
  refundCredits(input: GrantOrganizationCreditsRequest & { jobId?: string | null }): Promise<OrganizationCreditBalance>;
  grantMonthlyCredits(
    input: GrantOrganizationCreditsRequest,
    client?: DatabaseClient,
  ): Promise<OrganizationCreditBalance>;
  grantPurchasedCredits(
    input: GrantOrganizationCreditsRequest & { packageCode?: CreditPackageCode | null },
    client?: DatabaseClient,
  ): Promise<OrganizationCreditBalance>;
  listUsageEvents(userId: string, organizationId: string): Promise<OrganizationUsageEvent[]>;
  listAuditLogs(userId: string, organizationId: string): Promise<OrganizationAuditLog[]>;
  recordGenerationCompleted(input: RecordOrganizationGenerationRequest): Promise<void>;
  recordGenerationFailed(input: RecordOrganizationGenerationRequest & { errorMessage?: string | null }): Promise<void>;
  recordWorkExported(input: RecordOrganizationWorkExportRequest): Promise<void>;
  recordAuditEvent(input: RecordOrganizationAuditEventRequest, client?: DatabaseClient): Promise<void>;
}

/**
 * OrganizationService is the authorization boundary for enterprise workspaces.
 * Existing personal flows do not pass organizationId and continue to use the
 * personal user_id scope. Calls with organizationId must pass through this
 * service before reading works, members, billing data, or shared credits.
 */
export class OrganizationService implements OrganizationServicePort {
  public constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly invitationEmailService?: OrganizationInvitationEmailServicePort,
    private readonly invitationUrlBuilder: InvitationUrlBuilder = new InvitationUrlBuilder('http://localhost:5173'),
  ) {}

  public async listWorkspaces(userId: string): Promise<OrganizationWorkspaceSummary[]> {
    return this.organizationRepository.listWorkspacesByUserId(userId);
  }

  public async createOrganization(
    userId: string,
    input: CreateOrganizationRequest,
  ): Promise<OrganizationWorkspaceSummary> {
    return this.organizationRepository.transaction(async (client) => {
      const organization = await this.organizationRepository.createOrganization(
        {
          name: input.name,
          legalName: input.legalName,
          billingEmail: input.billingEmail,
          planKey: 'enterprise_a',
          createdByUserId: userId,
        },
        client,
      );
      const membership = await this.organizationRepository.createOrUpdateMember(
        {
          organizationId: organization.id,
          userId,
          role: 'owner',
          status: 'active',
          invitedByUserId: null,
          joinedAt: new Date(),
        },
        client,
      );
      const balance = await this.organizationRepository.createCreditBalance(organization.id, client);
      await this.organizationRepository.insertAuditLog(
        {
          organizationId: organization.id,
          actorUserId: userId,
          action: 'organization.created',
          targetType: 'organization',
          targetId: organization.id,
        },
        client,
      );
      return { organization, membership, balance };
    });
  }

  public async getOrganization(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationWorkspaceSummary> {
    const membership = await this.requireMembership(organizationId, userId);
    const organization = await this.organizationRepository.findOrganizationById(organizationId);
    if (organization === null) {
      throw new NotFoundError('Organization not found');
    }

    return {
      organization,
      membership,
      balance: await this.organizationRepository.getCreditBalance(organizationId),
    };
  }

  public async updateOrganization(
    userId: string,
    organizationId: string,
    input: UpdateOrganizationRequest,
  ): Promise<Organization> {
    await this.requireMembership(organizationId, userId, 'manage_organization');
    // User-facing workspace edits must never alter contract state. Plan/status
    // changes are reserved for admin operations and Stripe webhook handling.
    const allowedUpdate = {
      name: input.name,
      legalName: input.legalName,
      billingEmail: input.billingEmail,
    };
    const organization = await this.organizationRepository.updateOrganization(organizationId, allowedUpdate);
    if (organization === null) {
      throw new NotFoundError('Organization not found');
    }
    await this.organizationRepository.insertAuditLog({
      organizationId,
      actorUserId: userId,
      action: 'organization.updated',
      targetType: 'organization',
      targetId: organizationId,
      metadata: {
        fields: Object.keys(allowedUpdate).filter(
          (key) => allowedUpdate[key as keyof typeof allowedUpdate] !== undefined,
        ),
      },
    });
    return organization;
  }

  public async adminUpdateOrganizationContract(
    actorUserId: string,
    organizationId: string,
    input: AdminUpdateOrganizationContractRequest,
  ): Promise<Organization> {
    return this.organizationRepository.transaction(async (client) => {
      const before = await this.organizationRepository.findOrganizationById(organizationId, client);
      if (before === null) {
        throw new NotFoundError('Organization not found');
      }

      const organization = await this.organizationRepository.updateOrganization(
        organizationId,
        {
          planKey: input.planKey,
          status: input.status,
          billingEmail: input.billingEmail,
        },
        client,
      );
      if (organization === null) {
        throw new NotFoundError('Organization not found');
      }

      await this.organizationRepository.insertAuditLog(
        {
          organizationId,
          actorUserId,
          action: 'organization.contract_updated',
          targetType: 'organization',
          targetId: organizationId,
          metadata: {
            from_plan_key: before.planKey,
            to_plan_key: organization.planKey,
            from_status: before.status,
            to_status: organization.status,
            billing_email_changed: before.billingEmail !== organization.billingEmail,
          },
        },
        client,
      );
      return organization;
    });
  }

  public async adminGrantCredits(
    input: GrantOrganizationCreditsRequest & {
      bucket: 'monthly' | 'purchased';
      packageCode?: CreditPackageCode | null;
    },
  ): Promise<OrganizationCreditBalance> {
    if (input.bucket === 'monthly') {
      return this.grantMonthlyCredits(input);
    }
    return this.grantPurchasedCredits({
      ...input,
      packageCode: input.packageCode ?? null,
    });
  }

  public async listMembers(userId: string, organizationId: string): Promise<OrganizationMember[]> {
    await this.requireMembership(organizationId, userId, 'manage_members');
    return this.organizationRepository.listMembers(organizationId);
  }

  public async listInvitations(userId: string, organizationId: string): Promise<OrganizationInvitation[]> {
    await this.requireMembership(organizationId, userId, 'manage_members');
    return this.organizationRepository.listInvitations(organizationId);
  }

  public async inviteMember(
    userId: string,
    organizationId: string,
    input: { email: string; role: OrganizationMemberRole },
  ): Promise<CreateOrganizationInvitationResult> {
    await this.requireMembership(organizationId, userId, 'manage_members');
    if (input.role === 'owner') {
      await this.requireMembership(organizationId, userId, 'manage_organization');
    }

    const normalizedEmail = input.email.trim().toLowerCase();
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashInvitationToken(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const organization = await this.organizationRepository.findOrganizationById(organizationId);
    if (organization === null) {
      throw new NotFoundError('Organization not found');
    }

    const invitation = await this.organizationRepository.transaction(async (client) => {
      const existing = await this.organizationRepository.findPendingInvitationByEmail(
        organizationId,
        normalizedEmail,
        client,
      );
      if (existing !== null) {
        const renewedInvitation = await this.organizationRepository.updateInvitationToken(
          existing.id,
          { tokenHash, expiresAt, role: input.role },
          client,
        );
        if (renewedInvitation === null) {
          throw new NotFoundError('Invitation not found');
        }
        const resetInvitation = await this.organizationRepository.updateInvitationSendStatus(
          existing.id,
          {
            sendStatus: 'not_sent',
            errorCode: null,
            errorMessage: null,
            incrementResendCount: true,
          },
          client,
        );
        if (resetInvitation === null) {
          throw new NotFoundError('Invitation not found');
        }
        await this.organizationRepository.insertAuditLog(
          {
            organizationId,
            actorUserId: userId,
            action: 'member.invitation_resent',
            targetType: 'invitation',
            targetId: existing.id,
            metadata: { email: normalizedEmail, role: input.role, reason: 'duplicate_pending_invite' },
          },
          client,
        );
        return resetInvitation;
      }

      const invitation = await this.organizationRepository.createInvitation(
        {
          organizationId,
          email: normalizedEmail,
          role: input.role,
          tokenHash,
          invitedByUserId: userId,
          expiresAt,
        },
        client,
      );
      await this.organizationRepository.insertAuditLog(
        {
          organizationId,
          actorUserId: userId,
          action: 'member.invited',
          targetType: 'invitation',
          targetId: invitation.id,
          metadata: { email: normalizedEmail, role: input.role },
        },
        client,
      );
      return invitation;
    });

    return this.buildInvitationResult(organization, invitation, token);
  }

  public async resendInvitation(
    userId: string,
    organizationId: string,
    invitationId: string,
  ): Promise<CreateOrganizationInvitationResult> {
    await this.requireMembership(organizationId, userId, 'manage_members');
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashInvitationToken(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const { organization, invitation } = await this.organizationRepository.transaction(async (client) => {
      const organization = await this.organizationRepository.findOrganizationById(organizationId, client);
      if (organization === null) {
        throw new NotFoundError('Organization not found');
      }
      const current = await this.organizationRepository.findInvitationById(organizationId, invitationId, client);
      if (current === null) {
        throw new NotFoundError('Invitation not found');
      }
      if (current.status !== 'pending') {
        throw new ConflictError('Only pending invitations can be resent');
      }
      const invitation = await this.organizationRepository.updateInvitationToken(
        invitationId,
        { tokenHash, expiresAt },
        client,
      );
      if (invitation === null) {
        throw new NotFoundError('Invitation not found');
      }
      const resetInvitation = await this.organizationRepository.updateInvitationSendStatus(
        invitationId,
        {
          sendStatus: 'not_sent',
          errorCode: null,
          errorMessage: null,
          incrementResendCount: true,
        },
        client,
      );
      if (resetInvitation === null) {
        throw new NotFoundError('Invitation not found');
      }
      await this.organizationRepository.insertAuditLog(
        {
          organizationId,
          actorUserId: userId,
          action: 'member.invitation_resent',
          targetType: 'invitation',
          targetId: invitationId,
          metadata: { email: invitation.email, role: invitation.role },
        },
        client,
      );
      return { organization, invitation: resetInvitation };
    });

    return this.buildInvitationResult(organization, invitation, token);
  }

  public async revokeInvitation(
    userId: string,
    organizationId: string,
    invitationId: string,
  ): Promise<OrganizationInvitation> {
    await this.requireMembership(organizationId, userId, 'manage_members');
    return this.organizationRepository.transaction(async (client) => {
      const current = await this.organizationRepository.findInvitationById(organizationId, invitationId, client);
      if (current === null) {
        throw new NotFoundError('Invitation not found');
      }
      if (current.status !== 'pending') {
        throw new ConflictError('Only pending invitations can be revoked');
      }
      const revoked = await this.organizationRepository.revokeInvitation(
        invitationId,
        {
          revokedAt: new Date(),
          revokedByUserId: userId,
        },
        client,
      );
      if (revoked === null) {
        throw new NotFoundError('Invitation not found');
      }
      await this.organizationRepository.insertAuditLog(
        {
          organizationId,
          actorUserId: userId,
          action: 'member.invitation_revoked',
          targetType: 'invitation',
          targetId: invitationId,
          metadata: { email: current.email, role: current.role },
        },
        client,
      );
      return revoked;
    });
  }

  public async previewInvitation(token: string): Promise<{
    organization: Pick<Organization, 'id' | 'name'>;
    invitation: Pick<OrganizationInvitation, 'email' | 'role' | 'status' | 'expiresAt'>;
  }> {
    const tokenHash = hashInvitationToken(token);
    const invitation = await this.organizationRepository.transaction(async (client) => {
      const current = await this.organizationRepository.findInvitationByTokenHash(tokenHash, client);
      if (current === null) {
        return null;
      }
      if (current.status === 'pending' && current.expiresAt.getTime() < Date.now()) {
        return this.organizationRepository.updateInvitation(current.id, { status: 'expired' }, client);
      }
      return current;
    });
    if (invitation === null) {
      logInvitationDiagnostic('organization_invitation_preview_failed', { reason: 'token_not_found' });
      throw new NotFoundError('Invitation not found');
    }
    const organization = await this.organizationRepository.findOrganizationById(invitation.organizationId);
    if (organization === null) {
      logInvitationDiagnostic('organization_invitation_preview_failed', {
        reason: 'organization_not_found',
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        invitedEmailDomain: emailDomain(invitation.email),
        invitationStatus: invitation.status,
      });
      throw new NotFoundError('Organization not found');
    }
    if (invitation.status !== 'pending') {
      logInvitationDiagnostic('organization_invitation_preview_unavailable', {
        reason: 'non_pending_status',
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        invitedEmailDomain: emailDomain(invitation.email),
        invitationStatus: invitation.status,
      });
    }
    return {
      organization: {
        id: organization.id,
        name: organization.name,
      },
      invitation: {
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      },
    };
  }

  public async acceptInvitation(
    userId: string,
    email: string,
    token: string,
  ): Promise<OrganizationWorkspaceSummary> {
    const tokenHash = hashInvitationToken(token);
    const normalizedEmail = email.trim().toLowerCase();

    return this.organizationRepository.transaction(async (client) => {
      const invitation = await this.organizationRepository.findInvitationByTokenHash(tokenHash, client);
      if (invitation === null || invitation.status !== 'pending') {
        logInvitationDiagnostic('organization_invitation_accept_failed', {
          reason: invitation === null ? 'token_not_found' : 'non_pending_status',
          invitationId: invitation?.id,
          organizationId: invitation?.organizationId,
          invitedEmailDomain: invitation === null ? undefined : emailDomain(invitation.email),
          signedInEmailDomain: emailDomain(normalizedEmail),
          invitationStatus: invitation?.status,
        });
        throw new NotFoundError('Invitation not found');
      }
      if (invitation.expiresAt.getTime() < Date.now()) {
        await this.organizationRepository.updateInvitation(invitation.id, { status: 'expired' }, client);
        logInvitationDiagnostic('organization_invitation_accept_failed', {
          reason: 'expired',
          invitationId: invitation.id,
          organizationId: invitation.organizationId,
          invitedEmailDomain: emailDomain(invitation.email),
          signedInEmailDomain: emailDomain(normalizedEmail),
          invitationStatus: invitation.status,
        });
        throw new ConflictError('Invitation has expired');
      }
      if (invitation.email !== normalizedEmail) {
        logInvitationDiagnostic('organization_invitation_accept_failed', {
          reason: 'email_mismatch',
          invitationId: invitation.id,
          organizationId: invitation.organizationId,
          invitedEmailDomain: emailDomain(invitation.email),
          signedInEmailDomain: emailDomain(normalizedEmail),
          invitationStatus: invitation.status,
        });
        throw new ForbiddenError('Invitation email does not match the signed-in account');
      }

      const membership = await this.organizationRepository.createOrUpdateMember(
        {
          organizationId: invitation.organizationId,
          userId,
          role: invitation.role,
          status: 'active',
          invitedByUserId: invitation.invitedByUserId,
          joinedAt: new Date(),
        },
        client,
      );
      await this.organizationRepository.updateInvitation(
        invitation.id,
        {
          status: 'accepted',
          acceptedByUserId: userId,
          acceptedAt: new Date(),
        },
        client,
      );
      await this.organizationRepository.insertAuditLog(
        {
          organizationId: invitation.organizationId,
          actorUserId: userId,
          action: 'member.joined',
          targetType: 'member',
          targetId: membership.id,
          metadata: { role: invitation.role },
        },
        client,
      );
      logInvitationDiagnostic('organization_invitation_accept_succeeded', {
        reason: 'accepted',
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        invitedEmailDomain: emailDomain(invitation.email),
        signedInEmailDomain: emailDomain(normalizedEmail),
        invitationStatus: 'accepted',
      });
      const organization = await this.organizationRepository.findOrganizationById(invitation.organizationId, client);
      if (organization === null) {
        throw new NotFoundError('Organization not found');
      }
      return {
        organization,
        membership,
        balance: await this.organizationRepository.getCreditBalance(invitation.organizationId, client),
      };
    });
  }

  private async buildInvitationResult(
    organization: Organization,
    invitation: OrganizationInvitation,
    token: string,
  ): Promise<CreateOrganizationInvitationResult> {
    const invitationUrl = this.invitationUrlBuilder.buildInvitationUrl(token);
    const emailDelivery =
      this.invitationEmailService === undefined
        ? ({ status: 'disabled' } as const)
        : await this.invitationEmailService.deliverInvitation({
            organization,
            invitation,
            invitationUrl,
          });
    const latestInvitation =
      (await this.organizationRepository.findInvitationById(organization.id, invitation.id)) ?? invitation;
    return {
      invitation: latestInvitation,
      invitationUrl,
      emailDelivery,
    };
  }

  public async updateMember(
    userId: string,
    organizationId: string,
    memberId: string,
    input: { role?: OrganizationMemberRole; status?: 'active' | 'suspended' | 'removed' },
  ): Promise<OrganizationMember> {
    await this.requireMembership(organizationId, userId, 'manage_members');
    return this.organizationRepository.transaction(async (client) => {
      const current = await this.organizationRepository.findMemberById(organizationId, memberId, client);
      if (current === null) {
        throw new NotFoundError('Member not found');
      }
      if (touchesOwnerAuthority(current, input)) {
        await this.requireMembership(organizationId, userId, 'manage_organization', client);
      }
      await this.ensureLastOwnerIsKept(organizationId, current, input, client);
      const updated = await this.organizationRepository.updateMember(organizationId, memberId, input, client);
      if (updated === null) {
        throw new NotFoundError('Member not found');
      }
      for (const entry of memberAuditEntries(current, updated)) {
        await this.organizationRepository.insertAuditLog(
          {
            organizationId,
            actorUserId: userId,
            action: entry.action,
            targetType: 'member',
            targetId: memberId,
            metadata: entry.metadata,
          },
          client,
        );
      }
      return updated;
    });
  }

  public async removeMember(userId: string, organizationId: string, memberId: string): Promise<void> {
    await this.updateMember(userId, organizationId, memberId, { status: 'removed' });
  }

  public async requireMembership(
    organizationId: string,
    userId: string,
    capability?: OrganizationCapability,
    client?: DatabaseClient,
  ): Promise<OrganizationMember> {
    const organization = await this.organizationRepository.findOrganizationById(organizationId, client);
    if (organization === null) {
      throw new NotFoundError('Organization not found');
    }
    const member = await this.organizationRepository.findMemberByOrganizationAndUser(
      organizationId,
      userId,
      client,
    );
    if (member === null || member.status !== 'active') {
      throw new NotFoundError('Organization not found');
    }
    if (capability !== undefined && !roleHasCapability(member.role, capability)) {
      throw new ForbiddenError('You do not have permission for this organization action');
    }
    if (!canUseOrganizationCapabilityByStatus(organization.status, capability)) {
      throw new ForbiddenError('This organization workspace is not available for this action');
    }
    return member;
  }

  public async getCreditBalance(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationCreditBalance> {
    await this.requireMembership(organizationId, userId);
    return (await this.organizationRepository.getCreditBalance(organizationId)) ?? emptyOrgBalance(organizationId);
  }

  public async consumeCredits(input: ConsumeOrganizationCreditsRequest): Promise<OrganizationCreditBalance> {
    assertPositiveInteger(input.cost, 'Credit cost');

    return this.organizationRepository.transaction(async (client) => {
      await this.requireMembership(input.organizationId, input.userId, 'generate', client);
      const balance =
        (await this.organizationRepository.getCreditBalanceForUpdate(input.organizationId, client)) ??
        (await this.organizationRepository.createCreditBalance(input.organizationId, client));
      const total = balance.monthlyCredits + balance.purchasedCredits;
      if (total < input.cost) {
        throw new InsufficientCreditsError();
      }

      const monthlyDelta = -Math.min(balance.monthlyCredits, input.cost);
      const purchasedDelta = -(input.cost + monthlyDelta);
      const next = await this.organizationRepository.updateCreditBalance(
        {
          ...balance,
          monthlyCredits: balance.monthlyCredits + monthlyDelta,
          purchasedCredits: balance.purchasedCredits + purchasedDelta,
        },
        client,
      );
      await this.organizationRepository.insertCreditLedger({
        userId: input.userId,
        organizationId: input.organizationId,
        type: 'consume',
        amount: -input.cost,
        monthlyDelta,
        purchasedDelta,
        monthlyAfter: next.monthlyCredits,
        purchasedAfter: next.purchasedCredits,
        description: input.description,
        stripeEventId: null,
        jobId: input.jobId ?? null,
      }, client);
      await this.organizationRepository.insertUsageEvent(
        {
          organizationId: input.organizationId,
          userId: input.userId,
          workId: input.workId ?? null,
          generationJobId: input.jobId ?? null,
          eventType: input.eventType ?? 'generation.credit_consumed',
          creditAmount: input.cost,
          metadata: buildCreditUsageMetadata({
            eventType: input.eventType ?? 'generation.credit_consumed',
            creditsUsed: input.cost,
            status: usageStatusForEvent(input.eventType ?? 'generation.credit_consumed'),
            description: input.description,
          }),
        },
        client,
      );
      if (isGenerationStartedEvent(input.eventType ?? 'generation.credit_consumed')) {
        await this.organizationRepository.insertAuditLog(
          {
            organizationId: input.organizationId,
            actorUserId: input.userId,
            action: input.eventType ?? 'generation.started',
            targetType: 'generation_job',
            targetId: input.jobId ?? null,
            metadata: {
              work_id: input.workId ?? null,
              ...buildCreditUsageMetadata({
                eventType: input.eventType ?? 'generation.started',
                creditsUsed: input.cost,
                status: 'started',
                description: input.description,
              }),
            },
          },
          client,
        );
      }
      await this.organizationRepository.insertAuditLog(
        {
          organizationId: input.organizationId,
          actorUserId: input.userId,
          action: 'credit.consumed',
          targetType: 'credit',
          targetId: input.jobId ?? null,
          metadata: {
            amount: input.cost,
            monthly_delta: monthlyDelta,
            purchased_delta: purchasedDelta,
            monthly_after: next.monthlyCredits,
            purchased_after: next.purchasedCredits,
            work_id: input.workId ?? null,
            event_type: input.eventType ?? 'generation.credit_consumed',
            description: input.description,
          },
        },
        client,
      );
      return next;
    });
  }

  public async refundCredits(
    input: GrantOrganizationCreditsRequest & { jobId?: string | null },
  ): Promise<OrganizationCreditBalance> {
    assertPositiveInteger(input.amount, 'Refund amount');
    return this.organizationRepository.transaction(async (client) => {
      const balance =
        (await this.organizationRepository.getCreditBalanceForUpdate(input.organizationId, client)) ??
        (await this.organizationRepository.createCreditBalance(input.organizationId, client));
      const refundDeltas = input.jobId === undefined || input.jobId === null
        ? { amount: input.amount, monthlyDelta: 0, purchasedDelta: input.amount }
        : await this.calculateOrganizationJobRefundDeltas(
            input.organizationId,
            input.jobId,
            input.amount,
            client,
          );
      if (refundDeltas === null) {
        return balance;
      }
      const next = await this.organizationRepository.updateCreditBalance(
        {
          ...balance,
          monthlyCredits: balance.monthlyCredits + refundDeltas.monthlyDelta,
          purchasedCredits: balance.purchasedCredits + refundDeltas.purchasedDelta,
        },
        client,
      );
      await this.organizationRepository.insertCreditLedger({
        userId: input.actorUserId,
        organizationId: input.organizationId,
        type: 'refund',
        amount: refundDeltas.amount,
        monthlyDelta: refundDeltas.monthlyDelta,
        purchasedDelta: refundDeltas.purchasedDelta,
        monthlyAfter: next.monthlyCredits,
        purchasedAfter: next.purchasedCredits,
        description: input.description,
        stripeEventId: input.stripeEventId ?? null,
        jobId: input.jobId ?? null,
      }, client);
      await this.organizationRepository.insertUsageEvent(
        {
          organizationId: input.organizationId,
          userId: input.actorUserId,
          workId: null,
          generationJobId: null,
          eventType: 'credit.refunded',
          creditAmount: 0,
          metadata: {
            action_type: 'refund',
            status: 'refunded',
            credits_refunded: refundDeltas.amount,
            stripe_event_id: input.stripeEventId ?? null,
            description: input.description,
          },
        },
        client,
      );
      await this.organizationRepository.insertAuditLog(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'credit.refunded',
          targetType: 'credit',
          targetId: input.jobId ?? null,
          metadata: {
            amount: refundDeltas.amount,
            monthly_delta: refundDeltas.monthlyDelta,
            purchased_delta: refundDeltas.purchasedDelta,
            monthly_after: next.monthlyCredits,
            purchased_after: next.purchasedCredits,
            stripe_event_id: input.stripeEventId ?? null,
            description: input.description,
          },
        },
        client,
      );
      return next;
    });
  }

  private async calculateOrganizationJobRefundDeltas(
    organizationId: string,
    jobId: string,
    requestedAmount: number,
    client: DatabaseClient,
  ): Promise<{ amount: number; monthlyDelta: number; purchasedDelta: number } | null> {
    const consumed = await this.organizationRepository.summarizeJobCreditLedger(
      organizationId,
      jobId,
      'consume',
      client,
    );
    if (consumed.entryCount === 0) {
      return null;
    }
    const refunded = await this.organizationRepository.summarizeJobCreditLedger(
      organizationId,
      jobId,
      'refund',
      client,
    );
    if (
      consumed.entryCount !== consumed.completeEntryCount ||
      refunded.entryCount !== refunded.completeEntryCount
    ) {
      const refundableAmount = Math.abs(consumed.amount) - refunded.amount;
      if (refundableAmount <= 0) {
        return null;
      }
      const amount = Math.min(requestedAmount, refundableAmount);
      return { amount, monthlyDelta: 0, purchasedDelta: amount };
    }
    const remainingMonthly = Math.max(0, -consumed.monthlyDelta - refunded.monthlyDelta);
    const remainingPurchased = Math.max(0, -consumed.purchasedDelta - refunded.purchasedDelta);
    const refundableAmount = remainingMonthly + remainingPurchased;
    if (refundableAmount <= 0) {
      return null;
    }
    const amount = Math.min(requestedAmount, refundableAmount);
    const monthlyDelta = Math.min(remainingMonthly, amount);
    return { amount, monthlyDelta, purchasedDelta: amount - monthlyDelta };
  }

  public async grantMonthlyCredits(
    input: GrantOrganizationCreditsRequest,
    client?: DatabaseClient,
  ): Promise<OrganizationCreditBalance> {
    assertPositiveInteger(input.amount, 'Monthly credit grant amount');
    const work = async (transactionClient: DatabaseClient): Promise<OrganizationCreditBalance> => {
      const balance =
        (await this.organizationRepository.getCreditBalanceForUpdate(input.organizationId, transactionClient)) ??
        (await this.organizationRepository.createCreditBalance(input.organizationId, transactionClient));
      const nextExpiresAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
      const next = await this.organizationRepository.updateCreditBalance(
        {
          ...balance,
          monthlyCredits: input.amount,
          monthlyExpiresAt: nextExpiresAt,
        },
        transactionClient,
      );
      await this.organizationRepository.insertCreditLedger({
        userId: input.actorUserId,
        organizationId: input.organizationId,
        type: 'monthly_grant',
        amount: input.amount,
        monthlyDelta: input.amount - balance.monthlyCredits,
        purchasedDelta: 0,
        monthlyAfter: next.monthlyCredits,
        purchasedAfter: next.purchasedCredits,
        description: input.description,
        stripeEventId: input.stripeEventId ?? null,
        jobId: null,
      }, transactionClient);
      await this.organizationRepository.insertAuditLog(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'credit.granted',
          targetType: 'credit',
          targetId: null,
          metadata: {
            grant_type: 'monthly',
            amount: input.amount,
            monthly_after: next.monthlyCredits,
            purchased_after: next.purchasedCredits,
            monthly_expires_at: next.monthlyExpiresAt?.toISOString() ?? null,
            stripe_event_id: input.stripeEventId ?? null,
            description: input.description,
          },
        },
        transactionClient,
      );
      return next;
    };
    return client === undefined ? this.organizationRepository.transaction(work) : work(client);
  }

  public async grantPurchasedCredits(
    input: GrantOrganizationCreditsRequest & { packageCode?: CreditPackageCode | null },
    client?: DatabaseClient,
  ): Promise<OrganizationCreditBalance> {
    assertPositiveInteger(input.amount, 'Purchased credit grant amount');
    const work = async (transactionClient: DatabaseClient): Promise<OrganizationCreditBalance> => {
      const balance =
        (await this.organizationRepository.getCreditBalanceForUpdate(input.organizationId, transactionClient)) ??
        (await this.organizationRepository.createCreditBalance(input.organizationId, transactionClient));
      const next = await this.organizationRepository.updateCreditBalance(
        {
          ...balance,
          purchasedCredits: balance.purchasedCredits + input.amount,
        },
        transactionClient,
      );
      await this.organizationRepository.insertCreditLedger({
        userId: input.actorUserId,
        organizationId: input.organizationId,
        type: 'purchased_grant',
        amount: input.amount,
        monthlyDelta: 0,
        purchasedDelta: input.amount,
        monthlyAfter: next.monthlyCredits,
        purchasedAfter: next.purchasedCredits,
        description: input.description,
        stripeEventId: input.stripeEventId ?? null,
        jobId: null,
      }, transactionClient);
      await this.organizationRepository.insertAuditLog(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'credit.granted',
          targetType: 'credit',
          targetId: null,
          metadata: {
            grant_type: 'purchased',
            amount: input.amount,
            package_code: input.packageCode ?? null,
            monthly_after: next.monthlyCredits,
            purchased_after: next.purchasedCredits,
            stripe_event_id: input.stripeEventId ?? null,
            description: input.description,
          },
        },
        transactionClient,
      );
      return next;
    };
    return client === undefined ? this.organizationRepository.transaction(work) : work(client);
  }

  public async listUsageEvents(userId: string, organizationId: string): Promise<OrganizationUsageEvent[]> {
    await this.requireMembership(organizationId, userId, 'view_usage');
    return this.organizationRepository.listUsageEvents(organizationId, 200);
  }

  public async listAuditLogs(userId: string, organizationId: string): Promise<OrganizationAuditLog[]> {
    const member = await this.requireMembership(organizationId, userId);
    if (roleHasCapability(member.role, 'view_audit_logs')) {
      return this.organizationRepository.listAuditLogs(organizationId, 200);
    }
    if (roleHasCapability(member.role, 'view_billing')) {
      return this.organizationRepository.listAuditLogsByActionPrefixes(
        organizationId,
        BILLING_AUDIT_ACTION_PREFIXES,
        200,
      );
    }
    throw new ForbiddenError('You do not have permission for this organization action');
  }

  public async recordGenerationCompleted(input: RecordOrganizationGenerationRequest): Promise<void> {
    await this.recordGenerationEvent('generation.completed', input);
  }

  public async recordGenerationFailed(
    input: RecordOrganizationGenerationRequest & { errorMessage?: string | null },
  ): Promise<void> {
    await this.recordGenerationEvent('generation.failed', {
      ...input,
      metadata: {
        ...(input.metadata ?? {}),
        error_message: input.errorMessage ?? null,
      },
    });
  }

  public async recordWorkExported(input: RecordOrganizationWorkExportRequest): Promise<void> {
    await this.organizationRepository.transaction(async (client) => {
      await this.organizationRepository.insertUsageEvent(
        {
          organizationId: input.organizationId,
          userId: input.userId,
          workId: input.workId,
          generationJobId: null,
          eventType: 'work.exported',
          creditAmount: 0,
          metadata: {
            page_id: input.pageId ?? null,
            ...(input.metadata ?? {}),
          },
        },
        client,
      );
      await this.organizationRepository.insertAuditLog(
        {
          organizationId: input.organizationId,
          actorUserId: input.userId,
          action: 'work.exported',
          targetType: 'work',
          targetId: input.workId,
          metadata: {
            page_id: input.pageId ?? null,
            ...(input.metadata ?? {}),
          },
        },
        client,
      );
    });
  }

  public async recordAuditEvent(
    input: RecordOrganizationAuditEventRequest,
    client?: DatabaseClient,
  ): Promise<void> {
    await this.organizationRepository.insertAuditLog(
      {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        metadata: compactAuditMetadata(input.metadata ?? {}),
      },
      client,
    );
  }

  private async recordGenerationEvent(
    action: 'generation.completed' | 'generation.failed',
    input: RecordOrganizationGenerationRequest,
  ): Promise<void> {
    const metadata = {
      action_type: 'generation',
      generation_type: input.generationType,
      status: action === 'generation.completed' ? 'completed' : 'failed',
      credits_used: input.creditAmount ?? 0,
      ...(input.metadata ?? {}),
    };
    await this.organizationRepository.transaction(async (client) => {
      await this.organizationRepository.insertUsageEvent(
        {
          organizationId: input.organizationId,
          userId: input.userId,
          workId: input.workId ?? null,
          generationJobId: input.jobId,
          eventType: action,
          creditAmount: input.creditAmount ?? 0,
          metadata,
        },
        client,
      );
      await this.organizationRepository.insertAuditLog(
        {
          organizationId: input.organizationId,
          actorUserId: input.userId,
          action,
          targetType: 'generation_job',
          targetId: input.jobId,
          metadata: {
            work_id: input.workId ?? null,
            ...metadata,
          },
        },
        client,
      );
    });
  }

  private async ensureLastOwnerIsKept(
    organizationId: string,
    current: OrganizationMember,
    input: { role?: OrganizationMemberRole; status?: 'active' | 'suspended' | 'removed' },
    client: DatabaseClient,
  ): Promise<void> {
    const wouldLoseOwner =
      current.role === 'owner' &&
      current.status === 'active' &&
      ((input.role !== undefined && input.role !== 'owner') ||
        (input.status !== undefined && input.status !== 'active'));
    if (!wouldLoseOwner) {
      return;
    }
    const ownerCount = await this.organizationRepository.countActiveOwners(organizationId, client);
    if (ownerCount <= 1) {
      throw new ConflictError('Organization must keep at least one active owner');
    }
  }
}

function memberAuditEntries(
  before: OrganizationMember,
  after: OrganizationMember,
): Array<{ action: string; metadata: Record<string, unknown> }> {
  const entries: Array<{ action: string; metadata: Record<string, unknown> }> = [];
  if (before.role !== after.role) {
    entries.push({
      action: 'member.role_updated',
      metadata: { from_role: before.role, to_role: after.role },
    });
  }
  if (before.status !== after.status) {
    if (after.status === 'suspended') {
      entries.push({
        action: 'member.suspended',
        metadata: { from_status: before.status, to_status: after.status },
      });
    } else if (after.status === 'removed') {
      entries.push({
        action: 'member.removed',
        metadata: { from_status: before.status, to_status: after.status },
      });
    } else if (after.status === 'active') {
      entries.push({
        action: 'member.reactivated',
        metadata: { from_status: before.status, to_status: after.status },
      });
    }
  }
  return entries;
}

function compactAuditMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries.slice(0, 30));
}

function touchesOwnerAuthority(
  current: OrganizationMember,
  input: { role?: OrganizationMemberRole; status?: 'active' | 'suspended' | 'removed' },
): boolean {
  return current.role === 'owner' || input.role === 'owner';
}

export function monthlyCreditsForEnterprisePlan(planKey: EnterprisePlanCode): number {
  return ENTERPRISE_PLAN_DEFINITIONS[planKey].monthlyCredits;
}

export function purchasedCreditsForPackage(packageCode: CreditPackageCode): number {
  return CREDIT_PACKAGE_DEFINITIONS[packageCode].purchasedCredits;
}

function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

interface InvitationDiagnosticFields {
  reason: string;
  invitationId?: string;
  organizationId?: string;
  invitedEmailDomain?: string;
  signedInEmailDomain?: string;
  invitationStatus?: OrganizationInvitation['status'];
}

function logInvitationDiagnostic(event: string, fields: InvitationDiagnosticFields): void {
  console.info(
    JSON.stringify({
      level: fields.reason === 'accepted' ? 'info' : 'warn',
      event,
      reason: fields.reason,
      invitation_id: fields.invitationId,
      organization_id: fields.organizationId,
      invited_email_domain: fields.invitedEmailDomain,
      signed_in_email_domain: fields.signedInEmailDomain,
      invitation_status: fields.invitationStatus,
    }),
  );
}

function emailDomain(email: string): string {
  const [, domain = ''] = email.trim().toLowerCase().split('@');
  return domain;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`${label} must be a positive integer`);
  }
}

function canUseOrganizationCapabilityByStatus(
  status: OrganizationStatus,
  capability?: OrganizationCapability,
): boolean {
  if (capability === undefined) {
    return true;
  }

  if (status === 'active' || status === 'trialing') {
    return true;
  }

  if (capability === 'manage_billing' || capability === 'view_billing') {
    return true;
  }

  if (status === 'past_due') {
    return capability === 'view_work' || capability === 'view_usage' || capability === 'view_audit_logs';
  }

  return false;
}

function buildCreditUsageMetadata(input: {
  eventType: string;
  creditsUsed: number;
  status: string;
  description: string;
}): Record<string, unknown> {
  return {
    action_type: 'generation',
    generation_type: inferGenerationType(input.eventType),
    status: input.status,
    credits_used: input.creditsUsed,
    description: input.description,
  };
}

function usageStatusForEvent(eventType: string): string {
  if (eventType.endsWith('.started')) {
    return 'started';
  }
  return 'consumed';
}

function isGenerationStartedEvent(eventType: string): boolean {
  return eventType === 'generation.started' || eventType === 'entity_generation.started';
}

function inferGenerationType(eventType: string): string | null {
  if (
    eventType === 'generation.started' ||
    eventType === 'generation.completed' ||
    eventType === 'generation.failed'
  ) {
    return 'page_generate';
  }
  if (eventType.startsWith('entity_generation.')) {
    return 'entity_generate';
  }
  if (eventType.startsWith('entity_import.')) {
    return 'entity_import_analysis';
  }
  return null;
}

function emptyOrgBalance(organizationId: string): OrganizationCreditBalance {
  return {
    organizationId,
    monthlyCredits: 0,
    purchasedCredits: 0,
    monthlyExpiresAt: null,
    updatedAt: new Date(0),
  };
}
