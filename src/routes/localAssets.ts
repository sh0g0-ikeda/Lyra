import { Hono } from 'hono';
import { readLocalAsset, resolveLocalAssetPath, inferImageMimeTypeFromKey } from '../infrastructure/local/LocalAssetFiles.js';
import type { AppEnv } from '../types/app.js';

export function createLocalAssetRoutes(rootDir: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/local-assets/*', async (c) => {
    const rawAssetKey = c.req.path.replace(/^\/local-assets\//u, '');

    try {
      const assetKey = decodeURIComponent(rawAssetKey);
      // Resolve once here to reject traversal attempts before reading.
      resolveLocalAssetPath(rootDir, assetKey);
      const imageData = await readLocalAsset(rootDir, assetKey);
      return c.body(new Uint8Array(imageData), 200, {
        'Content-Type': inferImageMimeTypeFromKey(assetKey),
        'Cache-Control': 'public, max-age=604800, immutable',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
    } catch {
      return c.notFound();
    }
  });

  return app;
}
