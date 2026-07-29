import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
import {
  decodeListCursor,
  normalizeListPageLimit,
  type ListPageRequest,
} from '../domain/pagination.js';
import type { PaymentRecord } from '../domain/types/billing.js';
import type {
  Organization,
  OrganizationAuditLog,
  OrganizationCreditBalance,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationUsageEvent,
  OrganizationWorkspaceSummary,
} from '../domain/types/organization.js';
import {
  acceptInvitationBodySchema,
  createOrganizationBodySchema,
  createOrganizationInvitationBodySchema,
  organizationBillingCheckoutBodySchema,
  organizationCreditCheckoutBodySchema,
  organizationUuidParamSchema,
  updateOrganizationBodySchema,
  updateOrganizationMemberBodySchema,
} from '../lib/validators/organization.schema.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type { OrganizationBillingServicePort } from '../services/organization/OrganizationBillingService.js';
import { buildOrganizationUsageCsv } from '../services/organization/OrganizationUsageCsv.js';
import type {
  OrganizationServicePort,
  OrganizationUsagePageResult,
} from '../services/organization/OrganizationService.js';
import type { AppEnv } from '../types/app.js';
import {
  organizationAuditLogsResponseSchema,
  organizationBillingSummarySchema,
  organizationCreditCheckoutSchema,
  organizationCreditBalanceSchema,
  organizationCustomerPortalSchema,
  organizationInvitationActionResponseSchema,
  organizationInvitationPreviewSchema,
  organizationInvitationsResponseSchema,
  organizationInvitationUpdateResponseSchema,
  organizationInvoicesResponseSchema,
  organizationMemberUpdateResponseSchema,
  organizationMembersResponseSchema,
  organizationPlansResponseSchema,
  organizationSubscriptionCheckoutSchema,
  organizationUsageResponseSchema,
  organizationUpdateResponseSchema,
  organizationWorkspaceDetailSchema,
  organizationWorkspacesResponseSchema,
  organizationWorkspaceSchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

export interface OrganizationRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  publicRateLimitMiddleware?: MiddlewareHandler<AppEnv>;
  organizationService: OrganizationServicePort;
  organizationBillingService: OrganizationBillingServicePort;
}

