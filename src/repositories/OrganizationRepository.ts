import type { QueryResultRow } from 'pg';
import type {
  Organization,
  OrganizationAuditLog,
  OrganizationCreditBalance,
  EmailDeliveryLog,
  EmailDeliveryStatus,
  OrganizationInvitation,
  OrganizationInvitationSendStatus,
  OrganizationMember,
  OrganizationMemberRole,
  OrganizationMemberStatus,
  OrganizationStatus,
  OrganizationUsageEvent,
  OrganizationWorkspaceSummary,
} from '../domain/types/organization.js';
import type { EnterprisePlanCode } from '../domain/constants/billing.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

interface OrganizationRow extends QueryResultRow {
  id: string;
  type: Organization['type'];
  name: string;
  legal_name: string | null;
  status: OrganizationStatus;
  plan_key: EnterprisePlanCode;
  billing_email: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
}

interface OrganizationMemberRow extends QueryResultRow {
  id: string;
  organization_id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  role: OrganizationMemberRole;
  status: OrganizationMemberStatus;
  invited_by_user_id: string | null;
  joined_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface OrganizationInvitationRow extends QueryResultRow {
  id: string;
  organization_id: string;
  email: string;
  role: OrganizationMemberRole;
  status: OrganizationInvitation['status'];
  send_status: OrganizationInvitationSendStatus;
  send_error_code: string | null;
  send_error_message: string | null;
  sent_at: Date | null;
  last_sent_at: Date | null;
  resend_count: number;
  invited_by_user_id: string;
  accepted_by_user_id: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  revoked_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface EmailDeliveryLogRow extends QueryResultRow {
  id: string;
  organization_id: string | null;
  invitation_id: string | null;
  recipient_email: string;
  template_key: string;
  provider: string;
  status: EmailDeliveryStatus;
  provider_message_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

interface OrganizationCreditBalanceRow extends QueryResultRow {
  organization_id: string;
  monthly_credits: number;
  purchased_credits: number;
  monthly_expires_at: Date | null;
  updated_at: Date;
}

interface OrganizationAuditLogRow extends QueryResultRow {
  id: string;
  organization_id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: unknown;
  created_at: Date;
}

interface OrganizationUsageEventRow extends QueryResultRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  work_id: string | null;
  generation_job_id: string | null;
  event_type: string;
  credit_amount: number;
  metadata: unknown;
  created_at: Date;
}

interface OrganizationWorkspaceRow extends QueryResultRow {
  org_id: string;
  org_type: Organization['type'];
  org_name: string;
  org_legal_name: string | null;
  org_status: OrganizationStatus;
  org_plan_key: EnterprisePlanCode;
  org_billing_email: string | null;
  org_stripe_customer_id: string | null;
  org_stripe_subscription_id: string | null;
  org_created_by_user_id: string;
  org_created_at: Date;
  org_updated_at: Date;
  member_id: string;
  member_organization_id: string;
  member_user_id: string;
  member_email: string;
  member_display_name: string | null;
  member_role: OrganizationMemberRole;
  member_status: OrganizationMemberStatus;
  member_invited_by_user_id: string | null;
  member_joined_at: Date | null;
  member_created_at: Date;
  member_updated_at: Date;
  balance_organization_id: string | null;
  balance_monthly_credits: number | null;
  balance_purchased_credits: number | null;
  balance_monthly_expires_at: Date | null;
  balance_updated_at: Date | null;
}

export interface CreateOrganizationRecord {
  name: string;
  legalName: string | null;
  billingEmail: string | null;
  planKey: EnterprisePlanCode;
  createdByUserId: string;
}

export interface CreateOrganizationInvitationRecord {
  organizationId: string;
  email: string;
  role: OrganizationMemberRole;
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: Date;
}

export interface OrganizationRepository {
  transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T>;
  createOrganization(input: CreateOrganizationRecord, client: DatabaseClient): Promise<Organization>;
  updateOrganization(
    organizationId: string,
    input: {
      name?: string;
      legalName?: string | null;
      billingEmail?: string | null;
      status?: OrganizationStatus;
      planKey?: EnterprisePlanCode;
      stripeCustomerId?: string | null;
      stripeSubscriptionId?: string | null;
    },
    client?: DatabaseClient,
  ): Promise<Organization | null>;
  createOrUpdateMember(
    input: {
      organizationId: string;
      userId: string;
      role: OrganizationMemberRole;
      status: OrganizationMemberStatus;
      invitedByUserId: string | null;
      joinedAt: Date | null;
    },
    client: DatabaseClient,
  ): Promise<OrganizationMember>;
  listWorkspacesByUserId(userId: string): Promise<OrganizationWorkspaceSummary[]>;
  findOrganizationById(organizationId: string, client?: DatabaseClient): Promise<Organization | null>;
  findMemberByOrganizationAndUser(
    organizationId: string,
    userId: string,
    client?: DatabaseClient,
  ): Promise<OrganizationMember | null>;
  findMemberById(
    organizationId: string,
    memberId: string,
    client?: DatabaseClient,
  ): Promise<OrganizationMember | null>;
  listMembers(organizationId: string): Promise<OrganizationMember[]>;
  updateMember(
    organizationId: string,
    memberId: string,
    input: { role?: OrganizationMemberRole; status?: OrganizationMemberStatus },
    client: DatabaseClient,
  ): Promise<OrganizationMember | null>;
  countActiveOwners(organizationId: string, client: DatabaseClient): Promise<number>;
  createInvitation(input: CreateOrganizationInvitationRecord, client: DatabaseClient): Promise<OrganizationInvitation>;
  listInvitations(organizationId: string, client?: DatabaseClient): Promise<OrganizationInvitation[]>;
  findPendingInvitationByEmail(
    organizationId: string,
    email: string,
    client?: DatabaseClient,
  ): Promise<OrganizationInvitation | null>;
  findInvitationByTokenHash(tokenHash: string, client: DatabaseClient): Promise<OrganizationInvitation | null>;
  findInvitationById(
    organizationId: string,
    invitationId: string,
    client?: DatabaseClient,
  ): Promise<OrganizationInvitation | null>;
  updateInvitation(
    invitationId: string,
    input: {
      status: OrganizationInvitation['status'];
      acceptedByUserId?: string | null;
      acceptedAt?: Date | null;
    },
    client: DatabaseClient,
  ): Promise<OrganizationInvitation | null>;
  updateInvitationToken(
    invitationId: string,
    input: { tokenHash: string; expiresAt: Date; role?: OrganizationMemberRole },
    client: DatabaseClient,
  ): Promise<OrganizationInvitation | null>;
  updateInvitationSendStatus(
    invitationId: string,
    input: {
      sendStatus: OrganizationInvitationSendStatus;
      providerMessageId?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      incrementResendCount?: boolean;
      sentAt?: Date | null;
      lastSentAt?: Date | null;
    },
    client?: DatabaseClient,
  ): Promise<OrganizationInvitation | null>;
  revokeInvitation(
    invitationId: string,
    input: { revokedByUserId: string; revokedAt: Date },
    client: DatabaseClient,
  ): Promise<OrganizationInvitation | null>;
  insertEmailDeliveryLog(
    input: {
      organizationId: string | null;
      invitationId: string | null;
      recipientEmail: string;
      templateKey: string;
      provider: string;
      status: EmailDeliveryStatus;
      providerMessageId?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    },
    client?: DatabaseClient,
  ): Promise<EmailDeliveryLog>;
  getCreditBalance(organizationId: string, client?: DatabaseClient): Promise<OrganizationCreditBalance | null>;
  getCreditBalanceForUpdate(organizationId: string, client: DatabaseClient): Promise<OrganizationCreditBalance | null>;
  createCreditBalance(organizationId: string, client: DatabaseClient): Promise<OrganizationCreditBalance>;
  updateCreditBalance(balance: OrganizationCreditBalance, client: DatabaseClient): Promise<OrganizationCreditBalance>;
  insertAuditLog(
    input: {
      organizationId: string;
      actorUserId: string | null;
      action: string;
      targetType: string;
      targetId: string | null;
      metadata?: Record<string, unknown>;
    },
    client?: DatabaseClient,
  ): Promise<void>;
  insertUsageEvent(
    input: {
      organizationId: string;
      userId: string | null;
      workId: string | null;
      generationJobId: string | null;
      eventType: string;
      creditAmount: number;
      metadata?: Record<string, unknown>;
    },
    client?: DatabaseClient,
  ): Promise<void>;
  listAuditLogs(organizationId: string, limit: number): Promise<OrganizationAuditLog[]>;
  listAuditLogsByActionPrefixes(
    organizationId: string,
    actionPrefixes: readonly string[],
    limit: number,
  ): Promise<OrganizationAuditLog[]>;
  listUsageEvents(organizationId: string, limit: number): Promise<OrganizationUsageEvent[]>;
}

const INVITATION_RETURNING_COLUMNS = `
  id,
  organization_id,
  email,
  role,
  status,
  send_status,
  send_error_code,
  send_error_message,
  sent_at,
  last_sent_at,
  resend_count,
  invited_by_user_id,
  accepted_by_user_id,
  expires_at,
  accepted_at,
  revoked_at,
  revoked_by_user_id,
  created_at,
  updated_at
`;

export class PostgresOrganizationRepository implements OrganizationRepository {
  public constructor(
    private readonly client: DatabaseClient,
    private readonly transactionRunner: TransactionRunner,
  ) {}

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return this.transactionRunner.transaction(work);
  }

  public async createOrganization(
    input: CreateOrganizationRecord,
    client: DatabaseClient,
  ): Promise<Organization> {
    const result = await client.query<OrganizationRow>(
      `
      INSERT INTO organizations (name, legal_name, billing_email, plan_key, created_by_user_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [input.name, input.legalName, input.billingEmail, input.planKey, input.createdByUserId],
    );

    return mapOrganizationRow(result.rows[0]);
  }

  public async updateOrganization(
    organizationId: string,
    input: {
      name?: string;
      legalName?: string | null;
      billingEmail?: string | null;
      status?: OrganizationStatus;
      planKey?: EnterprisePlanCode;
      stripeCustomerId?: string | null;
      stripeSubscriptionId?: string | null;
    },
    client: DatabaseClient = this.client,
  ): Promise<Organization | null> {
    const result = await client.query<OrganizationRow>(
      `
      UPDATE organizations
      SET name = COALESCE($2, name),
          legal_name = CASE WHEN $3::boolean THEN $4 ELSE legal_name END,
          billing_email = CASE WHEN $5::boolean THEN $6 ELSE billing_email END,
          status = COALESCE($7, status),
          plan_key = COALESCE($8, plan_key),
          stripe_customer_id = CASE WHEN $9::boolean THEN $10 ELSE stripe_customer_id END,
          stripe_subscription_id = CASE WHEN $11::boolean THEN $12 ELSE stripe_subscription_id END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        organizationId,
        input.name ?? null,
        input.legalName !== undefined,
        input.legalName ?? null,
        input.billingEmail !== undefined,
        input.billingEmail ?? null,
        input.status ?? null,
        input.planKey ?? null,
        input.stripeCustomerId !== undefined,
        input.stripeCustomerId ?? null,
        input.stripeSubscriptionId !== undefined,
        input.stripeSubscriptionId ?? null,
      ],
    );

    return result.rows[0] === undefined ? null : mapOrganizationRow(result.rows[0]);
  }

