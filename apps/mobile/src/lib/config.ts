import { z } from 'zod';

export type MobileBuildEnvironment = 'development' | 'preview' | 'production';

export interface MobileConfig {
  apiBaseUrl: string;
  cognitoDomain: string;
  cognitoClientId: string;
  cognitoRedirectUri: string;
  cognitoLogoutRedirectUri: string;
  cognitoScopes: string[];
  apiTokenUse: 'id_token';
  organizationFeaturesEnabled: boolean;
  sentryDsn: string;
  buildEnvironment: MobileBuildEnvironment;
}

export type MobileConfigIssue =
  | 'API_BASE_URL'
  | 'BUILD_ENVIRONMENT'
  | 'COGNITO_CLIENT_ID'
  | 'COGNITO_DOMAIN'
  | 'COGNITO_LOGOUT_REDIRECT_URI'
  | 'COGNITO_REDIRECT_URI'
  | 'COGNITO_SCOPES'
  | 'PRODUCTION_API_ORIGIN'
  | 'PRODUCTION_COGNITO_DOMAIN'
  | 'PRODUCTION_LOGOUT_REDIRECT_URI'
  | 'PRODUCTION_REDIRECT_URI'
  | 'SENTRY_DSN';

export interface MobileConfigValidation {
  valid: boolean;
  issues: MobileConfigIssue[];
  supportCode: string;
}

const PRODUCTION_API_ORIGIN = 'https://app.lyra-editor.com';
const PRODUCTION_REDIRECT_URI = 'https://app.lyra-editor.com/auth/mobile/callback';
const PRODUCTION_LOGOUT_REDIRECT_URI = 'https://app.lyra-editor.com/auth/mobile/logout';

const mobileConfigSchema = z.object({
  apiBaseUrl: z.string().min(1),
  cognitoDomain: z.string().url(),
  cognitoClientId: z.string().regex(/^[a-z0-9]{10,128}$/i),
  cognitoRedirectUri: z.string().min(1).max(500),
  cognitoLogoutRedirectUri: z.string().min(1).max(500),
  cognitoScopes: z.array(z.string().min(1).max(100)).min(1).max(20),
  apiTokenUse: z.literal('id_token'),
  organizationFeaturesEnabled: z.boolean(),
  sentryDsn: z.string().max(2_048),
  buildEnvironment: z.enum(['development', 'preview', 'production'])
}).strict();

const readPublicEnv = (value: string | undefined): string =>
  typeof value === 'string' ? value.trim() : '';