export function createOrganizationRoutes(dependencies: OrganizationRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/organization-invitations/:token', dependencies.publicRateLimitMiddleware ?? buildNoopMiddleware(), async (c) => {
    const token = c.req.param('token').trim();
    const body = acceptInvitationBodySchema.safeParse({ token });
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }
    const preview = await dependencies.organizationService.previewInvitation(body.data.token);
    const payload = {
      organization: preview.organization,
      invitation: {
        email: preview.invitation.email,
        role: preview.invitation.role,
        status: preview.invitation.status,
        expires_at: preview.invitation.expiresAt.toISOString(),
      },
    };
    return c.json(assertMobileResponseContract(organizationInvitationPreviewSchema, payload));
  });

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.get('/organizations', async (c) => {
    const user = c.get('user');
    const workspaces = await dependencies.organizationService.listWorkspaces(user.id);
    const payload = { organizations: workspaces.map(toWorkspaceResponse) };
    return c.json(assertMobileResponseContract(organizationWorkspacesResponseSchema, payload));
  });

  app.post('/organizations', async (c) => {
    const user = c.get('user');
    const body = createOrganizationBodySchema.safeParse(await readSmallJsonBody(c));
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const workspace = await dependencies.organizationService.createOrganization(user.id, {
      name: body.data.name,
      legalName: body.data.legal_name ?? null,
      billingEmail: body.data.billing_email ?? null,
    });

    const payload = toWorkspaceResponse(workspace);
    return c.json(assertMobileResponseContract(organizationWorkspaceDetailSchema, payload), 201);
  });

  app.get('/organizations/:organizationId', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const workspace = await dependencies.organizationService.getOrganization(user.id, organizationId);
    const payload = toWorkspaceResponse(workspace);
    return c.json(assertMobileResponseContract(organizationWorkspaceDetailSchema, payload));
  });

  app.patch('/organizations/:organizationId', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const body = updateOrganizationBodySchema.safeParse(await readSmallJsonBody(c));
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const organization = await dependencies.organizationService.updateOrganization(user.id, organizationId, {
      name: body.data.name,
      legalName: body.data.legal_name,
      billingEmail: body.data.billing_email,
    });

    const payload = { organization: toOrganizationResponse(organization) };
    return c.json(assertMobileResponseContract(organizationUpdateResponseSchema, payload));
  });

  app.get('/organizations/:organizationId/members', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const page = parseOrganizationListPage(c, 'organization-members');
    if (page !== null) {
      const result = await dependencies.organizationService.listMembersPage(user.id, organizationId, page);
      const payload = { members: result.items.map(toMemberResponse), next_cursor: result.nextCursor };
      return c.json(assertMobileResponseContract(organizationMembersResponseSchema, payload));
    }
    const members = await dependencies.organizationService.listMembers(user.id, organizationId);
    const payload = { members: members.map(toMemberResponse) };
    return c.json(assertMobileResponseContract(organizationMembersResponseSchema, payload));
  });

  app.post('/organizations/:organizationId/invitations', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const body = createOrganizationInvitationBodySchema.safeParse(await readSmallJsonBody(c));
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const result = await dependencies.organizationService.inviteMember(user.id, organizationId, {
      email: body.data.email,
      role: body.data.role,
    });

    const payload = {
      invitation: toInvitationResponse(result.invitation),
      invitation_url: result.invitationUrl,
      email_delivery: result.emailDelivery,
    };
    return c.json(assertMobileResponseContract(organizationInvitationActionResponseSchema, payload), 201);
  });

  app.get('/organizations/:organizationId/invitations', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const page = parseOrganizationListPage(c, 'organization-invitations');
    if (page !== null) {
      const result = await dependencies.organizationService.listInvitationsPage(user.id, organizationId, page);
      const payload = {
        invitations: result.items.map(toInvitationResponse),
        next_cursor: result.nextCursor,
      };
      return c.json(assertMobileResponseContract(organizationInvitationsResponseSchema, payload));
    }
    const invitations = await dependencies.organizationService.listInvitations(user.id, organizationId);
    const payload = { invitations: invitations.map(toInvitationResponse) };
    return c.json(assertMobileResponseContract(organizationInvitationsResponseSchema, payload));
  });

  app.post('/organizations/:organizationId/invitations/:invitationId/resend', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const invitationId = parseUuidParam(c, 'invitationId');
    const result = await dependencies.organizationService.resendInvitation(user.id, organizationId, invitationId);
    const payload = {
      invitation: toInvitationResponse(result.invitation),
      invitation_url: result.invitationUrl,
      email_delivery: result.emailDelivery,
    };
    return c.json(assertMobileResponseContract(organizationInvitationActionResponseSchema, payload));
  });

  app.post('/organizations/:organizationId/invitations/:invitationId/revoke', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const invitationId = parseUuidParam(c, 'invitationId');
    const invitation = await dependencies.organizationService.revokeInvitation(user.id, organizationId, invitationId);
    const payload = { invitation: toInvitationResponse(invitation) };
    return c.json(assertMobileResponseContract(organizationInvitationUpdateResponseSchema, payload));
  });

  app.post('/organization-invitations/accept', async (c) => {
    const user = c.get('user');
    const body = acceptInvitationBodySchema.safeParse(await readSmallJsonBody(c));
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const workspace = await dependencies.organizationService.acceptInvitation(user.id, user.email, body.data.token);
    const payload = toWorkspaceResponse(workspace);
    return c.json(assertMobileResponseContract(organizationWorkspaceSchema, payload));
  });

  app.post('/invitations/:token/accept', async (c) => {
    const user = c.get('user');
    const token = c.req.param('token').trim();
    const body = acceptInvitationBodySchema.safeParse({ token });
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const workspace = await dependencies.organizationService.acceptInvitation(user.id, user.email, body.data.token);
    const payload = toWorkspaceResponse(workspace);
    return c.json(assertMobileResponseContract(organizationWorkspaceSchema, payload));
  });

  app.patch('/organizations/:organizationId/members/:memberId', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const memberId = parseUuidParam(c, 'memberId');
    const body = updateOrganizationMemberBodySchema.safeParse(await readSmallJsonBody(c));
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const member = await dependencies.organizationService.updateMember(user.id, organizationId, memberId, {
      role: body.data.role,
      status: body.data.status,
    });

    const payload = { member: toMemberResponse(member) };
    return c.json(assertMobileResponseContract(organizationMemberUpdateResponseSchema, payload));
  });

  app.delete('/organizations/:organizationId/members/:memberId', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const memberId = parseUuidParam(c, 'memberId');
    await dependencies.organizationService.removeMember(user.id, organizationId, memberId);
    return c.body(null, 204);
  });

  app.get('/organizations/:organizationId/credits/balance', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const balance = await dependencies.organizationService.getCreditBalance(user.id, organizationId);
    const payload = toCreditBalanceResponse(balance);
    return c.json(assertMobileResponseContract(organizationCreditBalanceSchema, payload));
  });

  app.get('/organizations/:organizationId/billing/plans', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    await dependencies.organizationService.requireMembership(organizationId, user.id, 'view_billing');
    const payload = {
      subscription_plans: dependencies.organizationBillingService.getEnterprisePlanCatalog().map(toPlanResponse),
    };
    return c.json(assertMobileResponseContract(organizationPlansResponseSchema, payload));
  });

  const createSubscriptionCheckout = async (c: Context<AppEnv>) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const body = organizationBillingCheckoutBodySchema.safeParse(await readSmallJsonBody(c));
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const result = await dependencies.organizationBillingService.createSubscriptionCheckoutSession(
      user,
      organizationId,
      body.data.plan_code,
    );
    const payload = {
      session_id: result.sessionId,
      url: result.url,
    };
    return c.json(assertMobileResponseContract(organizationSubscriptionCheckoutSchema, payload), 201);
  };

  app.post('/organizations/:organizationId/billing/checkout/subscription', createSubscriptionCheckout);
  app.post('/organizations/:organizationId/billing/subscription-checkout-session', createSubscriptionCheckout);

  const createCreditCheckout = async (c: Context<AppEnv>) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const body = organizationCreditCheckoutBodySchema.safeParse(await readSmallJsonBody(c));
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const result = await dependencies.organizationBillingService.createCreditCheckoutSession(
      user,
      organizationId,
      body.data.package_code,
    );
    const payload = {
      session_id: result.sessionId,
      package_code: result.packageCode,
      url: result.url,
    };
    return c.json(assertMobileResponseContract(organizationCreditCheckoutSchema, payload), 201);
  };

  app.post('/organizations/:organizationId/billing/checkout/credits', createCreditCheckout);
  app.post('/organizations/:organizationId/billing/credit-pack-checkout-session', createCreditCheckout);

  const createCustomerPortal = async (c: Context<AppEnv>) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const result = await dependencies.organizationBillingService.createCustomerPortalSession(user.id, organizationId);
    const payload = { url: result.url };
    return c.json(assertMobileResponseContract(organizationCustomerPortalSchema, payload));
  };

  app.post('/organizations/:organizationId/billing/customer-portal', createCustomerPortal);
  app.post('/organizations/:organizationId/billing/customer-portal-session', createCustomerPortal);

  app.get('/organizations/:organizationId/billing', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    await dependencies.organizationService.requireMembership(organizationId, user.id, 'view_billing');
    const workspace = await dependencies.organizationService.getOrganization(user.id, organizationId);
    const subscription =
      await dependencies.organizationBillingService.getOrganizationSubscriptionSummary(user.id, organizationId);
    const payload = {
      workspace: toWorkspaceResponse(workspace),
      subscription: subscription === null ? null : toSubscriptionSummaryResponse(subscription),
      subscription_plans: dependencies.organizationBillingService.getEnterprisePlanCatalog().map(toPlanResponse),
    };
    return c.json(assertMobileResponseContract(organizationBillingSummarySchema, payload));
  });

  app.get('/organizations/:organizationId/invoices', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const invoices = await dependencies.organizationBillingService.listOrganizationInvoices(user.id, organizationId);
    const payload = { invoices: invoices.map(toInvoiceResponse) };
    return c.json(assertMobileResponseContract(organizationInvoicesResponseSchema, payload));
  });

  app.get('/organizations/:organizationId/usage', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const page = parseOrganizationListPage(c, 'organization-usage');
    if (page !== null) {
      const result = await dependencies.organizationService.listUsageEventsPage(user.id, organizationId, page);
      const payload = {
        usage_events: result.page.items.map(toUsageEventResponse),
        next_cursor: result.page.nextCursor,
        summary: toUsageSummaryResponse(result.summary),
      };
      return c.json(assertMobileResponseContract(organizationUsageResponseSchema, payload));
    }
    const events = await dependencies.organizationService.listUsageEvents(user.id, organizationId);
    const payload = {
      usage_events: events.map(toUsageEventResponse),
      summary: summarizeUsageEvents(events),
    };
    return c.json(assertMobileResponseContract(organizationUsageResponseSchema, payload));
  });

  app.get('/organizations/:organizationId/usage.csv', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const events = await dependencies.organizationService.listUsageEvents(user.id, organizationId);
    const csv = buildOrganizationUsageCsv(events);
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="lyra-organization-usage.csv"');
    return c.body(csv);
  });

  app.get('/organizations/:organizationId/audit-logs', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const page = parseOrganizationListPage(c, 'organization-audit-logs');
    if (page !== null) {
      const result = await dependencies.organizationService.listAuditLogsPage(user.id, organizationId, page);
      const payload = {
        audit_logs: result.items.map(toAuditLogResponse),
        next_cursor: result.nextCursor,
      };
      return c.json(assertMobileResponseContract(organizationAuditLogsResponseSchema, payload));
    }
    const logs = await dependencies.organizationService.listAuditLogs(user.id, organizationId);
    const payload = { audit_logs: logs.map(toAuditLogResponse) };
    return c.json(assertMobileResponseContract(organizationAuditLogsResponseSchema, payload));
  });

  return app;
}

