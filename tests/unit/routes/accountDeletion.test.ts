import type { MiddlewareHandler } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  accountDeletionPreviewResponseSchema,
  accountDeletionResultResponseSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';
import type { AuthenticatedUser } from '../../../src/domain/types/user.js';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import { createAccountDeletionRoutes } from '../../../src/routes/accountDeletion.js';
import type {
  AccountDeletionPreview,
  AccountDeletionRequestInput,
  AccountDeletionResult,
  AccountDeletionServicePort,
} from '../../../src/services/account/AccountDeletionService.js';
import type { AppEnv } from '../../../src/types/app.js';
import { createApp } from '../../../src/app.js';

const user: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  supabaseId: 'cognito-sub-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};

class FakeService implements AccountDeletionServicePort {
  public result: AccountDeletionResult = { status: 'completed', blockers: [] };
  public readonly requests: AccountDeletionRequestInput[] = [];

  public async getDeletionPreview(): Promise<AccountDeletionPreview> {
    return {
      personalData: {
        account: 'anonymized',
        personalWorks: 'deleted',
        organizationMemberships: 'removed',
        billingRecords: 'retained_for_legal_and_security',
      },
      uniqueOwnerOrganizations: [],
      activePersonalStripeSubscriptionCount: 0,
      activeStoreSubscriptions: [],
      personalAssetCount: 0,
      activePersonalJobCount: 0,
    };
  }

  public async requestDeletion(
    input: AccountDeletionRequestInput,
  ): Promise<AccountDeletionResult> {
    this.requests.push(input);
    return this.result;
  }
}

describe('createAccountDeletionRoutes', () => {
  it('既定構成ではAPIを公開せず、明示注入時だけmountする', async () => {
    const disabled = createApp({ enableDevAuthBypass: true });
    expect((await disabled.request('/api/account/deletion')).status).toBe(404);

    const enabled = createApp({
      enableDevAuthBypass: true,
      accountDeletionService: new FakeService(),
    });
    expect((await enabled.request('/api/account/deletion')).status).toBe(200);
  });

  it('previewを本人scope・no-store・strict contractで返す', async () => {
    const service = new FakeService();
    const app = createRoutes(service);

    const response = await app.request('/account/deletion');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(
      accountDeletionPreviewResponseSchema.safeParse(await response.json())
        .success,
    ).toBe(true);
  });

  it('exact confirmationとacknowledgementだけを本人identity付きで渡す', async () => {
    const service = new FakeService();
    const app = createRoutes(service);

    const response = await app.request('/account/deletion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        confirmation: 'DELETE',
        acknowledge_personal_subscriptions: true,
        acknowledge_store_billing: true,
        acknowledge_personal_assets: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(
      accountDeletionResultResponseSchema.safeParse(await response.json())
        .success,
    ).toBe(true);
    expect(service.requests).toEqual([
      {
        userId: user.id,
        identityId: user.supabaseId,
        confirmation: 'DELETE',
        acknowledgePersonalSubscriptions: true,
        acknowledgeStoreBilling: true,
        acknowledgePersonalAssets: true,
      },
    ]);
  });

  it('blockerは409、recovery pendingは202にする', async () => {
    const service = new FakeService();
    const app = createRoutes(service);
    service.result = {
      status: 'blocked',
      blockers: [{ code: 'ACTIVE_PERSONAL_JOB', job_count: 1 }],
    };

    const blocked = await execute(app);
    expect(blocked.status).toBe(409);

    service.result = {
      status: 'pending_external_action',
      blockers: [],
      next_action: 'disable_identity',
    };
    const pending = await execute(app);
    expect(pending.status).toBe(202);
  });

  it('余分field・confirmation違いをservice前に422へする', async () => {
    const service = new FakeService();
    const app = createRoutes(service);

    const response = await app.request('/account/deletion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        confirmation: 'delete',
        acknowledge_personal_subscriptions: true,
        acknowledge_store_billing: true,
        acknowledge_personal_assets: true,
        user_id: 'other',
      }),
    });

    expect(response.status).toBe(422);
    expect(service.requests).toEqual([]);
  });
});

function createRoutes(service: AccountDeletionServicePort) {
  const app = createAccountDeletionRoutes({
    authMiddleware: buildAuthMiddleware(),
    rateLimitMiddleware: async (_c, next) => next(),
    accountDeletionService: service,
  });
  app.onError(errorHandler);
  return app;
}

function buildAuthMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('user', user);
    await next();
  };
}

async function execute(
  app: ReturnType<typeof createRoutes>,
): Promise<Response> {
  return app.request('/account/deletion', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      confirmation: 'DELETE',
      acknowledge_personal_subscriptions: true,
      acknowledge_store_billing: true,
      acknowledge_personal_assets: true,
    }),
  });
}
