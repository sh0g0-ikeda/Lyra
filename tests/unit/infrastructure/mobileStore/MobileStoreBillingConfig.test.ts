import { describe, expect, it } from 'vitest';
import {
  assertMobileStoreBillingRuntimeConfig,
  createMobileStoreBillingConfig,
} from '../../../../src/infrastructure/mobileStore/MobileStoreBillingConfig.js';

const completeConfig = {
  MOBILE_STORE_BILLING_ENABLED: true,
  MOBILE_STORE_IDENTIFIER_HASH_SECRET: '01234567890123456789012345678901',
  APPLE_STORE_BUNDLE_ID: 'jp.lyra.app',
  APPLE_STORE_APP_APPLE_ID: 123456789,
  APPLE_STORE_ROOT_CERTIFICATES_BASE64_JSON: Buffer.from(JSON.stringify([Buffer.from('root').toString('base64')])).toString('base64'),
  APPLE_STORE_ALLOW_SANDBOX: false,
  APPLE_STORE_PRODUCT_STANDARD_MONTHLY: 'jp.lyra.standard.monthly',
  APPLE_STORE_PRODUCT_PREMIUM_MONTHLY: 'jp.lyra.premium.monthly',
  APPLE_STORE_PRODUCT_CREDITS_200: 'jp.lyra.credits.200',
  APPLE_STORE_PRODUCT_CREDITS_1000: 'jp.lyra.credits.1000',
  APPLE_STORE_PRODUCT_CREDITS_3000: 'jp.lyra.credits.3000',
  GOOGLE_PLAY_PACKAGE_NAME: 'jp.lyra.app',
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(JSON.stringify({
    client_email: 'play-api@lyra.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----\\n',
  })).toString('base64'),
  GOOGLE_PLAY_PUBSUB_AUDIENCE: 'https://api.lyra.example/api/webhooks/mobile-purchases/google',
  GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL: 'pubsub@lyra.iam.gserviceaccount.com',
  GOOGLE_PLAY_ALLOW_TEST_PURCHASES: false,
  GOOGLE_PLAY_PRODUCT_STANDARD_MONTHLY: 'jp.lyra.standard.monthly',
  GOOGLE_PLAY_PRODUCT_PREMIUM_MONTHLY: 'jp.lyra.premium.monthly',
  GOOGLE_PLAY_PRODUCT_CREDITS_200: 'jp.lyra.credits.200',
  GOOGLE_PLAY_PRODUCT_CREDITS_1000: 'jp.lyra.credits.1000',
  GOOGLE_PLAY_PRODUCT_CREDITS_3000: 'jp.lyra.credits.3000',
};

describe('mobile store billing configuration', () => {
  it('builds the only server-authorized catalog for Apple and Google plans and credit packs', () => {
    const config = createMobileStoreBillingConfig(completeConfig, true);

    expect(config).not.toBeNull();
    expect(config?.productCatalog.resolve('apple', 'jp.lyra.standard.monthly')).toMatchObject({
      kind: 'subscription',
      planCode: 'standard',
    });
    expect(config?.productCatalog.resolve('google', 'jp.lyra.credits.1000')).toMatchObject({
      kind: 'credit_pack',
      creditPackageCode: 'credits_1000',
    });
  });

  it('fails closed in production when sandbox or tester purchases are enabled', () => {
    expect(() =>
      assertMobileStoreBillingRuntimeConfig(
        {
          ...completeConfig,
          APPLE_STORE_ALLOW_SANDBOX: true,
          GOOGLE_PLAY_ALLOW_TEST_PURCHASES: true,
        },
        true,
      ),
    ).toThrow(/sandbox and test purchases must be disabled/);
  });

  it('does not require provider credentials while mobile store billing is disabled', () => {
    expect(createMobileStoreBillingConfig({ MOBILE_STORE_BILLING_ENABLED: false }, true)).toBeNull();
  });
});
