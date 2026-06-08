import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../../src/domain/errors/index.js';
import type { ImageStorageReferenceRepository } from '../../../../src/repositories/ImageStorageReferenceRepository.js';
import {
  ImageStoragePruningService,
  type ImageStorageMaintenancePort,
  type StoredImageObject,
} from '../../../../src/services/storage/ImageStoragePruningService.js';

class FakeStorage implements ImageStorageMaintenancePort {
  public deleted: string[] = [];

  public constructor(private readonly objectsByPrefix: Map<string, StoredImageObject[]>) {}

  public async listObjects(prefix: string): Promise<StoredImageObject[]> {
    return this.objectsByPrefix.get(prefix) ?? [];
  }

  public async deleteObject(key: string): Promise<void> {
    this.deleted.push(key);
  }
}

class FakeReferenceRepository implements ImageStorageReferenceRepository {
  public constructor(private readonly protectedKeys: Set<string>) {}

  public async findProtectedImageS3Keys(): Promise<Set<string>> {
    return this.protectedKeys;
  }
}

describe('ImageStoragePruningService', () => {
  it('dry-run では古い未参照 tmp/session だけを削除候補にする', async () => {
    const storage = new FakeStorage(
      new Map([
        [
          'session/',
          [
            { key: 'session/user/pages/page/current.png', lastModified: new Date('2026-06-08T00:00:00.000Z') },
            { key: 'session/user/pages/page/old.png', lastModified: new Date('2026-06-01T00:00:00.000Z') },
            { key: 'session/user/pages/page/new.png', lastModified: new Date('2026-06-08T23:00:00.000Z') },
          ],
        ],
        [
          'tmp/',
          [
            { key: 'tmp/user/entities/imports/source.png', lastModified: new Date('2026-06-01T00:00:00.000Z') },
          ],
        ],
      ]),
    );
    const service = new ImageStoragePruningService(
      storage,
      new FakeReferenceRepository(new Set(['session/user/pages/page/current.png'])),
    );

    const result = await service.prune({
      prefixes: ['session/', 'tmp/'],
      olderThanHours: 24,
      protectRecentCandidateHours: 48,
      maxDeletes: 100,
      dryRun: true,
      now: new Date('2026-06-09T00:00:00.000Z'),
    });

    expect(result).toMatchObject({
      dryRun: true,
      scanned: 4,
      protected: 1,
      skippedRecent: 1,
      deleteCandidates: [
        'session/user/pages/page/old.png',
        'tmp/user/entities/imports/source.png',
      ],
      deleted: [],
      truncated: false,
    });
    expect(storage.deleted).toEqual([]);
  });

  it('apply では maxDeletes まで削除し、超過は truncated にする', async () => {
    const storage = new FakeStorage(
      new Map([
        [
          'session/',
          [
            { key: 'session/old-1.png', lastModified: new Date('2026-06-01T00:00:00.000Z') },
            { key: 'session/old-2.png', lastModified: new Date('2026-06-01T00:00:00.000Z') },
          ],
        ],
      ]),
    );
    const service = new ImageStoragePruningService(storage, new FakeReferenceRepository(new Set()));

    const result = await service.prune({
      prefixes: ['session/'],
      olderThanHours: 24,
      protectRecentCandidateHours: 48,
      maxDeletes: 1,
      dryRun: false,
      now: new Date('2026-06-09T00:00:00.000Z'),
    });

    expect(result.deleteCandidates).toEqual(['session/old-1.png', 'session/old-2.png']);
    expect(result.deleted).toEqual(['session/old-1.png']);
    expect(result.truncated).toBe(true);
  });

  it('saved prefix は削除対象として拒否する', async () => {
    const service = new ImageStoragePruningService(
      new FakeStorage(new Map()),
      new FakeReferenceRepository(new Set()),
    );

    await expect(
      service.prune({
        prefixes: ['saved/'],
        olderThanHours: 24,
        protectRecentCandidateHours: 48,
        maxDeletes: 100,
        dryRun: true,
      }),
    ).rejects.toEqual(new ValidationError('Image pruning is limited to tmp/ and session/ prefixes'));
  });
});
