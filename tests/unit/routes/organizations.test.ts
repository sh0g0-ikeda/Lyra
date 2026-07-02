import { describe, expect, it } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type {
  OrganizationCapability,
  OrganizationAuditLog,
  OrganizationCreditBalance,
  OrganizationUsageEvent,
  OrganizationWorkspaceSummary,
} from '../../../src/domain/types/organization.js';
import type { PaymentRecord } from '../../../src/domain/types/billing.js';
import type { AuthenticatedUser } from '../../../src/domain/types/user.js';
import type { AppEnv } from '../../../src/types/app.js';
import { createOrganizationRoutes } from '../../../src/routes/organizations.js';
import type { OrganizationBillingServicePort } from '../../../src/services/organization/OrganizationBillingService.js';
import type { OrganizationServicePort } from '../../../src/services/organization/OrganizationService.js';

const testUser: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: 'cognito-user-1',
  email: 'owner@example.com',
  displayName: 'Owner',
  planCode: 'standard',
};

const organizationId = '550e8400-e29b-41d4-a716-446655440000';

interface OrganizationsListResponse {
  organizations: Array<{
    organization: Record<string, unknown>;
  }>;
}

describe('createOrganizationRoutes', () => {
  it('法人Workspace一覧ではStripe内部IDを返さない', async () => {
    const organizationService = new FakeOrganizationService();
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: organizationService as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await routes.request('/organizations');

    expect(response.status).toBe(200);
    const body = (await response.json()) as OrganizationsListResponse;
    expect(body.organizations).toHaveLength(1);
    expect(body.organizations[0].organization).toMatchObject({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Lyra Studio',
      billing_email: 'billing@example.com',
      plan_key: 'enterprise_a',
    });
    expect(body.organizations[0].organization).not.toHaveProperty('stripe_customer_id');
    expect(body.organizations[0].organization).not.toHaveProperty('stripe_subscription_id');
  });

  it('利用履歴取得ではview_usage権限をService境界で要求する', async () => {
    const organizationService = new FakeOrganizationService();
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: organizationService as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await routes.request('/organizations/550e8400-e29b-41d4-a716-446655440000/usage');

    expect(response.status).toBe(200);
    expect(organizationService.requiredCapabilities).toContain('view_usage');
  });

  it('利用履歴CSVでは外部サービスIDとプロンプト系メタデータを出力しない', async () => {
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: new FakeOrganizationService() as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await routes.request(`/organizations/${organizationId}/usage.csv`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    const csv = await response.text();
    expect(csv).toContain('created_at,organization_id,user_id,work_id,generation_job_id,event_type,credit_amount,generation_type,status');
    expect(csv).toContain('page_generate');
    expect(csv).not.toContain('cus_should_not_be_returned');
    expect(csv).not.toContain('req_should_not_be_returned');
    expect(csv).not.toContain('prompt should not be returned');
    expect(csv).not.toContain('private/source.png');
  });

  it('請求履歴取得ではStripe内部IDを返さない', async () => {
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: new FakeOrganizationService() as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await routes.request(`/organizations/${organizationId}/invoices`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { invoices: Array<Record<string, unknown>> };
    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0]).toMatchObject({
      id: 'payment-1',
      organization_id: organizationId,
      kind: 'subscription',
      amount_jpy: 10000,
      status: 'paid',
      invoice_url: 'https://billing.stripe.com/invoice/acct_test/in_1',
    });
    expect(body.invoices[0]).not.toHaveProperty('stripe_checkout_session_id');
    expect(body.invoices[0]).not.toHaveProperty('stripe_invoice_id');
  });

  it('法人請求概要ではサブスク状態と次回請求日だけを返しStripe内部IDを返さない', async () => {
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: new FakeOrganizationService() as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await routes.request(`/organizations/${organizationId}/billing`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.subscription).toMatchObject({
      organization_id: organizationId,
      plan_code: 'enterprise_a',
      status: 'active',
      current_period_end: '2026-08-01T00:00:00.000Z',
      cancel_at_period_end: false,
    });
    expect(JSON.stringify(body)).not.toContain('sub_should_not_be_returned');
    expect(JSON.stringify(body)).not.toContain('cus_should_not_be_returned');
  });

  it('利用履歴レスポンスでは外部サービスIDとプロンプト系メタデータを返さない', async () => {
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: new FakeOrganizationService() as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await routes.request(`/organizations/${organizationId}/usage`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { usage_events: Array<{ metadata: Record<string, unknown> }> };
    expect(body.usage_events[0].metadata).toEqual({
      generation_type: 'page_generate',
      page_id: 'page-1',
    });
  });

  it('監査ログレスポンスでは外部サービスIDとプロンプト系メタデータを返さない', async () => {
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: new FakeOrganizationService() as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await routes.request(`/organizations/${organizationId}/audit-logs`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { audit_logs: Array<{ metadata: Record<string, unknown> }> };
    expect(body.audit_logs[0].metadata).toEqual({
      plan_key: 'enterprise_a',
      credits: 600,
    });
  });

  it('法人Workspace更新APIでは請求状態とプランを直接変更できない', async () => {
    const organizationService = new FakeOrganizationService();
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: organizationService as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });
    routes.onError((err, c) =>
      c.json({ error: { code: 'code' in err ? err.code : 'INTERNAL_ERROR', message: err.message } }, 'statusCode' in err ? (err.statusCode as 422) : 500),
    );

    const response = await routes.request(`/organizations/${organizationId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        plan_key: 'enterprise_c',
        status: 'active',
      }),
    });

    expect(response.status).toBe(422);
    expect(organizationService.updatedOrganizations).toHaveLength(0);
  });

  it('法人Workspace作成APIでは契約プランを直接指定できない', async () => {
    const organizationService = new FakeOrganizationService();
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: organizationService as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });
    routes.onError((err, c) =>
      c.json({ error: { code: 'code' in err ? err.code : 'INTERNAL_ERROR', message: err.message } }, 'statusCode' in err ? (err.statusCode as 422) : 500),
    );

    const response = await routes.request('/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Fake Enterprise C',
        billing_email: 'billing@example.com',
        plan_key: 'enterprise_c',
      }),
    });

    expect(response.status).toBe(422);
    expect(organizationService.createdOrganizations).toHaveLength(0);
  });
});

function buildAuthMiddleware(user: AuthenticatedUser): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('user', user);
    await next();
  };
}

function buildPassThroughMiddleware(): MiddlewareHandler<AppEnv> {
  return async (_c, next) => {
    await next();
  };
}

class FakeOrganizationBillingService {
  public getEnterprisePlanCatalog(): unknown[] {
    return [];
  }

  public async getOrganizationSubscriptionSummary(): Promise<{
    organizationId: string;
    planCode: 'enterprise_a';
    status: 'active';
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: false;
  }> {
    return {
      organizationId,
      planCode: 'enterprise_a',
      status: 'active',
      currentPeriodStart: new Date('2026-07-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
    };
  }

  public async listOrganizationInvoices(_userId: string, _organizationId: string): Promise<PaymentRecord[]> {
    return [
      {
        id: 'payment-1',
        userId: null,
        organizationId,
        stripeCheckoutSessionId: 'cs_should_not_be_returned',
        stripeInvoiceId: 'in_should_not_be_returned',
        invoiceUrl: 'https://billing.stripe.com/invoice/acct_test/in_1',
        kind: 'subscription',
        amountJpy: 10000,
        status: 'paid',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ];
  }
}

class FakeOrganizationService {
  public requiredCapabilities: Array<OrganizationCapability | undefined> = [];
  public createdOrganizations: Array<Record<string, unknown>> = [];
  public updatedOrganizations: Array<Record<string, unknown>> = [];

  public async listWorkspaces(_userId: string): Promise<OrganizationWorkspaceSummary[]> {
    return [buildWorkspace()];
  }

  public async getOrganization(_userId: string, _organizationId: string): Promise<OrganizationWorkspaceSummary> {
    return buildWorkspace();
  }

  public async createOrganization(
    _userId: string,
    input: Record<string, unknown>,
  ): Promise<OrganizationWorkspaceSummary> {
    this.createdOrganizations.push(input);
    return buildWorkspace();
  }

  public async updateOrganization(
    _userId: string,
    _organizationId: string,
    input: Record<string, unknown>,
  ): Promise<OrganizationWorkspaceSummary['organization']> {
    this.updatedOrganizations.push(input);
    return buildWorkspace().organization;
  }

  public async listUsageEvents(userId: string, organizationId: string): Promise<unknown[]> {
    await this.requireMembership(organizationId, userId, 'view_usage');
    return [
      {
        id: 'usage-1',
        organizationId,
        userId,
        workId: 'work-1',
        generationJobId: 'job-1',
        eventType: 'page_generate',
        creditAmount: -3,
        metadata: {
          generation_type: 'page_generate',
          page_id: 'page-1',
          stripe_customer_id: 'cus_should_not_be_returned',
          openai_request_id: 'req_should_not_be_returned',
          draft_prompt: 'prompt should not be returned',
          source_s3_key: 'private/source.png',
        },
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ] satisfies OrganizationUsageEvent[];
  }

  public async listAuditLogs(userId: string, organizationId: string): Promise<unknown[]> {
    await this.requireMembership(organizationId, userId, 'view_audit_logs');
    return [
      {
        id: 'audit-1',
        organizationId,
        actorUserId: userId,
        action: 'subscription.paid',
        targetType: 'organization',
        targetId: organizationId,
        metadata: {
          plan_key: 'enterprise_a',
          credits: 600,
          stripe_subscription_id: 'sub_should_not_be_returned',
          stripe_event_id: 'evt_should_not_be_returned',
          compiled_prompt: 'prompt should not be returned',
          image_url: 'https://private.example/image.png',
        },
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ] satisfies OrganizationAuditLog[];
  }

  public async requireMembership(
    _organizationId: string,
    _userId: string,
    capability?: OrganizationCapability,
  ): Promise<OrganizationWorkspaceSummary['membership']> {
    this.requiredCapabilities.push(capability);
    return buildWorkspace().membership;
  }

  public async getCreditBalance(): Promise<OrganizationCreditBalance> {
    return buildWorkspace().balance as OrganizationCreditBalance;
  }
}

function buildWorkspace(): OrganizationWorkspaceSummary {
    return {
      organization: {
      id: organizationId,
      type: 'business',
      name: 'Lyra Studio',
      legalName: 'Lyra Studio Inc.',
      status: 'active',
      planKey: 'enterprise_a',
      billingEmail: 'billing@example.com',
      stripeCustomerId: 'cus_should_not_be_returned',
      stripeSubscriptionId: 'sub_should_not_be_returned',
      createdByUserId: 'user-1',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    },
    membership: {
      id: 'member-1',
      organizationId: '550e8400-e29b-41d4-a716-446655440000',
      userId: 'user-1',
      email: 'owner@example.com',
      displayName: 'Owner',
      role: 'owner',
      status: 'active',
      invitedByUserId: null,
      joinedAt: new Date('2026-07-01T00:00:00.000Z'),
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    },
    balance: {
      organizationId: '550e8400-e29b-41d4-a716-446655440000',
      monthlyCredits: 500,
      purchasedCredits: 40,
      monthlyExpiresAt: new Date('2026-07-31T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    },
  };
}
