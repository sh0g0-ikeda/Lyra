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
      violations.push(`${key} must use https and a non-local, non-private host in production`);
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
    return url.protocol === 'https:' && !isUnsafeProductionHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLocalHostname(hostname: string): boolean {
  const normalizedHostname = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  const ipv4Address = parseIpv4Address(normalizedHostname);

  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname.endsWith('.localhost') ||
    normalizedHostname === '::1' ||
    normalizedHostname === '::' ||
    ipv4Address?.[0] === 127 ||
    normalizedHostname === '0.0.0.0'
  );
}

function isUnsafeProductionHostname(hostname: string): boolean {
  const normalizedHostname = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (
    isLocalHostname(normalizedHostname) ||
    normalizedHostname.endsWith('.local') ||
    normalizedHostname.endsWith('.internal')
  ) {
    return true;
  }

  const ipv4Address = parseIpv4Address(normalizedHostname);
  if (ipv4Address !== null) {
    return isPrivateOrReservedIpv4Address(ipv4Address);
  }

  return isPrivateOrLinkLocalIpv6Hostname(normalizedHostname);
}

function parseIpv4Address(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => {
    if (!/^[0-9]+$/u.test(part)) {
      return null;
    }

    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
  });

  if (octets.some((octet) => octet === null)) {
    return null;
  }

  return octets as [number, number, number, number];
}

function isPrivateOrReservedIpv4Address([first, second]: [number, number, number, number]): boolean {
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19))
  );
}

function isPrivateOrLinkLocalIpv6Hostname(hostname: string): boolean {
  if (!hostname.includes(':')) {
    return false;
  }

  return (
    hostname === '::' ||
    hostname === '::1' ||
    hostname.startsWith('fe80:') ||
    hostname.startsWith('fc') ||
    hostname.startsWith('fd')
  );
}
