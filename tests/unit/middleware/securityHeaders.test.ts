import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createSecurityHeadersMiddleware } from '../../../src/middleware/securityHeaders.js';
import type { AppEnv } from '../../../src/types/app.js';

describe('createSecurityHeadersMiddleware', () => {
  it('API response に基本セキュリティヘッダーを付ける', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', createSecurityHeadersMiddleware('development'));
    app.get('/api/health', (c) => c.json({ ok: true }));

    const response = await app.request('/api/health');

    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Permissions-Policy')).toContain('camera=()');
    expect(response.headers.get('Strict-Transport-Security')).toBeNull();
  });

  it('production では HSTS を付ける', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', createSecurityHeadersMiddleware('production'));
    app.get('/api/health', (c) => c.json({ ok: true }));

    const response = await app.request('/api/health');

    expect(response.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains; preload',
    );
  });

  it('route 固有ヘッダーを上書きしない', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', createSecurityHeadersMiddleware('production'));
    app.get('/asset', (c) => {
      c.header('Cross-Origin-Resource-Policy', 'cross-origin');
      c.header('Content-Security-Policy', "default-src 'self'");
      return c.text('ok');
    });

    const response = await app.request('/asset');

    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
  });
});
