import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { describe, expect, it, afterEach } from 'vitest';
import { LocalFileEntityImageStorage } from '../../../../src/infrastructure/local/LocalFileEntityImageStorage.js';
import { LocalFileFinalPageImageStorage } from '../../../../src/infrastructure/local/LocalFileFinalPageImageStorage.js';
import { LocalFilePageImageStorage } from '../../../../src/infrastructure/local/LocalFilePageImageStorage.js';
import { LocalFileStoredImageLoader } from '../../../../src/infrastructure/local/LocalFileStoredImageLoader.js';
import type { LocalAssetConfig } from '../../../../src/infrastructure/local/LocalAssetFiles.js';

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Local file storage adapters', () => {
  it('page image を session 配下へ保存して読み戻せる', async () => {
    const config = await createConfig();
    const storage = new LocalFilePageImageStorage(config);
    const loader = new LocalFileStoredImageLoader(config);

    const stored = await storage.store({
      jobId: 'job-1',
      userId: 'user-1',
      pageId: 'page-1',
      imageData: Buffer.from('page-image'),
      mimeType: 'image/png',
    });
    const loaded = await loader.loadByS3Key(stored.s3Key);

    expect(stored.s3Key).toBe('session/user-1/pages/page-1/job-1.png');
    expect(stored.cdnUrl).toBe('http://127.0.0.1:3000/local-assets/session/user-1/pages/page-1/job-1.png');
    expect(loaded).toEqual({
      imageData: Buffer.from('page-image'),
      mimeType: 'image/png',
    });
  });

  it('entity import と finalize が tmp から saved へコピーする', async () => {
    const config = await createConfig();
    const storage = new LocalFileEntityImageStorage(config);
    const loader = new LocalFileStoredImageLoader(config);

    const imported = await storage.storeImportedImage({
      userId: 'user-1',
      imageData: Buffer.from('entity-image'),
      mimeType: 'image/png',
    });
    const finalized = await storage.finalizeReferenceImage({
      userId: 'user-1',
      entityId: 'entity-1',
      refId: 'ref-1',
      sourceS3Key: imported.s3Key,
    });
    const loaded = await loader.loadByS3Key(finalized.s3Key);

    expect(imported.s3Key).toContain('tmp/user-1/entities/imports/');
    expect(finalized.s3Key).toBe('saved/user-1/entities/entity-1/ref-1.png');
    expect(loaded.imageData).toEqual(Buffer.from('entity-image'));
  });

  it('final page image を saved 配下へ保存する', async () => {
    const config = await createConfig();
    const storage = new LocalFileFinalPageImageStorage(config);

    const result = await storage.storeFinalPageImage({
      userId: 'user-1',
      pageId: 'page-1',
      imageData: Buffer.from('final-page'),
      mimeType: 'image/webp',
      generatedImage: {
        s3Key: 'session/user-1/pages/page-1/job-1.png',
        cdnUrl: 'http://127.0.0.1:3000/local-assets/session/user-1/pages/page-1/job-1.png',
        generationMode: 'standard',
        generatedAt: '2026-05-24T00:00:00.000Z',
      },
    });

    expect(result.s3Key).toBe('saved/user-1/pages/page-1_final.webp');
    expect(result.cdnUrl).toBe('http://127.0.0.1:3000/local-assets/saved/user-1/pages/page-1_final.webp');
  });
});

async function createConfig(): Promise<LocalAssetConfig> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'lyra-local-storage-'));
  createdDirs.push(rootDir);

  return {
    rootDir,
    baseUrl: 'http://127.0.0.1:3000/local-assets',
  };
}

