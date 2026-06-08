export interface CognitoAuthConfig {
  domain: string;
  clientId: string;
  redirectUri: string;
  logoutUri: string;
  scopes: string[];
}

export interface CognitoAuthEnv {
  VITE_COGNITO_DOMAIN?: string;
  VITE_COGNITO_CLIENT_ID?: string;
  VITE_COGNITO_REDIRECT_URI?: string;
  VITE_COGNITO_LOGOUT_URI?: string;
  VITE_COGNITO_SCOPES?: string;
}

export interface CognitoSession {
  accessToken: string;
  idToken: string | null;
  refreshToken: string | null;
  expiresAt: number;
}

export interface CognitoRedirectResult {
  handled: boolean;
  session: CognitoSession | null;
  error: string | null;
}

interface CognitoTokenPayload {
  access_token?: unknown;
  id_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
}

interface StoredPkceState {
  state: string;
  verifier: string;
  createdAt: number;
}

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface WebLocationLike {
  href: string;
  origin: string;
  pathname: string;
  search: string;
  hash: string;
  assign(url: string): void;
}

interface WebHistoryLike {
  replaceState(data: unknown, title: string, url?: string): void;
}

interface WebCryptoLike {
  getRandomValues<T extends Uint8Array<ArrayBuffer>>(array: T): T;
  subtle: {
    digest(algorithm: 'SHA-256', data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer>;
  };
}

interface TokenFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type TokenFetcher = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
  },
) => Promise<TokenFetchResponse>;

export const COGNITO_SESSION_STORAGE_KEY = 'lyra:web:cognito-session';
const COGNITO_PKCE_STORAGE_KEY = 'lyra:web:cognito-pkce';
const DEFAULT_COGNITO_SCOPES = ['openid', 'email', 'profile'];

export function getCognitoAuthConfig(
  env: CognitoAuthEnv,
  origin: string | undefined,
): CognitoAuthConfig | null {
  const domain = trimTrailingSlash(env.VITE_COGNITO_DOMAIN);
  const clientId = env.VITE_COGNITO_CLIENT_ID?.trim();
  if (domain === null || clientId === undefined || clientId.length === 0) {
    return null;
  }

  const redirectUri = env.VITE_COGNITO_REDIRECT_URI?.trim() || origin;
  if (redirectUri === undefined || redirectUri.length === 0) {
    return null;
  }

  return {
    domain,
    clientId,
    redirectUri,
    logoutUri: env.VITE_COGNITO_LOGOUT_URI?.trim() || redirectUri,
    scopes: parseScopes(env.VITE_COGNITO_SCOPES),
  };
}

