import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const createExpoConfig = require('../app.config.js') as (input: {
  config: {
    name: string;
    ios?: Record<string, unknown>;
    android?: Record<string, unknown>;
  };
}) => {
  name: string;
  ios?: Record<string, unknown>;
  android?: Record<string, unknown>;
};
const originalEnvironment = {
  googleServicesJson: process.env.GOOGLE_SERVICES_JSON,
  buildEnvironment: process.env.EXPO_PUBLIC_BUILD_ENVIRONMENT,
  appLinkHost: process.env.EXPO_PUBLIC_APP_LINK_HOST,
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  cognitoDomain: process.env.EXPO_PUBLIC_COGNITO_DOMAIN,
  cognitoClientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID,
  cognitoRedirectUri: process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI,
  cognitoLogoutRedirectUri: process.env.EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI,
  cognitoScopes: process.env.EXPO_PUBLIC_COGNITO_SCOPES,
  organizationFeaturesEnabled: process.env.EXPO_PUBLIC_ORGANIZATION_FEATURES_ENABLED,
};

const productionPublicEnvironment = {
  EXPO_PUBLIC_BUILD_ENVIRONMENT: 'production',
  EXPO_PUBLIC_APP_LINK_HOST: 'app.lyra-editor.com',
  EXPO_PUBLIC_API_BASE_URL: 'https://app.lyra-editor.com',
  EXPO_PUBLIC_COGNITO_DOMAIN: 'https://ap-northeast-1wizlzlgmm.auth.ap-northeast-1.amazoncognito.com',
  EXPO_PUBLIC_COGNITO_CLIENT_ID: '6b2h941o888u2l7ejhv5jog94',
  EXPO_PUBLIC_COGNITO_REDIRECT_URI: 'lyra-mobile://auth/callback',
  EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI: 'lyra-mobile://auth/logout',
  EXPO_PUBLIC_COGNITO_SCOPES: 'openid,email',
  EXPO_PUBLIC_ORGANIZATION_FEATURES_ENABLED: 'true',
};

const baseConfig = {
  name: 'Lyra Mobile',
  ios: {
    bundleIdentifier: 'com.lyra.mobile',
    associatedDomains: ['applinks:app.lyra-editor.com'],
  },
  android: {
    package: 'com.lyra.mobile',
    intentFilters: [{ action: 'VIEW' }],
  },
};

