export interface WebRuntimeEnv {
  MODE?: string;
  PROD?: boolean;
  VITE_DEV_AUTH_BYPASS?: string;
  VITE_COGNITO_DOMAIN?: string;
  VITE_COGNITO_CLIENT_ID?: string;
  VITE_COGNITO_SCOPES?: string;
  VITE_COGNITO_API_TOKEN_USE?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

export function assertSafeWebRuntimeConfig(env: WebRuntimeEnv): void {
  const isProduction = env.PROD === true || env.MODE === 'production';
  if (!isProduction) {
    return;
  }

  const violations: string[] = [];
  if (env.VITE_DEV_AUTH_BYPASS === 'true') {
    violations.push('VITE_DEV_AUTH_BYPASS must be disabled');
  }

  const hasCognito = hasValue(env.VITE_COGNITO_DOMAIN) && hasValue(env.VITE_COGNITO_CLIENT_ID);
  const hasSupabase = hasValue(env.VITE_SUPABASE_URL) && hasValue(env.VITE_SUPABASE_ANON_KEY);

  if (!hasCognito) {
    violations.push('production web auth requires Cognito Hosted UI configuration');
  }
  if (hasSupabase) {
    violations.push('production web auth must not configure Supabase');
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

  if (violations.length > 0) {
    throw new Error(`Unsafe production web config: ${violations.join('; ')}`);
  }
}

function hasValue(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function isValidCognitoApiTokenUse(value: string | undefined): boolean {
  const normalized = value?.trim();
  return normalized === 'access' || normalized === 'id';
}
