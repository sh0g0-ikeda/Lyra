import { describe, expect, it } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import {
  organizationAuditLogsResponseSchema,
  organizationBillingSummarySchema,
  organizationCreditBalanceSchema,
  organizationCreditCheckoutSchema,
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
  organizationWorkspaceSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';
import { createApp } from '../../../src/app.js';
import { ValidationError } from '../../../src/domain/errors/index.js';
import type {
  OrganizationCapability,
  OrganizationAuditLog,
  OrganizationCreditBalance,
  OrganizationInvitation,
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
  it('Mobileが利用する法人JSON応答はcanonical schemaで検証できる', async () => {
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      publicRateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: new FakeOrganizationService() as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });
    const jsonBody = (body: Record<string, unknown>): RequestInit => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    // CSV, 204, legacy aliases, and Mobile-unused JSON endpoints are outside
    // this Mobile response-contract table.
    const cases = [
      {
        name: '招待preview',
        path: '/organization-invitations/raw-token-value-with-enough-length',
        schema: organizationInvitationPreviewSchema,
      },
      {
        name: '招待accept',
        path: '/organization-invitations/accept',
        init: jsonBody({ token: 'raw-token-value-with-enough-length' }),
        schema: organizationWorkspaceSchema,
      },
      {
        name: '法人作成',
        path: '/organizations',
        init: jsonBody({ name: 'Lyra Studio', billing_email: 'billing@example.com' }),
        expectedStatus: 201,
        schema: organizationWorkspaceDetailSchema,
      },
      {
        name: '法人詳細',
        path: `/organizations/${organizationId}`,
        schema: organizationWorkspaceDetailSchema,
      },
      {
        name: '法人更新',
        path: `/organizations/${organizationId}`,
        init: {
          ...jsonBody({ name: 'Lyra Studio Updated' }),
          method: 'PATCH',
        },
        schema: organizationUpdateResponseSchema,
      },
      {
        name: 'メンバー一覧',
        path: `/organizations/${organizationId}/members`,
        schema: organizationMembersResponseSchema,
      },
      {
        name: 'メンバー一覧ページ',
        path: `/organizations/${organizationId}/members?limit=1`,
        schema: organizationMembersResponseSchema,
      },
      {
        name: 'メンバー更新',
        path: `/organizations/${organizationId}/members/550e8400-e29b-41d4-a716-446655440001`,
        init: {
          ...jsonBody({ role: 'viewer' }),
          method: 'PATCH',
        },
        schema: organizationMemberUpdateResponseSchema,
      },
      {
        name: '招待一覧',
        path: `/organizations/${organizationId}/invitations`,
        schema: organizationInvitationsResponseSchema,
      },
      {
        name: '招待一覧ページ',
        path: `/organizations/${organizationId}/invitations?limit=1`,
        schema: organizationInvitationsResponseSchema,
      },
      {
        name: '招待作成',
        path: `/organizations/${organizationId}/invitations`,
        init: jsonBody({ email: 'member@example.com', role: 'editor' }),
        expectedStatus: 201,
        schema: organizationInvitationActionResponseSchema,
      },
      {
        name: '招待再送',
        path: `/organizations/${organizationId}/invitations/550e8400-e29b-41d4-a716-446655440010/resend`,
        init: { method: 'POST' },
        schema: organizationInvitationActionResponseSchema,
      },
      {
        name: '招待取り消し',
        path: `/organizations/${organizationId}/invitations/550e8400-e29b-41d4-a716-446655440010/revoke`,
        init: { method: 'POST' },
        schema: organizationInvitationUpdateResponseSchema,
      },
      {
        name: 'クレジット残高',
        path: `/organizations/${organizationId}/credits/balance`,
        schema: organizationCreditBalanceSchema,
      },
      {
        name: '法人プラン',
        path: `/organizations/${organizationId}/billing/plans`,
        schema: organizationPlansResponseSchema,
      },
      {
        name: '法人請求概要',
        path: `/organizations/${organizationId}/billing`,
        schema: organizationBillingSummarySchema,
      },
      {
        name: '法人サブスクリプションhandoff',
        path: `/organizations/${organizationId}/billing/checkout/subscription`,
        init: jsonBody({ plan_code: 'enterprise_a' }),
        expectedStatus: 201,
        schema: organizationSubscriptionCheckoutSchema,
      },
      {
        name: '法人クレジットhandoff',
        path: `/organizations/${organizationId}/billing/checkout/credits`,
        init: jsonBody({ package_code: 'credits_200' }),
        expectedStatus: 201,
        schema: organizationCreditCheckoutSchema,
      },
      {
        name: '法人請求管理handoff',
        path: `/organizations/${organizationId}/billing/customer-portal`,
        init: { method: 'POST' },
        schema: organizationCustomerPortalSchema,
      },
      {
        name: '法人請求履歴',
        path: `/organizations/${organizationId}/invoices`,
        schema: organizationInvoicesResponseSchema,
      },
      {
        name: '利用履歴',
        path: `/organizations/${organizationId}/usage`,
        schema: organizationUsageResponseSchema,
      },
      {
        name: '利用履歴ページ',
        path: `/organizations/${organizationId}/usage?limit=1`,
        schema: organizationUsageResponseSchema,
      },
      {
        name: '監査ログ',
        path: `/organizations/${organizationId}/audit-logs`,
        schema: organizationAuditLogsResponseSchema,
      },
      {
        name: '監査ログページ',
        path: `/organizations/${organizationId}/audit-logs?limit=1`,
        schema: organizationAuditLogsResponseSchema,
      },
    ];

    for (const contractCase of cases) {
      const response = await routes.request(contractCase.path, contractCase.init);
      expect(response.status, contractCase.name).toBe(contractCase.expectedStatus ?? 200);
      const result = contractCase.schema.safeParse(await response.json());
      expect(result.success, contractCase.name).toBe(true);
    }
  });

  it('法人詳細がcanonical schemaに違反する場合はfail-closedで拒否する', async () => {
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: new InvalidOrganizationResponseService() as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });
    installTestErrorHandler(routes);

    const response = await routes.request(`/organizations/${organizationId}`);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INTERNAL_ERROR' },
    });
  });

  it('法人請求handoffが安全でないURLを返す場合はfail-closedで拒否する', async () => {
    const billingService = new FakeOrganizationBillingService();
    billingService.portalUrl = 'http://billing.example.com/portal';
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: new FakeOrganizationService() as unknown as OrganizationServicePort,
      organizationBillingService: billingService as unknown as OrganizationBillingServicePort,
    });
    installTestErrorHandler(routes);

    const response = await routes.request(
      `/organizations/${organizationId}/billing/customer-portal`,
      { method: 'POST' },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INTERNAL_ERROR' },
    });
  });

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

  it('法人Workspace一覧のservice応答が契約外ならfail-closedにする', async () => {
    const organizationService = new FakeOrganizationService();
    organizationService.listWorkspaces = async () =>
      [{ organization: { id: 42 } }] as unknown as OrganizationWorkspaceSummary[];
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: organizationService as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });
    installTestErrorHandler(routes);

    const response = await routes.request('/organizations');

    expect(response.status).toBe(500);
  });

  it('旧招待accept aliasのservice応答が契約外ならfail-closedにする', async () => {
    const organizationService = new FakeOrganizationService();
    organizationService.acceptInvitation = async () =>
      ({ organization: { id: 42 } }) as unknown as OrganizationWorkspaceSummary;
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: organizationService as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });
    installTestErrorHandler(routes);

    const response = await routes.request('/invitations/raw-token-value-with-enough-length/accept', {
      method: 'POST',
    });

    expect(response.status).toBe(500);
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

  it('ページング指定がない既存の組織一覧レスポンスはnext_cursorを含まない', async () => {
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: new FakeOrganizationService() as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await routes.request(`/organizations/${organizationId}/invitations`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.not.toHaveProperty('next_cursor');
  });

  it.each([
    ['members', 'organization-members'],
    ['invitations', 'organization-invitations'],
    ['usage', 'organization-usage'],
    ['audit-logs', 'organization-audit-logs'],
  ])('ページング一覧%sは不正なlimitまたはcursorを422で拒否する', async (endpoint) => {
    const service = new FakeOrganizationService();
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: service as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });
    installTestErrorHandler(routes);

    const invalidLimit = await routes.request(`/organizations/${organizationId}/${endpoint}?limit=101`);
    const zeroLimit = await routes.request(`/organizations/${organizationId}/${endpoint}?limit=0`);
    const fractionalLimit = await routes.request(`/organizations/${organizationId}/${endpoint}?limit=1.5`);
    const invalidCursor = await routes.request(`/organizations/${organizationId}/${endpoint}?limit=1&cursor=bad`);
    const missingLimit = await routes.request(`/organizations/${organizationId}/${endpoint}?cursor=bad`);

    expect(invalidLimit.status).toBe(422);
    expect(zeroLimit.status).toBe(422);
    expect(fractionalLimit.status).toBe(422);
    expect(invalidCursor.status).toBe(422);
    expect(missingLimit.status).toBe(422);
    expect(service.pageRequests).toHaveLength(0);
  });

  it.each([
    ['members', 'members', 'next-members-cursor'],
    ['invitations', 'invitations', 'next-invitations-cursor'],
    ['usage', 'usage_events', 'next-usage-cursor'],
    ['audit-logs', 'audit_logs', 'next-audit-cursor'],
  ])('ページング一覧%sは既存のcollection keyとnext_cursorを返す', async (endpoint, collectionKey, nextCursor) => {
    const service = new FakeOrganizationService();
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: service as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await routes.request(`/organizations/${organizationId}/${endpoint}?limit=1`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty(collectionKey);
    expect(body).toMatchObject({ next_cursor: nextCursor });
  });

  it('ページング一覧はendpoint固有でないcursorを422で拒否する', async () => {
    const service = new FakeOrganizationService();
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: service as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });
    installTestErrorHandler(routes);
    const foreignCursor = Buffer.from(
      JSON.stringify({
        v: 1,
        k: 'organization-members',
        sort: '2026-07-10T00:00:00.000Z',
        id: '550e8400-e29b-41d4-a716-446655440001',
      }),
    ).toString('base64url');

    const response = await routes.request(
      `/organizations/${organizationId}/invitations?limit=1&cursor=${foreignCursor}`,
    );

    expect(response.status).toBe(422);
    expect(service.pageRequests).toHaveLength(0);
  });

  it('ページング使用量は1ページ目でも完全なスコープのsummaryを返す', async () => {
    const service = new FakeOrganizationService();
    const routes = createOrganizationRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      organizationService: service as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await routes.request(`/organizations/${organizationId}/usage?limit=1`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      usage_events: [{ id: 'usage-1' }],
      next_cursor: 'next-usage-cursor',
      summary: { current_month_total_credits: 99 },
    });
    expect(service.pageRequests).toEqual([{ kind: 'usage', limit: 1 }]);
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
    expect(body.invoices[0]).not.toHaveProperty('user_id');
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
    const body = organizationUsageResponseSchema.parse(await response.json());
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
    const body = organizationAuditLogsResponseSchema.parse(await response.json());
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

  it('アプリ直結の招待プレビュー応答がcanonical schemaに違反する場合は500になる', async () => {
    const app = createApp({
      enableDevAuthBypass: false,
      jwtSecret: 'unit-test-secret',
      userProvisioningService: new FakeUserProvisioningService(),
      rateLimitStore: new AllowingRateLimitStore(),
      organizationService: new InvalidInvitationPreviewService() as unknown as OrganizationServicePort,
      organizationBillingService: new FakeOrganizationBillingService() as unknown as OrganizationBillingServicePort,
    });

    const response = await app.request('/api/organization-invitations/raw-token-value-with-enough-length');

    expect(response.status).toBe(500);
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
});

function buildAuthMiddleware(user: AuthenticatedUser): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('user', user);
    await next();
  };
}

