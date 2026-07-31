import { currentSessionSchema } from '../domain/apiSchemas';
import type { AuthTokens } from '../domain/auth';

export type CurrentSession = ReturnType<typeof currentSessionSchema.parse>;

export interface MobileAuthSessionPort {
  getTokens(): Promise<AuthTokens | null>;
  refreshTokens(): Promise<AuthTokens>;
}

export class ApiError extends Error {
  public constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface LyraMobileApiClientOptions {
  apiBaseUrl: string;
  auth: MobileAuthSessionPort;
  fetcher?: typeof fetch;
  requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;

export class LyraMobileApiClient {
  private readonly apiBaseUrl: string;
  private readonly auth: MobileAuthSessionPort;
  private readonly fetcher: typeof fetch;
  private readonly requestTimeoutMs: number;

  public constructor(options: LyraMobileApiClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, '');
    this.auth = options.auth;
    this.fetcher = options.fetcher ?? fetch;
    this.requestTimeoutMs = normalizeRequestTimeout(options.requestTimeoutMs);
  }

  public async getCurrentSession(): Promise<CurrentSession> {
    const tokens = await this.requireTokens();
    let response = await this.request('/api/me', tokens.idToken);

    if (response.status === 401) {
      const refreshed = await this.auth.refreshTokens();
      response = await this.request('/api/me', refreshed.idToken);
    }

    return await this.parseCurrentSession(response);
  }

  private async requireTokens(): Promise<AuthTokens> {
    const tokens = await this.auth.getTokens();
    if (tokens === null) {
      throw new ApiError('AUTH_REQUIRED', 401, 'Authentication is required.');
    }
    return tokens;
  }

  private async request(path: string, idToken: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs,
    );
    try {
      return await this.fetcher(`${this.apiBaseUrl}${path}`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(
        'NETWORK_ERROR',
        0,
        'The server could not be reached.',
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async parseCurrentSession(
    response: Response,
  ): Promise<CurrentSession> {
    if (!response.ok) {
      throw new ApiError(
        response.status >= 500 ? 'SERVER_ERROR' : 'REQUEST_FAILED',
        response.status,
        'The request could not be completed.',
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError(
        'INVALID_API_RESPONSE',
        502,
        'The server returned an invalid response.',
      );
    }

    const parsed = currentSessionSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError(
        'INVALID_API_RESPONSE',
        502,
        'The server returned an invalid response.',
      );
    }
    return parsed.data;
  }
}

function normalizeRequestTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  return Math.min(Math.max(Math.trunc(value), 1), MAX_REQUEST_TIMEOUT_MS);
}
