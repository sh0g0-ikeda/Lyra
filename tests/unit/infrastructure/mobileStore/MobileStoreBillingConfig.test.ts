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
  APPLE_STORE_ROOT_CERTIFICATES_BASE64_JSON: Buffer.from(
    JSON.stringify([Buffer.from('root').toString('base64')]),
  ).toString('base64'),
  APPLE_STORE_ALLOW_SANDBOX: false,
  APPLE_STORE_PRODUCT_STANDARD_MONTHLY: 'jp.lyra.apple.standard.monthly',
  APPLE_STORE_PRODUCT_PREMIUM_MONTHLY: 'jp.lyra.apple.premium.monthly',
  APPLE_STORE_PRODUCT_CREDITS_200: 'jp.lyra.apple.credits.200',
  APPLE_STORE_PRODUCT_CREDITS_1000: 'jp.lyra.apple.credits.1000',
  APPLE_STORE_PRODUCT_CREDITS_3000: 'jp.lyra.apple.credits.3000',
  GOOGLE_PLAY_PACKAGE_NAME: 'jp.lyra.app',
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(
    JSON.stringify({
      client_email: 'play-api@lyra.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
    }),
  ).toString('base64'),
  GOOGLE_PLAY_PUBSUB_AUDIENCE: 'https://api.lyra.example/api/webhooks/mobile-purchases/google',
  GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL: 'pubsub@lyra.iam.gserviceaccount.com',
  GOOGLE_PLAY_ALLOW_TEST_PURCHASES: false,
  GOOGLE_PLAY_PRODUCT_STANDARD_MONTHLY: 'jp.lyra.google.standard.monthly',
  GOOGLE_PLAY_PRODUCT_PREMIUM_MONTHLY: 'jp.lyra.google.premium.monthly',
  GOOGLE_PLAY_PRODUCT_CREDITS_200: 'jp.lyra.google.credits.200',
  GOOGLE_PLAY_PRODUCT_CREDITS_1000: 'jp.lyra.google.credits.1000',
  GOOGLE_PLAY_PRODUCT_CREDITS_3000: 'jp.lyra.google.credits.3000',
} as const;

describe('mobile store billing configuration', () => {
  it('明示的に有効化した場合だけ10商品のserver catalogを構築する', () => {
    const config = createMobileStoreBillingConfig(completeConfig, true);

    expect(config?.productCatalog.entries()).toHaveLength(10);
    expect(config?.productCatalog.resolve('google', 'jp.lyra.google.credits.1000')).toMatchObject({
      kind: 'credit_pack',
      creditPackageCode: 'credits_1000',
    });
  });

  it('無効時はcredentialがなくてもnullを返し既存runtimeへ影響しない', () => {
    expect(createMobileStoreBillingConfig({ MOBILE_STORE_BILLING_ENABLED: false }, true)).toBeNull();
  });

  it('productionでsandboxまたはtest purchaseを許可すると起動を拒否する', () => {
    expect(() =>
      assertMobileStoreBillingRuntimeConfig(
        {
          ...completeConfig,
          APPLE_STORE_ALLOW_SANDBOX: true,
          GOOGLE_PLAY_ALLOW_TEST_PURCHASES: true,
        },
        true,
      ),
    ).toThrow(/sandbox and test purchases must be disabled/u);
  });

  it('secret不足と同一storeのproduct ID重複を拒否する', () => {
    expect(() =>
      assertMobileStoreBillingRuntimeConfig(
        {
          ...completeConfig,
          MOBILE_STORE_IDENTIFIER_HASH_SECRET: 'short',
          APPLE_STORE_PRODUCT_PREMIUM_MONTHLY: completeConfig.APPLE_STORE_PRODUCT_STANDARD_MONTHLY,
        },
        false,
      ),
    ).toThrow(/at least 32 characters.*duplicates/u);
  });
});
