import { z } from 'zod';

export type MobileBuildEnvironment = 'development' | 'preview' | 'production';

export interface MobileConfig {
  apiBaseUrl: string;
  cognitoDomain: string;
  cognitoClientId: string;
  cognitoRedirectUri: string;
  cognitoLogoutRedirectUri: string;
  cognitoScopes: string[];
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
  | 'PRODUCTION_NATIVE_LINKING'
  | 'PRODUCTION_REDIRECT_URI';

export interface MobileConfigValidation {
  valid: boolean;
  issues: MobileConfigIssue[];
  supportCode: string;
}

const PRODUCTION_API_ORIGIN = 'https://app.lyra-editor.com';
const PRODUCTION_REDIRECT_URI = 'https://app.lyra-editor.com/auth/mobile/callback';
const PRODUCTION_LOGOUT_REDIRECT_URI = 'https://app.lyra-editor.com/auth/mobile/logout';

const mobileConfigSchema = z
  .object({
    apiBaseUrl: z.string().min(1).max(2_048),
    cognitoDomain: z.string().min(1).max(2_048),
    cognitoClientId: z.string().regex(/^[a-z0-9]{10,128}$/iu),
    cognitoRedirectUri: z.string().min(1).max(500),
    cognitoLogoutRedirectUri: z.string().min(1).max(500),
    cognitoScopes: z.array(z.string().min(1).max(100)).min(1).max(20),
    buildEnvironment: z.enum(['development', 'preview', 'production'])
  })
  .strict();

const readPublicEnv = (value: string | undefined): string =>
  typeof value === 'string' ? value.trim() : '';

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

const isDevelopmentLocalhostUrl = (url: URL): boolean =>
  url.protocol === 'http:' && url.hostname === 'localhost';

const isCustomCallback = (value: string, expectedPath: string): boolean => {
  const url = parseUrl(value);
  return url?.protocol === 'lyra-mobile:' && url.hostname === 'auth' && url.pathname === expectedPath;
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
    for (const issue of parsed.error.issues) {
      switch (issue.path[0]) {
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
        default:
          break;
      }
    }
  }

  const apiUrl = parseUrl(input.apiBaseUrl);
  if (apiUrl === null) {
    addIssue(issues, 'API_BASE_URL');
  } else if (
    apiUrl.protocol !== 'https:' &&
    !(input.buildEnvironment === 'development' && isDevelopmentLocalhostUrl(apiUrl))
  ) {
    addIssue(issues, 'API_BASE_URL');
  }

  const cognitoUrl = parseUrl(input.cognitoDomain);
  if (cognitoUrl === null || cognitoUrl.protocol !== 'https:') {
    addIssue(issues, 'COGNITO_DOMAIN');
  }
  if (/placeholder|your_|test_client/iu.test(input.cognitoClientId)) {
    addIssue(issues, 'COGNITO_CLIENT_ID');
  }

  if (input.buildEnvironment === 'production') {
    // PR-E intentionally has no bundle/package identifiers or universal-link
    // association. Keep production sign-in closed until PR-H adds and verifies
    // both native release targets.
    addIssue(issues, 'PRODUCTION_NATIVE_LINKING');
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
  } else {
    const redirectUrl = parseUrl(input.cognitoRedirectUri);
    const logoutUrl = parseUrl(input.cognitoLogoutRedirectUri);
    if (
      !isCustomCallback(input.cognitoRedirectUri, '/callback') &&
      redirectUrl?.protocol !== 'https:'
    ) {
      addIssue(issues, 'COGNITO_REDIRECT_URI');
    }
    if (
      !isCustomCallback(input.cognitoLogoutRedirectUri, '/logout') &&
      logoutUrl?.protocol !== 'https:'
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
  buildEnvironment: readPublicEnv(
    process.env.EXPO_PUBLIC_BUILD_ENVIRONMENT
  ) as MobileBuildEnvironment
};

export const configValidation = validateMobileConfig(config);
