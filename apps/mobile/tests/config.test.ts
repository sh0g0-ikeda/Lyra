import { afterEach, describe, expect, it, vi } from 'vitest';

import { validateMobileConfig } from '@/lib/config';

const productionConfig = {
  accountDeletionEnabled: false,
  apiBaseUrl: 'https://app.lyra-editor.com',
  cognitoDomain: 'https://ap-northeast-1example.auth.ap-northeast-1.amazoncognito.com',
  cognitoClientId: '6b2h941o888u2l7ejhv5jog94',
  cognitoRedirectUri: 'https://app.lyra-editor.com/auth/mobile/callback',
  cognitoLogoutRedirectUri: 'https://app.lyra-editor.com/auth/mobile/logout',
  cognitoScopes: ['openid', 'email'],
  apiTokenUse: 'id_token' as const,
  organizationFeaturesEnabled: true,
  mobileStoreBillingEnabled: false,
  sentryDsn: 'https://public@example.ingest.sentry.io/123456',
  buildEnvironment: 'production' as const
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('mobile configuration validation', () => {
  it('store billing flagは未設定ならfalseとして読み込む', async () => {
    vi.stubEnv('EXPO_PUBLIC_MOBILE_STORE_BILLING_ENABLED', '');
    vi.resetModules();

    const { config } = await import('@/lib/config');

    expect(config.mobileStoreBillingEnabled).toBe(false);
  });

  it('store billing flagはtrueだけを有効として読み込む', async () => {
    vi.stubEnv('EXPO_PUBLIC_MOBILE_STORE_BILLING_ENABLED', 'true');
    vi.resetModules();

    const { config } = await import('@/lib/config');

    expect(config.mobileStoreBillingEnabled).toBe(true);
  });

  it('account deletion flagは未設定ならfalseとして読み込む', async () => {
    vi.stubEnv('EXPO_PUBLIC_ACCOUNT_DELETION_ENABLED', '');
    vi.resetModules();

    const { config } = await import('@/lib/config');

    expect(config.accountDeletionEnabled).toBe(false);
  });

  it('固定された本番HTTPS設定を受け入れる', () => {
    expect(validateMobileConfig(productionConfig)).toMatchObject({ valid: true, issues: [] });
  });

  it('本番のHTTP、localhost、任意origin、開発callbackを拒否する', () => {
    const result = validateMobileConfig({
      ...productionConfig,
      apiBaseUrl: 'http://localhost:3000',
      cognitoRedirectUri: 'lyra-mobile://auth/callback'
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining(['PRODUCTION_API_ORIGIN', 'PRODUCTION_REDIRECT_URI'])
    );
    expect(result.supportCode).toMatch(/^MOB-CONFIG-/);
  });

  it('placeholderのCognito clientと不足値を拒否する', () => {
    const result = validateMobileConfig({
      ...productionConfig,
      apiBaseUrl: '',
      cognitoClientId: 'your_cognito_app_client_id'
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining(['API_BASE_URL', 'COGNITO_CLIENT_ID']));
  });

  it('開発環境だけはlocalhostとcustom schemeを許可する', () => {
    const result = validateMobileConfig({
      ...productionConfig,
      apiBaseUrl: 'http://localhost:3000',
      cognitoRedirectUri: 'lyra-mobile://auth/callback',
      cognitoLogoutRedirectUri: 'lyra-mobile://auth/logout',
      buildEnvironment: 'development'
    });

    expect(result.valid).toBe(true);
  });

  it('productionでは有効なHTTPS Sentry DSNを必須にする', () => {
    expect(
      validateMobileConfig({
        ...productionConfig,
        sentryDsn: ''
      })
    ).toMatchObject({
      valid: false,
      issues: expect.arrayContaining(['SENTRY_DSN'])
    });
    expect(
      validateMobileConfig({
        ...productionConfig,
        sentryDsn: 'http://public@example.ingest.sentry.io/123456'
      })
    ).toMatchObject({
      valid: false,
      issues: expect.arrayContaining(['SENTRY_DSN'])
    });
  });

  it('developmentとpreviewではSentry DSNを設定しなくても送信を無効化できる', () => {
    expect(
      validateMobileConfig({
        ...productionConfig,
        apiBaseUrl: 'http://localhost:3000',
        cognitoRedirectUri: 'lyra-mobile://auth/callback',
        cognitoLogoutRedirectUri: 'lyra-mobile://auth/logout',
        sentryDsn: '',
        buildEnvironment: 'development'
      })
    ).toMatchObject({ valid: true, issues: [] });
  });
});
