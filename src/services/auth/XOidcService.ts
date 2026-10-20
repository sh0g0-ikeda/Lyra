import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { XOidcError, type XArtifactKind, type XArtifactRepository, type XOAuthPort, type XOidcConfig, type XOidcCryptoPort, type XProfile } from '../../domain/auth/XOidcProtocol.js';

const FLOW_TTL_SECONDS = 240;
const CODE_TTL_SECONDS = 60;
const ACCESS_TTL_SECONDS = 120;
const randomToken = (): string => randomBytes(32).toString('base64url');
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const profileSchema = z.object({ subject: z.string().regex(/^\d{1,30}$/u), email: z.string().email().max(320), name: z.string().min(1).max(200) });
const flowSchema = z.object({ state: z.string().min(1).max(500), nonce: z.string().min(1).max(500).optional(), verifier: z.string(), codeChallenge: z.string().optional() });
const emailChallengeSchema = flowSchema.omit({ verifier: true }).extend({ profile: profileSchema });
const grantSchema = emailChallengeSchema.extend({ authenticatedAt: z.number().int().positive() });
interface Cookie { name: string; value: string; maxAge: number }
interface XOidcPorts {
  repository: XArtifactRepository; oauth: XOAuthPort; crypto: XOidcCryptoPort;
  assertProfileAllowed(profile: XProfile): Promise<void>;
  sendCode(email: string, code: string): Promise<void>;
  createEmailCode?(): string;
}
export class XOidcService {
  public readonly enabled: boolean;
  public constructor(private readonly config: XOidcConfig | null, private readonly ports?: XOidcPorts) { this.enabled = config !== null && ports !== undefined; }
  public static disabled(): XOidcService { return new XOidcService(null); }
  public get androidEnabled(): boolean { return this.enabled && this.config?.androidEnabled === true; }
  public cookieName(value: string): string { return `__Host-lyra-x-${hash(value).slice(0, 24)}`; }
  public async jwks(): Promise<{ keys: import('jose').JWK[] }> { return this.requirePorts().crypto.jwks(); }
  public discovery(): Record<string, unknown> {
    const { issuer } = this.requireConfig();
    return { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, userinfo_endpoint: `${issuer}/userinfo`, jwks_uri: `${issuer}/jwks`, response_types_supported: ['code'], grant_types_supported: ['authorization_code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_post'], scopes_supported: ['openid', 'email', 'profile'], claims_supported: ['sub', 'email', 'email_verified', 'name', 'nonce'], code_challenge_methods_supported: ['S256'] };
  }
  public async start(query: URLSearchParams): Promise<{ url: string; cookie: Cookie }> {
    const config = this.requireConfig(), ports = this.requirePorts();
    const input = parseParams(query);
    if (input.client_id !== config.clientId || input.redirect_uri !== config.cognitoRedirectUri || input.response_type !== 'code'
      || !input.state || input.state.length > 500 || !input.scope || !input.scope.split(' ').includes('openid')
      || input.scope.split(' ').some(s => !['openid', 'email', 'profile'].includes(s))
      || (input.nonce !== undefined && (input.nonce.length === 0 || input.nonce.length > 500))
      || (input.code_challenge !== undefined && (input.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/u.test(input.code_challenge)))
      || (input.code_challenge_method !== undefined && input.code_challenge === undefined)
      || (input.prompt !== undefined && !['login', 'consent', 'select_account'].includes(input.prompt))) throw new XOidcError('invalid_request');
    const state = randomToken(), browser = randomToken(), verifier = randomToken();
    await ports.repository.prune();
    await this.save('state', state, browser, { state: input.state, nonce: input.nonce, verifier, codeChallenge: input.code_challenge }, FLOW_TTL_SECONDS);
    return { url: ports.oauth.buildAuthorizationUrl(state, verifier), cookie: this.cookie(state, browser) };
  }
  public async callback(input: { state: string; code?: string; error?: string }, cookie: string | undefined): Promise<{ challenge: string; cookie: Cookie }> {
    const ports = this.requirePorts();
    if (!validToken(input.state) || !validToken(cookie)) throw new XOidcError('invalid_request');
    const saved = await ports.repository.consume('state', hash(input.state), hash(cookie));
    if (!saved) throw new XOidcError('invalid_request');
    if (input.error || !input.code || input.code.length > 2048) throw new XOidcError('access_denied');
    try {
      const flow = flowSchema.parse(ports.crypto.open(saved.ciphertext));
      const profile = profileSchema.parse(await ports.oauth.exchange(input.code, flow.verifier));
      await ports.assertProfileAllowed(profile);
      const challenge = randomToken(), browser = randomToken();
      const code = ports.createEmailCode?.() ?? randomInt(100000, 1000000).toString();
      if (!/^\d{6}$/u.test(code)) throw new XOidcError('access_denied');
      const deliveryHash = createHmac('sha256', this.requireConfig().proofSecret).update(`x-delivery:${profile.email.toLowerCase()}`).digest('hex');
      if (!(await ports.repository.reserveEmailDelivery(deliveryHash))) throw new XOidcError('access_denied');
      await this.save('email', challenge, browser, { state: flow.state, nonce: flow.nonce, codeChallenge: flow.codeChallenge, profile }, Math.min(FLOW_TTL_SECONDS, Math.floor((saved.expiresAt.getTime() - Date.now()) / 1000)), this.proof(challenge, code));
      // Every new Cognito session requires user presence beyond ambient X SSO.
      // Never persist/return/log this code or the upstream X access token.
      await ports.sendCode(profile.email, code);
      return { challenge, cookie: this.cookie(challenge, browser) };
    } catch { throw new XOidcError('access_denied'); }
  }
  public async verify(challenge: string, code: string, cookie: string | undefined): Promise<string> {
    const config = this.requireConfig(), ports = this.requirePorts();
    if (!validToken(challenge) || !validToken(cookie) || !/^\d{6}$/u.test(code)) throw new XOidcError('invalid_grant');
    const saved = await ports.repository.consume('email', hash(challenge), hash(cookie), this.proof(challenge, code));
    if (!saved) throw new XOidcError('invalid_grant');
    const authenticatedAt = Math.floor(Date.now() / 1000);
    const grant = emailChallengeSchema.parse(ports.crypto.open(saved.ciphertext));
    // Recheck after the email challenge: another signup can occur meanwhile.
    try { await ports.assertProfileAllowed(grant.profile); } catch { throw new XOidcError('access_denied'); }
    const authorizationCode = randomToken();
    await this.save('code', authorizationCode, config.clientId, { ...grant, authenticatedAt }, CODE_TTL_SECONDS);
    const redirect = new URL(config.cognitoRedirectUri);
    redirect.searchParams.set('code', authorizationCode); redirect.searchParams.set('state', grant.state);
    return redirect.toString();
  }
  public async token(query: URLSearchParams): Promise<{ access_token: string; id_token: string; token_type: 'Bearer'; expires_in: number }> {
    const config = this.requireConfig(), ports = this.requirePorts(), input = parseParams(query);
    if (input.client_id !== config.clientId || !equalSecret(input.client_secret ?? '', config.clientSecret)) throw new XOidcError('invalid_client', 401);
    if (input.grant_type !== 'authorization_code' || input.redirect_uri !== config.cognitoRedirectUri || !validToken(input.code)) throw new XOidcError('invalid_grant');
    const saved = await ports.repository.find('code', hash(input.code), hash(config.clientId));
    if (!saved) throw new XOidcError('invalid_grant');
    const grant = grantSchema.parse(ports.crypto.open(saved.ciphertext));
    if (grant.codeChallenge && (!input.code_verifier || !/^[A-Za-z0-9._~-]{43,128}$/u.test(input.code_verifier) || createHash('sha256').update(input.code_verifier).digest('base64url') !== grant.codeChallenge)) throw new XOidcError('invalid_grant');
    if (!(await ports.repository.consume('code', hash(input.code), hash(config.clientId)))) throw new XOidcError('invalid_grant');
    const accessToken = randomToken();
    const idToken = await ports.crypto.signIdentity(grant.profile, grant.nonce, grant.authenticatedAt);
    await this.save('access', accessToken, config.clientId, grant.profile, ACCESS_TTL_SECONDS);
    return { access_token: accessToken, id_token: idToken, token_type: 'Bearer', expires_in: ACCESS_TTL_SECONDS };
  }
  public async userinfo(token: string): Promise<{ sub: string; email: string; email_verified: true; name: string }> {
    const config = this.requireConfig(), ports = this.requirePorts();
    if (!validToken(token)) throw new XOidcError('invalid_token', 401);
    const saved = await ports.repository.find('access', hash(token), hash(config.clientId));
    if (!saved) throw new XOidcError('invalid_token', 401);
    const profile = profileSchema.parse(ports.crypto.open(saved.ciphertext));
    return { sub: profile.subject, email: profile.email, email_verified: true, name: profile.name };
  }
  private cookie(value: string, browser: string): Cookie { return { name: this.cookieName(value), value: browser, maxAge: FLOW_TTL_SECONDS }; }
  private async save(kind: XArtifactKind, token: string, binding: string, value: unknown, ttl: number, proofHash?: string): Promise<void> {
    if (ttl <= 0) throw new XOidcError('invalid_grant');
    await this.requirePorts().repository.save({ kind, hash: hash(token), bindingHash: hash(binding), ciphertext: this.requirePorts().crypto.seal(value), expiresAt: new Date(Date.now() + ttl * 1000), proofHash });
  }
  private proof(challenge: string, code: string): string { return createHmac('sha256', this.requireConfig().proofSecret).update(`x-email:${challenge}:${code}`).digest('hex'); }
  private requireConfig(): XOidcConfig { if (!this.enabled || !this.config) throw new XOidcError('temporarily_unavailable', 503); return this.config; }
  private requirePorts(): XOidcPorts { if (!this.enabled || !this.ports) throw new XOidcError('temporarily_unavailable', 503); return this.ports; }
}
function validToken(value: string | undefined): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value); }
function equalSecret(a: string, b: string): boolean { return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest()); }
function parseParams(query: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of query) { if (key in result || key.length > 64 || value.length > 4096) throw new XOidcError('invalid_request'); result[key] = value; }
  return result;
}