function buildNoopMiddleware(): MiddlewareHandler<AppEnv> {
  return async (_c, next) => {
    await next();
  };
}

function toPlanResponse(plan: ReturnType<OrganizationBillingServicePort['getEnterprisePlanCatalog']>[number]): Record<string, unknown> {
  return {
    plan_code: plan.planCode,
    display_name_ja: plan.displayNameJa,
    display_name_en: plan.displayNameEn,
    monthly_credits: plan.monthlyCredits,
    amount_jpy: plan.amountJpy,
    minimum_contract_months: plan.minimumContractMonths,
    trial_days: plan.trialDays,
    is_enterprise: plan.isEnterprise,
    configured: plan.configured,
  };
}

async function readSmallJsonBody(c: Context<AppEnv>): Promise<unknown> {
  return readJsonBody(c, {
    maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
    description: 'Organization request',
  });
}

function parseOrganizationId(c: Context<AppEnv>): string {
  return parseUuidParam(c, 'organizationId');
}

function parseOrganizationListPage(
  c: Context<AppEnv>,
  kind:
    | 'organization-members'
    | 'organization-invitations'
    | 'organization-usage'
    | 'organization-audit-logs',
): ListPageRequest | null {
  const rawLimit = c.req.query('limit');
  const rawCursor = c.req.query('cursor');
  if (rawLimit === undefined && rawCursor === undefined) {
    return null;
  }
  if (rawLimit === undefined) {
    throw new ValidationError('limit is required when cursor is provided');
  }
  if (!/^(?:[1-9]|[1-9][0-9]|100)$/u.test(rawLimit)) {
    throw new ValidationError('limit must be an integer between 1 and 100');
  }

  const limit = normalizeListPageLimit(Number(rawLimit));
  if (limit === null) {
    throw new ValidationError('limit must be an integer between 1 and 100');
  }
  if (rawCursor === undefined) {
    return { limit, cursor: null };
  }

  const cursor = decodeListCursor(rawCursor, kind);
  if (cursor === null || !isCanonicalCursorTimestamp(cursor.sort)) {
    throw new ValidationError('cursor is invalid for this endpoint');
  }
  return { limit, cursor };
}

