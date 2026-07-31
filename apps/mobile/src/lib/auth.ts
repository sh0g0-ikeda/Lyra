import { z } from 'zod';
import {
  authTokensSchema,
  type AuthTokens,
} from '../domain/auth';

const MAX_TOKEN_LENGTH = 32_768;
const tokenResponseSchema = z.object({
  id_token: z.string().min(1).max(MAX_TOKEN_LENGTH),
  access_token: z.string().min(1).max(MAX_TOKEN_LENGTH).optional(),
  refresh_token: z.string().min(1).max(MAX_TOKEN_LENGTH).optional(),
  expires_in: z.number().int().positive().max(86_400),
  token_type: z.literal('Bearer').optional(),
});

export interface CognitoAuthConfig {
  cognitoDomain: string;
  cognitoClientId: string;
  cognitoRedirectUri: string;
  cognitoLogoutRedirectUri: string;
  cognitoScopes: string[];
}

interface AuthorizationResult {
  code: string;
  codeVerifier: string;
}

export interface CognitoAuthDependencies {
  authorize(input: { usePkce: boolean }): Promise<AuthorizationResult>;
  requestTokens(endpoint: string, body: URLSearchParams): Promise<unknown>;
  openLogout(url: string): Promise<void>;
  saveTokens(tokens: AuthTokens): Promise<void>;
  clearTokens(): Promise<void>;
}

export class AuthError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly fatal: boolean,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class CognitoAuthService {
  private refreshPromise: Promise<AuthTokens> | null = null;

  public constructor(
    private readonly config: CognitoAuthConfig,
    private readonly dependencies: CognitoAuthDependencies,
  ) {}

  public async signIn(): Promise<AuthTokens> {
    const authorization = await this.dependencies.authorize({ usePkce: true });
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.cognitoClientId,
      code: authorization.code,
      code_verifier: authorization.codeVerifier,
      redirect_uri: this.config.cognitoRedirectUri,
    });
    const payload = await this.dependencies.requestTokens(
      this.tokenEndpoint(),
      body,
    );
    const tokens = this.parseTokenResponse(payload, null);
    await this.dependencies.saveTokens(tokens);
    return tokens;
  }

  public refresh(tokens: AuthTokens): Promise<AuthTokens> {
    if (this.refreshPromise !== null) {
      return this.refreshPromise;
    }

    const started = this.performRefresh(tokens);
    const tracked = started.finally(() => {
      if (this.refreshPromise === tracked) {
        this.refreshPromise = null;
      }
    });
    this.refreshPromise = tracked;
    return tracked;
  }

  public async signOut(): Promise<void> {
    await this.dependencies.clearTokens();
    const logoutUrl = new URL('/logout', this.normalizedDomain());
    logoutUrl.searchParams.set('client_id', this.config.cognitoClientId);
    logoutUrl.searchParams.set(
      'logout_uri',
      this.config.cognitoLogoutRedirectUri,
    );
    try {
      await this.dependencies.openLogout(logoutUrl.toString());
    } catch {
      throw new AuthError(
        'REMOTE_LOGOUT_FAILED',
        'The remote sign-out page could not be completed.',
        false,
      );
    }
  }

  private async performRefresh(tokens: AuthTokens): Promise<AuthTokens> {
    if (tokens.refreshToken === null) {
      throw new AuthError(
        'REFRESH_UNAVAILABLE',
        'The session cannot be refreshed.',
        true,
      );
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config.cognitoClientId,
      refresh_token: tokens.refreshToken,
    });
    const payload = await this.dependencies.requestTokens(
      this.tokenEndpoint(),
      body,
    );
    return this.parseTokenResponse(payload, tokens.refreshToken);
  }

  private parseTokenResponse(
    payload: unknown,
    fallbackRefreshToken: string | null,
  ): AuthTokens {
    const parsed = tokenResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AuthError(
        'INVALID_TOKEN_RESPONSE',
        'The identity provider returned an invalid token response.',
        true,
      );
    }

    return authTokensSchema.parse({
      idToken: parsed.data.id_token,
      accessToken: parsed.data.access_token ?? null,
      refreshToken: parsed.data.refresh_token ?? fallbackRefreshToken,
      expiresAt: Date.now() + parsed.data.expires_in * 1_000,
      tokenType: 'Bearer',
    });
  }

  private tokenEndpoint(): string {
    return new URL('/oauth2/token', this.normalizedDomain()).toString();
  }

  private normalizedDomain(): string {
    return `${this.config.cognitoDomain.replace(/\/+$/, '')}/`;
  }
}
