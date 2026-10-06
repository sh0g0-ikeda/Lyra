import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

import type { AuthTokens } from '@/domain/types';
import { config } from '@/lib/config';
import { createSingleFlight } from '@/lib/singleFlight';
import { clearAuthTokens, saveAuthTokens } from '@/lib/storage';

WebBrowser.maybeCompleteAuthSession();

interface CognitoTokenResponse {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export class AuthError extends Error {
  public readonly fatal: boolean;
  public readonly code: 'ACCOUNT_LINK_REQUIRED' | null;

  public constructor(message: string, fatal = false, code: 'ACCOUNT_LINK_REQUIRED' | null = null) {
    super(message);
    this.name = 'AuthError';
    this.fatal = fatal;
    this.code = code;
  }
}

const ACCOUNT_LINK_REQUIRED_PROVIDER_MESSAGE =
  'Use the existing sign-in method and link this provider from your account.';

const isAccountLinkRequiredResult = (result: AuthSession.AuthSessionResult): boolean => {
  if (result.type !== 'error') {
    return false;
  }
  if (result.error?.code === 'state_mismatch') {
    return false;
  }
  return (
    result.params.error?.trim().toUpperCase() === 'ACCOUNT_LINK_REQUIRED' ||
    result.params.error_description?.includes(ACCOUNT_LINK_REQUIRED_PROVIDER_MESSAGE) === true
  );
};

const normalizeDomain = (domain: string): string => domain.replace(/\/+$/, '');

const tokenEndpoint = (): string => `${normalizeDomain(config.cognitoDomain)}/oauth2/token`;

const logoutEndpoint = (): string => `${normalizeDomain(config.cognitoDomain)}/logout`;

const toAuthTokens = (tokenResponse: CognitoTokenResponse, refreshToken: string | null): AuthTokens => {
  if (typeof tokenResponse.id_token !== 'string' || tokenResponse.id_token.length === 0) {
    throw new AuthError('Cognito did not return an id_token.', true);
  }
  return {
    idToken: tokenResponse.id_token,
    accessToken: tokenResponse.access_token ?? null,
    refreshToken: tokenResponse.refresh_token ?? refreshToken,
    expiresAt:
      typeof tokenResponse.expires_in === 'number'
        ? Date.now() + tokenResponse.expires_in * 1000
        : null,
    tokenType: tokenResponse.token_type ?? null
  };
};

const toTokenRequestBody = (code: string, codeVerifier: string): URLSearchParams => {
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', config.cognitoClientId);
  body.set('code', code);
  body.set('redirect_uri', config.cognitoRedirectUri);
  body.set('code_verifier', codeVerifier);
  return body;
};

const exchangeCodeForTokens = async (code: string, codeVerifier: string): Promise<AuthTokens> => {
  const response = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: toTokenRequestBody(code, codeVerifier).toString()
  });

  if (!response.ok) {
    throw new AuthError('Cognito token exchange failed.');
  }

  const tokenResponse = (await response.json()) as CognitoTokenResponse;
  return toAuthTokens(tokenResponse, null);
};

const refreshAuthTokensOnce = async (tokens: AuthTokens): Promise<AuthTokens> => {
  if (tokens.refreshToken === null || tokens.refreshToken.trim().length === 0) {
    throw new AuthError('Cognito refresh token is missing.', true);
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.cognitoClientId,
    refresh_token: tokens.refreshToken
  });
  const response = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });
  if (!response.ok) {
    throw new AuthError(
      'Cognito token refresh failed.',
      response.status === 400 || response.status === 401 || response.status === 403
    );
  }
  return toAuthTokens((await response.json()) as CognitoTokenResponse, tokens.refreshToken);
};

export const refreshAuthTokens = createSingleFlight(refreshAuthTokensOnce);

interface CognitoSignInOptions { identityProvider?: 'Google'; }

const authorizeWithCognito = async (options: CognitoSignInOptions & { reauthenticate?: boolean } = {}): Promise<AuthTokens> => {
  const request = new AuthSession.AuthRequest({
    clientId: config.cognitoClientId,
    redirectUri: config.cognitoRedirectUri,
    responseType: AuthSession.ResponseType.Code,
    scopes: config.cognitoScopes,
    usePKCE: true,
    ...(options.reauthenticate ? { prompt: AuthSession.Prompt.Login, extraParams: { max_age: '0' } }
      : options.identityProvider === 'Google' ? { extraParams: { identity_provider: 'Google' } } : {})
  });

  const discovery: AuthSession.DiscoveryDocument = {
    authorizationEndpoint: `${normalizeDomain(config.cognitoDomain)}/oauth2/authorize`,
    tokenEndpoint: tokenEndpoint()
  };

  const result = await request.promptAsync(discovery);
  if (result.type !== 'success') {
    if (isAccountLinkRequiredResult(result)) {
      throw new AuthError('ACCOUNT_LINK_REQUIRED', false, 'ACCOUNT_LINK_REQUIRED');
    }
    throw new AuthError('Cognito sign-in was cancelled or failed.');
  }

  const code = result.params.code;
  if (typeof code !== 'string' || code.length === 0 || request.codeVerifier === undefined) {
    throw new AuthError('Cognito authorization code is missing.');
  }

  return exchangeCodeForTokens(code, request.codeVerifier);
};

export const signInWithCognito = async (options: CognitoSignInOptions = {}): Promise<AuthTokens> => {
  const tokens = await authorizeWithCognito(options);
  await saveAuthTokens(tokens);
  return tokens;
};

// Linking proves recent native ownership without replacing the active session.
export const reauthenticateWithCognito = (): Promise<AuthTokens> => authorizeWithCognito({ reauthenticate: true });

export const signOutFromCognito = async (): Promise<void> => {
  await clearAuthTokens();

  if (config.cognitoDomain.length === 0 || config.cognitoClientId.length === 0) {
    return;
  }

  const params = new URLSearchParams({
    client_id: config.cognitoClientId,
    logout_uri: config.cognitoLogoutRedirectUri
  });
  await WebBrowser.openAuthSessionAsync(`${logoutEndpoint()}?${params.toString()}`, config.cognitoLogoutRedirectUri);
};
