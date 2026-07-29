import { ConfigurationError } from '../../domain/errors/index.js';
import { AesGcmPushTokenCipher } from '../crypto/AesGcmPushTokenCipher.js';
import type { DatabaseClient, TransactionRunner } from '../../lib/db.js';
import { PostgresPushNotificationOutboxRepository } from '../../repositories/PushNotificationOutboxRepository.js';
import { PushNotificationDeliveryService } from '../../services/notification/PushNotificationDeliveryService.js';
import {
  ApnsPushProvider,
  JoseApnsProviderToken,
  NodeHttp2ApnsTransport,
} from './ApnsPushProvider.js';
import {
  FetchFcmHttpClient,
  FcmPushProvider,
  GoogleServiceAccountFcmAccessToken,
} from './FcmPushProvider.js';
import { PlatformNativePushProvider } from './PlatformNativePushProvider.js';

const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;
const DEFAULT_DELIVERY_INTERVAL_MS = 30_000;

export interface PushNotificationEnvironment {
  PUSH_NOTIFICATIONS_ENABLED: boolean;
  PUSH_TOKEN_ENCRYPTION_KEY_BASE64?: string;
  PUSH_TOKEN_HASH_KEY_BASE64?: string;
  PUSH_TOKEN_ENCRYPTION_KEY_ID?: string;
  PUSH_APNS_TEAM_ID?: string;
  PUSH_APNS_KEY_ID?: string;
  PUSH_APNS_PRIVATE_KEY_BASE64?: string;
  PUSH_APNS_BUNDLE_ID?: string;
  PUSH_APNS_ENVIRONMENT?: 'sandbox' | 'production';
  PUSH_FCM_SERVICE_ACCOUNT_JSON_BASE64?: string;
  PUSH_PROVIDER_TIMEOUT_MS?: number;
  PUSH_DELIVERY_INTERVAL_MS?: number;
}

export interface ResolvedPushNotificationRuntimeConfig {
  encryptionKeyBase64: string;
  hashKeyBase64: string;
  encryptionKeyId: string;
  providerTimeoutMs: number;
  deliveryIntervalMs: number;
  apns: {
    teamId: string;
    keyId: string;
    privateKeyPem: string;
    bundleId: string;
    environment: 'sandbox' | 'production';
  };
  fcm: {
    projectId: string;
    clientEmail: string;
    privateKey: string;
  };
}

export interface PushNotificationDeliveryRuntime {
  deliveryService: PushNotificationDeliveryService;
  intervalMs: number;
}

export function resolvePushNotificationRuntimeConfig(
  config: PushNotificationEnvironment,
): ResolvedPushNotificationRuntimeConfig | null {
  if (!config.PUSH_NOTIFICATIONS_ENABLED) {
    return null;
  }

  const encryptionKeyBase64 = requireConfig(
    config.PUSH_TOKEN_ENCRYPTION_KEY_BASE64,
    'PUSH_TOKEN_ENCRYPTION_KEY_BASE64',
  );
  const hashKeyBase64 = requireConfig(
    config.PUSH_TOKEN_HASH_KEY_BASE64,
    'PUSH_TOKEN_HASH_KEY_BASE64',
  );
  const encryptionKeyId = requireConfig(
    config.PUSH_TOKEN_ENCRYPTION_KEY_ID,
    'PUSH_TOKEN_ENCRYPTION_KEY_ID',
  );
  const apnsTeamId = requireConfig(config.PUSH_APNS_TEAM_ID, 'PUSH_APNS_TEAM_ID');
  const apnsKeyId = requireConfig(config.PUSH_APNS_KEY_ID, 'PUSH_APNS_KEY_ID');
  const apnsBundleId = requireConfig(
    config.PUSH_APNS_BUNDLE_ID,
    'PUSH_APNS_BUNDLE_ID',
  );
  const apnsPrivateKeyPem = decodeBase64Utf8(
    requireConfig(
      config.PUSH_APNS_PRIVATE_KEY_BASE64,
      'PUSH_APNS_PRIVATE_KEY_BASE64',
    ),
    'PUSH_APNS_PRIVATE_KEY_BASE64',
  );
  assertPrivateKey(apnsPrivateKeyPem, 'PUSH_APNS_PRIVATE_KEY_BASE64');

  const serviceAccountText = decodeBase64Utf8(
    requireConfig(
      config.PUSH_FCM_SERVICE_ACCOUNT_JSON_BASE64,
      'PUSH_FCM_SERVICE_ACCOUNT_JSON_BASE64',
    ),
    'PUSH_FCM_SERVICE_ACCOUNT_JSON_BASE64',
  );
  const serviceAccount = parseFcmServiceAccount(serviceAccountText);

  return {
    encryptionKeyBase64,
    hashKeyBase64,
    encryptionKeyId,
    providerTimeoutMs:
      config.PUSH_PROVIDER_TIMEOUT_MS ?? DEFAULT_PROVIDER_TIMEOUT_MS,
    deliveryIntervalMs:
      config.PUSH_DELIVERY_INTERVAL_MS ?? DEFAULT_DELIVERY_INTERVAL_MS,
    apns: {
      teamId: apnsTeamId,
      keyId: apnsKeyId,
      privateKeyPem: apnsPrivateKeyPem,
      bundleId: apnsBundleId,
      environment: config.PUSH_APNS_ENVIRONMENT ?? 'sandbox',
    },
    fcm: serviceAccount,
  };
}

