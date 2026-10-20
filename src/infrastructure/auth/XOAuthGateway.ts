import { createHash } from 'node:crypto';
import { UnauthorizedError, ConfigurationError } from '../../domain/errors/index.js';
import type { XOAuthPort, XProfile } from '../../domain/auth/XOidcProtocol.js';

const X_AUTHORIZE_ENDPOINT = 'https://x.com/i/oauth2/authorize';
const X_TOKEN_ENDPOINT = 'https://api.x.com/2/oauth2/token';
const X_PROFILE_ENDPOINT = 'https://api.x.com/2/users/me?user.fields=confirmed_email';
const X_SCOPES = ['users.read', 'users.email'] as const;
const X_SCOPE_VALUE = X_SCOPES.join(' ');
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 10_000;
const TOKEN_RESPONSE_MAX_BYTES = 16 * 1024;
const PROFILE_RESPONSE_MAX_BYTES = 32 * 1024;

export interface XOAuthGatewayConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface XOAuthGatewayDependencies {
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export class XOAuthGateway implements XOAuthPort {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(
    private readonly config: XOAuthGatewayConfig,
    dependencies: XOAuthGatewayDependencies = {},
  ) {
    validateConfig(config);
    this.fetcher = dependencies.fetcher ?? fetch;
    this.timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > MAX_TIMEOUT_MS) {
      throw new ConfigurationError('X OAuth timeout must be between 1 and 10000 milliseconds');
    }
  }

  public buildAuthorizationUrl(state: string, verifier: string): string {
    assertState(state);
    assertVerifier(verifier);
    const url = new URL(X_AUTHORIZE_ENDPOINT);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('scope', X_SCOPE_VALUE);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', createHash('sha256').update(verifier, 'utf8').digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  public async exchange(code: string, verifier: string): Promise<XProfile> {
    try {
      assertCode(code);
      assertVerifier(verifier);
      const abortSignal = AbortSignal.timeout(this.timeoutMs);
      const tokenResponse = await this.fetcher(X_TOKEN_ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        signal: abortSignal,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: createClientAuthorization(this.config.clientId, this.config.clientSecret),
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.config.redirectUri,
          code_verifier: verifier,
        }).toString(),
      });
      if (!tokenResponse.ok) throw new Error('token exchange rejected');
      const tokenPayload = await readBoundedJson(tokenResponse, TOKEN_RESPONSE_MAX_BYTES);
      const accessToken = parseTokenResponse(tokenPayload);

      const profileResponse = await this.fetcher(X_PROFILE_ENDPOINT, {
        method: 'GET',
        redirect: 'error',
        signal: abortSignal,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!profileResponse.ok) throw new Error('profile lookup rejected');
      return parseProfileResponse(await readBoundedJson(profileResponse, PROFILE_RESPONSE_MAX_BYTES));
    } catch {
      throw new UnauthorizedError('X identity proof could not be verified');
    }
  }
}

function validateConfig(config: XOAuthGatewayConfig): void {
  assertUnmodifiedBoundedValue(config.clientId, 1, 512, 'X OAuth client ID');
  assertUnmodifiedBoundedValue(config.clientSecret, 1, 2048, 'X OAuth client secret');
  assertUnmodifiedBoundedValue(config.redirectUri, 1, 2048, 'X OAuth redirect URI');
  let redirectUri: URL;
  try {
    redirectUri = new URL(config.redirectUri);
  } catch {
    throw new ConfigurationError('X OAuth redirect URI is invalid');
  }
  if (
    redirectUri.protocol !== 'https:'
    || redirectUri.username.length > 0
    || redirectUri.password.length > 0
    || redirectUri.hash.length > 0
  ) {
    throw new ConfigurationError('X OAuth redirect URI must be an HTTPS URL without credentials or a fragment');
  }
}

function assertState(state: string): void {
  if (state.length < 16 || state.length > 500 || !/^[A-Za-z0-9._~-]+$/u.test(state)) {
    throw new UnauthorizedError('X authorization state is invalid');
  }
}

function assertVerifier(verifier: string): void {
  if (verifier.length < 43 || verifier.length > 128 || !/^[A-Za-z0-9._~-]+$/u.test(verifier)) {
    throw new UnauthorizedError('X authorization proof is invalid');
  }
}

function assertCode(code: string): void {
  if (code.length < 1 || code.length > 2048 || /[\u0000-\u001F\u007F]/u.test(code)) {
    throw new UnauthorizedError('X authorization code is invalid');
  }
}

function assertUnmodifiedBoundedValue(value: string, minimum: number, maximum: number, label: string): void {
  if (value.trim() !== value || value.length < minimum || value.length > maximum) {
    throw new ConfigurationError(`${label} is invalid`);
  }
}

function createClientAuthorization(clientId: string, clientSecret: string): string {
  const username = encodeURIComponent(clientId);
  const password = encodeURIComponent(clientSecret);
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumBytes) {
      throw new Error('provider response is too large');
    }
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    throw new Error('provider response is invalid');
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

function parseTokenResponse(value: unknown): string {
  if (!isRecord(value)) throw new Error('token response is invalid');
  const accessToken = value.access_token;
  const tokenType = value.token_type;
  const expiresIn = value.expires_in;
  const scope = value.scope;
  if (
    typeof accessToken !== 'string'
    || accessToken.length < 16
    || accessToken.length > 4096
    || typeof tokenType !== 'string'
    || tokenType.toLowerCase() !== 'bearer'
    || !Number.isSafeInteger(expiresIn)
    || (expiresIn as number) < 1
    || (expiresIn as number) > 86_400
    || typeof scope !== 'string'
    || !hasExactScopes(scope)
  ) {
    throw new Error('token response is incomplete');
  }
  return accessToken;
}

function hasExactScopes(scope: string): boolean {
  const values = scope.split(/\s+/u).filter((value) => value.length > 0);
  const unique = new Set(values);
  return values.length === X_SCOPES.length
    && unique.size === X_SCOPES.length
    && X_SCOPES.every((required) => unique.has(required));
}

function parseProfileResponse(value: unknown): XProfile {
  if (!isRecord(value) || ('errors' in value && value.errors !== undefined)) {
    throw new Error('profile response is partial');
  }
  const data = value.data;
  if (!isRecord(data)) throw new Error('profile response is invalid');
  const subject = data.id;
  const email = data.confirmed_email;
  const name = data.name;
  if (
    typeof subject !== 'string'
    || !/^[1-9][0-9]{0,31}$/u.test(subject)
    || typeof email !== 'string'
    || email.length < 3
    || email.length > 320
    || email.trim() !== email
    || !isEmail(email)
    || typeof name !== 'string'
    || name.trim() !== name
    || name.length < 1
    || name.length > 100
  ) {
    throw new Error('profile response is incomplete');
  }
  return { subject, email: email.toLowerCase(), name };
}

function isEmail(value: string): boolean {
  const at = value.indexOf('@');
  return at > 0
    && at === value.lastIndexOf('@')
    && at < value.length - 3
    && value.slice(at + 1).includes('.')
    && !/\s/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
