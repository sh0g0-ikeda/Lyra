import { Hono, type MiddlewareHandler } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { AppError, UnauthorizedError } from '../../../src/domain/errors/index.js';
import { createPageGenerationWarmupRoutes } from '../../../src/routes/pageGenerationWarmup.js';
import type { AppEnv } from '../../../src/types/app.js';

function appFor(signedIn: boolean): { app: Hono<AppEnv>; warmup: ReturnType<typeof vi.fn> } {
  const warmup = vi.fn(async (_user: string, _page: string, _org: string | null) => undefined);
  const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (!signedIn) throw new UnauthorizedError();
    c.set('user', { id: 'user-1', supabaseId: 'sub-1', email: 'test@example.test', displayName: null, planCode: 'free' });
    await next();
  };
  const app = new Hono<AppEnv>();
  app.onError((error, c) => c.json({ code: error instanceof AppError ? error.code : 'INTERNAL_ERROR' }, error instanceof AppError ? error.statusCode : 500));
  app.route('/api', createPageGenerationWarmupRoutes({ authMiddleware: auth, rateLimitMiddleware: async (_c, next) => next(), warmupService: { warmup } }));
  return { app, warmup };
}
const page = '11111111-1111-4111-8111-111111111111';
describe('POST page generation warmup', () => {
  it('認証済み本人と対象scopeだけをserviceへ渡して204を返す', async () => {
    const { app, warmup } = appFor(true);
    const org = '22222222-2222-4222-8222-222222222222';
    const response = await app.request(`/api/pages/${page}/generation-warmup?organization_id=${org}`, { method: 'POST' });
    expect(response.status).toBe(204);
    expect(warmup).toHaveBeenCalledWith('user-1', page, org);
    expect(await response.text()).toBe('');
  });
  it('未認証の場合は起動serviceを呼ばない', async () => {
    const { app, warmup } = appFor(false);
    expect((await app.request(`/api/pages/${page}/generation-warmup`, { method: 'POST' })).status).toBe(401);
    expect(warmup).not.toHaveBeenCalled();
  });
  it('不正な対象IDの場合は起動serviceを呼ばない', async () => {
    const { app, warmup } = appFor(true);
    expect((await app.request('/api/pages/not-a-uuid/generation-warmup', { method: 'POST' })).status).toBe(422);
    expect(warmup).not.toHaveBeenCalled();
  });
});