function isCanonicalCursorTimestamp(sort: string | number): sort is string {
  if (typeof sort !== 'string') {
    return false;
  }
  const date = new Date(sort);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === sort;
}

function toUsageSummaryResponse(summary: OrganizationUsagePageResult['summary']): Record<string, unknown> {
  return {
    current_month_total_credits: summary.currentMonthTotalCredits,
    by_member: summary.byMember,
    by_work: summary.byWork,
    by_generation_type: summary.byGenerationType,
  };
}

function parseUuidParam(c: Context<AppEnv>, name: string): string {
  const result = organizationUuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }

  return result.data;
}

function toWorkspaceResponse(workspace: OrganizationWorkspaceSummary): Record<string, unknown> {
  return {
    organization: toOrganizationResponse(workspace.organization),
    membership: toMemberResponse(workspace.membership),
    balance: workspace.balance === null ? null : toCreditBalanceResponse(workspace.balance),
  };
}

function toOrganizationResponse(organization: Organization): Record<string, unknown> {
  return {
    id: organization.id,
    type: organization.type,
    name: organization.name,
    legal_name: organization.legalName,
    status: organization.status,
    plan_key: organization.planKey,
    billing_email: organization.billingEmail,
    created_by_user_id: organization.createdByUserId,
    created_at: organization.createdAt.toISOString(),
    updated_at: organization.updatedAt.toISOString(),
  };
}

