import { describe, expect, it } from 'vitest';

import { validateMobileConfig } from '@/lib/config';

const productionConfig = {
  apiBaseUrl: 'https://app.lyra-editor.com',
  cognitoDomain: 'https://ap-northeast-1example.auth.ap-northeast-1.amazoncognito.com',
  cognitoClientId: '6b2h941o888u2l7ejhv5jog94',
  cognitoRedirectUri: 'lyra-mobile://auth/callback',
  cognitoLogoutRedirectUri: 'lyra-mobile://auth/logout',
  cognitoScopes: ['openid', 'email'],
  apiTokenUse: 'id_token' as const,
  organizationFeaturesEnabled: true,
  sentryDsn: 'https://public@example.ingest.sentry.io/123456',
  buildEnvironment: 'production' as const
};

describe('mobile configuration validation', () => {
  it('固定された本番アプリcallback設定を受け入れる', () => {
    expect(validateMobileConfig(productionConfig)).toMatchObject({ valid: true, issues: [] });
  });

  it('本番のHTTP、localhost、任意origin、旧HTTPS callbackを拒否する', () => {
    const result = validateMobileConfig({
      ...productionConfig,
      apiBaseUrl: 'http://localhost:3000',
      cognitoRedirectUri: 'https://app.lyra-editor.com/auth/mobile/callback'
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining(['PRODUCTION_API_ORIGIN', 'PRODUCTION_REDIRECT_URI'])
    );
    expect(result.supportCode).toMatch(/^MOB-CONFIG-/);
  });

  it('本番のhybrid custom scheme callbackとlogoutを拒否する', () => {
    const result = validateMobileConfig({
      ...productionConfig,
      cognitoRedirectUri: 'lyra-mobile://auth/mobile/callback',
      cognitoLogoutRedirectUri: 'lyra-mobile://auth/mobile/logout',
    });

    expect(result).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        'PRODUCTION_REDIRECT_URI',
        'PRODUCTION_LOGOUT_REDIRECT_URI',
      ]),
    });
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

  it('productionではSentry DSNが未設定でも接続設定を有効にする', () => {
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

  it('設定されているSentry DSNが不正ならproductionでも拒否する', () => {
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