function installTestErrorHandler(routes: ReturnType<typeof createOrganizationRoutes>): void {
  routes.onError((error, c) => {
    if (error instanceof ValidationError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.statusCode);
    }
    return c.json({ error: { code: 'INTERNAL_ERROR' } }, 500);
  });
}

function buildPassThroughMiddleware(): MiddlewareHandler<AppEnv> {
  return async (_c, next) => {
    await next();
  };
}

class FakeOrganizationBillingService {
  public portalUrl = 'https://billing.stripe.com/portal/test';

  public async createSubscriptionCheckoutSession(): Promise<{
    sessionId: string;
    url: string;
  }> {
    return {
      sessionId: 'cs_subscription_test',
      url: 'https://checkout.stripe.com/subscription/test',
    };
  }

  public async createCreditCheckoutSession(): Promise<{
    sessionId: string;
    url: string;
    packageCode: 'credits_200';
  }> {
    return {
      sessionId: 'cs_credit_test',
      url: 'https://checkout.stripe.com/credits/test',
      packageCode: 'credits_200',
    };
  }

  public async createCustomerPortalSession(): Promise<{ url: string }> {
    return { url: this.portalUrl };
  }

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
  public pageRequests: Array<{ kind: string; limit: number }> = [];
  public createdOrganizations: Array<Record<string, unknown>> = [];
  public updatedOrganizations: Array<Record<string, unknown>> = [];

