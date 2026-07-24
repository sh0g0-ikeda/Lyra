import { describe, expect, it } from 'vitest';

import { createApp } from '../../../src/app.js';
import type { SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';
import type {
  PushTokenRegistryServicePort
} from '../../../src/services/notification/PushTokenRegistryService.js';

describe('push token app wiring', () => {
  it('依存関係がある場合に認証済み/api routeとして登録・削除を公開する', async () => {
    const devUserId = '22222222-2222-4222-8222-222222222222';
    const service = new FakePushTokenRegistryService();
    const app = createApp({
      enableDevAuthBypass: true,
      devAuthBypassClaims: {
        sub: devUserId,
        email: 'dev@local.lyra',
      },
      userProvisioningService: new FakeUserProvisioningService(),
      pushTokenRegistryService: service
    });

    const registration = await app.request('/api/push-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: '11111111-1111-4111-8111-111111111111',
        platform: 'android',
        device_token: 'ExponentPushToken[device-token-123456]',
        locale: 'ja'
      })
    });
    const removal = await app.request(
      '/api/push-tokens/11111111-1111-4111-8111-111111111111',
      { method: 'DELETE' }
    );

    expect(registration.status).toBe(200);
    expect(removal.status).toBe(204);
    expect(service.registeredUsers).toEqual([devUserId]);
    expect(service.removedUsers).toEqual([devUserId]);
  });
});

class FakeUserProvisioningService implements UserProvisioningPort {
  public async provisionFromSupabaseClaims(claims: SupabaseJwtClaims): Promise<ProvisionedUser> {
    return {
      user: {
        id: claims.sub,
        supabaseId: claims.sub,
        email: claims.email,
        displayName: null,
        planCode: 'free',
      },
      isNewUser: false,
    };
  }
}

class FakePushTokenRegistryService implements PushTokenRegistryServicePort {
  public readonly registeredUsers: string[] = [];
  public readonly removedUsers: string[] = [];

  public async register(
    userId: string,
    input: {
      installationId: string;
      platform: 'ios' | 'android';
      deviceToken: string;
      locale: 'ja' | 'en';
    }
  ): Promise<{ installationId: string; platform: 'ios' | 'android' }> {
    this.registeredUsers.push(userId);
    return {
      installationId: input.installationId,
      platform: input.platform
    };
  }

  public async remove(userId: string): Promise<void> {
    this.removedUsers.push(userId);
  }
}
