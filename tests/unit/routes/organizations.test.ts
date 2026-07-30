import { describe, expect, it } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import { createApp } from '../../../src/app.js';
import type {
  OrganizationCapability,
  OrganizationAuditLog,
  OrganizationCreditBalance,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationUsageEvent,
  OrganizationWorkspaceSummary,
} from '../../../src/domain/types/organization.js';
import type { PaymentRecord } from '../../../src/domain/types/billing.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type { RateLimitResult, RateLimitStore } from '../../../src/middleware/rateLimit.js';
import type { AppEnv } from '../../../src/types/app.js';
import { createOrganizationRoutes } from '../../../src/routes/organizations.js';
import type { ProvisionedUser, UserProvisioningPort } from '../../../src/services/auth/UserProvisioningService.js';
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
  it('招待作成APIは招待URLと送信結果を返し、生トークンは返さない', async () => {
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: new FakeOrganizationService() as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await routes.request(`/organizations/${organizationId}/invitations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'member@example.com',
        role: 'editor',
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      invitation_url: 'https://app.lyra-editor.com/invite/new-token',
      email_delivery: { status: 'sent' },
    });
    expect(body).not.toHaveProperty('invitation_token');
  });

  it('招待preview APIはログイン前に最小情報だけを返す', async () => {
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      publicRateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: new FakeOrganizationService() as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await routes.request('/organization-invitations/raw-token-value-with-enough-length');

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      organization: {
        id: organizationId,
        name: 'Lyra Studio',
      },
      invitation: {
        email: 'member@example.com',
        role: 'editor',
        status: 'pending',
        expires_at: '2026-07-08T00:00:00.000Z',
      },
    });
  });

  it('招待preview APIは公開レート制限を通す', async () => {
    let publicRateLimitCount = 0;
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      publicRateLimitMiddleware: async (_c, next) => {
        publicRateLimitCount += 1;
        await next();
      },
      organizationService: new FakeOrganizationService() as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await routes.request('/organization-invitations/raw-token-value-with-enough-length');

    expect(response.status).toBe(200);
    expect(publicRateLimitCount).toBe(1);
  });

  it('招待プレビューAPIはアプリ全体でもログイン前に取得できる', async () => {
    const app = createApp({
      enableDevAuthBypass: false,
      jwtSecret: 'unit-test-secret',
      userProvisioningService: new FakeUserProvisioningService(),
      rateLimitStore: new AllowingRateLimitStore(),
      organizationService: new FakeOrganizationService() as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await app.request('/api/organization-invitations/raw-token-value-with-enough-length');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      organization: {
        id: organizationId,
        name: 'Lyra Studio',
      },
      invitation: {
        email: 'member@example.com',
        role: 'editor',
        status: 'pending',
        expires_at: '2026-07-08T00:00:00.000Z',
      },
    });
  });

  it('招待一覧APIは送信状態と再送回数を返す', async () => {
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: new FakeOrganizationService() as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await routes.request(`/organizations/${organizationId}/invitations`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { invitations: Array<Record<string, unknown>> };
    expect(body.invitations[0]).toMatchObject({
      id: '550e8400-e29b-41d4-a716-446655440010',
      organization_id: organizationId,
      email: 'member@example.com',
      role: 'editor',
      status: 'pending',
      send_status: 'failed',
      send_error_code: 'MessageRejected',
      resend_count: 1,
    });
  });

  it('招待再送APIは新しい招待URLと送信結果を返す', async () => {
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: new FakeOrganizationService() as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await routes.request(
      `/organizations/${organizationId}/invitations/550e8400-e29b-41d4-a716-446655440010/resend`,
      { method: 'POST' },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      invitation_url: 'https://app.lyra-editor.com/invite/new-token',
      email_delivery: { status: 'sent' },
    });
    expect(body).not.toHaveProperty('invitation_token');
  });

  it('招待取り消しAPIはrevoked状態を返す', async () => {
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: new FakeOrganizationService() as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await routes.request(
      `/organizations/${organizationId}/invitations/550e8400-e29b-41d4-a716-446655440010/revoke`,
      { method: 'POST' },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { invitation: Record<string, unknown> };
    expect(body.invitation).toMatchObject({
      id: '550e8400-e29b-41d4-a716-446655440010',
      status: 'revoked',
      revoked_by_user_id: 'user-1',
    });
  });

  it('workspace・member・invitationの13成功JSONは契約外Service値を500にする', async () => {
    const organizationService = new FakeOrganizationService();
    const invalidWorkspace = {
      ...buildWorkspace(),
      organization: { ...buildWorkspace().organization, id: '' },
    };
    const invalidOrganization = invalidWorkspace.organization;
    const invalidMember = { ...buildWorkspace().membership, id: '' };
    const invalidInvitation = buildInvitation({ id: '' });
    organizationService.listWorkspaces = async () => [invalidWorkspace];
    organizationService.createOrganization = async () => invalidWorkspace;
    organizationService.getOrganization = async () => invalidWorkspace;
    organizationService.updateOrganization = async () => invalidOrganization;
    organizationService.listMembers = async () => [invalidMember];
    organizationService.updateMember = async () => invalidMember;
    organizationService.listInvitations = async () => [invalidInvitation];
    organizationService.inviteMember = async () => ({
      invitation: invalidInvitation,
      invitationUrl: 'https://app.lyra-editor.com/invite/new-token',
      emailDelivery: { status: 'sent' },
    });
    organizationService.resendInvitation = async () => ({
      invitation: invalidInvitation,
      invitationUrl: 'https://app.lyra-editor.com/invite/new-token',
      emailDelivery: { status: 'sent' },
    });
    organizationService.revokeInvitation = async () => invalidInvitation;
    organizationService.acceptInvitation = async () => invalidWorkspace;
    organizationService.previewInvitation = async () => ({
      organization: { id: '', name: 'Lyra Studio' },
      invitation: {
        email: invalidInvitation.email,
        role: invalidInvitation.role,
        status: invalidInvitation.status,
        expiresAt: invalidInvitation.expiresAt,
      },
    });
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      publicRateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: organizationService as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });
    const jsonHeaders = { 'content-type': 'application/json' };
    const invitationId = '550e8400-e29b-41d4-a716-446655440010';
    const token = 'raw-token-value-with-enough-length';

    const responses = await Promise.all([
      routes.request(`/organization-invitations/${token}`),
      routes.request('/organizations'),
      routes.request('/organizations', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ name: 'Lyra Studio' }),
      }),
      routes.request(`/organizations/${organizationId}`),
      routes.request(`/organizations/${organizationId}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ name: 'Updated Studio' }),
      }),
      routes.request(`/organizations/${organizationId}/members`),
      routes.request(`/organizations/${organizationId}/invitations`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ email: 'member@example.com', role: 'editor' }),
      }),
      routes.request(`/organizations/${organizationId}/invitations`),
      routes.request(`/organizations/${organizationId}/invitations/${invitationId}/resend`, {
        method: 'POST',
      }),
      routes.request(`/organizations/${organizationId}/invitations/${invitationId}/revoke`, {
        method: 'POST',
      }),
      routes.request('/organization-invitations/accept', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ token }),
      }),
      routes.request(`/invitations/${token}/accept`, { method: 'POST' }),
      routes.request(`/organizations/${organizationId}/members/550e8400-e29b-41d4-a716-446655440020`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ role: 'viewer' }),
      }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(500);
    }
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

  public async listMembers(): Promise<OrganizationMember[]> {
    return [buildWorkspace().membership];
  }

  public async updateMember(): Promise<OrganizationMember> {
    return buildWorkspace().membership;
  }

  public async acceptInvitation(): Promise<OrganizationWorkspaceSummary> {
    return buildWorkspace();
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

  public async listInvitations(): Promise<OrganizationInvitation[]> {
    return [buildInvitation()];
  }

  public async inviteMember(): Promise<{
    invitation: OrganizationInvitation;
    invitationUrl: string;
    emailDelivery: { status: 'sent' };
  }> {
    return {
      invitation: buildInvitation({
        sendStatus: 'sent',
        sendErrorCode: null,
        sendErrorMessage: null,
        sentAt: new Date('2026-07-02T00:00:00.000Z'),
        lastSentAt: new Date('2026-07-02T00:00:00.000Z'),
      }),
      invitationUrl: 'https://app.lyra-editor.com/invite/new-token',
      emailDelivery: { status: 'sent' },
    };
  }

  public async resendInvitation(): Promise<{
    invitation: OrganizationInvitation;
    invitationUrl: string;
    emailDelivery: { status: 'sent' };
  }> {
    return {
      invitation: buildInvitation({
        sendStatus: 'sent',
        sendErrorCode: null,
        sendErrorMessage: null,
        sentAt: new Date('2026-07-02T00:00:00.000Z'),
        lastSentAt: new Date('2026-07-02T00:00:00.000Z'),
        resendCount: 2,
      }),
      invitationUrl: 'https://app.lyra-editor.com/invite/new-token',
      emailDelivery: { status: 'sent' },
    };
  }

  public async revokeInvitation(): Promise<OrganizationInvitation> {
    return buildInvitation({
      status: 'revoked',
      revokedAt: new Date('2026-07-02T00:00:00.000Z'),
      revokedByUserId: 'user-1',
    });
  }

  public async previewInvitation(): Promise<{
    organization: { id: string; name: string };
    invitation: Pick<OrganizationInvitation, 'email' | 'role' | 'status' | 'expiresAt'>;
  }> {
    const invitation = buildInvitation();
    return {
      organization: {
        id: organizationId,
        name: 'Lyra Studio',
      },
      invitation: {
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
      },
    };
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

function buildInvitation(overrides: Partial<OrganizationInvitation> = {}): OrganizationInvitation {
  return {
    id: '550e8400-e29b-41d4-a716-446655440010',
    organizationId,
    email: 'member@example.com',
    role: 'editor',
    status: 'pending',
    sendStatus: 'failed',
    sendErrorCode: 'MessageRejected',
    sendErrorMessage: 'Email address is not verified',
    sentAt: null,
    lastSentAt: new Date('2026-07-02T00:00:00.000Z'),
    resendCount: 1,
    invitedByUserId: 'user-1',
    acceptedByUserId: null,
    expiresAt: new Date('2026-07-08T00:00:00.000Z'),
    acceptedAt: null,
    revokedAt: null,
    revokedByUserId: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

class FakeUserProvisioningService implements UserProvisioningPort {
  public async provisionFromSupabaseClaims(claims: SupabaseJwtClaims): Promise<ProvisionedUser> {
    return {
      user: {
        ...testUser,
        supabaseId: claims.sub,
        email: claims.email,
      },
      isNewUser: false,
    };
  }
}

class AllowingRateLimitStore implements RateLimitStore {
  public async consume(_key: string, maxRequests: number, windowSeconds: number): Promise<RateLimitResult> {
    return {
      allowed: true,
      remaining: Math.max(maxRequests - 1, 0),
      retryAfterSeconds: windowSeconds,
      resetAt: new Date('2026-07-01T00:00:00.000Z'),
    };
  }
}