describe('Expo app config', () => {
  afterEach(() => {
    for (const [key, value] of Object.entries({
      GOOGLE_SERVICES_JSON: originalEnvironment.googleServicesJson,
      EXPO_PUBLIC_BUILD_ENVIRONMENT: originalEnvironment.buildEnvironment,
      EXPO_PUBLIC_APP_LINK_HOST: originalEnvironment.appLinkHost,
      EXPO_PUBLIC_API_BASE_URL: originalEnvironment.apiBaseUrl,
      EXPO_PUBLIC_COGNITO_DOMAIN: originalEnvironment.cognitoDomain,
      EXPO_PUBLIC_COGNITO_CLIENT_ID: originalEnvironment.cognitoClientId,
      EXPO_PUBLIC_COGNITO_REDIRECT_URI: originalEnvironment.cognitoRedirectUri,
      EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI: originalEnvironment.cognitoLogoutRedirectUri,
      EXPO_PUBLIC_COGNITO_SCOPES: originalEnvironment.cognitoScopes,
      EXPO_PUBLIC_ORGANIZATION_FEATURES_ENABLED: originalEnvironment.organizationFeaturesEnabled,
    })) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('EAS file secretがあるbuildだけAndroid Firebase設定を追加する', () => {
    process.env.GOOGLE_SERVICES_JSON = '/eas/secrets/google-services.json';

    expect(createExpoConfig({
      config: baseConfig,
    })).toMatchObject({
      name: 'Lyra Mobile',
      android: {
        package: 'com.lyra.mobile',
        googleServicesFile: '/eas/secrets/google-services.json',
      },
    });
  });

  it('file secretがないlocal buildでは存在しないpathを設定しない', () => {
    delete process.env.GOOGLE_SERVICES_JSON;

    expect(createExpoConfig({
      config: baseConfig,
    }).android).not.toHaveProperty('googleServicesFile');
  });

  it('developmentではuniversal app linksを出力せずcustom schemeだけを使う', () => {
    process.env.EXPO_PUBLIC_BUILD_ENVIRONMENT = 'development';
    delete process.env.EXPO_PUBLIC_APP_LINK_HOST;

    const config = createExpoConfig({ config: baseConfig });

    expect(config.ios).not.toHaveProperty('associatedDomains');
    expect(config.android).not.toHaveProperty('intentFilters');
  });

  it('previewでは検証済みhostをiOSとAndroidの全app linkに一貫して設定する', () => {
    process.env.EXPO_PUBLIC_BUILD_ENVIRONMENT = 'preview';
    process.env.EXPO_PUBLIC_APP_LINK_HOST = 'preview.lyra-editor.com';

    const config = createExpoConfig({ config: baseConfig });

    expect(config.ios).toMatchObject({
      associatedDomains: ['applinks:preview.lyra-editor.com'],
    });
    expect(config.android).toMatchObject({
      intentFilters: [
        { data: [{ scheme: 'https', host: 'preview.lyra-editor.com', pathPrefix: '/auth/mobile/callback' }] },
        { data: [{ scheme: 'https', host: 'preview.lyra-editor.com', pathPrefix: '/auth/mobile/logout' }] },
        { data: [{ scheme: 'https', host: 'preview.lyra-editor.com', pathPrefix: '/invitations/' }] },
      ],
    });
  });

  it('productionは固定のapp link host以外をfail-fastで拒否する', () => {
    Object.assign(process.env, productionPublicEnvironment);
    process.env.EXPO_PUBLIC_APP_LINK_HOST = 'preview.lyra-editor.com';

    expect(() => createExpoConfig({ config: baseConfig })).toThrow(
      'EXPO_PUBLIC_APP_LINK_HOST',
    );
    expect(() => createExpoConfig({ config: baseConfig })).not.toThrow(
      'preview.lyra-editor.com',
    );
  });

  it('productionではcanonical native callback設定だけを受け入れる', () => {
    Object.assign(process.env, productionPublicEnvironment);

    expect(createExpoConfig({ config: baseConfig })).toMatchObject({
      name: 'Lyra Mobile',
    });
  });

  it('productionのredirect不一致は値を出さずに変数名だけでfail-fastにする', () => {
    Object.assign(process.env, productionPublicEnvironment);
    process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI = 'lyra-mobile://auth/mobile/callback';
    process.env.EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI = 'lyra-mobile://auth/mobile/logout';

    expect(() => createExpoConfig({ config: baseConfig })).toThrow(
      'EXPO_PUBLIC_COGNITO_REDIRECT_URI,EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI',
    );
    expect(() => createExpoConfig({ config: baseConfig })).not.toThrow(
      'lyra-mobile://auth/mobile/callback',
    );
  });

  it('productionのAPI origin不一致は値を出さずに変数名だけでfail-fastにする', () => {
    Object.assign(process.env, productionPublicEnvironment);
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://unexpected.example';

    expect(() => createExpoConfig({ config: baseConfig })).toThrow(
      'EXPO_PUBLIC_API_BASE_URL',
    );
    expect(() => createExpoConfig({ config: baseConfig })).not.toThrow(
      'https://unexpected.example',
    );
  });

  it.each([
    undefined,
    '',
    'https://app.lyra-editor.com',
    'app.lyra-editor.com/auth/mobile/callback',
    '*.lyra-editor.com',
  ])('previewで無効なapp link host %jをfail-fastで拒否する', (host) => {
    process.env.EXPO_PUBLIC_BUILD_ENVIRONMENT = 'preview';
    if (host === undefined) {
      delete process.env.EXPO_PUBLIC_APP_LINK_HOST;
    } else {
      process.env.EXPO_PUBLIC_APP_LINK_HOST = host;
    }

    expect(() => createExpoConfig({ config: baseConfig })).toThrow(
      'EXPO_PUBLIC_APP_LINK_HOST must be a hostname for preview',
    );
  });
});
