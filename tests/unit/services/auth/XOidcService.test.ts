import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { XOidcService } from '../../../../src/services/auth/XOidcService.js';
import type { XArtifact, XArtifactKind, XArtifactRepository, XOidcConfig } from '../../../../src/domain/auth/XOidcProtocol.js';

// Spec 3/4/5/8/10: bridge X code+S256 PKCE into Cognito's OIDC federation;
// leave Cognito API JWTs, subject provisioning, ownership and credits intact.
// Fail closed on browser/state/replay/email/redirect failures; no email linking.
// Parent owns integration; Terra maps/reviews auth. Test before implementation.
describe('X OIDC', () => {
  it('無効な場合に認証機能が公開されない', () => {
    expect(XOidcService.disabled().enabled).toBe(false);
  });
  it('未登録クライアントや外部への転送を受け付けない', async () => {
    const { service, repository } = fixture();
    await expect(service.start(params({ client_id: 'other' }))).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(service.start(params({ redirect_uri: 'https://evil.invalid/' }))).rejects.toMatchObject({ code: 'invalid_request' });
    const duplicate = params(); duplicate.append('state', 'other');
    await expect(service.start(duplicate)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(repository.rows.size).toBe(0);
  });
  it('ブラウザーが異なる場合にXトークン交換もメール送信もしない', async () => {
    const { service, exchange, sendCode } = fixture();
    const start = await service.start(params());
    await expect(service.callback({ state: new URL(start.url).searchParams.get('state')!, code: 'x-code' }, 'wrong-browser')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(exchange).not.toHaveBeenCalled(); expect(sendCode).not.toHaveBeenCalled();
  });
  it('Xと確認メールを検証した場合だけCognito用コードを発行し一回だけ交換できる', async () => {
    const f = fixture();
    const start = await f.service.start(params());
    const callback = { state: new URL(start.url).searchParams.get('state')!, code: 'x-code' };
    const challenge = await f.service.callback(callback, start.cookie.value);
    expect(f.sendCode).toHaveBeenCalledOnce();
    const emailCode = f.sendCode.mock.calls[0][1];
    await expect(f.service.callback(callback, start.cookie.value)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(f.service.verify(challenge.challenge, '0000000', challenge.cookie.value)).rejects.toMatchObject({ code: 'invalid_grant' });
    const result = await f.service.verify(challenge.challenge, emailCode, challenge.cookie.value);
    const redirect = new URL(result);
    expect(redirect.origin + redirect.pathname).toBe(config.cognitoRedirectUri);
    expect(redirect.searchParams.get('state')).toBe('cognito-state');
    const tokenRequest = new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.cognitoRedirectUri, code: redirect.searchParams.get('code')! });
    const results = await Promise.allSettled([f.service.token(tokenRequest), f.service.token(tokenRequest)]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    const success = results.find(x => x.status === 'fulfilled');
    if (success?.status !== 'fulfilled') throw new Error('Expected token');
    expect(f.signIdentity).toHaveBeenCalledWith(profile, 'cognito-nonce', expect.any(Number));
    expect(await f.service.userinfo(success.value.access_token)).toMatchObject({ sub: profile.subject, email: profile.email, email_verified: true });
    expect(success.value).not.toHaveProperty('refresh_token');
  });
  it('同じメールの既存アカウントがある場合にコードも確認メールも発行しない', async () => {
    const f = fixture(); f.assertProfileAllowed.mockRejectedValue(new Error('secret provider response'));
    const start = await f.service.start(params());
    await expect(f.service.callback({ state: new URL(start.url).searchParams.get('state')!, code: 'x-code' }, start.cookie.value)).rejects.toMatchObject({ code: 'access_denied', message: expect.not.stringContaining('secret') });
    expect(f.sendCode).not.toHaveBeenCalled();
  });
  it('メールコードが5回間違った場合に正しいコードでも拒否する', async () => {
    const f = fixture(), start = await f.service.start(params());
    const challenge = await f.service.callback({ state: new URL(start.url).searchParams.get('state')!, code: 'code' }, start.cookie.value);
    for (let i = 0; i < 5; i++) await expect(f.service.verify(challenge.challenge, '000000', challenge.cookie.value)).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(f.service.verify(challenge.challenge, f.sendCode.mock.calls[0][1], challenge.cookie.value)).rejects.toMatchObject({ code: 'invalid_grant' });
  });
  it('クライアント秘密鍵が違う場合に保存コードを消費しない', async () => {
    const f = fixture();
    await expect(f.service.token(new URLSearchParams({ client_id: config.clientId, client_secret: 'wrong', grant_type: 'authorization_code' }))).rejects.toMatchObject({ code: 'invalid_client' });
  });
  it('上流PKCEが指定された場合に同じverifierだけがコードを交換できる', async () => {
    const f = fixture(), verifier = 'a'.repeat(43);
    const start = await f.service.start(params({ code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }));
    const challenge = await f.service.callback({ state: new URL(start.url).searchParams.get('state')!, code: 'x-code' }, start.cookie.value);
    const redirect = new URL(await f.service.verify(challenge.challenge, '123456', challenge.cookie.value));
    const query = new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.cognitoRedirectUri, code: redirect.searchParams.get('code')! });
    await expect(f.service.token(query)).rejects.toMatchObject({ code: 'invalid_grant' });
    query.set('code_verifier', verifier);
    await expect(f.service.token(query)).resolves.toHaveProperty('id_token');
  });
  it('期限切れやX側キャンセルの場合にメール確認へ進まない', async () => {
    const f = fixture(), start = await f.service.start(params());
    for (const row of f.repository.rows.values()) row.expiresAt = new Date(Date.now() - 1);
    await expect(f.service.callback({ state: new URL(start.url).searchParams.get('state')!, code: 'x-code' }, start.cookie.value)).rejects.toMatchObject({ code: 'invalid_request' });
    const next = await f.service.start(params());
    await expect(f.service.callback({ state: new URL(next.url).searchParams.get('state')!, error: 'access_denied' }, next.cookie.value)).rejects.toMatchObject({ code: 'access_denied' });
    expect(f.exchange).not.toHaveBeenCalled(); expect(f.sendCode).not.toHaveBeenCalled();
  });
});

