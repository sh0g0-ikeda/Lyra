import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import {
  AuthError,
  type CognitoAuthConfig,
  type CognitoAuthDependencies,
} from './auth';
import { clearAuthTokens, saveAuthTokens } from './storage';

const TOKEN_REQUEST_TIMEOUT_MS = 15_000;

WebBrowser.maybeCompleteAuthSession();

export function createExpoCognitoDependencies(
  config: CognitoAuthConfig,
): CognitoAuthDependencies {
  const domain = config.cognitoDomain.replace(/\/+$/, '');
  return {
    async authorize(input) {
      if (!input.usePkce) {
        throw new AuthError(
          'PKCE_REQUIRED',
          'PKCE is required for mobile authentication.',
          true,
        );
      }
      const request = new AuthSession.AuthRequest({
        clientId: config.cognitoClientId,
        redirectUri: config.cognitoRedirectUri,
        responseType: AuthSession.ResponseType.Code,
        scopes: config.cognitoScopes,
        usePKCE: true,
      });
      const discovery: AuthSession.DiscoveryDocument = {
        authorizationEndpoint: `${domain}/oauth2/authorize`,
        tokenEndpoint: `${domain}/oauth2/token`,
      };
      const result = await request.promptAsync(discovery);
      const code = result.type === 'success' ? result.params.code : undefined;
      if (
        typeof code !== 'string'
        || code.length === 0
        || request.codeVerifier === undefined
      ) {
        throw new AuthError(
          'AUTHORIZATION_CANCELLED',
          'Sign-in was cancelled or could not be completed.',
          false,
        );
      }
      return { code, codeVerifier: request.codeVerifier };
    },
    async requestTokens(endpoint, body) {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        TOKEN_REQUEST_TIMEOUT_MS,
      );
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new AuthError(
            'TOKEN_REQUEST_FAILED',
            'The identity provider rejected the token request.',
            response.status === 400
              || response.status === 401
              || response.status === 403,
          );
        }
        return await response.json();
      } catch (error: unknown) {
        if (error instanceof AuthError) {
          throw error;
        }
        throw new AuthError(
          'TOKEN_NETWORK_ERROR',
          'The identity provider could not be reached.',
          false,
        );
      } finally {
        clearTimeout(timeoutId);
      }
    },
    async openLogout(url) {
      await WebBrowser.openAuthSessionAsync(
        url,
        config.cognitoLogoutRedirectUri,
      );
    },
    saveTokens: saveAuthTokens,
    clearTokens: clearAuthTokens,
  };
}
