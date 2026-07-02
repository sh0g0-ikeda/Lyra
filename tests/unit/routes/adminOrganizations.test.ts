import { describe, expect, it } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { OrganizationCreditBalance, OrganizationStatus } from '../../../src/domain/types/organization.js';
import type { EnterprisePlanCode } from '../../../src/domain/constants/billing.js';
import type { AuthenticatedUser } from '../../../src/domain/types/user.js';
import type { AppEnv } from '../../../src/types/app.js';
import { createAdminOrganizationRoutes } from '../../../src/routes/adminOrganizations.js';
import type {
  AdminUpdateOrganizationContractRequest,
  OrganizationServicePort,
} from '../../../src/services/organization/OrganizationService.js';

const organizationId = '550e8400-e29b-41d4-a716-446655440000';

const adminUser: AuthenticatedUser = {
  id: 'admin-user',
  supabaseId: 'cognito-admin',
  email: 'admin@example.com',
  displayName: 'Admin',
  planCode: 'standard',
};

const normalUser: AuthenticatedUser = {
  id: 'normal-user',
  supabaseId: 'cognito-normal',
  email: 'user@example.com',
  displayName: 'User',
  planCode: 'standard',
};

describe('createAdminOrganizationRoutes', () => {
  it('管理者メール以外は法人管理APIを実行できない', async () => {
    const routes = createRoutes({
      user: normalUser,
      organizationService: new FakeAdminOrganizationService(),
      adminEmails: ['admin@example.com'],
    });

    const response = await routes.request(`/admin/organizations/${organizationId}/credits/grants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bucket: 'purchased',
        amount: 100,
        description: 'support grant',
      }),
    });

    expect(response.status).toBe(403);
  });

  it('管理者は法人契約プランと状態を手動更新できる', async () => {
    const organizationService = new FakeAdminOrganizationService();
    const routes = createRoutes({
      user: adminUser,
      organizationService,
      adminEmails: ['admin@example.com'],
    });

    const response = await routes.request(`/admin/organizations/${organizationId}/contract`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        plan_key: 'enterprise_c',
        status: 'active',
        billing_email: 'billing@example.com',
      }),
    });

    expect(response.status).toBe(200);
    expect(organizationService.contractUpdates).toEqual([
      {
        actorUserId: 'admin-user',
        organizationId,
        input: {
          planKey: 'enterprise_c',
          status: 'active',
          billingEmail: 'billing@example.com',
        },
      },
    ]);
    await expect(response.json()).resolves.toMatchObject({
      organization: {
        id: organizationId,
        status: 'active',
        plan_key: 'enterprise_c',
        billing_email: 'billing@example.com',
      },
    });
  });

  it('管理者は法人共有クレジットを手動付与できる', async () => {
    const organizationService = new FakeAdminOrganizationService();
    const routes = createRoutes({
      user: adminUser,
      organizationService,
      adminEmails: ['admin@example.com'],
    });

    const response = await routes.request(`/admin/organizations/${organizationId}/credits/grants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bucket: 'monthly',
        amount: 600,
        description: 'manual contract adjustment',
      }),
    });

    expect(response.status).toBe(201);
    expect(organizationService.creditGrants).toEqual([
      {
        organizationId,
        actorUserId: 'admin-user',
        bucket: 'monthly',
        amount: 600,
        description: 'Admin manual grant: manual contract adjustment',
        packageCode: null,
        stripeEventId: null,
      },
    ]);
    await expect(response.json()).resolves.toMatchObject({
      organization_id: organizationId,
      monthly_credits: 600,
      purchased_credits: 40,
      total_credits: 640,
    });
  });
});

function createRoutes(input: {
  user: AuthenticatedUser;
  organizationService: FakeAdminOrganizationService;
  adminEmails: readonly string[];
}) {
  const routes = createAdminOrganizationRoutes({
    authMiddleware: buildAuthMiddleware(input.user),
    rateLimitMiddleware: buildPassThroughMiddleware(),
    organizationService: input.organizationService as unknown as OrganizationServicePort,
    adminEmails: input.adminEmails,
  });
  routes.onError((err, c) =>
    c.json(
      { error: { code: 'code' in err ? err.code : 'INTERNAL_ERROR', message: err.message } },
      'statusCode' in err ? (err.statusCode as 403 | 422 | 500) : 500,
    ),
  );
  return routes;
}

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

class FakeAdminOrganizationService {
  public readonly contractUpdates: Array<{
    actorUserId: string;
    organizationId: string;
    input: AdminUpdateOrganizationContractRequest;
  }> = [];
  public readonly creditGrants: Array<Record<string, unknown>> = [];

  public async adminUpdateOrganizationContract(
    actorUserId: string,
    targetOrganizationId: string,
    input: AdminUpdateOrganizationContractRequest,
  ) {
    this.contractUpdates.push({ actorUserId, organizationId: targetOrganizationId, input });
    return {
      id: targetOrganizationId,
      type: 'business' as const,
      name: 'Lyra Enterprise',
      legalName: 'Lyra Enterprise Inc.',
      status: input.status ?? ('active' as OrganizationStatus),
      planKey: input.planKey ?? ('enterprise_a' as EnterprisePlanCode),
      billingEmail: input.billingEmail ?? null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      createdByUserId: 'owner-user',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    };
  }

  public async adminGrantCredits(input: Record<string, unknown>): Promise<OrganizationCreditBalance> {
    this.creditGrants.push(input);
    return {
      organizationId,
      monthlyCredits: input.bucket === 'monthly' ? Number(input.amount) : 0,
      purchasedCredits: input.bucket === 'purchased' ? Number(input.amount) : 40,
      monthlyExpiresAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    };
  }
}
