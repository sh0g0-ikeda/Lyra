import { Buffer } from 'node:buffer';
import { ConfigurationError } from '../../domain/errors/index.js';
import {
  createStoreProductCatalog,
  type StoreProductCatalog,
} from '../../domain/storePurchase.js';

export interface MobileStoreBillingEnvConfig {
  MOBILE_STORE_BILLING_ENABLED?: boolean;
  MOBILE_STORE_IDENTIFIER_HASH_SECRET?: string;
  MOBILE_STORE_PROVIDER_TIMEOUT_MS?: number;
  APPLE_STORE_BUNDLE_ID?: string;
  APPLE_STORE_APP_APPLE_ID?: number;
  APPLE_STORE_ROOT_CERTIFICATES_BASE64_JSON?: string;
  APPLE_STORE_ALLOW_SANDBOX?: boolean;
  APPLE_STORE_PRODUCT_STANDARD_MONTHLY?: string;
  APPLE_STORE_PRODUCT_PREMIUM_MONTHLY?: string;
  APPLE_STORE_PRODUCT_CREDITS_200?: string;
  APPLE_STORE_PRODUCT_CREDITS_1000?: string;
  APPLE_STORE_PRODUCT_CREDITS_3000?: string;
  GOOGLE_PLAY_PACKAGE_NAME?: string;
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64?: string;
  GOOGLE_PLAY_PUBSUB_AUDIENCE?: string;
  GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_PLAY_ALLOW_TEST_PURCHASES?: boolean;
  GOOGLE_PLAY_PRODUCT_STANDARD_MONTHLY?: string;
  GOOGLE_PLAY_PRODUCT_PREMIUM_MONTHLY?: string;
  GOOGLE_PLAY_PRODUCT_CREDITS_200?: string;
  GOOGLE_PLAY_PRODUCT_CREDITS_1000?: string;
  GOOGLE_PLAY_PRODUCT_CREDITS_3000?: string;
}

export interface MobileStoreBillingConfig {
  identifierSecret: string;
  providerTimeoutMs: number;
  apple: {
    bundleId: string;
    appAppleId: number;
    rootCertificates: Buffer[];
    allowSandbox: boolean;
    allowProduction: true;
    timeoutMs: number;
  };
  google: {
    packageName: string;
    serviceAccountJsonBase64: string;
    pubSubAudience: string;
    pubSubServiceAccountEmail: string;
    allowTestPurchases: boolean;
    timeoutMs: number;
  };
  productCatalog: StoreProductCatalog;
}

const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;

export function createMobileStoreBillingConfig(
  source: MobileStoreBillingEnvConfig,
  isProduction: boolean,
): MobileStoreBillingConfig | null {
  if (source.MOBILE_STORE_BILLING_ENABLED !== true) {
    return null;
  }

  assertMobileStoreBillingRuntimeConfig(source, isProduction);
  const timeoutMs = source.MOBILE_STORE_PROVIDER_TIMEOUT_MS ?? DEFAULT_PROVIDER_TIMEOUT_MS;

  return {
    identifierSecret: requiredValue(source.MOBILE_STORE_IDENTIFIER_HASH_SECRET),
    providerTimeoutMs: timeoutMs,
    apple: {
      bundleId: requiredValue(source.APPLE_STORE_BUNDLE_ID),
      appAppleId: requiredPositiveInteger(source.APPLE_STORE_APP_APPLE_ID),
      rootCertificates: parseRootCertificates(
        requiredValue(source.APPLE_STORE_ROOT_CERTIFICATES_BASE64_JSON),
      ),
      allowSandbox: source.APPLE_STORE_ALLOW_SANDBOX === true,
      allowProduction: true,
      timeoutMs,
    },
    google: {
      packageName: requiredValue(source.GOOGLE_PLAY_PACKAGE_NAME),
      serviceAccountJsonBase64: requiredValue(source.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64),
      pubSubAudience: requiredValue(source.GOOGLE_PLAY_PUBSUB_AUDIENCE),
      pubSubServiceAccountEmail: requiredValue(
        source.GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL,
      ),
      allowTestPurchases: source.GOOGLE_PLAY_ALLOW_TEST_PURCHASES === true,
      timeoutMs,
    },
    productCatalog: createStoreProductCatalog(productEntries(source)),
  };
}

