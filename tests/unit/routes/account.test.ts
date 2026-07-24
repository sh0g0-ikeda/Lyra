import { describe, expect, it } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import type { AuthenticatedUser } from '../../../src/domain/types/user.js';
import { createAccountRoutes } from '../../../src/routes/account.js';
import type {
  AccountDeletionRequestInput,
  AccountDeletionResult,
  AccountDeletionServicePort,
} from '../../../src/services/account/AccountDeletionService.js';
import type { AppEnv } from '../../../src/types/app.js';
import {
  accountDeletionPreviewSchema,
  accountDeletionResultSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';

const user: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  supabaseId: 'cognito-subject-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};

describe('createAccountRoutes', () => {
  it('確認済み POST を本人の deletion request に変換する', async () => {
    const service = new FakeAccountDeletionService();
    const app = createAccountRoutes({
      authMiddleware: authenticatedAs(user),
      rateLimitMiddleware: passThrough(),
      accountDeletionService: service,
    });
    app.onError(errorHandler);

    const response = await app.request('/account/deletion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        confirmation: 'DELETE',
        acknowledge_active_subscription: true,
        acknowledge_confirmed_assets: true,
      }),
    });

    expect(response.status).toBe(202);
    expect(accountDeletionResultSchema.safeParse(await response.json()).success).toBe(true);
    expect(service.inputs).toEqual([
      {
        userId: user.id,
        identityId: user.supabaseId,
        confirmation: 'DELETE',
        acknowledgeActiveSubscription: true,
        acknowledgeConfirmedAssets: true,
      },
    ]);
  });

  it('confirmation が不正な request は service を実行しない', async () => {
    const service = new FakeAccountDeletionService();
    const app = createAccountRoutes({
      authMiddleware: authenticatedAs(user),
      rateLimitMiddleware: passThrough(),
      accountDeletionService: service,
    });
    app.onError(errorHandler);

    const response = await app.request('/account/deletion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'erase' }),
    });

    expect(response.status).toBe(422);
    expect(service.inputs).toEqual([]);
  });

  it('削除プレビューは本人の範囲で副作用なしに返す', async () => {
    const service = new FakeAccountDeletionService();
    const app = createAccountRoutes({
      authMiddleware: authenticatedAs(user),
      rateLimitMiddleware: passThrough(),
      accountDeletionService: service,
    });
    app.onError(errorHandler);

    const response = await app.request('/account/deletion-preview');

    expect(response.status).toBe(200);
    expect(service.previewUserIds).toEqual([user.id]);
    expect(service.inputs).toEqual([]);
    const payload = await response.json();
    expect(accountDeletionPreviewSchema.safeParse(payload).success).toBe(true);
    expect(payload).toEqual({
      personal_data: {
        account: 'anonymized',
        personal_works: 'deleted',
        organization_memberships: 'removed',
      },
      unique_owner_organizations: [{ id: 'organization-1', name: 'Lyra Studio' }],
      active_personal_subscription_count: 2,
      active_stripe_subscription_count: 1,
      active_mobile_store_subscription_count: 1,
      confirmed_personal_asset_count: 3,
    });
  });

  it('account route の認証 middleware は無関係な API path へ漏れない', async () => {
    const service = new FakeAccountDeletionService();
    let authenticationCalls = 0;
    const app = createAccountRoutes({
      authMiddleware: async (_c, next) => {
        authenticationCalls += 1;
        await next();
      },
      rateLimitMiddleware: passThrough(),
      accountDeletionService: service,
    });

    const response = await app.request('/webhooks/stripe', { method: 'POST' });

    expect(response.status).toBe(404);
    expect(authenticationCalls).toBe(0);
  });
});

class FakeAccountDeletionService implements AccountDeletionServicePort {
  public inputs: AccountDeletionRequestInput[] = [];
  public previewUserIds: string[] = [];

  public async requestDeletion(input: AccountDeletionRequestInput): Promise<AccountDeletionResult> {
    this.inputs.push(input);
    return {
      status: 'pending_external_action',
      blockers: [],
      next_action: 'delete_identity',
    };
  }

  public async getDeletionPreview(userId: string): Promise<{
    personalData: {
      account: 'anonymized';
      personalWorks: 'deleted';
      organizationMemberships: 'removed';
    };
    uniqueOwnerOrganizations: Array<{ id: string; name: string }>;
    activePersonalSubscriptionCount: number;
    activeStripeSubscriptionCount: number;
    activeMobileStoreSubscriptionCount: number;
    confirmedPersonalAssetCount: number;
  }> {
    this.previewUserIds.push(userId);
    return {
      personalData: {
        account: 'anonymized',
        personalWorks: 'deleted',
        organizationMemberships: 'removed',
      },
      uniqueOwnerOrganizations: [{ id: 'organization-1', name: 'Lyra Studio' }],
      activePersonalSubscriptionCount: 2,
      activeStripeSubscriptionCount: 1,
      activeMobileStoreSubscriptionCount: 1,
      confirmedPersonalAssetCount: 3,
    };
  }
}

function authenticatedAs(authenticatedUser: AuthenticatedUser): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('user', authenticatedUser);
    await next();
  };
}

function passThrough(): MiddlewareHandler<AppEnv> {
  return async (_c, next) => {
    await next();
  };
}