  public async createOrUpdateMember(
    input: {
      organizationId: string;
      userId: string;
      role: OrganizationMemberRole;
      status: OrganizationMemberStatus;
      invitedByUserId: string | null;
      joinedAt: Date | null;
    },
    client: DatabaseClient,
  ): Promise<OrganizationMember> {
    const result = await client.query<OrganizationMemberRow>(
      `
      WITH upserted AS (
        INSERT INTO organization_members (
          organization_id,
          user_id,
          role,
          status,
          invited_by_user_id,
          joined_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (organization_id, user_id)
        DO UPDATE SET
          role = EXCLUDED.role,
          status = EXCLUDED.status,
          invited_by_user_id = COALESCE(EXCLUDED.invited_by_user_id, organization_members.invited_by_user_id),
          joined_at = COALESCE(EXCLUDED.joined_at, organization_members.joined_at),
          updated_at = NOW()
        RETURNING *
      )
      SELECT upserted.*, users.email, users.display_name
      FROM upserted
      INNER JOIN users ON users.id = upserted.user_id
      `,
      [input.organizationId, input.userId, input.role, input.status, input.invitedByUserId, input.joinedAt],
    );

    return mapMemberRow(result.rows[0]);
  }

  public async listWorkspacesByUserId(userId: string): Promise<OrganizationWorkspaceSummary[]> {
    const result = await this.client.query<OrganizationWorkspaceRow>(
      `
      SELECT
        organizations.id AS org_id,
        organizations.type AS org_type,
        organizations.name AS org_name,
        organizations.legal_name AS org_legal_name,
        organizations.status AS org_status,
        organizations.plan_key AS org_plan_key,
        organizations.billing_email AS org_billing_email,
        organizations.stripe_customer_id AS org_stripe_customer_id,
        organizations.stripe_subscription_id AS org_stripe_subscription_id,
        organizations.created_by_user_id AS org_created_by_user_id,
        organizations.created_at AS org_created_at,
        organizations.updated_at AS org_updated_at,
        organization_members.id AS member_id,
        organization_members.organization_id AS member_organization_id,
        organization_members.user_id AS member_user_id,
        organization_members.role AS member_role,
        organization_members.status AS member_status,
        organization_members.invited_by_user_id AS member_invited_by_user_id,
        organization_members.joined_at AS member_joined_at,
        organization_members.created_at AS member_created_at,
        organization_members.updated_at AS member_updated_at,
        users.email AS member_email,
        users.display_name AS member_display_name,
        organization_credit_balances.organization_id AS balance_organization_id,
        organization_credit_balances.monthly_credits AS balance_monthly_credits,
        organization_credit_balances.purchased_credits AS balance_purchased_credits,
        organization_credit_balances.monthly_expires_at AS balance_monthly_expires_at,
        organization_credit_balances.updated_at AS balance_updated_at
      FROM organization_members
      INNER JOIN organizations ON organizations.id = organization_members.organization_id
      INNER JOIN users ON users.id = organization_members.user_id
      LEFT JOIN organization_credit_balances ON organization_credit_balances.organization_id = organizations.id
      WHERE organization_members.user_id = $1
        AND organization_members.status = 'active'
      ORDER BY organizations.updated_at DESC, organizations.created_at DESC
      `,
      [userId],
    );

    return result.rows.map((row) => {
      const organization = mapOrganizationRow({
        id: row.org_id,
        type: row.org_type,
        name: row.org_name,
        legal_name: row.org_legal_name,
        status: row.org_status,
        plan_key: row.org_plan_key,
        billing_email: row.org_billing_email,
        stripe_customer_id: row.org_stripe_customer_id,
        stripe_subscription_id: row.org_stripe_subscription_id,
        created_by_user_id: row.org_created_by_user_id,
        created_at: row.org_created_at,
        updated_at: row.org_updated_at,
      });
      const membership = mapMemberRow({
        id: row.member_id,
        organization_id: row.member_organization_id,
        user_id: row.member_user_id,
        email: row.member_email,
        display_name: row.member_display_name,
        role: row.member_role,
        status: row.member_status,
        invited_by_user_id: row.member_invited_by_user_id,
        joined_at: row.member_joined_at,
        created_at: row.member_created_at,
        updated_at: row.member_updated_at,
      });
      const balance =
        row.balance_organization_id === null || row.balance_organization_id === undefined
          ? null
          : mapBalanceRow({
              organization_id: row.balance_organization_id as string,
              monthly_credits: row.balance_monthly_credits ?? 0,
              purchased_credits: row.balance_purchased_credits ?? 0,
              monthly_expires_at: row.balance_monthly_expires_at,
              updated_at: row.balance_updated_at ?? new Date(0),
            });
      return { organization, membership, balance };
    });
  }