export function assertMobileStoreBillingRuntimeConfig(
  source: MobileStoreBillingEnvConfig,
  isProduction: boolean,
): void {
  if (source.MOBILE_STORE_BILLING_ENABLED !== true) {
    return;
  }

  const missing = REQUIRED_MOBILE_STORE_CONFIG_KEYS.filter((key) => isEmpty(source[key]));
  const violations: string[] = [];
  if (missing.length > 0) {
    violations.push(`Mobile store billing config is incomplete: ${missing.join(', ')}`);
  }
  if (
    source.MOBILE_STORE_IDENTIFIER_HASH_SECRET !== undefined &&
    source.MOBILE_STORE_IDENTIFIER_HASH_SECRET.trim().length < 32
  ) {
    violations.push('MOBILE_STORE_IDENTIFIER_HASH_SECRET must be at least 32 characters');
  }
  if (
    source.MOBILE_STORE_PROVIDER_TIMEOUT_MS !== undefined &&
    (!Number.isInteger(source.MOBILE_STORE_PROVIDER_TIMEOUT_MS) ||
      source.MOBILE_STORE_PROVIDER_TIMEOUT_MS < 1_000 ||
      source.MOBILE_STORE_PROVIDER_TIMEOUT_MS > 60_000)
  ) {
    violations.push('MOBILE_STORE_PROVIDER_TIMEOUT_MS must be between 1000 and 60000');
  }
  if (
    source.APPLE_STORE_APP_APPLE_ID !== undefined &&
    (!Number.isInteger(source.APPLE_STORE_APP_APPLE_ID) ||
      source.APPLE_STORE_APP_APPLE_ID <= 0)
  ) {
    violations.push('APPLE_STORE_APP_APPLE_ID must be a positive integer');
  }
  if (source.APPLE_STORE_ROOT_CERTIFICATES_BASE64_JSON !== undefined) {
    try {
      parseRootCertificates(source.APPLE_STORE_ROOT_CERTIFICATES_BASE64_JSON);
    } catch {
      violations.push(
        'APPLE_STORE_ROOT_CERTIFICATES_BASE64_JSON must contain DER certificates encoded as base64 JSON',
      );
    }
  }
  if (
    source.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64 !== undefined &&
    !isServiceAccountJson(source.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64)
  ) {
    violations.push(
      'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64 must contain a Google service account credential',
    );
  }
  if (
    source.GOOGLE_PLAY_PUBSUB_AUDIENCE !== undefined &&
    !isHttpsUrl(source.GOOGLE_PLAY_PUBSUB_AUDIENCE)
  ) {
    violations.push('GOOGLE_PLAY_PUBSUB_AUDIENCE must be an https URL');
  }
  if (
    source.GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL !== undefined &&
    !isEmail(source.GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL)
  ) {
    violations.push('GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL must be an email address');
  }

  const duplicateProducts = findDuplicateConfiguredProducts(source);
  if (duplicateProducts.length > 0) {
    violations.push(`Mobile store product mapping contains duplicates: ${duplicateProducts.join(', ')}`);
  }
  if (
    isProduction &&
    (source.APPLE_STORE_ALLOW_SANDBOX === true ||
      source.GOOGLE_PLAY_ALLOW_TEST_PURCHASES === true)
  ) {
    violations.push('Mobile store sandbox and test purchases must be disabled in production');
  }

  if (violations.length > 0) {
    throw new ConfigurationError(violations.join('; '));
  }
}

const REQUIRED_MOBILE_STORE_CONFIG_KEYS = [
  'MOBILE_STORE_IDENTIFIER_HASH_SECRET',
  'APPLE_STORE_BUNDLE_ID',
  'APPLE_STORE_APP_APPLE_ID',
  'APPLE_STORE_ROOT_CERTIFICATES_BASE64_JSON',
  'APPLE_STORE_PRODUCT_STANDARD_MONTHLY',
  'APPLE_STORE_PRODUCT_PREMIUM_MONTHLY',
  'APPLE_STORE_PRODUCT_CREDITS_200',
  'APPLE_STORE_PRODUCT_CREDITS_1000',
  'APPLE_STORE_PRODUCT_CREDITS_3000',
  'GOOGLE_PLAY_PACKAGE_NAME',
  'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64',
  'GOOGLE_PLAY_PUBSUB_AUDIENCE',
  'GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_PLAY_PRODUCT_STANDARD_MONTHLY',
  'GOOGLE_PLAY_PRODUCT_PREMIUM_MONTHLY',
  'GOOGLE_PLAY_PRODUCT_CREDITS_200',
  'GOOGLE_PLAY_PRODUCT_CREDITS_1000',
  'GOOGLE_PLAY_PRODUCT_CREDITS_3000',
] as const;

