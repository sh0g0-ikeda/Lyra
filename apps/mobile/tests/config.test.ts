import { describe, expect, it } from 'vitest';

import { validateMobileConfig } from '@/lib/config';

const productionConfig = {
  apiBaseUrl: 'https://app.lyra-editor.com',
  cognitoDomain: 'https://example.auth.ap-northeast-1.amazoncognito.com',
  cognitoClientId: 'abc123456789',
  cognitoRedirectUri: 'https://app.lyra-editor.com/auth/mobile/callback',
  cognitoLogoutRedirectUri: 'https://app.lyra-editor.com/auth/mobile/logout',
  cognitoScopes: ['openid', 'email'],
  buildEnvironment: 'production' as const
};

describe('mobile configuration validation', () => {
  it('native release linking未導入の本番設定をfail closedにする', () => {
    expect(validateMobileConfig(productionConfig)).toMatchObject({
      valid: false,
      issues: ['PRODUCTION_NATIVE_LINKING'],
    });
  });

  it('本番のHTTP、任意origin、開発callbackを拒否する', () => {
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

  it('開発環境だけはlocalhost HTTPとcustom schemeを許可する', () => {
    expect(
      validateMobileConfig({
        ...productionConfig,
        apiBaseUrl: 'http://localhost:3000',
        cognitoRedirectUri: 'lyra-mobile://auth/callback',
        cognitoLogoutRedirectUri: 'lyra-mobile://auth/logout',
        buildEnvironment: 'development'
      })
    ).toMatchObject({ valid: true, issues: [] });
  });
});
