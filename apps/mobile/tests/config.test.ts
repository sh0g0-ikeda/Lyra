import { afterEach, describe, expect, it, vi } from 'vitest';

import { validateMobileConfig } from '@/lib/config';

const productionConfig = {
  accountDeletionEnabled: false,
  apiBaseUrl: 'https://app.lyra-editor.com',
  webEditorUrl: 'https://app.lyra-editor.com/',
  cognitoDomain: 'https://ap-northeast-1example.auth.ap-northeast-1.amazoncognito.com',
  cognitoClientId: '6b2h941o888u2l7ejhv5jog94',
  cognitoRedirectUri: 'lyra-mobile://auth/mobile/callback',
  cognitoLogoutRedirectUri: 'lyra-mobile://auth/mobile/logout',
  cognitoScopes: ['openid', 'email'],
  apiTokenUse: 'id_token' as const,
  organizationFeaturesEnabled: true,
  mobileStoreBillingEnabled: false,
  episodeExportEnabled: false,
  sentryDsn: 'https://public@example.ingest.sentry.io/123456',
  buildEnvironment: 'production' as const
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('mobile configuration validation', () => {
  const stagingConfig = { ...productionConfig, buildEnvironment: 'preview' as const,
    apiBaseUrl: 'https://staging.example.test', webEditorUrl: 'https://staging.example.test/',
    cognitoRedirectUri: 'lyra-mobile-staging://auth/mobile/callback',
    cognitoLogoutRedirectUri: 'lyra-mobile-staging://auth/mobile/logout' };
  it('検証APKの場合に検証用callbackとlogoutの組を受け入れる', () => {
    expect(validateMobileConfig(stagingConfig)).toMatchObject({ valid: true, issues: [] });
  });
  it('検証callbackに公開アプリのlogoutを組み合わせた場合に拒否する', () => {
    expect(validateMobileConfig({ ...stagingConfig, cognitoLogoutRedirectUri: productionConfig.cognitoLogoutRedirectUri }).issues).toContain('COGNITO_LOGOUT_REDIRECT_URI');
  });
  it.each(['lyra-mobile-staging://evil/mobile/callback', 'lyra-mobile-staging://auth/mobile/callback?redirect=evil', 'lyra-mobile-staging://auth/mobile/callback#fragment'])('検証APKのcallbackが固定値と違う場合に拒否する %s', (cognitoRedirectUri) => {
    expect(validateMobileConfig({ ...stagingConfig, cognitoRedirectUri }).issues).toContain('COGNITO_REDIRECT_URI');
  });
  it('公開アプリの場合に検証schemeを受け入れない', () => {
    expect(validateMobileConfig({ ...productionConfig, cognitoRedirectUri: stagingConfig.cognitoRedirectUri, cognitoLogoutRedirectUri: stagingConfig.cognitoLogoutRedirectUri }).valid).toBe(false);
  });
  it('staging variantでは検証済みAPI originをWeb editor URLにする', async () => {
    vi.stubEnv('EXPO_PUBLIC_APP_VARIANT', 'staging');
    vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', 'https://staging.example.test');
    vi.resetModules();

    const { config } = await import('@/lib/config');

    expect(config.webEditorUrl).toBe('https://staging.example.test/');
  });

  it('staging以外では既存のproduction Web editor URLを保つ', async () => {
    vi.stubEnv('EXPO_PUBLIC_APP_VARIANT', 'preview');
    vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', 'https://preview.example.test');
    vi.resetModules();

    const { config } = await import('@/lib/config');

    expect(config.webEditorUrl).toBe('https://app.lyra-editor.com/');
  });

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

  it('episode export flagは未設定ならfalseとして読み込む', async () => {
    vi.stubEnv('EXPO_PUBLIC_EPISODE_EXPORT_ENABLED', '');
    vi.resetModules();

    const { config } = await import('@/lib/config');

    expect(config.episodeExportEnabled).toBe(false);
  });

  it('episode export flagはtrueだけを有効として読み込む', async () => {
    vi.stubEnv('EXPO_PUBLIC_EPISODE_EXPORT_ENABLED', 'true');
    vi.resetModules();

    const { config } = await import('@/lib/config');

    expect(config.episodeExportEnabled).toBe(true);
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

  it('productionではSentry DSNが空でもアプリ設定を有効に保つ', () => {
    expect(
      validateMobileConfig({
        ...productionConfig,
        sentryDsn: ''
      })
    ).toMatchObject({
      valid: true,
      issues: []
    });
  });

  it('nonemptyかつ不正なSentry DSNはproductionで拒否する', () => {
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