export function readStoredCognitoSession(
  storage: WebStorageLike,
  now = Date.now(),
): CognitoSession | null {
  const rawValue = storage.getItem(COGNITO_SESSION_STORAGE_KEY);
  if (rawValue === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<CognitoSession>;
    if (
      typeof parsed.accessToken !== 'string' ||
      parsed.accessToken.length === 0 ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isFinite(parsed.expiresAt)
    ) {
      storage.removeItem(COGNITO_SESSION_STORAGE_KEY);
      return null;
    }

    if (parsed.expiresAt <= now + 30_000) {
      storage.removeItem(COGNITO_SESSION_STORAGE_KEY);
      return null;
    }

    return {
      accessToken: parsed.accessToken,
      idToken: typeof parsed.idToken === 'string' ? parsed.idToken : null,
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    storage.removeItem(COGNITO_SESSION_STORAGE_KEY);
    return null;
  }
}

export function storeCognitoSession(storage: WebStorageLike, session: CognitoSession): void {
  storage.setItem(COGNITO_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearCognitoSession(storage: WebStorageLike): void {
  storage.removeItem(COGNITO_SESSION_STORAGE_KEY);
  storage.removeItem(COGNITO_PKCE_STORAGE_KEY);
}

export async function beginCognitoLogin(
  config: CognitoAuthConfig,
  storage: WebStorageLike,
  location: WebLocationLike,
  cryptoProvider: WebCryptoLike,
): Promise<void> {
  const verifier = createPkceVerifier(cryptoProvider);
  const state = createPkceVerifier(cryptoProvider);
  const challenge = await createCodeChallenge(verifier, cryptoProvider);
  storage.setItem(COGNITO_PKCE_STORAGE_KEY, JSON.stringify({
    state,
    verifier,
    createdAt: Date.now(),
  } satisfies StoredPkceState));
  location.assign(buildCognitoAuthorizeUrl(config, state, challenge));
}

export async function completeCognitoRedirectIfPresent(
  config: CognitoAuthConfig,
  storage: WebStorageLike,
  location: WebLocationLike,
  history: WebHistoryLike,
  fetcher: TokenFetcher = getGlobalFetch(),
  now = Date.now(),
): Promise<CognitoRedirectResult> {
  const query = new URLSearchParams(location.search);
  const error = query.get('error');
  if (error !== null) {
    clearCognitoCallbackUrl(location, history);
    return {
      handled: true,
      session: null,
      error: query.get('error_description') ?? error,
    };
  }

  const code = query.get('code');
  const state = query.get('state');
  if (code === null && state === null) {
    return { handled: false, session: null, error: null };
  }

  if (code === null || state === null) {
    clearCognitoCallbackUrl(location, history);
    return { handled: true, session: null, error: 'Cognito callback is incomplete' };
  }

  const storedState = readStoredPkceState(storage);
  storage.removeItem(COGNITO_PKCE_STORAGE_KEY);
  if (storedState === null || storedState.state !== state) {
    clearCognitoCallbackUrl(location, history);
    return { handled: true, session: null, error: 'Cognito callback state did not match' };
  }

  try {
    const session = await exchangeCodeForTokens(config, code, storedState.verifier, fetcher, now);
    storeCognitoSession(storage, session);
    clearCognitoCallbackUrl(location, history);
    return { handled: true, session, error: null };
  } catch (exchangeError) {
    clearCognitoCallbackUrl(location, history);
    return { handled: true, session: null, error: toErrorMessage(exchangeError) };
  }
}

export async function refreshCognitoSession(
  config: CognitoAuthConfig,
  session: CognitoSession,
  fetcher: TokenFetcher = getGlobalFetch(),
  now = Date.now(),
): Promise<CognitoSession | null> {
  if (session.refreshToken === null || session.refreshToken.length === 0) {
    return null;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    refresh_token: session.refreshToken,
  });
  const response = await fetcher(`${config.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error(`Cognito token refresh failed (${response.status})`);
  }

  const payload = (await response.json()) as CognitoTokenPayload;
  return parseTokenPayload(payload, now, session.refreshToken);
}

export function buildCognitoAuthorizeUrl(
  config: CognitoAuthConfig,
  state: string,
  codeChallenge: string,
): string {
  const url = new URL(`${config.domain}/oauth2/authorize`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export function buildCognitoLogoutUrl(config: CognitoAuthConfig): string {
  const url = new URL(`${config.domain}/logout`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('logout_uri', config.logoutUri);
  return url.toString();
}

async function exchangeCodeForTokens(
  config: CognitoAuthConfig,
  code: string,
  verifier: string,
  fetcher: TokenFetcher,
  now: number,
): Promise<CognitoSession> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
  });
  const response = await fetcher(`${config.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error(`Cognito token exchange failed (${response.status})`);
  }

  const payload = (await response.json()) as CognitoTokenPayload;
  return parseTokenPayload(payload, now, null);
}

function parseTokenPayload(
  payload: CognitoTokenPayload,
  now: number,
  existingRefreshToken: string | null,
): CognitoSession {
  if (typeof payload.access_token !== 'string') {
    throw new Error('Cognito token response did not include an access token');
  }

  const expiresIn = typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)
    ? payload.expires_in
    : 3600;
  return {
    accessToken: payload.access_token,
    idToken: typeof payload.id_token === 'string' ? payload.id_token : null,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : existingRefreshToken,
    expiresAt: now + expiresIn * 1000,
  };
}

function clearCognitoCallbackUrl(location: WebLocationLike, history: WebHistoryLike): void {
  history.replaceState(null, '', `${location.pathname}${location.hash}`);
}

function readStoredPkceState(storage: WebStorageLike): StoredPkceState | null {
  const rawValue = storage.getItem(COGNITO_PKCE_STORAGE_KEY);
  if (rawValue === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<StoredPkceState>;
    if (
      typeof parsed.state !== 'string' ||
      typeof parsed.verifier !== 'string' ||
      typeof parsed.createdAt !== 'number'
    ) {
      return null;
    }

    return {
      state: parsed.state,
      verifier: parsed.verifier,
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

function createPkceVerifier(cryptoProvider: WebCryptoLike): string {
  const bytes = new Uint8Array(32) as Uint8Array<ArrayBuffer>;
  cryptoProvider.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function createCodeChallenge(verifier: string, cryptoProvider: WebCryptoLike): Promise<string> {
  const digest = await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const btoa = (globalThis as { btoa?: (value: string) => string }).btoa;
  if (btoa === undefined) {
    throw new Error('Base64 encoder is unavailable');
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
}

function parseScopes(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) {
    return DEFAULT_COGNITO_SCOPES;
  }

  const scopes = value
    .split(/[\s,]+/u)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);

  return scopes.length === 0 ? DEFAULT_COGNITO_SCOPES : Array.from(new Set(scopes));
}

function trimTrailingSlash(value: string | undefined): string | null {
  if (value === undefined || value.trim().length === 0) {
    return null;
  }

  return value.trim().replace(/\/+$/u, '');
}

function getGlobalFetch(): TokenFetcher {
  const fetcher = (globalThis as { fetch?: TokenFetcher }).fetch;
  if (fetcher === undefined) {
    throw new Error('Fetch API is unavailable');
  }

  return fetcher;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Cognito sign-in failed';
}
