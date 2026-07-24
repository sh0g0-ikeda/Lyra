import type { MiddlewareHandler } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../../src/domain/types/user.js';
import { UnauthorizedError } from '../../../src/domain/errors/index.js';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import {
  createPushTokenRoutes,
} from '../../../src/routes/pushTokens.js';
import type {
  PushTokenRegistryServicePort,
} from '../../../src/services/notification/PushTokenRegistryService.js';
import type { AppEnv } from '../../../src/types/app.js';
import { pushTokenRegistrationSchema } from '../../../packages/api-contract/src/mobileApiSchemas.js';

const user: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  supabaseId: 'subject-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};
const installationId = '22222222-2222-4222-8222-222222222222';
const rawToken = 'native-provider-token-value-1234567890';

class FakePushTokenRegistryService implements PushTokenRegistryServicePort {
  public registrations: Array<{
    userId: string;
    input: {
      installationId: string;
      platform: 'ios' | 'android';
      deviceToken: string;
      locale: 'ja' | 'en';
    };
  }> = [];
  public removals: Array<{ userId: string; installationId: string }> = [];

  public async register(
    userId: string,
    input: {
      installationId: string;
      platform: 'ios' | 'android';
      deviceToken: string;
      locale: 'ja' | 'en';
    },
  ): Promise<{ installationId: string; platform: 'ios' | 'android' }> {
    this.registrations.push({ userId, input });
    return {
      installationId: input.installationId,
      platform: input.platform,
    };
  }

  public async remove(userId: string, targetInstallationId: string): Promise<void> {
    this.removals.push({ userId, installationId: targetInstallationId });
  }
}

describe('createPushTokenRoutes', () => {
  it('認証userとしてtokenを登録し秘密値を含まない安定responseだけを返す', async () => {
    const service = new FakePushTokenRegistryService();
    const app = createTestApp(service, authenticatedAs(user));

    const response = await app.request('/push-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'ios',
        installation_id: installationId,
        device_token: rawToken,
        locale: 'en',
      }),
    });
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const payload = JSON.parse(responseText) as unknown;
    expect(pushTokenRegistrationSchema.safeParse(payload).success).toBe(true);
    expect(payload).toEqual({
      status: 'registered',
      installation_id: installationId,
      platform: 'ios',
    });
    expect(responseText).not.toContain(rawToken);
    expect(responseText).not.toContain('token_hash');
    expect(responseText).not.toContain('ciphertext');
    expect(service.registrations).toEqual([
      {
        userId: user.id,
        input: {
          installationId,
          platform: 'ios',
          deviceToken: rawToken,
          locale: 'en',
        },
      },
    ]);
  });

  it('client指定user・未知field・不正値を拒否してserviceを呼ばない', async () => {
    const service = new FakePushTokenRegistryService();
    const app = createTestApp(service, authenticatedAs(user));
    const invalidBodies = [
      {
        platform: 'ios',
        installation_id: installationId,
        device_token: rawToken,
        user_id: '33333333-3333-4333-8333-333333333333',
      },
      { platform: 'web', installation_id: installationId, device_token: rawToken },
      { platform: 'ios', installation_id: 'not-a-uuid', device_token: rawToken },
      { platform: 'android', installation_id: installationId, device_token: 'short' },
    ];

    for (const body of invalidBodies) {
      const response = await app.request('/push-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(422);
    }
    expect(service.registrations).toHaveLength(0);
  });

  it('削除は認証userとpath installationだけを渡し存在有無に関係なく204を返す', async () => {
    const service = new FakePushTokenRegistryService();
    const app = createTestApp(service, authenticatedAs(user));

    const response = await app.request(`/push-tokens/${installationId}`, {
      method: 'DELETE',
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(service.removals).toEqual([{ userId: user.id, installationId }]);
  });

  it('未認証または不正installation pathの場合にregistryを実行しない', async () => {
    const service = new FakePushTokenRegistryService();
    const unauthenticated = createTestApp(service, rejectAuthentication());
    const unauthorizedResponse = await unauthenticated.request('/push-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        platform: 'ios',
        installation_id: installationId,
        device_token: rawToken,
      }),
    });
    expect(unauthorizedResponse.status).toBe(401);

    const authenticated = createTestApp(service, authenticatedAs(user));
    const invalidPathResponse = await authenticated.request('/push-tokens/not-a-uuid', {
      method: 'DELETE',
    });
    expect(invalidPathResponse.status).toBe(422);
    expect(service.registrations).toHaveLength(0);
    expect(service.removals).toHaveLength(0);
  });
});

function createTestApp(
  service: PushTokenRegistryServicePort,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = createPushTokenRoutes({
    authMiddleware,
    rateLimitMiddleware: passThrough(),
    pushTokenRegistryService: service,
  });
  app.onError(errorHandler);
  return app;
}

function authenticatedAs(authenticatedUser: AuthenticatedUser): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('user', authenticatedUser);
    await next();
  };
}

function rejectAuthentication(): MiddlewareHandler<AppEnv> {
  return async () => {
    throw new UnauthorizedError();
  };
}

function passThrough(): MiddlewareHandler<AppEnv> {
  return async (_c, next) => {
    await next();
  };
}
