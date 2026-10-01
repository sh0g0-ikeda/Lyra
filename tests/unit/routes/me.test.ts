import { env } from '../../../src/lib/env.js';
import { describe, expect, it } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { AuthenticatedUser } from '../../../src/domain/types/user.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { OrganizationWorkspaceSummary } from '../../../src/domain/types/organization.js';
import type { AppEnv } from '../../../src/types/app.js';
import { createMeRoutes } from '../../../src/routes/me.js';
import type { CreditServicePort } from '../../../src/services/credit/CreditService.js';
import type { OrganizationServicePort } from '../../../src/services/organization/OrganizationService.js';
import { currentSessionSchema } from '../../../packages/api-contract/src/mobileApiSchemas.js';

const testUser: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: 'cognito-user-1',
  email: 'owner@example.com',
  displayName: 'Owner',
  planCode: 'standard',
};

describe('createMeRoutes', () => {
  it('通知の受付能力は信頼したruntimeだけが有効化できる', async () => {
    for (const enabled of [false, true]) {
      const routes = createMeRoutes({authMiddleware: buildAuthMiddleware(testUser), rateLimitMiddleware: buildPassThroughMiddleware(), pushNotificationsEnabled: enabled});
      const response = await routes.request('/me?push_notifications=true');
      expect((await response.json()).capabilities.push_notifications).toBe(enabled);
    }
  });

  it('ログイン中ユーザーと法人ワークスペース概要を返す', async () => {
    const organizationService = new FakeOrganizationService();
    const routes = createMeRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      creditService: new FakeCreditService() as CreditServicePort,
      organizationService: organizationService as unknown as OrganizationServicePort,
    });

    const response = await routes.request('/me');

    expect(response.status).toBe(200);
    const payload = currentSessionSchema.parse(await response.json());
    expect(currentSessionSchema.safeParse(payload).success).toBe(true);
    expect(payload).toEqual({
      capabilities: {
        generation_quotes: false,
        push_notifications: false,
        web_image_delivery: false,
        entity_state_reference_generation: false,
        episode_state_autofill_v1: false,
        entity_state_preview_credit_cost: 1,
      },
      user: {
        id: 'user-1',
        email: 'owner@example.com',
        display_name: 'Owner',
        plan_code: 'standard',
      },
      personal_credits: {
        monthly_credits: 30,
        purchased_credits: 12,
        total_credits: 42,
        monthly_expires_at: '2026-07-31T00:00:00.000Z',
      },
      organizations: [
        {
          id: 'org-1',
          name: 'Lyra Studio',
          status: 'active',
          plan_key: 'enterprise_a',
          role: 'owner',
          membership_status: 'active',
          monthly_credits: 500,
          purchased_credits: 40,
          total_credits: 540,
          monthly_expires_at: '2026-07-31T00:00:00.000Z',
        },
      ],
    });
    expect(organizationService.userIds).toEqual(['user-1']);
  });

  it('optional serviceが未設定でも現行のnullと空配列contractを返す', async () => {
    const routes = createMeRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
    });

    const response = await routes.request('/me');
    const payload = currentSessionSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(currentSessionSchema.safeParse(payload).success).toBe(true);
    expect(payload).toEqual({
      capabilities: {
        generation_quotes: false,
        push_notifications: false,
        web_image_delivery: false,
        entity_state_reference_generation: false,
        episode_state_autofill_v1: false,
        entity_state_preview_credit_cost: 1,
      },
      user: {
        id: 'user-1',
        email: 'owner@example.com',
        display_name: 'Owner',
        plan_code: 'standard',
      },
      personal_credits: null,
      organizations: [],
    });
  });

  it('状態受付の能力が未設定ならOFFとserver料金だけを返す', async () => {
    const routes = createMeRoutes({ authMiddleware: buildAuthMiddleware(testUser), rateLimitMiddleware: buildPassThroughMiddleware() });
    const response = await routes.request('/me');
    const payload = currentSessionSchema.parse(await response.json());
    expect(payload.capabilities).toEqual({
      generation_quotes: false,
        push_notifications: false,
        web_image_delivery: false,
      entity_state_reference_generation: false,
      episode_state_autofill_v1: false,
      entity_state_preview_credit_cost: 1,
    });
  });

  it('信頼したruntimeの受付flagを返しクライアントqueryでは有効化しない', async () => {
    const routes = createMeRoutes({
      authMiddleware: buildAuthMiddleware(testUser), rateLimitMiddleware: buildPassThroughMiddleware(),
      stateCapabilities: { referenceGeneration: true, storyAutofill: false },
    });
    const response = await routes.request('/me?episode_state_autofill_v1=true');
    expect(currentSessionSchema.parse(await response.json()).capabilities).toEqual({
      generation_quotes: false,
        push_notifications: false,
        web_image_delivery: false,
      entity_state_reference_generation: true,
      episode_state_autofill_v1: false,
      entity_state_preview_credit_cost: 1,
    });
  });

  it('内部で負数creditが生成された場合は成功payloadとして返さない', async () => {
    const routes = createMeRoutes({
      authMiddleware: buildAuthMiddleware(testUser),
      rateLimitMiddleware: buildPassThroughMiddleware(),
      creditService: new NegativeCreditService(),
    });
    routes.onError((error, c) =>
      c.json(
        {
          error: {
            code: 'code' in error ? error.code : 'INTERNAL_ERROR',
            message: error.message,
          },
        },
        'statusCode' in error ? (error.statusCode as 500) : 500,
      ),
    );

    const response = await routes.request('/me');

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'CONFIGURATION_ERROR',
        message: 'Mobile response contract validation failed',
      },
    });
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