  public async listWorkspaces(_userId: string): Promise<OrganizationWorkspaceSummary[]> {
    return [buildWorkspace()];
  }

  public async getOrganization(_userId: string, _organizationId: string): Promise<OrganizationWorkspaceSummary> {
    return buildWorkspace();
  }

  public async acceptInvitation(): Promise<OrganizationWorkspaceSummary> {
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

  public async listMembersPage(_userId: string, _organizationId: string, page: { limit: number }): Promise<unknown> {
    this.pageRequests.push({ kind: 'members', limit: page.limit });
    return { items: [], nextCursor: 'next-members-cursor' };
  }

  public async listMembers(): Promise<OrganizationWorkspaceSummary['membership'][]> {
    return [buildWorkspace().membership];
  }

  public async updateMember(): Promise<OrganizationWorkspaceSummary['membership']> {
    return buildWorkspace().membership;
  }

  public async listInvitationsPage(_userId: string, _organizationId: string, page: { limit: number }): Promise<unknown> {
    this.pageRequests.push({ kind: 'invitations', limit: page.limit });
    return { items: [buildInvitation()], nextCursor: 'next-invitations-cursor' };
  }

  public async listUsageEventsPage(_userId: string, _organizationId: string, page: { limit: number }): Promise<unknown> {
    this.pageRequests.push({ kind: 'usage', limit: page.limit });
    return {
      page: {
        items: [
          {
            id: 'usage-1',
            organizationId,
            userId: 'user-1',
            workId: 'work-1',
            generationJobId: null,
            eventType: 'page_generate',
            creditAmount: -3,
            metadata: {},
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
          },
        ],
        nextCursor: 'next-usage-cursor',
      },
      summary: {
        currentMonthTotalCredits: 99,
        byMember: [],
        byWork: [],
        byGenerationType: [],
      },
    };
  }

  public async listAuditLogsPage(_userId: string, _organizationId: string, page: { limit: number }): Promise<unknown> {
    this.pageRequests.push({ kind: 'audit-logs', limit: page.limit });
    return { items: [], nextCursor: 'next-audit-cursor' };
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

class InvalidOrganizationResponseService extends FakeOrganizationService {
  public override async getOrganization(): Promise<OrganizationWorkspaceSummary> {
    const workspace = buildWorkspace();
    workspace.organization.billingEmail = 'not-an-email';
    return workspace;
  }
}

class InvalidInvitationPreviewService extends FakeOrganizationService {
  public override async previewInvitation(): Promise<{
    organization: { id: string; name: string };
    invitation: Pick<OrganizationInvitation, 'email' | 'role' | 'status' | 'expiresAt'>;
  }> {
    const preview = await super.previewInvitation();
    return {
      ...preview,
      invitation: {
        ...preview.invitation,
        email: 'not-an-email',
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
