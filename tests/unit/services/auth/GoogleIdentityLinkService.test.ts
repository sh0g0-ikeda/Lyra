import { describe, expect, it, vi } from 'vitest';
import { GoogleIdentityLinkService } from '../../../../src/services/auth/GoogleIdentityLinkService.js';
import type { GoogleIdentityLinkRepository } from '../../../../src/repositories/GoogleIdentityLinkRepository.js';
import type { GoogleLinkChallenge, VerifiedCognitoIdentity } from '../../../../src/domain/types/googleIdentityLink.js';
const user = { id: '11111111-1111-4111-8111-111111111111', supabaseId: 'native-sub', email: 'owner@example.com', displayName: null, planCode: 'free' };
const now = new Date('2026-10-01T13:00:00Z');
const proof: VerifiedCognitoIdentity = { subject: user.supabaseId, username: 'native-user', email: user.email, authTime: now.getTime() / 1000, tokenFingerprint: 'token-hash' };
const key = '22222222-2222-4222-8222-222222222222';
function fixture(enabled = true, nativeReturnUri = 'lyra-mobile://auth/identity-link') {
    const rows = new Map<string, GoogleLinkChallenge>();
    const reserveIdentity = vi.fn<GoogleIdentityLinkRepository['reserveIdentity']>(async (id, hash) => { const row = rows.get(id)!; row.providerSubjectHash = hash; row.exchangeMaterial = null; });
    const repo: GoogleIdentityLinkRepository = {
        findRequest: vi.fn(async (uid, k) => [...rows.values()].find(x => x.userId === uid && x.requestKey === k) ?? null),
        create: vi.fn(async (row) => { rows.set(row.id, row); return row; }),
        findForUser: vi.fn(async (id, uid) => { const row = rows.get(id); return row?.userId === uid ? row ?? null : null; }),
        claimState: vi.fn(async (hash) => { const row = [...rows.values()].find(x => x.stateHash === hash && x.status === 'pending'); if (!row)
            return null; row.status = 'processing'; return row; }),
        reserveIdentity,
        performLink: vi.fn(async (id, _hash, op) => { await op(); rows.get(id)!.status = 'linked'; }),
        finish: vi.fn(async (id, status, message) => { const row = rows.get(id)!; row.status = status; row.messageCode = message ?? null; row.exchangeMaterial = null; }),
        completeReconciliation: vi.fn(async (id) => { rows.get(id)!.status = 'linked'; }), expirePending: vi.fn(async () => 0),
    };
    const native = { subject: proof.subject, email: user.email, enabled: true, status: 'CONFIRMED', googleSubjects: [] as string[] };
    const gateway = { getNativeIdentity: vi.fn(async () => native), linkGoogleIdentity: vi.fn(async () => { }), exchangeCode: vi.fn(async () => ({ subject: 'google-sub', email: user.email })) };
    let clock = now;
    const service = new GoogleIdentityLinkService({ repository: repo, gateway, config: enabled ? { clientId: 'dedicated-link-client', redirectUri: 'https://api.example.com/api/auth/identity-links/google/callback', webReturnUri: 'https://app.example.com/auth/identity-link', nativeReturnUri, encryptionSecret: 's'.repeat(40) } : null, now: () => clock });
    return { service, repo, reserveIdentity, gateway, native, rows, setClock: (d: Date) => { clock = d; } };
}
describe('GoogleIdentityLinkService', () => {
    it('検証APKで連携を取り消した場合に公開アプリではなく検証アプリへ戻る', async () => {
        const f = fixture(true, 'lyra-mobile-staging://auth/identity-link');
        const started = await f.service.start(user, proof, { platform: 'mobile', request_key: key });
        const state = new URL(started.authorization_url!).searchParams.get('state')!;
        expect(await f.service.callback({ state, error: 'access_denied' })).toBe('lyra-mobile-staging://auth/identity-link?challenge_id=' + started.challenge_id);
        expect(f.gateway.exchangeCode).not.toHaveBeenCalled();
        expect(f.gateway.linkGoogleIdentity).not.toHaveBeenCalled();
    });
    it('disabled mode never queries private data or providers', async () => { const f = fixture(false); await expect(f.service.start(user, proof, { platform: 'mobile', request_key: key })).rejects.toMatchObject({ code: 'GOOGLE_LINK_DISABLED' }); expect(f.repo.findRequest).not.toHaveBeenCalled(); expect(f.gateway.getNativeIdentity).not.toHaveBeenCalled(); });
    it('requires a recent verified native proof matching the current account', async () => { for (const p of [null, { ...proof, authTime: proof.authTime - 301 }, { ...proof, authTime: proof.authTime + 61 }, { ...proof, subject: 'another' }]) {
        const f = fixture();
        await expect(f.service.start(user, p, { platform: 'mobile', request_key: key })).rejects.toMatchObject({ code: 'RECENT_AUTH_REQUIRED' });
        expect(f.repo.create).not.toHaveBeenCalled();
    } });
    it('persists encrypted challenge and offers only dedicated Google PKCE authorization', async () => { const f = fixture(); const result = await f.service.start(user, proof, { platform: 'mobile', request_key: key }); const url = new URL(result.authorization_url!); expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth'); expect(url.searchParams.get('client_id')).toBe('dedicated-link-client'); expect(url.searchParams.get('code_challenge_method')).toBe('S256'); const row = f.rows.get(result.challenge_id)!; expect(row.exchangeMaterial).not.toContain(url.searchParams.get('state')); expect(JSON.stringify(result)).not.toContain('native-sub'); });
    it('same token and request key reconcile even after recent authentication ages, without extending expiry', async () => { const f = fixture(); const first = await f.service.start(user, proof, { platform: 'mobile', request_key: key }); f.setClock(new Date(now.getTime() + 301000)); const second = await f.service.start(user, proof, { platform: 'mobile', request_key: key }); expect(second).toEqual(first); expect(f.repo.create).toHaveBeenCalledTimes(1); expect(f.gateway.getNativeIdentity).toHaveBeenCalledTimes(1); });
    it('a different session cannot recover the authorization URL', async () => { const f = fixture(); await f.service.start(user, proof, { platform: 'mobile', request_key: key }); const result = await f.service.start(user, { ...proof, tokenFingerprint: 'other' }, { platform: 'mobile', request_key: key }); expect(result.authorization_url).toBeNull(); expect(result.requires_reauthentication).toBe(true); });
    it('rejects destination federated, disabled or mismatched profiles before creating a challenge', async () => { for (const patch of [{ status: 'EXTERNAL_PROVIDER' }, { enabled: false }, { subject: 'other' }, { email: 'other@example.com' }]) {
        const f = fixture();
        Object.assign(f.native, patch);
        await expect(f.service.start(user, proof, { platform: 'web', request_key: key })).rejects.toMatchObject({ code: 'IDENTITY_LINK_CONFLICT' });
        expect(f.repo.create).not.toHaveBeenCalled();
    } });
    it('callback is single-use, checks email, commits intent before provider mutation and returns no token', async () => { const f = fixture(); const started = await f.service.start(user, proof, { platform: 'mobile', request_key: key }); const state = new URL(started.authorization_url!).searchParams.get('state')!; const redirect = await f.service.callback({ state, code: 'one-time-code' }); expect(redirect).toBe(`lyra-mobile://auth/identity-link?challenge_id=${started.challenge_id}`); expect(f.reserveIdentity.mock.invocationCallOrder[0]).toBeLessThan(f.gateway.linkGoogleIdentity.mock.invocationCallOrder[0]!); expect(f.rows.get(started.challenge_id)!.status).toBe('linked'); expect(await f.service.callback({ state, code: 'same-code' })).toBeNull(); expect(f.gateway.linkGoogleIdentity).toHaveBeenCalledTimes(1); });
    it('rejects a different verified Google email without linking or persisting raw identity', async () => { const f = fixture(); f.gateway.exchangeCode.mockResolvedValue({ subject: 'google-sub', email: 'other@example.com' }); const started = await f.service.start(user, proof, { platform: 'mobile', request_key: key }); await f.service.callback({ state: new URL(started.authorization_url!).searchParams.get('state')!, code: 'code' }); expect(f.gateway.linkGoogleIdentity).not.toHaveBeenCalled(); expect(f.rows.get(started.challenge_id)?.messageCode).toBe('EMAIL_MISMATCH'); });
    it('unknown provider outcome is reconciled only by read, never retried as mutation', async () => { const f = fixture(); f.gateway.linkGoogleIdentity.mockRejectedValue(new Error('provider response secret')); const started = await f.service.start(user, proof, { platform: 'mobile', request_key: key }); await f.service.callback({ state: new URL(started.authorization_url!).searchParams.get('state')!, code: 'code' }); expect(f.rows.get(started.challenge_id)?.status).toBe('recovery_required'); f.native.googleSubjects = ['google-sub']; const status = await f.service.status(user, started.challenge_id); expect(status.status).toBe('linked'); expect(JSON.stringify(status)).not.toContain('secret'); expect(f.gateway.linkGoogleIdentity).toHaveBeenCalledTimes(1); });
    it('status is owner-scoped', async () => { const f = fixture(); const started = await f.service.start(user, proof, { platform: 'mobile', request_key: key }); await expect(f.service.status({ ...user, id: 'different' }, started.challenge_id)).rejects.toMatchObject({ statusCode: 404 }); });
});