function toMemberResponse(member: OrganizationMember): Record<string, unknown> {
  return {
    id: member.id,
    organization_id: member.organizationId,
    user_id: member.userId,
    email: member.email,
    display_name: member.displayName,
    role: member.role,
    status: member.status,
    invited_by_user_id: member.invitedByUserId,
    joined_at: member.joinedAt?.toISOString() ?? null,
    created_at: member.createdAt.toISOString(),
    updated_at: member.updatedAt.toISOString(),
  };
}

function toInvitationResponse(invitation: OrganizationInvitation): Record<string, unknown> {
  return {
    id: invitation.id,
    organization_id: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    send_status: invitation.sendStatus,
    send_error_code: invitation.sendErrorCode,
    send_error_message: invitation.sendErrorMessage,
    sent_at: invitation.sentAt?.toISOString() ?? null,
    last_sent_at: invitation.lastSentAt?.toISOString() ?? null,
    resend_count: invitation.resendCount,
    invited_by_user_id: invitation.invitedByUserId,
    accepted_by_user_id: invitation.acceptedByUserId,
    expires_at: invitation.expiresAt.toISOString(),
    accepted_at: invitation.acceptedAt?.toISOString() ?? null,
    revoked_at: invitation.revokedAt?.toISOString() ?? null,
    revoked_by_user_id: invitation.revokedByUserId,
    created_at: invitation.createdAt.toISOString(),
    updated_at: invitation.updatedAt.toISOString(),
  };
}

function toCreditBalanceResponse(balance: OrganizationCreditBalance): Record<string, unknown> {
  return {
    organization_id: balance.organizationId,
    monthly_credits: balance.monthlyCredits,
    purchased_credits: balance.purchasedCredits,
    total_credits: balance.monthlyCredits + balance.purchasedCredits,
    monthly_expires_at: balance.monthlyExpiresAt?.toISOString() ?? null,
    updated_at: balance.updatedAt.toISOString(),
  };
}

function toUsageEventResponse(event: OrganizationUsageEvent): Record<string, unknown> {
  return {
    id: event.id,
    organization_id: event.organizationId,
    user_id: event.userId,
    work_id: event.workId,
    generation_job_id: event.generationJobId,
    event_type: event.eventType,
    credit_amount: event.creditAmount,
    metadata: sanitizeOrganizationLogMetadata(event.metadata),
    created_at: event.createdAt.toISOString(),
  };
}