  public async findOrganizationById(
    organizationId: string,
    client: DatabaseClient = this.client,
  ): Promise<Organization | null> {
    const result = await client.query<OrganizationRow>(
      `
      SELECT *
      FROM organizations
      WHERE id = $1
      `,
      [organizationId],
    );

    return result.rows[0] === undefined ? null : mapOrganizationRow(result.rows[0]);
  }

  public async findMemberByOrganizationAndUser(
    organizationId: string,
    userId: string,
    client: DatabaseClient = this.client,
  ): Promise<OrganizationMember | null> {
    const result = await client.query<OrganizationMemberRow>(
      `
      SELECT organization_members.*, users.email, users.display_name
      FROM organization_members
      INNER JOIN users ON users.id = organization_members.user_id
      WHERE organization_members.organization_id = $1
        AND organization_members.user_id = $2
      `,
      [organizationId, userId],
    );

    return result.rows[0] === undefined ? null : mapMemberRow(result.rows[0]);
  }

  public async findMemberById(
    organizationId: string,
    memberId: string,
    client: DatabaseClient = this.client,
  ): Promise<OrganizationMember | null> {
    const result = await client.query<OrganizationMemberRow>(
      `
      SELECT organization_members.*, users.email, users.display_name
      FROM organization_members
      INNER JOIN users ON users.id = organization_members.user_id
      WHERE organization_members.organization_id = $1
        AND organization_members.id = $2
      `,
      [organizationId, memberId],
    );

    return result.rows[0] === undefined ? null : mapMemberRow(result.rows[0]);
  }

