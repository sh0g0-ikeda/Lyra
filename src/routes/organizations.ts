import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
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
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import type { AppEnv } from '../types/app.js';
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
    return c.json({
      organization: preview.organization,
      invitation: {
        email: preview.invitation.email,
        role: preview.invitation.role,
        status: preview.invitation.status,
        expires_at: preview.invitation.expiresAt.toISOString(),
      },
    });
  });

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.get('/organizations', async (c) => {
    const user = c.get('user');
    const workspaces = await dependencies.organizationService.listWorkspaces(user.id);
    return c.json({ organizations: workspaces.map(toWorkspaceResponse) });
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

    return c.json(toWorkspaceResponse(workspace), 201);
  });

  app.get('/organizations/:organizationId', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const workspace = await dependencies.organizationService.getOrganization(user.id, organizationId);
    return c.json(toWorkspaceResponse(workspace));
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

    return c.json({ organization: toOrganizationResponse(organization) });
  });

  app.get('/organizations/:organizationId/members', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const members = await dependencies.organizationService.listMembers(user.id, organizationId);
    return c.json({ members: members.map(toMemberResponse) });
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

    return c.json(
      {
        invitation: toInvitationResponse(result.invitation),
        invitation_url: result.invitationUrl,
        email_delivery: result.emailDelivery,
      },
      201,
    );
  });

  app.get('/organizations/:organizationId/invitations', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const invitations = await dependencies.organizationService.listInvitations(user.id, organizationId);
    return c.json({ invitations: invitations.map(toInvitationResponse) });
  });

  app.post('/organizations/:organizationId/invitations/:invitationId/resend', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const invitationId = parseUuidParam(c, 'invitationId');
    const result = await dependencies.organizationService.resendInvitation(user.id, organizationId, invitationId);
    return c.json({
      invitation: toInvitationResponse(result.invitation),
      invitation_url: result.invitationUrl,
      email_delivery: result.emailDelivery,
    });
  });

  app.post('/organizations/:organizationId/invitations/:invitationId/revoke', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const invitationId = parseUuidParam(c, 'invitationId');
    const invitation = await dependencies.organizationService.revokeInvitation(user.id, organizationId, invitationId);
    return c.json({ invitation: toInvitationResponse(invitation) });
  });

  app.post('/organization-invitations/accept', async (c) => {
    const user = c.get('user');
    const body = acceptInvitationBodySchema.safeParse(await readSmallJsonBody(c));
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const workspace = await dependencies.organizationService.acceptInvitation(user.id, user.email, body.data.token);
    return c.json(toWorkspaceResponse(workspace));
  });

  app.post('/invitations/:token/accept', async (c) => {
    const user = c.get('user');
    const token = c.req.param('token').trim();
    const body = acceptInvitationBodySchema.safeParse({ token });
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const workspace = await dependencies.organizationService.acceptInvitation(user.id, user.email, body.data.token);
    return c.json(toWorkspaceResponse(workspace));
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

    return c.json({ member: toMemberResponse(member) });
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
    return c.json(toCreditBalanceResponse(balance));
  });

  app.get('/organizations/:organizationId/billing/plans', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    await dependencies.organizationService.requireMembership(organizationId, user.id, 'view_billing');
    return c.json({
      subscription_plans: dependencies.organizationBillingService.getEnterprisePlanCatalog().map(toPlanResponse),
    });
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
    return c.json(
      {
        session_id: result.sessionId,
        url: result.url,
      },
      201,
    );
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
    return c.json(
      {
        session_id: result.sessionId,
        package_code: result.packageCode,
        url: result.url,
      },
      201,
    );
  };

  app.post('/organizations/:organizationId/billing/checkout/credits', createCreditCheckout);
  app.post('/organizations/:organizationId/billing/credit-pack-checkout-session', createCreditCheckout);

  const createCustomerPortal = async (c: Context<AppEnv>) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const result = await dependencies.organizationBillingService.createCustomerPortalSession(user.id, organizationId);
    return c.json({ url: result.url });
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
    return c.json({
      workspace: toWorkspaceResponse(workspace),
      subscription: subscription === null ? null : toSubscriptionSummaryResponse(subscription),
      subscription_plans: dependencies.organizationBillingService.getEnterprisePlanCatalog().map(toPlanResponse),
    });
  });

  app.get('/organizations/:organizationId/invoices', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const invoices = await dependencies.organizationBillingService.listOrganizationInvoices(user.id, organizationId);
    return c.json({ invoices: invoices.map(toInvoiceResponse) });
  });

  app.get('/organizations/:organizationId/usage', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c);
    const events = await dependencies.organizationService.listUsageEvents(user.id, organizationId);
    return c.json({
      usage_events: events.map(toUsageEventResponse),
      summary: summarizeUsageEvents(events),
    });
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
    const logs = await dependencies.organizationService.listAuditLogs(user.id, organizationId);
    return c.json({ audit_logs: logs.map(toAuditLogResponse) });
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
    user_id: record.userId,
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