function toInvoiceResponse(record: PaymentRecord): Record<string, unknown> {
  return {
    id: record.id,
    organization_id: record.organizationId,
    kind: record.kind,
    amount_jpy: record.amountJpy,
    status: record.status,
    invoice_url: record.invoiceUrl ?? null,
    created_at: record.createdAt.toISOString(),
  };
}

function toSubscriptionSummaryResponse(subscription: Awaited<ReturnType<OrganizationBillingServicePort['getOrganizationSubscriptionSummary']>>): Record<string, unknown> | null {
  if (subscription === null) {
    return null;
  }

  return {
    organization_id: subscription.organizationId,
    plan_code: subscription.planCode,
    status: subscription.status,
    current_period_start: subscription.currentPeriodStart?.toISOString() ?? null,
    current_period_end: subscription.currentPeriodEnd?.toISOString() ?? null,
    cancel_at_period_end: subscription.cancelAtPeriodEnd,
  };
}

function toAuditLogResponse(log: OrganizationAuditLog): Record<string, unknown> {
  return {
    id: log.id,
    organization_id: log.organizationId,
    actor_user_id: log.actorUserId,
    action: log.action,
    target_type: log.targetType,
    target_id: log.targetId,
    metadata: sanitizeOrganizationLogMetadata(log.metadata),
    created_at: log.createdAt.toISOString(),
  };
}

const REDACTED_ORGANIZATION_METADATA_KEYS = new Set([
  'checkout_session_id',
  'customer_id',
  'invoice_id',
  'subscription_id',
  'stripe_checkout_session_id',
  'stripe_customer_id',
  'stripe_event_id',
  'stripe_invoice_id',
  'stripe_subscription_id',
  'openai_request_id',
  'prompt',
  'compiled_prompt',
  'draft_prompt',
  'image_url',
  'cdn_url',
  's3_key',
]);

function sanitizeOrganizationLogMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    const normalizedKey = key.toLowerCase();
    if (isSensitiveOrganizationMetadataKey(normalizedKey)) {
      continue;
    }
    sanitized[key] = value;
  }

  return sanitized;
}

function isSensitiveOrganizationMetadataKey(normalizedKey: string): boolean {
  return (
    REDACTED_ORGANIZATION_METADATA_KEYS.has(normalizedKey) ||
    normalizedKey.includes('stripe_') ||
    normalizedKey.includes('openai_request') ||
    normalizedKey.includes('prompt') ||
    normalizedKey.endsWith('_s3_key') ||
    normalizedKey.includes('image_url') ||
    normalizedKey.includes('cdn_url')
  );
}

function summarizeUsageEvents(events: OrganizationUsageEvent[]): Record<string, unknown> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthlyEvents = events.filter((event) => event.createdAt >= monthStart);
  return {
    current_month_total_credits: sumCredits(monthlyEvents),
    by_member: groupCredits(monthlyEvents, (event) => event.userId ?? 'unknown'),
    by_work: groupCredits(monthlyEvents, (event) => event.workId ?? 'unknown'),
    by_generation_type: groupCredits(monthlyEvents, (event) => event.eventType),
  };
}

function sumCredits(events: OrganizationUsageEvent[]): number {
  return events.reduce((sum, event) => sum + event.creditAmount, 0);
}

function groupCredits(
  events: OrganizationUsageEvent[],
  keyOf: (event: OrganizationUsageEvent) => string,
): Array<{ key: string; credits: number }> {
  const totals = new Map<string, number>();
  for (const event of events) {
    const key = keyOf(event);
    totals.set(key, (totals.get(key) ?? 0) + event.creditAmount);
  }
  return Array.from(totals.entries())
    .map(([key, credits]) => ({ key, credits }))
    .sort((a, b) => b.credits - a.credits || a.key.localeCompare(b.key));
}