  public async listMembers(organizationId: string): Promise<OrganizationMember[]> {
    const result = await this.client.query<OrganizationMemberRow>(
      `
      SELECT organization_members.*, users.email, users.display_name
      FROM organization_members
      INNER JOIN users ON users.id = organization_members.user_id
      WHERE organization_members.organization_id = $1
        AND organization_members.status <> 'removed'
      ORDER BY
        CASE organization_members.role
          WHEN 'owner' THEN 0
          WHEN 'admin' THEN 1
          WHEN 'billing' THEN 2
          WHEN 'editor' THEN 3
          ELSE 5
        END,
        users.email ASC
      `,
      [organizationId],
    );

    return result.rows.map(mapMemberRow);
  }

  public async updateMember(
    organizationId: string,
    memberId: string,
    input: { role?: OrganizationMemberRole; status?: OrganizationMemberStatus },
    client: DatabaseClient,
  ): Promise<OrganizationMember | null> {
    const result = await client.query<OrganizationMemberRow>(
      `
      UPDATE organization_members
      SET role = COALESCE($3, role),
          status = COALESCE($4, status),
          updated_at = NOW()
      FROM users
      WHERE organization_members.organization_id = $1
        AND organization_members.id = $2
        AND users.id = organization_members.user_id
      RETURNING organization_members.*, users.email, users.display_name
      `,
      [organizationId, memberId, input.role ?? null, input.status ?? null],
    );

    return result.rows[0] === undefined ? null : mapMemberRow(result.rows[0]);
  }