function productEntries(source: MobileStoreBillingEnvConfig) {
  return [
    subscriptionProduct('apple', requiredValue(source.APPLE_STORE_PRODUCT_STANDARD_MONTHLY), 'standard'),
    subscriptionProduct('apple', requiredValue(source.APPLE_STORE_PRODUCT_PREMIUM_MONTHLY), 'premium'),
    creditProduct('apple', requiredValue(source.APPLE_STORE_PRODUCT_CREDITS_200), 'credits_200'),
    creditProduct('apple', requiredValue(source.APPLE_STORE_PRODUCT_CREDITS_1000), 'credits_1000'),
    creditProduct('apple', requiredValue(source.APPLE_STORE_PRODUCT_CREDITS_3000), 'credits_3000'),
    subscriptionProduct('google', requiredValue(source.GOOGLE_PLAY_PRODUCT_STANDARD_MONTHLY), 'standard'),
    subscriptionProduct('google', requiredValue(source.GOOGLE_PLAY_PRODUCT_PREMIUM_MONTHLY), 'premium'),
    creditProduct('google', requiredValue(source.GOOGLE_PLAY_PRODUCT_CREDITS_200), 'credits_200'),
    creditProduct('google', requiredValue(source.GOOGLE_PLAY_PRODUCT_CREDITS_1000), 'credits_1000'),
    creditProduct('google', requiredValue(source.GOOGLE_PLAY_PRODUCT_CREDITS_3000), 'credits_3000'),
  ] as const;
}

function subscriptionProduct(
  store: 'apple' | 'google',
  productId: string,
  planCode: 'standard' | 'premium',
) {
  return { store, productId, kind: 'subscription' as const, planCode };
}

function creditProduct(
  store: 'apple' | 'google',
  productId: string,
  creditPackageCode: 'credits_200' | 'credits_1000' | 'credits_3000',
) {
  return { store, productId, kind: 'credit_pack' as const, creditPackageCode };
}

function requiredValue(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new ConfigurationError('Mobile store billing config is incomplete');
  }
  return value.trim();
}

function requiredPositiveInteger(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    throw new ConfigurationError('Mobile store billing config is invalid');
  }
  return value;
}

function isEmpty(value: string | number | boolean | undefined): boolean {
  return value === undefined || (typeof value === 'string' && value.trim().length === 0);
}

function parseRootCertificates(value: string): Buffer[] {
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  const raw: unknown = JSON.parse(decoded);
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.some((entry) => typeof entry !== 'string' || entry.length === 0)
  ) {
    throw new Error('invalid root certificates');
  }

  const certificates = raw.map((entry) => Buffer.from(entry, 'base64'));
  if (certificates.some((certificate) => certificate.length === 0)) {
    throw new Error('invalid root certificate');
  }
  return certificates;
}

function isServiceAccountJson(value: string): boolean {
  try {
    const raw: unknown = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
    if (typeof raw !== 'object' || raw === null) {
      return false;
    }
    const record = raw as Record<string, unknown>;
    return (
      typeof record.client_email === 'string' &&
      record.client_email.length > 0 &&
      typeof record.private_key === 'string' &&
      record.private_key.length > 0
    );
  } catch {
    return false;
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function findDuplicateConfiguredProducts(source: MobileStoreBillingEnvConfig): string[] {
  const stores: Array<{ store: 'apple' | 'google'; values: Array<string | undefined> }> = [
    {
      store: 'apple',
      values: [
        source.APPLE_STORE_PRODUCT_STANDARD_MONTHLY,
        source.APPLE_STORE_PRODUCT_PREMIUM_MONTHLY,
        source.APPLE_STORE_PRODUCT_CREDITS_200,
        source.APPLE_STORE_PRODUCT_CREDITS_1000,
        source.APPLE_STORE_PRODUCT_CREDITS_3000,
      ],
    },
    {
      store: 'google',
      values: [
        source.GOOGLE_PLAY_PRODUCT_STANDARD_MONTHLY,
        source.GOOGLE_PLAY_PRODUCT_PREMIUM_MONTHLY,
        source.GOOGLE_PLAY_PRODUCT_CREDITS_200,
        source.GOOGLE_PLAY_PRODUCT_CREDITS_1000,
        source.GOOGLE_PLAY_PRODUCT_CREDITS_3000,
      ],
    },
  ];

  return stores
    .filter(({ values }) => {
      const normalized = values
        .filter((value): value is string => value !== undefined && value.trim().length > 0)
        .map((value) => value.trim());
      return new Set(normalized).size !== normalized.length;
    })
    .map(({ store }) => store);
}
