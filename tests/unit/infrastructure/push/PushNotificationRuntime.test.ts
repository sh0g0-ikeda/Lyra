import { describe, expect, it } from 'vitest';

import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { resolvePushNotificationRuntimeConfig } from '../../../../src/infrastructure/push/PushNotificationRuntime.js';

const apnsPrivateKey = [
  '-----BEGIN PRIVATE KEY-----',
  'opaque-apns-private-key',
  '-----END PRIVATE KEY-----',
].join('\n');
const fcmPrivateKey = [
  '-----BEGIN PRIVATE KEY-----',
  'opaque-fcm-private-key',
  '-----END PRIVATE KEY-----',
].join('\n');
const serviceAccount = {
  type: 'service_account',
  project_id: 'lyra-production',
  client_email: 'firebase-admin@lyra-production.iam.gserviceaccount.com',
  private_key: fcmPrivateKey,
};

describe('resolvePushNotificationRuntimeConfig', () => {
  it('無効時はprovider secretなしでnullを返す', () => {
    expect(resolvePushNotificationRuntimeConfig({
      PUSH_NOTIFICATIONS_ENABLED: false,
    })).toBeNull();
  });

  it('有効時はtoken保護鍵・APNs・FCM設定を検証して復号する', () => {
    const resolved = resolvePushNotificationRuntimeConfig(buildConfig());

    expect(resolved).toEqual({
      encryptionKeyBase64: Buffer.alloc(32, 7).toString('base64'),
      hashKeyBase64: Buffer.alloc(32, 11).toString('base64'),
      encryptionKeyId: 'push-key-v1',
      providerTimeoutMs: 8_000,
      deliveryIntervalMs: 20_000,
      apns: {
        teamId: 'TEAM123456',
        keyId: 'KEY1234567',
        privateKeyPem: apnsPrivateKey,
        bundleId: 'jp.lyra.mobile',
        environment: 'production',
      },
      fcm: {
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email,
        privateKey: fcmPrivateKey,
      },
    });
  });

  it.each([
    ['PUSH_APNS_TEAM_ID', { PUSH_APNS_TEAM_ID: undefined }],
    ['PUSH_APNS_PRIVATE_KEY_BASE64', { PUSH_APNS_PRIVATE_KEY_BASE64: 'not-base64!' }],
    ['PUSH_FCM_SERVICE_ACCOUNT_JSON_BASE64', { PUSH_FCM_SERVICE_ACCOUNT_JSON_BASE64: 'bm90LWpzb24=' }],
  ] as const)('不完全または不正な %s は秘密値を出さずfail closedにする', (key, override) => {
    expect(() => resolvePushNotificationRuntimeConfig({
      ...buildConfig(),
      ...override,
    })).toThrowError(ConfigurationError);
    try {
      resolvePushNotificationRuntimeConfig({ ...buildConfig(), ...override });
    } catch (error) {
      expect(String(error)).toContain(key);
      expect(String(error)).not.toContain('opaque-apns-private-key');
      expect(String(error)).not.toContain('opaque-fcm-private-key');
    }
  });
});

function buildConfig() {
  return {
    PUSH_NOTIFICATIONS_ENABLED: true,
    PUSH_TOKEN_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
    PUSH_TOKEN_HASH_KEY_BASE64: Buffer.alloc(32, 11).toString('base64'),
    PUSH_TOKEN_ENCRYPTION_KEY_ID: 'push-key-v1',
    PUSH_APNS_TEAM_ID: 'TEAM123456',
    PUSH_APNS_KEY_ID: 'KEY1234567',
    PUSH_APNS_PRIVATE_KEY_BASE64: Buffer.from(apnsPrivateKey, 'utf8').toString('base64'),
    PUSH_APNS_BUNDLE_ID: 'jp.lyra.mobile',
    PUSH_APNS_ENVIRONMENT: 'production' as const,
    PUSH_FCM_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(
      JSON.stringify(serviceAccount),
      'utf8',
    ).toString('base64'),
    PUSH_PROVIDER_TIMEOUT_MS: 8_000,
    PUSH_DELIVERY_INTERVAL_MS: 20_000,
  };
}
