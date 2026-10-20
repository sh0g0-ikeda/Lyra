import { describe, expect, it } from 'vitest';
import { createXOidcRoutes } from '../../../src/routes/xOidc.js';
import { XOidcService } from '../../../src/services/auth/XOidcService.js';
const pass = async (_c: unknown, next: () => Promise<void>): Promise<void> => next();
describe('X認証の公開境界', () => {
  it('既定でログイン機能とiOSを無効にして秘密情報を返さない', async () => {
    const app = createXOidcRoutes({ service: XOidcService.disabled(), rateLimitMiddleware: pass });
    const response = await app.request('/capabilities');
    expect(await response.json()).toEqual({ x_sign_in: false, x_android: false, x_ios: false });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await app.request('/authorize')).status).toBe(503);
  });
  it('秘密情報を含む大きなフォームやJSONをtoken endpointで拒否する', async () => {
    const app = createXOidcRoutes({ service: XOidcService.disabled(), rateLimitMiddleware: pass });
    expect((await app.request('/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(400);
    const response = await app.request('/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a='.repeat(10000) });
    expect(response.status).toBe(413);
    expect(await response.text()).not.toContain('a=a=');
  });
  it('確認画面の値からスクリプトや外部form送信を作れない', async () => {
    const app = createXOidcRoutes({ service: XOidcService.disabled(), rateLimitMiddleware: pass });
    const response = await app.request('/verify?challenge=%22%3E%3Cscript%3E');
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('<script>');
  });
});