const readPublicBooleanEnv = (value: string | undefined): boolean => {
  const normalized = readPublicEnv(value).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const readBuildEnvironment = (value: string | undefined): MobileBuildEnvironment => {
  return readPublicEnv(value) as MobileBuildEnvironment;
};

const parseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const addIssue = (issues: MobileConfigIssue[], issue: MobileConfigIssue): void => {
  if (!issues.includes(issue)) {
    issues.push(issue);
  }
};

const isValidSentryDsn = (value: string): boolean => {
  const parsed = parseUrl(value);
  return (
    parsed !== null &&
    parsed.protocol === 'https:' &&
    parsed.username.length > 0 &&
    parsed.password.length === 0 &&
    parsed.pathname.length > 1
  );
};

const supportCodeFor = (issues: MobileConfigIssue[]): string => {
  const source = issues.length === 0 ? 'OK' : [...issues].sort().join('|');
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `MOB-CONFIG-${(hash >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
};

export const validateMobileConfig = (input: MobileConfig): MobileConfigValidation => {
  const issues: MobileConfigIssue[] = [];
  const parsed = mobileConfigSchema.safeParse(input);
  if (!parsed.success) {
    parsed.error.issues.forEach((issue) => {
      const field = issue.path[0];
      switch (field) {
        case 'apiBaseUrl':
          addIssue(issues, 'API_BASE_URL');
          break;
        case 'cognitoDomain':
          addIssue(issues, 'COGNITO_DOMAIN');
          break;
        case 'cognitoClientId':
          addIssue(issues, 'COGNITO_CLIENT_ID');
          break;
        case 'cognitoRedirectUri':
          addIssue(issues, 'COGNITO_REDIRECT_URI');
          break;
        case 'cognitoLogoutRedirectUri':
          addIssue(issues, 'COGNITO_LOGOUT_REDIRECT_URI');
          break;
        case 'cognitoScopes':
          addIssue(issues, 'COGNITO_SCOPES');
          break;
        case 'buildEnvironment':
          addIssue(issues, 'BUILD_ENVIRONMENT');
          break;
        case 'sentryDsn':
          addIssue(issues, 'SENTRY_DSN');
          break;
        default:
          break;
      }
    });
  }

  const apiUrl = parseUrl(input.apiBaseUrl);
  if (apiUrl === null) {
    addIssue(issues, 'API_BASE_URL');
  } else if (
    apiUrl.protocol !== 'https:' &&
    !(input.buildEnvironment === 'development' && apiUrl.protocol === 'http:' && apiUrl.hostname === 'localhost')
  ) {
    addIssue(issues, 'API_BASE_URL');
  }

  const cognitoUrl = parseUrl(input.cognitoDomain);
  if (cognitoUrl === null || cognitoUrl.protocol !== 'https:') {
    addIssue(issues, 'COGNITO_DOMAIN');
  }
  if (/placeholder|your_|test_client/i.test(input.cognitoClientId)) {
    addIssue(issues, 'COGNITO_CLIENT_ID');
  }
  if (input.sentryDsn.length > 0 && !isValidSentryDsn(input.sentryDsn)) {
    addIssue(issues, 'SENTRY_DSN');
  }

  if (input.buildEnvironment === 'production') {
    if (apiUrl?.origin !== PRODUCTION_API_ORIGIN || apiUrl.pathname !== '/') {
      addIssue(issues, 'PRODUCTION_API_ORIGIN');
    }
    if (cognitoUrl === null || !cognitoUrl.hostname.endsWith('.amazoncognito.com')) {
      addIssue(issues, 'PRODUCTION_COGNITO_DOMAIN');
    }
    if (input.cognitoRedirectUri !== PRODUCTION_REDIRECT_URI) {
      addIssue(issues, 'PRODUCTION_REDIRECT_URI');
    }
    if (input.cognitoLogoutRedirectUri !== PRODUCTION_LOGOUT_REDIRECT_URI) {
      addIssue(issues, 'PRODUCTION_LOGOUT_REDIRECT_URI');
    }
    if (!isValidSentryDsn(input.sentryDsn)) {
      addIssue(issues, 'SENTRY_DSN');
    }
  } else {
    if (
      !input.cognitoRedirectUri.startsWith('lyra-mobile://') &&
      parseUrl(input.cognitoRedirectUri)?.protocol !== 'https:'
    ) {
      addIssue(issues, 'COGNITO_REDIRECT_URI');
    }
    if (
      !input.cognitoLogoutRedirectUri.startsWith('lyra-mobile://') &&
      parseUrl(input.cognitoLogoutRedirectUri)?.protocol !== 'https:'
    ) {
      addIssue(issues, 'COGNITO_LOGOUT_REDIRECT_URI');
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    supportCode: supportCodeFor(issues)
  };
};

export const config: MobileConfig = {
  apiBaseUrl: readPublicEnv(process.env.EXPO_PUBLIC_API_BASE_URL),
  cognitoDomain: readPublicEnv(process.env.EXPO_PUBLIC_COGNITO_DOMAIN),
  cognitoClientId: readPublicEnv(process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID),
  cognitoRedirectUri: readPublicEnv(process.env.EXPO_PUBLIC_COGNITO_REDIRECT_URI),
  cognitoLogoutRedirectUri: readPublicEnv(process.env.EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI),
  cognitoScopes: (readPublicEnv(process.env.EXPO_PUBLIC_COGNITO_SCOPES) || 'openid,email,profile')
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0),
  apiTokenUse: 'id_token',
  organizationFeaturesEnabled: readPublicBooleanEnv(process.env.EXPO_PUBLIC_ORGANIZATION_FEATURES_ENABLED),
  sentryDsn: readPublicEnv(process.env.EXPO_PUBLIC_SENTRY_DSN),
  buildEnvironment: readBuildEnvironment(process.env.EXPO_PUBLIC_BUILD_ENVIRONMENT)
};

export const configValidation = validateMobileConfig(config);

export const isAuthConfigured = (): boolean => configValidation.valid;
