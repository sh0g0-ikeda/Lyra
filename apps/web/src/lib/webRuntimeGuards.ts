export interface WebRuntimeEnv {
  MODE?: string;
  PROD?: boolean;
  LYRA_STRICT_WEB_PRODUCTION_CONFIG?: string;
  VITE_DEV_AUTH_BYPASS?: string;
  VITE_API_BASE_URL?: string;
  VITE_COGNITO_DOMAIN?: string;
  VITE_COGNITO_CLIENT_ID?: string;
  VITE_COGNITO_REDIRECT_URI?: string;
  VITE_COGNITO_LOGOUT_URI?: string;
  VITE_COGNITO_SCOPES?: string;
  VITE_COGNITO_API_TOKEN_USE?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

export interface WebRuntimeGuardOptions {
  requireProductionHostedAuth?: boolean;
}

export function shouldRequireStrictWebProductionConfig(env: WebRuntimeEnv): boolean {
  return env.LYRA_STRICT_WEB_PRODUCTION_CONFIG === 'true';
}

export function assertSafeWebRuntimeConfig(
  env: WebRuntimeEnv,
  options: WebRuntimeGuardOptions = {},
): void {
  const isProduction = env.PROD === true || env.MODE === 'production';
  if (!isProduction) {
    return;
  }

  const requireProductionHostedAuth = options.requireProductionHostedAuth ?? true;
  const violations: string[] = [];
  if (env.VITE_DEV_AUTH_BYPASS === 'true') {
    violations.push('VITE_DEV_AUTH_BYPASS must be disabled');
  }

  const hasCognito = hasValue(env.VITE_COGNITO_DOMAIN) && hasValue(env.VITE_COGNITO_CLIENT_ID);
  const hasSupabase = hasValue(env.VITE_SUPABASE_URL) && hasValue(env.VITE_SUPABASE_ANON_KEY);

  if (requireProductionHostedAuth) {
    if (!hasCognito) {
      violations.push('production web auth requires Cognito Hosted UI configuration');
    }
    if (hasSupabase) {
      violations.push('production web auth must not configure Supabase');
    }
  }

  if (
    hasValue(env.VITE_COGNITO_DOMAIN) &&
    hasValue(env.VITE_COGNITO_CLIENT_ID) &&
    !hasValue(env.VITE_COGNITO_SCOPES)
  ) {
    violations.push('VITE_COGNITO_SCOPES is required when Cognito Hosted UI is configured');
  }

  if (hasValue(env.VITE_COGNITO_API_TOKEN_USE) && !isValidCognitoApiTokenUse(env.VITE_COGNITO_API_TOKEN_USE)) {
    violations.push('VITE_COGNITO_API_TOKEN_USE must be access or id');
  }

  for (const key of [
    'VITE_COGNITO_DOMAIN',
    'VITE_COGNITO_REDIRECT_URI',
    'VITE_COGNITO_LOGOUT_URI',
    'VITE_API_BASE_URL',
  ] as const) {
    const value = env[key];
    if (hasValue(value) && !isSafeProductionHttpsUrl(value)) {
      violations.push(`${key} must use https and a non-local host in production`);
    }
  }

  if (violations.length > 0) {
    throw new Error(`Unsafe production web config: ${violations.join('; ')}`);
  }
}

function hasValue(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function isValidCognitoApiTokenUse(value: string | undefined): boolean {
  const normalized = value?.trim();
  return normalized === 'access' || normalized === 'id';
}

function isSafeProductionHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLocalHostname(hostname: string): boolean {
  const normalizedHostname = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  return normalizedHostname === 'localhost' || normalizedHostname === '127.0.0.1' || normalizedHostname === '::1';
}
