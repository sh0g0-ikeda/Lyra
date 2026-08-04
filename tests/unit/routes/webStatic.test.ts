import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createApp, isWebStaticFallbackPath } from '../../../src/app.js';

describe('web static routes', () => {
  it('root path returns the web index when web static dir is configured', async () => {
    const root = await createStaticFixture();
    try {
      const app = createApp({ jwtSecret: 'test-web-static-secret', webStaticDir: root });

      const response = await app.request('/');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
      await expect(response.text()).resolves.toContain('<div id="root"></div>');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('SPA route returns the web index without swallowing API 404s', async () => {
    const root = await createStaticFixture();
    try {
      const app = createApp({ jwtSecret: 'test-web-static-secret', webStaticDir: root });

      const spaResponse = await app.request('/auth/callback?code=test');
      const apiResponse = await app.request('/api/not-found');

      expect(spaResponse.status).toBe(200);
      await expect(spaResponse.text()).resolves.toContain('<div id="root"></div>');
      expect(apiResponse.status).toBe(401);
      expect(apiResponse.headers.get('content-type')).not.toContain('text/html');
      expect(apiResponse.headers.get('content-security-policy')).toBe(
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('Mobile association files return JSON and never fall through to the SPA', async () => {
    const root = await createStaticFixture();
    try {
      const app = createApp({ jwtSecret: 'test-web-static-secret', webStaticDir: root });

      const androidResponse = await app.request('/.well-known/assetlinks.json');
      const appleResponse = await app.request('/.well-known/apple-app-site-association');
      const missingResponse = await app.request('/.well-known/missing-association');

      expect(androidResponse.status).toBe(200);
      expect(androidResponse.headers.get('content-type')).toContain('application/json');
      await expect(androidResponse.json()).resolves.toEqual([{ relation: ['delegate_permission/common.handle_all_urls'] }]);
      expect(appleResponse.status).toBe(200);
      expect(appleResponse.headers.get('content-type')).toContain('application/json');
      await expect(appleResponse.json()).resolves.toEqual({
        applinks: { details: [{ appID: 'TEAMID.jp.lyra.mobile', paths: ['/auth/mobile/*', '/invitations/*'] }] },
      });
      expect(missingResponse.status).toBe(404);
      expect(missingResponse.headers.get('content-type')).not.toContain('text/html');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('API and operational paths are excluded from web fallback', () => {
    expect(isWebStaticFallbackPath('/')).toBe(true);
    expect(isWebStaticFallbackPath('/auth/callback')).toBe(true);
    expect(isWebStaticFallbackPath('/api')).toBe(false);
    expect(isWebStaticFallbackPath('/api/works')).toBe(false);
    expect(isWebStaticFallbackPath('/healthz')).toBe(false);
    expect(isWebStaticFallbackPath('/local-assets/image.png')).toBe(false);
  });
});

async function createStaticFixture(): Promise<string> {
  const root = join(tmpdir(), `lyra-web-static-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  await mkdir(join(root, '.well-known'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<!doctype html><div id="root"></div>', 'utf8');
  await writeFile(
    join(root, '.well-known', 'assetlinks.json'),
    JSON.stringify([{ relation: ['delegate_permission/common.handle_all_urls'] }]),
    'utf8',
  );
  await writeFile(
    join(root, '.well-known', 'apple-app-site-association'),
    JSON.stringify({
      applinks: {
        details: [{ appID: 'TEAMID.jp.lyra.mobile', paths: ['/auth/mobile/*', '/invitations/*'] }],
      },
    }),
    'utf8',
  );
  return root;
}
