import type { MiddlewareHandler } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccountDeletionRoutes } from '../../../src/routes/accountDeletion.js';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import type { AppEnv } from '../../../src/types/app.js';
import type { VerifiedCognitoIdentity } from '../../../src/domain/types/googleIdentityLink.js';

const now = Math.floor(Date.now() / 1000);
const identity: VerifiedCognitoIdentity = { subject: 'same-sub', username: 'user', email: 'user@example.com', authTime: now, tokenFingerprint: 'verified-token' };

function setup(proof: VerifiedCognitoIdentity | undefined) {
  const requestDeletion = vi.fn(async () => ({ status: 'completed' as const, blockers: [] as [] }));
  const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id: '11111111-1111-4111-8111-111111111111', supabaseId: 'same-sub', email: 'user@example.com', displayName: null, planCode: 'free' });
    if (proof) c.set('cognitoIdentity', proof);
    await next();
  };
  const app = createAccountDeletionRoutes({ authMiddleware: auth, rateLimitMiddleware: async (_c, next) => next(), accountDeletionService: { requestDeletion, getDeletionPreview: vi.fn() } });
  app.onError(errorHandler);
  return { app, requestDeletion };
}

const body = { confirmation: 'DELETE', acknowledge_personal_subscriptions: true, acknowledge_store_billing: true, acknowledge_personal_assets: true };
describe('退会時の直近の本人認証', () => {
  beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now * 1000); });
  afterEach(() => { vi.restoreAllMocks(); });
  it.each([
    ['欠落', undefined],
    ['5分以上前', { ...identity, authTime: now - 301 }],
    ['別本人', { ...identity, subject: 'different-sub' }],
    ['未来の認証', { ...identity, authTime: now + 61 }],
    ['不正な時刻', { ...identity, authTime: NaN }],
  ] as const)('%sの場合に退会を開始せず再認証を求める', async (_name, proof) => {
    const { app, requestDeletion } = setup(proof);
    const response = await app.request('/account/deletion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'RECENT_AUTH_REQUIRED' } });
    expect(requestDeletion).not.toHaveBeenCalled();
  });
  it.each([body, { confirmation: 'DELETE', acknowledge_active_subscription: true, acknowledge_confirmed_assets: true }])('同じ本人の直近認証の場合に既存の確認契約で退会できる', async (confirmation) => {
    const { app, requestDeletion } = setup(identity);
    const response = await app.request('/account/deletion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(confirmation) });
    expect(response.status).toBe(200);
    expect(requestDeletion).toHaveBeenCalledTimes(1);
  });
});