  public async countActiveOwners(organizationId: string, client: DatabaseClient): Promise<number> {
    const result = await client.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM organization_members
      WHERE organization_id = $1
        AND role = 'owner'
        AND status = 'active'
      `,
      [organizationId],
    );

    return Number(result.rows[0]?.count ?? '0');
  }

  public async createInvitation(
    input: CreateOrganizationInvitationRecord,
    client: DatabaseClient,
  ): Promise<OrganizationInvitation> {
    const result = await client.query<OrganizationInvitationRow>(
      `
      INSERT INTO organization_invitations (
        organization_id,
        email,
        role,
        token_hash,
        invited_by_user_id,
        expires_at
      )
      VALUES ($1, lower($2), $3, $4, $5, $6)
      RETURNING ${INVITATION_RETURNING_COLUMNS}
      `,
      [input.organizationId, input.email, input.role, input.tokenHash, input.invitedByUserId, input.expiresAt],
    );

    return mapInvitationRow(result.rows[0]);
  }

  public async listInvitations(
    organizationId: string,
    client: DatabaseClient = this.client,
  ): Promise<OrganizationInvitation[]> {
    const result = await client.query<OrganizationInvitationRow>(
      `
      SELECT ${INVITATION_RETURNING_COLUMNS}
      FROM organization_invitations
      WHERE organization_id = $1
      ORDER BY created_at DESC
      `,
      [organizationId],
    );

    return result.rows.map(mapInvitationRow);
  }

  public async findPendingInvitationByEmail(
    organizationId: string,
    email: string,
    client: DatabaseClient = this.client,
  ): Promise<OrganizationInvitation | null> {
    const result = await client.query<OrganizationInvitationRow>(
      `
      SELECT ${INVITATION_RETURNING_COLUMNS}
      FROM organization_invitations
      WHERE organization_id = $1
        AND lower(email) = lower($2)
        AND status = 'pending'
      LIMIT 1
      `,
      [organizationId, email],
    );

    return result.rows[0] === undefined ? null : mapInvitationRow(result.rows[0]);
  }

  public async findInvitationByTokenHash(
    tokenHash: string,
    client: DatabaseClient,
  ): Promise<OrganizationInvitation | null> {
    const result = await client.query<OrganizationInvitationRow>(
      `
      SELECT ${INVITATION_RETURNING_COLUMNS}
      FROM organization_invitations
      WHERE token_hash = $1
      FOR UPDATE
      `,
      [tokenHash],
    );

    return result.rows[0] === undefined ? null : mapInvitationRow(result.rows[0]);
  }

  public async findInvitationById(
    organizationId: string,
    invitationId: string,
    client: DatabaseClient = this.client,
  ): Promise<OrganizationInvitation | null> {
    const result = await client.query<OrganizationInvitationRow>(
      `
      SELECT ${INVITATION_RETURNING_COLUMNS}
      FROM organization_invitations
      WHERE organization_id = $1
        AND id = $2
      LIMIT 1
      `,
      [organizationId, invitationId],
    );

    return result.rows[0] === undefined ? null : mapInvitationRow(result.rows[0]);
  }

  public async updateInvitation(
    invitationId: string,
    input: {
      status: OrganizationInvitation['status'];
      acceptedByUserId?: string | null;
      acceptedAt?: Date | null;
    },
    client: DatabaseClient,
  ): Promise<OrganizationInvitation | null> {
    const result = await client.query<OrganizationInvitationRow>(
      `
      UPDATE organization_invitations
      SET status = $2,
          accepted_by_user_id = CASE WHEN $3::boolean THEN $4 ELSE accepted_by_user_id END,
          accepted_at = CASE WHEN $5::boolean THEN $6 ELSE accepted_at END,
          revoked_at = CASE WHEN $2 = 'revoked' THEN NOW() ELSE revoked_at END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING ${INVITATION_RETURNING_COLUMNS}
      `,
      [
        invitationId,
        input.status,
        input.acceptedByUserId !== undefined,
        input.acceptedByUserId ?? null,
        input.acceptedAt !== undefined,
        input.acceptedAt ?? null,
      ],
    );

    return result.rows[0] === undefined ? null : mapInvitationRow(result.rows[0]);
  }

  public async updateInvitationToken(
    invitationId: string,
    input: { tokenHash: string; expiresAt: Date; role?: OrganizationMemberRole },
    client: DatabaseClient,
  ): Promise<OrganizationInvitation | null> {
    const result = await client.query<OrganizationInvitationRow>(
      `
      UPDATE organization_invitations
      SET token_hash = $2,
          expires_at = $3,
          role = COALESCE($4, role),
          status = 'pending',
          updated_at = NOW()
      WHERE id = $1
      RETURNING ${INVITATION_RETURNING_COLUMNS}
      `,
      [invitationId, input.tokenHash, input.expiresAt, input.role ?? null],
    );

    return result.rows[0] === undefined ? null : mapInvitationRow(result.rows[0]);
  }

  public async updateInvitationSendStatus(
    invitationId: string,
    input: {
      sendStatus: OrganizationInvitationSendStatus;
      providerMessageId?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      incrementResendCount?: boolean;
      sentAt?: Date | null;
      lastSentAt?: Date | null;
    },
    client: DatabaseClient = this.client,
  ): Promise<OrganizationInvitation | null> {
    void input.providerMessageId;
    const result = await client.query<OrganizationInvitationRow>(
      `
      UPDATE organization_invitations
      SET send_status = $2,
          send_error_code = CASE WHEN $3::boolean THEN $4 ELSE send_error_code END,
          send_error_message = CASE WHEN $5::boolean THEN $6 ELSE send_error_message END,
          sent_at = CASE WHEN $7::boolean THEN $8 ELSE sent_at END,
          last_sent_at = CASE WHEN $9::boolean THEN $10 ELSE last_sent_at END,
          resend_count = CASE WHEN $11::boolean THEN resend_count + 1 ELSE resend_count END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING ${INVITATION_RETURNING_COLUMNS}
      `,
      [
        invitationId,
        input.sendStatus,
        input.errorCode !== undefined,
        input.errorCode ?? null,
        input.errorMessage !== undefined,
        input.errorMessage ?? null,
        input.sentAt !== undefined,
        input.sentAt ?? null,
        input.lastSentAt !== undefined,
        input.lastSentAt ?? null,
        input.incrementResendCount === true,
      ],
    );

    return result.rows[0] === undefined ? null : mapInvitationRow(result.rows[0]);
  }

  public async revokeInvitation(
    invitationId: string,
    input: { revokedByUserId: string; revokedAt: Date },
    client: DatabaseClient,
  ): Promise<OrganizationInvitation | null> {
    const result = await client.query<OrganizationInvitationRow>(
      `
      UPDATE organization_invitations
      SET status = 'revoked',
          revoked_at = $2,
          revoked_by_user_id = $3,
          updated_at = NOW()
      WHERE id = $1
      RETURNING ${INVITATION_RETURNING_COLUMNS}
      `,
      [invitationId, input.revokedAt, input.revokedByUserId],
    );

    return result.rows[0] === undefined ? null : mapInvitationRow(result.rows[0]);
  }

  public async insertEmailDeliveryLog(
    input: {
      organizationId: string | null;
      invitationId: string | null;
      recipientEmail: string;
      templateKey: string;
      provider: string;
      status: EmailDeliveryStatus;
      providerMessageId?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    },
    client: DatabaseClient = this.client,
  ): Promise<EmailDeliveryLog> {
    const result = await client.query<EmailDeliveryLogRow>(
      `
      INSERT INTO email_delivery_logs (
        organization_id,
        invitation_id,
        recipient_email,
        template_key,
        provider,
        status,
        provider_message_id,
        error_code,
        error_message
      )
      VALUES ($1, $2, lower($3), $4, $5, $6, $7, $8, $9)
      RETURNING id, organization_id, invitation_id, recipient_email, template_key, provider, status, provider_message_id, error_code, error_message, created_at, updated_at
      `,
      [
        input.organizationId,
        input.invitationId,
        input.recipientEmail,
        input.templateKey,
        input.provider,
        input.status,
        input.providerMessageId ?? null,
        input.errorCode ?? null,
        input.errorMessage ?? null,
      ],
    );

    return mapEmailDeliveryLogRow(result.rows[0]);
  }

  public async getCreditBalance(
    organizationId: string,
    client: DatabaseClient = this.client,
  ): Promise<OrganizationCreditBalance | null> {
    const result = await client.query<OrganizationCreditBalanceRow>(
      `
      SELECT *
      FROM organization_credit_balances
      WHERE organization_id = $1
      `,
      [organizationId],
    );

    return result.rows[0] === undefined ? null : mapBalanceRow(result.rows[0]);
  }

  public async getCreditBalanceForUpdate(
    organizationId: string,
    client: DatabaseClient,
  ): Promise<OrganizationCreditBalance | null> {
    await client.query(
      `
      INSERT INTO organization_credit_balances (organization_id)
      VALUES ($1)
      ON CONFLICT (organization_id) DO NOTHING
      `,
      [organizationId],
    );
    const result = await client.query<OrganizationCreditBalanceRow>(
      `
      SELECT *
      FROM organization_credit_balances
      WHERE organization_id = $1
      FOR UPDATE
      `,
      [organizationId],
    );

    return result.rows[0] === undefined ? null : mapBalanceRow(result.rows[0]);
  }

  public async createCreditBalance(
    organizationId: string,
    client: DatabaseClient,
  ): Promise<OrganizationCreditBalance> {
    const result = await client.query<OrganizationCreditBalanceRow>(
      `
      INSERT INTO organization_credit_balances (organization_id)
      VALUES ($1)
      ON CONFLICT (organization_id) DO UPDATE SET organization_id = EXCLUDED.organization_id
      RETURNING *
      `,
      [organizationId],
    );

    return mapBalanceRow(result.rows[0]);
  }

  public async updateCreditBalance(
    balance: OrganizationCreditBalance,
    client: DatabaseClient,
  ): Promise<OrganizationCreditBalance> {
    const result = await client.query<OrganizationCreditBalanceRow>(
      `
      UPDATE organization_credit_balances
      SET monthly_credits = $2,
          purchased_credits = $3,
          monthly_expires_at = $4,
          updated_at = NOW()
      WHERE organization_id = $1
      RETURNING *
      `,
      [balance.organizationId, balance.monthlyCredits, balance.purchasedCredits, balance.monthlyExpiresAt],
    );

    return mapBalanceRow(result.rows[0]);
  }

  public async insertAuditLog(
    input: {
      organizationId: string;
      actorUserId: string | null;
      action: string;
      targetType: string;
      targetId: string | null;
      metadata?: Record<string, unknown>;
    },
    client: DatabaseClient = this.client,
  ): Promise<void> {
    await client.query(
      `
      INSERT INTO organization_audit_logs (organization_id, actor_user_id, action, target_type, target_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        input.organizationId,
        input.actorUserId,
        input.action,
        input.targetType,
        input.targetId,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  public async insertUsageEvent(
    input: {
      organizationId: string;
      userId: string | null;
      workId: string | null;
      generationJobId: string | null;
      eventType: string;
      creditAmount: number;
      metadata?: Record<string, unknown>;
    },
    client: DatabaseClient = this.client,
  ): Promise<void> {
    await client.query(
      `
      INSERT INTO organization_usage_events (
        organization_id,
        user_id,
        work_id,
        generation_job_id,
        event_type,
        credit_amount,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        input.organizationId,
        input.userId,
        input.workId,
        input.generationJobId,
        input.eventType,
        input.creditAmount,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  public async listAuditLogs(organizationId: string, limit: number): Promise<OrganizationAuditLog[]> {
    const result = await this.client.query<OrganizationAuditLogRow>(
      `
      SELECT *
      FROM organization_audit_logs
      WHERE organization_id = $1
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [organizationId, limit],
    );

    return result.rows.map(mapAuditLogRow);
  }

  public async listAuditLogsByActionPrefixes(
    organizationId: string,
    actionPrefixes: readonly string[],
    limit: number,
  ): Promise<OrganizationAuditLog[]> {
    if (actionPrefixes.length === 0) {
      return [];
    }

    const result = await this.client.query<OrganizationAuditLogRow>(
      `
      SELECT *
      FROM organization_audit_logs
      WHERE organization_id = $1
        AND action LIKE ANY($2::text[])
      ORDER BY created_at DESC
      LIMIT $3
      `,
      [organizationId, actionPrefixes.map((prefix) => `${prefix}%`), limit],
    );

    return result.rows.map(mapAuditLogRow);
  }

  public async listUsageEvents(organizationId: string, limit: number): Promise<OrganizationUsageEvent[]> {
    const result = await this.client.query<OrganizationUsageEventRow>(
      `
      SELECT *
      FROM organization_usage_events
      WHERE organization_id = $1
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [organizationId, limit],
    );

    return result.rows.map(mapUsageEventRow);
  }
}

function mapOrganizationRow(row: OrganizationRow): Organization {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    legalName: row.legal_name,
    status: row.status,
    planKey: row.plan_key,
    billingEmail: row.billing_email,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMemberRow(row: OrganizationMemberRow): OrganizationMember {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: normalizeOrganizationMemberRole(row.role),
    status: row.status,
    invitedByUserId: row.invited_by_user_id,
    joinedAt: row.joined_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapInvitationRow(row: OrganizationInvitationRow): OrganizationInvitation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    role: normalizeOrganizationMemberRole(row.role),
    status: row.status,
    sendStatus: row.send_status,
    sendErrorCode: row.send_error_code,
    sendErrorMessage: row.send_error_message,
    sentAt: row.sent_at,
    lastSentAt: row.last_sent_at,
    resendCount: Number(row.resend_count),
    invitedByUserId: row.invited_by_user_id,
    acceptedByUserId: row.accepted_by_user_id,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    revokedByUserId: row.revoked_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeOrganizationMemberRole(role: string): OrganizationMemberRole {
  return role === 'creator' ? 'editor' : (role as OrganizationMemberRole);
}

function mapEmailDeliveryLogRow(row: EmailDeliveryLogRow): EmailDeliveryLog {
  return {
    id: row.id,
    organizationId: row.organization_id,
    invitationId: row.invitation_id,
    recipientEmail: row.recipient_email,
    templateKey: row.template_key,
    provider: row.provider,
    status: row.status,
    providerMessageId: row.provider_message_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBalanceRow(row: OrganizationCreditBalanceRow): OrganizationCreditBalance {
  return {
    organizationId: row.organization_id,
    monthlyCredits: Number(row.monthly_credits),
    purchasedCredits: Number(row.purchased_credits),
    monthlyExpiresAt: row.monthly_expires_at,
    updatedAt: row.updated_at,
  };
}

function mapAuditLogRow(row: OrganizationAuditLogRow): OrganizationAuditLog {
  return {
    id: row.id,
    organizationId: row.organization_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: asRecord(row.metadata),
    createdAt: row.created_at,
  };
}

function mapUsageEventRow(row: OrganizationUsageEventRow): OrganizationUsageEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    workId: row.work_id,
    generationJobId: row.generation_job_id,
    eventType: row.event_type,
    creditAmount: Number(row.credit_amount),
    metadata: asRecord(row.metadata),
    createdAt: row.created_at,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
