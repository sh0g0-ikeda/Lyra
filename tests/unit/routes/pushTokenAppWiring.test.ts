import { describe, expect, it } from 'vitest';

import { createApp } from '../../../src/app.js';
import type {
  PushTokenRegistryServicePort
} from '../../../src/services/notification/PushTokenRegistryService.js';

describe('push token app wiring', () => {
  it('依存関係がある場合に認証済み/api routeとして登録・削除を公開する', async () => {
    const service = new FakePushTokenRegistryService();
    const app = createApp({
      enableDevAuthBypass: true,
      devAuthBypassClaims: {
        sub: 'dev-local-user',
        email: 'dev@local.lyra',
      },
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
    expect(service.registeredUsers).toHaveLength(1);
    expect(service.registeredUsers[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(service.removedUsers).toEqual(service.registeredUsers);
  });
});

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