class FakeCreditService implements CreditServicePort {
  public async getBalance(_userId: string): Promise<CreditBalanceSnapshot> {
    return {
      monthlyCredits: 30,
      purchasedCredits: 12,
      totalCredits: 42,
      monthlyExpiresAt: new Date('2026-07-31T00:00:00.000Z'),
    };
  }

  public async grantSignupBonus(userId: string): Promise<CreditBalanceSnapshot> {
    return this.getBalance(userId);
  }

  public async consumeCredits(): Promise<CreditBalanceSnapshot> {
    return this.getBalance('user-1');
  }

  public async refundCredits(): Promise<CreditBalanceSnapshot> {
    return this.getBalance('user-1');
  }
}

class NegativeCreditService extends FakeCreditService {
  public override async getBalance(_userId: string): Promise<CreditBalanceSnapshot> {
    return {
      monthlyCredits: -1,
      purchasedCredits: 0,
      totalCredits: -1,
      monthlyExpiresAt: null,
    };
  }
}

class FakeOrganizationService {
  public userIds: string[] = [];

  public async listWorkspaces(userId: string): Promise<OrganizationWorkspaceSummary[]> {
    this.userIds.push(userId);
    return [
      {
        organization: {
          id: 'org-1',
          type: 'business',
          name: 'Lyra Studio',
          legalName: 'Lyra Studio Inc.',
          status: 'active',
          planKey: 'enterprise_a',
          billingEmail: 'billing@example.com',
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          createdByUserId: 'user-1',
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
        membership: {
          id: 'member-1',
          organizationId: 'org-1',
          userId,
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
          organizationId: 'org-1',
          monthlyCredits: 500,
          purchasedCredits: 40,
          monthlyExpiresAt: new Date('2026-07-31T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      },
    ];
  }
}


it('Web配信能力は検証済みclientとserver許可リストだけで決まる', async () => {
 const before=env.WEB_IMAGE_DELIVERY_COGNITO_CLIENT_IDS;env.WEB_IMAGE_DELIVERY_COGNITO_CLIENT_IDS='web-client';
 try {
  for (const clientId of [undefined,'mobile-client','web-client']) {
   const routes=createMeRoutes({authMiddleware:async(c,next)=>{c.set('user',testUser);if(clientId!==undefined)c.set('authenticatedClientId',clientId);await next();},rateLimitMiddleware:buildPassThroughMiddleware()});
   const payload=await (await routes.request('/me?platform=web',{headers:{'X-Client-Id':'web-client'}})).json() as {capabilities:{web_image_delivery:boolean}};
   expect(payload.capabilities.web_image_delivery).toBe(clientId==='web-client');
  }
 } finally {env.WEB_IMAGE_DELIVERY_COGNITO_CLIENT_IDS=before;}
});
