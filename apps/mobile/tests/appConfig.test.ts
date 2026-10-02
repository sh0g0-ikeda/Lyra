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
  appVariant: process.env.EXPO_PUBLIC_APP_VARIANT,
  appLinkHost: process.env.EXPO_PUBLIC_APP_LINK_HOST,
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  cognitoDomain: process.env.EXPO_PUBLIC_COGNITO_DOMAIN,
  cognitoClientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID,
  cognitoRedirectUri: process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI,
  cognitoLogoutRedirectUri: process.env.EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI,
  iosAssociatedDomainsEnabled: process.env.EXPO_PUBLIC_IOS_ASSOCIATED_DOMAINS_ENABLED,
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
      EXPO_PUBLIC_APP_VARIANT: originalEnvironment.appVariant,
      EXPO_PUBLIC_APP_LINK_HOST: originalEnvironment.appLinkHost,
      EXPO_PUBLIC_API_BASE_URL: originalEnvironment.apiBaseUrl,
      EXPO_PUBLIC_COGNITO_DOMAIN: originalEnvironment.cognitoDomain,
      EXPO_PUBLIC_COGNITO_CLIENT_ID: originalEnvironment.cognitoClientId,
      EXPO_PUBLIC_COGNITO_REDIRECT_URI: originalEnvironment.cognitoRedirectUri,
      EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI: originalEnvironment.cognitoLogoutRedirectUri,
      EXPO_PUBLIC_IOS_ASSOCIATED_DOMAINS_ENABLED: originalEnvironment.iosAssociatedDomainsEnabled,
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

  it('previewではiOS関連ドメインを明示的に有効化しない限り出力せず、Android App Linksを維持する', () => {
    process.env.EXPO_PUBLIC_BUILD_ENVIRONMENT = 'preview';
    process.env.EXPO_PUBLIC_APP_LINK_HOST = 'preview.lyra-editor.com';
    delete process.env.EXPO_PUBLIC_IOS_ASSOCIATED_DOMAINS_ENABLED;

    const config = createExpoConfig({ config: baseConfig });

    expect(config.ios).not.toHaveProperty('associatedDomains');
    expect(config.android).toMatchObject({
      intentFilters: [
        { data: [{ scheme: 'https', host: 'preview.lyra-editor.com', pathPrefix: '/auth/mobile/callback' }] },
        { data: [{ scheme: 'https', host: 'preview.lyra-editor.com', pathPrefix: '/auth/mobile/logout' }] },
        { data: [{ scheme: 'https', host: 'preview.lyra-editor.com', pathPrefix: '/invitations/' }] },
      ],
    });
  });

  it('明示的なiOS関連ドメイン有効化時だけ検証済みhostを出力する', () => {
    process.env.EXPO_PUBLIC_BUILD_ENVIRONMENT = 'preview';
    process.env.EXPO_PUBLIC_APP_LINK_HOST = 'preview.lyra-editor.com';
    process.env.EXPO_PUBLIC_IOS_ASSOCIATED_DOMAINS_ENABLED = 'true';

    expect(createExpoConfig({ config: baseConfig }).ios).toMatchObject({
      associatedDomains: ['applinks:preview.lyra-editor.com'],
    });
  });

  // Staging is an independently installable Android app. Its backend and OAuth
  // identifiers arrive only from explicitly supplied EAS environment values.
  it('stagingでは独立package・scheme・callbackとstaging App Linkを出力する', () => {
    process.env.EXPO_PUBLIC_BUILD_ENVIRONMENT = 'preview';
    process.env.EXPO_PUBLIC_APP_VARIANT = 'staging';
    process.env.EXPO_PUBLIC_APP_LINK_HOST = 'staging.lyra-editor.test';
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.staging.lyra-editor.test';
    process.env.EXPO_PUBLIC_COGNITO_DOMAIN = 'https://staging.auth.example.com';
    process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID = 'stagingclientid123';
    process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI = 'lyra-mobile-staging://auth/mobile/callback';
    process.env.EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI = 'lyra-mobile-staging://auth/mobile/logout';

    expect(createExpoConfig({ config: baseConfig })).toMatchObject({
      name: 'Lyra Mobile Staging',
      scheme: 'lyra-mobile-staging',
      android: {
        package: 'com.lyra.mobile.staging',
        intentFilters: [
          { data: [{ scheme: 'https', host: 'staging.lyra-editor.test', pathPrefix: '/auth/mobile/callback' }] },
          { data: [{ scheme: 'https', host: 'staging.lyra-editor.test', pathPrefix: '/auth/mobile/logout' }] },
          { data: [{ scheme: 'https', host: 'staging.lyra-editor.test', pathPrefix: '/invitations/' }] },
        ],
      },
    });
  });

  it.each([
    ['EXPO_PUBLIC_API_BASE_URL', 'https://app.lyra-editor.com'],
    ['EXPO_PUBLIC_COGNITO_CLIENT_ID', '6b2h941o888u2l7ejhv5jog94'],
    ['EXPO_PUBLIC_COGNITO_REDIRECT_URI', 'lyra-mobile://auth/mobile/callback'],
    ['EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI', 'lyra-mobile://auth/mobile/logout'],
  ])('stagingで本番の%sをfail-fastで拒否する', (key, value) => {
    process.env.EXPO_PUBLIC_BUILD_ENVIRONMENT = 'preview';
    process.env.EXPO_PUBLIC_APP_VARIANT = 'staging';
    process.env.EXPO_PUBLIC_APP_LINK_HOST = 'staging.lyra-editor.test';
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.staging.lyra-editor.test';
    process.env.EXPO_PUBLIC_COGNITO_DOMAIN = 'https://staging.auth.example.com';
    process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID = 'stagingclientid123';
    process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI = 'lyra-mobile-staging://auth/mobile/callback';
    process.env.EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI = 'lyra-mobile-staging://auth/mobile/logout';
    process.env[key] = value;

    expect(() => createExpoConfig({ config: baseConfig })).toThrow(/staging/);
  });

  it('stagingで必要な接続先が未供給ならfail-fastで拒否する', () => {
    process.env.EXPO_PUBLIC_BUILD_ENVIRONMENT = 'preview';
    process.env.EXPO_PUBLIC_APP_VARIANT = 'staging';
    process.env.EXPO_PUBLIC_APP_LINK_HOST = 'staging.lyra-editor.test';
    delete process.env.EXPO_PUBLIC_API_BASE_URL;

    expect(() => createExpoConfig({ config: baseConfig })).toThrow(
      'EXPO_PUBLIC_API_BASE_URL must be supplied by the staging environment',
    );
  });

  it('stagingはproduction Firebase設定を引き継がずpushを無効のままにする', () => {
    process.env.EXPO_PUBLIC_BUILD_ENVIRONMENT = 'preview';
    process.env.EXPO_PUBLIC_APP_VARIANT = 'staging';
    process.env.EXPO_PUBLIC_APP_LINK_HOST = 'staging.lyra-editor.test';
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.staging.lyra-editor.test';
    process.env.EXPO_PUBLIC_COGNITO_DOMAIN = 'https://staging.auth.example.com';
    process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID = 'stagingclientid123';
    process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI = 'lyra-mobile-staging://auth/mobile/callback';
    process.env.EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI = 'lyra-mobile-staging://auth/mobile/logout';
    process.env.GOOGLE_SERVICES_JSON = '/eas/secrets/production-google-services.json';

    expect(createExpoConfig({ config: baseConfig }).android).not.toHaveProperty('googleServicesFile');
  });

  it('productionは固定のapp link host以外をfail-fastで拒否する', () => {
    process.env.EXPO_PUBLIC_BUILD_ENVIRONMENT = 'production';
    process.env.EXPO_PUBLIC_APP_LINK_HOST = 'preview.lyra-editor.com';

    expect(() => createExpoConfig({ config: baseConfig })).toThrow(
      'EXPO_PUBLIC_APP_LINK_HOST must be app.lyra-editor.com for production',
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
