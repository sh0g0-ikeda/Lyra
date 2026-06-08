import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalAssetRoutes } from '../../../src/routes/localAssets.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe('local asset routes', () => {
  it('export 用の画像取得で CORS を許可する', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'lyra-local-assets-'));
    tempDirs.push(rootDir);

    const nestedDir = join(rootDir, 'saved', 'user-1', 'pages');
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(nestedDir, 'page-1.webp'), Buffer.from('RIFF0000WEBP', 'utf8'));

    const app = createLocalAssetRoutes(rootDir);
    const response = await app.request('/local-assets/saved/user-1/pages/page-1.webp');

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
  });

  it('CORS preflight に OPTIONS で応答する', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'lyra-local-assets-'));
    tempDirs.push(rootDir);

    const app = createLocalAssetRoutes(rootDir);
    const response = await app.request('/local-assets/saved/user-1/pages/page-1.webp', { method: 'OPTIONS' });

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS');
  });

  it('壊れた URL エンコードの asset key は 404 にする', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'lyra-local-assets-'));
    tempDirs.push(rootDir);

    const app = createLocalAssetRoutes(rootDir);
    const response = await app.request('/local-assets/%E0%A4%A');

    expect(response.status).toBe(404);
  });

  it('URL encode された traversal は root 外を読まず 404 にする', async () => {
    const parentDir = await mkdtemp(join(tmpdir(), 'lyra-local-assets-parent-'));
    const rootDir = join(parentDir, 'root');
    tempDirs.push(parentDir);
    await mkdir(rootDir, { recursive: true });
    await writeFile(join(parentDir, 'secret.png'), Buffer.from('secret'));

    const app = createLocalAssetRoutes(rootDir);
    const response = await app.request('/local-assets/%2E%2E%2Fsecret.png');

    expect(response.status).toBe(404);
  });
});
