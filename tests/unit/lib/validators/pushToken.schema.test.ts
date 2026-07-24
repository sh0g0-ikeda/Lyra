import { describe, expect, it } from 'vitest';
import {
  pushTokenInstallationIdSchema,
  pushTokenRegistrationBodySchema,
} from '../../../../src/lib/validators/pushToken.schema.js';

const installationId = '11111111-1111-4111-8111-111111111111';

describe('push token validator', () => {
  it('platform・installation・device token が境界内の場合に受理する', () => {
    expect(
      pushTokenRegistrationBodySchema.parse({
        platform: 'ios',
        installation_id: installationId,
        device_token: 'a'.repeat(16),
        locale: 'en',
      }),
    ).toEqual({
      platform: 'ios',
      installation_id: installationId,
      device_token: 'a'.repeat(16),
      locale: 'en',
    });

    expect(
      pushTokenRegistrationBodySchema.safeParse({
        platform: 'android',
        installation_id: installationId,
        device_token: 'b'.repeat(4096),
      }).success,
    ).toBe(true);
  });

  it('未対応platform・不正installation・短すぎるtoken・空白入りtokenを拒否する', () => {
    const invalidBodies = [
      { platform: 'web', installation_id: installationId, device_token: 'a'.repeat(32) },
      { platform: 'ios', installation_id: 'device-1', device_token: 'a'.repeat(32) },
      { platform: 'ios', installation_id: installationId, device_token: 'short' },
      { platform: 'android', installation_id: installationId, device_token: `token ${'a'.repeat(20)}` },
      { platform: 'android', installation_id: installationId, device_token: 'a'.repeat(4097) },
      { platform: 'android', installation_id: installationId, device_token: 'a'.repeat(32), locale: 'fr' },
    ];

    invalidBodies.forEach((body) => {
      expect(pushTokenRegistrationBodySchema.safeParse(body).success).toBe(false);
    });
  });

  it('未知fieldと不正なpath installation IDを拒否する', () => {
    expect(
      pushTokenRegistrationBodySchema.safeParse({
        platform: 'ios',
        installation_id: installationId,
        device_token: 'a'.repeat(32),
        user_id: 'attacker-selected-user',
      }).success,
    ).toBe(false);
    expect(pushTokenInstallationIdSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});
