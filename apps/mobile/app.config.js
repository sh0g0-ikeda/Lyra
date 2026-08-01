const APP_LINK_PATHS = [
  '/auth/mobile/callback',
  '/auth/mobile/logout',
  '/invitations/',
];

const BUILD_ENVIRONMENTS = new Set(['development', 'preview', 'production']);
const PRODUCTION_APP_LINK_HOST = 'app.lyra-editor.com';
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function getBuildEnvironment() {
  const environment = process.env.EXPO_PUBLIC_BUILD_ENVIRONMENT?.trim() || 'development';
  if (!BUILD_ENVIRONMENTS.has(environment)) {
    throw new Error('EXPO_PUBLIC_BUILD_ENVIRONMENT must be development, preview, or production');
  }

  return environment;
}

function getAppLinkHost(environment) {
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

  return host;
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
  const appLinkHost = getAppLinkHost(environment);
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON?.trim();
  const { associatedDomains: _associatedDomains, ...ios } = config.ios ?? {};
  const { intentFilters: _intentFilters, ...android } = config.android ?? {};

  return {
    ...config,
    ios: {
      ...ios,
      ...(appLinkHost ? { associatedDomains: [`applinks:${appLinkHost}`] } : {}),
    },
    android: {
      ...android,
      ...(appLinkHost ? { intentFilters: createIntentFilters(appLinkHost) } : {}),
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
