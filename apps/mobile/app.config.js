const STAGING_VARIANT = 'staging';
const STAGING_NAME = 'Lyra Mobile Staging';
const STAGING_SCHEME = 'lyra-mobile-staging';
const STAGING_ANDROID_PACKAGE = 'com.lyra.mobile.staging';
const STAGING_IOS_BUNDLE_IDENTIFIER = 'com.lyra.mobile.staging';
const PRODUCTION_HOST = 'app.lyra-editor.com';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be supplied for a staging build`);
  return value;
}

function isNonProductionHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value && url.hostname !== PRODUCTION_HOST;
  } catch {
    return false;
  }
}

function stagingIntentFilters(host) {
  return ['/auth/mobile/callback', '/auth/mobile/logout', '/invitations/'].map((pathPrefix) => ({
    action: 'VIEW', autoVerify: true, data: [{ scheme: 'https', host, pathPrefix }], category: ['BROWSABLE', 'DEFAULT'],
  }));
}

// The release app configuration remains untouched. Staging is an isolated
// install identity and refuses a production host, API origin, or callback.
module.exports = ({ config }) => {
  if ((process.env.EXPO_PUBLIC_APP_VARIANT?.trim() || 'default') !== STAGING_VARIANT) return config;

  const host = required('EXPO_PUBLIC_APP_LINK_HOST');
  const apiBaseUrl = required('EXPO_PUBLIC_API_BASE_URL');
  const cognitoDomain = required('EXPO_PUBLIC_COGNITO_DOMAIN');
  if (host === PRODUCTION_HOST || !isNonProductionHttpsOrigin(apiBaseUrl) || !isNonProductionHttpsOrigin(cognitoDomain)) {
    throw new Error('Staging must use non-production app-link, API, and Cognito origins');
  }
  if (required('EXPO_PUBLIC_COGNITO_REDIRECT_URI') !== `${STAGING_SCHEME}://auth/mobile/callback` ||
      required('EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI') !== `${STAGING_SCHEME}://auth/mobile/logout`) {
    throw new Error('Staging must use the isolated mobile callback scheme');
  }

  return {
    ...config,
    name: STAGING_NAME,
    scheme: STAGING_SCHEME,
    ios: { ...config.ios, bundleIdentifier: STAGING_IOS_BUNDLE_IDENTIFIER },
    android: { ...config.android, package: STAGING_ANDROID_PACKAGE, intentFilters: stagingIntentFilters(host) },
  };
};
