import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LocalFileEpisodeExportArtifactStorage,
  LocalFileEpisodeExportSourceImageLoader,
} from '../../../../src/infrastructure/local/LocalFileEpisodeExportStorage.js';

const temporaryDirectories: string[] = [];
const sourceKey =
  'session/11111111-1111-4111-8111-111111111111/pages/22222222-2222-4222-8222-222222222222/job.png';
const artifactKey =
  'exports/11111111-1111-4111-8111-111111111111/episodes/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.pdf';
const pngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('LocalFileEpisodeExportStorage', () => {
  it('local sourceもsize・MIME・magic bytesを検証して読む', async () => {
    const rootDir = await createTemporaryStorage();
    const sourcePath = path.join(rootDir, ...sourceKey.split('/'));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, pngBytes);
    const loader = new LocalFileEpisodeExportSourceImageLoader({ rootDir });

    await expect(loader.load({
      s3Key: sourceKey,
      mimeType: 'image/png',
    })).resolves.toMatchObject({
      imageData: pngBytes,
      mimeType: 'image/png',
      eTag: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it('traversal・MIME不一致・壊れた画像をroot外へ触れず拒否する', async () => {
    const rootDir = await createTemporaryStorage();
    const loader = new LocalFileEpisodeExportSourceImageLoader({ rootDir });

    await expect(loader.load({
      s3Key: '../outside.png',
      mimeType: 'image/png',
    })).rejects.toMatchObject({
      code: 'EXPORT_SOURCE_INVALID',
      retryable: false,
    });

    const sourcePath = path.join(rootDir, ...sourceKey.split('/'));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, Buffer.from([0xff, 0xd8, 0xff, 0x00]));
    await expect(loader.load({
      s3Key: sourceKey,
      mimeType: 'image/png',
    })).rejects.toMatchObject({
      code: 'EXPORT_SOURCE_INVALID',
      retryable: false,
    });

    await writeFile(sourcePath, Buffer.alloc(pngBytes.length));
    await expect(loader.load({
      s3Key: sourceKey,
      mimeType: 'image/png',
    })).rejects.toMatchObject({
      code: 'EXPORT_SOURCE_INVALID',
      retryable: false,
    });
  });

  it('exact artifact keyだけを書き込み削除する', async () => {
    const rootDir = await createTemporaryStorage();
    const storage = new LocalFileEpisodeExportArtifactStorage({ rootDir });
    const identity = buildArtifactIdentity();

    await storage.store({
      ...identity,
      s3Key: artifactKey,
      mimeType: 'application/pdf',
      artifactData: Buffer.from('%PDF-local'),
    });
    const artifactPath = path.join(rootDir, ...artifactKey.split('/'));
    await expect(readFile(artifactPath, 'utf8')).resolves.toBe('%PDF-local');

    await storage.delete({
      ...identity,
      s3Key: artifactKey,
      mimeType: 'application/pdf',
    });
    await expect(readFile(artifactPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function createTemporaryStorage(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'lyra-export-storage-'));
  temporaryDirectories.push(directory);
  return directory;
}

function buildArtifactIdentity(): {
  userId: string;
  organizationId: null;
  episodeId: string;
  jobId: string;
  format: 'pdf';
} {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    organizationId: null,
    episodeId: '33333333-3333-4333-8333-333333333333',
    jobId: '44444444-4444-4444-8444-444444444444',
    format: 'pdf',
  };
}
