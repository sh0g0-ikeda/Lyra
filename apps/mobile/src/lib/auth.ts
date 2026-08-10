import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

import type { AuthTokens, UiLanguage } from '@/domain/types';
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

  public constructor(message: string, fatal = false) {
    super(message);
    this.name = 'AuthError';
    this.fatal = fatal;
  }
}

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

export const signInWithCognito = async (language: UiLanguage): Promise<AuthTokens> => {
  const request = new AuthSession.AuthRequest({
    clientId: config.cognitoClientId,
    extraParams: {
      lang: language
    },
    redirectUri: config.cognitoRedirectUri,
    responseType: AuthSession.ResponseType.Code,
    scopes: config.cognitoScopes,
    usePKCE: true
  });

  const discovery: AuthSession.DiscoveryDocument = {
    authorizationEndpoint: `${normalizeDomain(config.cognitoDomain)}/oauth2/authorize`,
    tokenEndpoint: tokenEndpoint()
  };

  const result = await request.promptAsync(discovery);
  if (result.type !== 'success') {
    throw new AuthError('Cognito sign-in was cancelled or failed.');
  }

  const code = result.params.code;
  if (typeof code !== 'string' || code.length === 0 || request.codeVerifier === undefined) {
    throw new AuthError('Cognito authorization code is missing.');
  }

  const tokens = await exchangeCodeForTokens(code, request.codeVerifier);
  await saveAuthTokens(tokens);
  return tokens;
};

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