const config: XOidcConfig = { issuer: 'https://lyra.example/api/auth/x', clientId: 'cognito-bridge-client', clientSecret: 'bridge-client-secret'.repeat(3), cognitoRedirectUri: 'https://lyra.auth.ap-northeast-1.amazoncognito.com/oauth2/idpresponse', proofSecret: 'proof-secret'.repeat(4), androidEnabled: true };
const profile = { subject: '12345678', email: 'x-user@example.com', name: 'X user' };
function params(changes: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({ response_type: 'code', scope: 'openid email profile', client_id: config.clientId, redirect_uri: config.cognitoRedirectUri, state: 'cognito-state', nonce: 'cognito-nonce', ...changes });
}
class MemoryArtifacts implements XArtifactRepository {
  public rows = new Map<string, XArtifact & { attempts: number }>();
  public async save(row: XArtifact): Promise<void> { this.rows.set(row.hash, { ...row, attempts: 0 }); }
  public async find(kind: XArtifactKind, hash: string, binding: string): Promise<XArtifact | null> { const row = this.rows.get(hash); return row?.kind === kind && row.bindingHash === binding && row.expiresAt.getTime() > Date.now() ? row : null; }
  public async consume(kind: XArtifactKind, hash: string, binding: string, proof?: string): Promise<XArtifact | null> {
    const row = this.rows.get(hash);
    if (!row || row.kind !== kind || row.bindingHash !== binding || row.expiresAt.getTime() <= Date.now() || row.attempts >= 5) return null;
    if (row.proofHash && row.proofHash !== proof) { row.attempts++; return null; }
    this.rows.delete(hash); return row;
  }
  public async prune(): Promise<void> {}
  public async reserveEmailDelivery(): Promise<boolean> { return true; }
}
function fixture(): {
  service: XOidcService; repository: MemoryArtifacts;
  exchange: ReturnType<typeof vi.fn<(...args: string[]) => Promise<typeof profile>>>;
  sendCode: ReturnType<typeof vi.fn<(email: string, code: string) => Promise<void>>>;
  assertProfileAllowed: ReturnType<typeof vi.fn<() => Promise<void>>>;
  signIdentity: ReturnType<typeof vi.fn<() => Promise<string>>>;
} {
  const repository = new MemoryArtifacts(), exchange = vi.fn(async () => profile), sendCode = vi.fn(async (_email: string, _code: string) => {}), assertProfileAllowed = vi.fn(async () => {}), signIdentity = vi.fn(async () => 'signed-id');
  const sealed = new Map<string, unknown>();
  const service = new XOidcService(config, { repository, oauth: {
    exchange, buildAuthorizationUrl: (state, verifier) => `https://x.com/i/oauth2/authorize?state=${state}&code_challenge=${createHash('sha256').update(verifier).digest('base64url')}`,
  }, crypto: { seal: value => { const key = String(sealed.size); sealed.set(key, value); return key; }, open: key => sealed.get(key), signIdentity, jwks: async () => ({ keys: [] }) }, sendCode, assertProfileAllowed, createEmailCode: () => '123456' });
  return { service, repository, exchange, sendCode, assertProfileAllowed, signIdentity };
}
