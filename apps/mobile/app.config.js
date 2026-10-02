const APP_LINK_PATHS = [
  '/auth/mobile/callback',
  '/auth/mobile/logout',
  '/invitations/',
];

const BUILD_ENVIRONMENTS = new Set(['development', 'preview', 'production']);
const APP_VARIANTS = new Set(['default', 'staging']);
const PRODUCTION_APP_LINK_HOST = 'app.lyra-editor.com';
const PRODUCTION_API_ORIGIN = 'https://app.lyra-editor.com';
const PRODUCTION_COGNITO_DOMAIN = 'https://ap-northeast-1wizlzlgmm.auth.ap-northeast-1.amazoncognito.com';
const PRODUCTION_COGNITO_CLIENT_ID = '6b2h941o888u2l7ejhv5jog94';
const PRODUCTION_COGNITO_REDIRECT_URI = 'lyra-mobile://auth/mobile/callback';
const PRODUCTION_COGNITO_LOGOUT_REDIRECT_URI = 'lyra-mobile://auth/mobile/logout';
const STAGING_APP_NAME = 'Lyra Mobile Staging';
const STAGING_ANDROID_PACKAGE = 'com.lyra.mobile.staging';
const STAGING_SCHEME = 'lyra-mobile-staging';
const STAGING_COGNITO_REDIRECT_URI = `${STAGING_SCHEME}://auth/mobile/callback`;
const STAGING_COGNITO_LOGOUT_REDIRECT_URI = `${STAGING_SCHEME}://auth/mobile/logout`;
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function getBuildEnvironment() {
  const environment = process.env.EXPO_PUBLIC_BUILD_ENVIRONMENT?.trim() || 'development';
  if (!BUILD_ENVIRONMENTS.has(environment)) {
    throw new Error('EXPO_PUBLIC_BUILD_ENVIRONMENT must be development, preview, or production');
  }

  return environment;
}

function getAppVariant() {
  const variant = process.env.EXPO_PUBLIC_APP_VARIANT?.trim() || 'default';
  if (!APP_VARIANTS.has(variant)) {
    throw new Error('EXPO_PUBLIC_APP_VARIANT must be default or staging');
  }
  return variant;
}

function getAppLinkHost(environment, variant) {
  if (environment === 'development') {
    return undefined;
  }

  const host = process.env.EXPO_PUBLIC_APP_LINK_HOST;
  if (!host || host.trim() !== host || !HOSTNAME_PATTERN.test(host)) {
    throw new Error(`EXPO_PUBLIC_APP_LINK_HOST must be a hostname for ${environment}`);
  }

  if (environment === 'production' && host !== PRODUCTION_APP_LINK_HOST) {
    throw new Error(`EXPO_PUBLIC_APP_LINK_HOST must be ${PRODUCTION_APP_LINK_HOST} for production`);
  }
  if (variant === 'staging' && host === PRODUCTION_APP_LINK_HOST) {
    throw new Error('EXPO_PUBLIC_APP_LINK_HOST must not use the production host for staging');
  }

  return host;
}

function getRequiredStagingEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be supplied by the staging environment`);
  }
  return value;
}

function getHttpsOrigin(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.pathname === '/' && !parsed.search && !parsed.hash
      ? parsed.origin
      : undefined;
  } catch {
    return undefined;
  }
}

function assertStagingEnvironment() {
  const apiBaseUrl = getRequiredStagingEnvironmentValue('EXPO_PUBLIC_API_BASE_URL');
  const cognitoDomain = getRequiredStagingEnvironmentValue('EXPO_PUBLIC_COGNITO_DOMAIN');
  const cognitoClientId = getRequiredStagingEnvironmentValue('EXPO_PUBLIC_COGNITO_CLIENT_ID');
  const cognitoRedirectUri = getRequiredStagingEnvironmentValue('EXPO_PUBLIC_COGNITO_REDIRECT_URI');
  const cognitoLogoutRedirectUri = getRequiredStagingEnvironmentValue('EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI');

  if (getHttpsOrigin(apiBaseUrl) !== apiBaseUrl || apiBaseUrl === PRODUCTION_API_ORIGIN) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must be a non-production HTTPS origin for staging');
  }
  if (getHttpsOrigin(cognitoDomain) !== cognitoDomain || cognitoDomain === PRODUCTION_COGNITO_DOMAIN) {
    throw new Error('EXPO_PUBLIC_COGNITO_DOMAIN must be a non-production HTTPS origin for staging');
  }
  if (cognitoClientId === PRODUCTION_COGNITO_CLIENT_ID) {
    throw new Error('EXPO_PUBLIC_COGNITO_CLIENT_ID must not use the production client for staging');
  }
  if (cognitoRedirectUri !== STAGING_COGNITO_REDIRECT_URI || cognitoRedirectUri === PRODUCTION_COGNITO_REDIRECT_URI) {
    throw new Error(`EXPO_PUBLIC_COGNITO_REDIRECT_URI must be ${STAGING_COGNITO_REDIRECT_URI} for staging`);
  }
  if (cognitoLogoutRedirectUri !== STAGING_COGNITO_LOGOUT_REDIRECT_URI || cognitoLogoutRedirectUri === PRODUCTION_COGNITO_LOGOUT_REDIRECT_URI) {
    throw new Error(`EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI must be ${STAGING_COGNITO_LOGOUT_REDIRECT_URI} for staging`);
  }
}

function createIntentFilters(host) {
  return APP_LINK_PATHS.map((pathPrefix) => ({
    action: 'VIEW',
    autoVerify: true,
    data: [{ scheme: 'https', host, pathPrefix }],
    category: ['BROWSABLE', 'DEFAULT'],
  }));
}

module.exports = ({ config }) => {
  const environment = getBuildEnvironment();
  const variant = getAppVariant();
  const appLinkHost = getAppLinkHost(environment, variant);
  if (variant === 'staging') {
    assertStagingEnvironment();
  }
  const googleServicesFile = variant === 'staging' ? undefined : process.env.GOOGLE_SERVICES_JSON?.trim();
  const iOSAssociatedDomainsEnabled = process.env.EXPO_PUBLIC_IOS_ASSOCIATED_DOMAINS_ENABLED === 'true';
  const { associatedDomains: _associatedDomains, ...ios } = config.ios ?? {};
  const { intentFilters: _intentFilters, ...android } = config.android ?? {};

  return {
    ...config,
    ...(variant === 'staging' ? { name: STAGING_APP_NAME, scheme: STAGING_SCHEME } : {}),
    ios: {
      ...ios,
      ...(appLinkHost && iOSAssociatedDomainsEnabled ? { associatedDomains: [`applinks:${appLinkHost}`] } : {}),
    },
    android: {
      ...android,
      ...(variant === 'staging' ? { package: STAGING_ANDROID_PACKAGE } : {}),
      ...(appLinkHost ? { intentFilters: createIntentFilters(appLinkHost) } : {}),
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