export function createPushNotificationDeliveryRuntime(
  environment: PushNotificationEnvironment,
  database: DatabaseClient & TransactionRunner,
): PushNotificationDeliveryRuntime | null {
  const config = resolvePushNotificationRuntimeConfig(environment);
  if (config === null) {
    return null;
  }
  const cipher = new AesGcmPushTokenCipher({
    encryptionKeyBase64: config.encryptionKeyBase64,
    hashKeyBase64: config.hashKeyBase64,
    keyId: config.encryptionKeyId,
  });
  const apns = new ApnsPushProvider(
    {
      bundleId: config.apns.bundleId,
      environment: config.apns.environment,
      timeoutMs: config.providerTimeoutMs,
    },
    new NodeHttp2ApnsTransport(),
    new JoseApnsProviderToken(
      config.apns.teamId,
      config.apns.keyId,
      config.apns.privateKeyPem,
    ),
  );
  const fcm = new FcmPushProvider(
    {
      projectId: config.fcm.projectId,
      timeoutMs: config.providerTimeoutMs,
    },
    new FetchFcmHttpClient(),
    new GoogleServiceAccountFcmAccessToken(
      config.fcm.clientEmail,
      config.fcm.privateKey,
    ),
  );
  return {
    deliveryService: new PushNotificationDeliveryService(
      new PostgresPushNotificationOutboxRepository(database, database),
      cipher,
      new PlatformNativePushProvider(apns, fcm),
    ),
    intervalMs: config.deliveryIntervalMs,
  };
}

function requireConfig(value: string | undefined, key: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new ConfigurationError(`${key} is required when push notifications are enabled`);
  }
  return value.trim();
}

function decodeBase64Utf8(value: string, key: string): string {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new ConfigurationError(`${key} must be canonical base64`);
  }
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  if (decoded.length === 0 || decoded.includes('\uFFFD')) {
    throw new ConfigurationError(`${key} is invalid`);
  }
  return decoded;
}

function assertPrivateKey(value: string, key: string): void {
  if (
    !value.includes('-----BEGIN PRIVATE KEY-----') ||
    !value.includes('-----END PRIVATE KEY-----')
  ) {
    throw new ConfigurationError(`${key} must contain a PKCS8 private key`);
  }
}

function parseFcmServiceAccount(value: string): ResolvedPushNotificationRuntimeConfig['fcm'] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new ConfigurationError('PUSH_FCM_SERVICE_ACCOUNT_JSON_BASE64 must contain JSON');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('project_id' in parsed) ||
    typeof parsed.project_id !== 'string' ||
    parsed.project_id.length === 0 ||
    !('client_email' in parsed) ||
    typeof parsed.client_email !== 'string' ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(parsed.client_email) ||
    !('private_key' in parsed) ||
    typeof parsed.private_key !== 'string'
  ) {
    throw new ConfigurationError(
      'PUSH_FCM_SERVICE_ACCOUNT_JSON_BASE64 is missing required service-account fields',
    );
  }
  assertPrivateKey(parsed.private_key, 'PUSH_FCM_SERVICE_ACCOUNT_JSON_BASE64');
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}
