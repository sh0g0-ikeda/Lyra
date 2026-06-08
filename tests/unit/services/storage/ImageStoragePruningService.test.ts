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
  public listedPrefixes: string[] = [];

  public constructor(private readonly objectsByPrefix: Map<string, StoredImageObject[]>) {}

  public async listObjects(
    prefix: string,
    options?: { maxObjects?: number },
  ): Promise<{ objects: StoredImageObject[]; truncated: boolean }> {
    this.listedPrefixes.push(prefix);
    const objects = this.objectsByPrefix.get(prefix) ?? [];
    const limitedObjects = options?.maxObjects === undefined ? objects : objects.slice(0, options.maxObjects);
    return {
      objects: limitedObjects,
      truncated: limitedObjects.length < objects.length,
    };
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
  it('dry-run selects only old unprotected tmp and session objects', async () => {
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
      scanTruncated: false,
      deleteCandidates: [
        'session/user/pages/page/old.png',
        'tmp/user/entities/imports/source.png',
      ],
      deleted: [],
      truncated: false,
    });
    expect(storage.deleted).toEqual([]);
  });

  it('apply deletes up to maxDeletes and marks truncated overflow', async () => {
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

  it('stops scanning when maxScanned is reached', async () => {
    const storage = new FakeStorage(
      new Map([
        [
          'session/',
          [
            { key: 'session/old-1.png', lastModified: new Date('2026-06-01T00:00:00.000Z') },
            { key: 'session/old-2.png', lastModified: new Date('2026-06-01T00:00:00.000Z') },
            { key: 'session/old-3.png', lastModified: new Date('2026-06-01T00:00:00.000Z') },
          ],
        ],
        [
          'tmp/',
          [{ key: 'tmp/old-1.png', lastModified: new Date('2026-06-01T00:00:00.000Z') }],
        ],
      ]),
    );
    const service = new ImageStoragePruningService(storage, new FakeReferenceRepository(new Set()));

    const result = await service.prune({
      prefixes: ['session/', 'tmp/'],
      olderThanHours: 24,
      protectRecentCandidateHours: 48,
      maxDeletes: 100,
      maxScanned: 2,
      dryRun: true,
      now: new Date('2026-06-09T00:00:00.000Z'),
    });

    expect(storage.listedPrefixes).toEqual(['session/']);
    expect(result.scanned).toBe(2);
    expect(result.scanTruncated).toBe(true);
    expect(result.deleteCandidates).toEqual(['session/old-1.png', 'session/old-2.png']);
  });

  it('deduplicates overlapping delete candidates', async () => {
    const duplicateObject = { key: 'session/user/old.png', lastModified: new Date('2026-06-01T00:00:00.000Z') };
    const storage = new FakeStorage(
      new Map([
        ['session/', [duplicateObject]],
        ['session/user/', [duplicateObject]],
      ]),
    );
    const service = new ImageStoragePruningService(storage, new FakeReferenceRepository(new Set()));

    const result = await service.prune({
      prefixes: ['session/', 'session/user/'],
      olderThanHours: 24,
      protectRecentCandidateHours: 48,
      maxDeletes: 100,
      dryRun: false,
      now: new Date('2026-06-09T00:00:00.000Z'),
    });

    expect(result.deleteCandidates).toEqual(['session/user/old.png']);
    expect(result.deleted).toEqual(['session/user/old.png']);
  });

  it('deduplicates repeated prefixes inside the service', async () => {
    const storage = new FakeStorage(
      new Map([
        [
          'session/',
          [{ key: 'session/old.png', lastModified: new Date('2026-06-01T00:00:00.000Z') }],
        ],
      ]),
    );
    const service = new ImageStoragePruningService(storage, new FakeReferenceRepository(new Set()));

    const result = await service.prune({
      prefixes: ['session/', 'session/'],
      olderThanHours: 24,
      protectRecentCandidateHours: 48,
      maxDeletes: 100,
      dryRun: true,
      now: new Date('2026-06-09T00:00:00.000Z'),
    });

    expect(storage.listedPrefixes).toEqual(['session/']);
    expect(result.deleteCandidates).toEqual(['session/old.png']);
  });

  it('rejects saved prefix by default', async () => {
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
    ).rejects.toEqual(
      new ValidationError('Image pruning is limited to tmp/ and session/ prefixes unless saved pruning is enabled'),
    );
  });

  it('allows explicitly enabled saved pruning while protecting live references', async () => {
    const storage = new FakeStorage(
      new Map([
        [
          'saved/',
          [
            { key: 'saved/user/entities/entity/reference-live.png', lastModified: new Date('2026-06-01T00:00:00.000Z') },
            { key: 'saved/user/entities/entity/reference-deleted.png', lastModified: new Date('2026-06-01T00:00:00.000Z') },
            { key: 'saved/user/pages/page_final.png', lastModified: new Date('2026-06-01T00:00:00.000Z') },
            { key: 'saved/user/entities/entity/reference-new.png', lastModified: new Date('2026-06-08T23:00:00.000Z') },
          ],
        ],
      ]),
    );
    const service = new ImageStoragePruningService(
      storage,
      new FakeReferenceRepository(new Set([
        'saved/user/entities/entity/reference-live.png',
        'saved/user/pages/page_final.png',
      ])),
    );

    const result = await service.prune({
      prefixes: ['saved/'],
      olderThanHours: 24,
      protectRecentCandidateHours: 48,
      maxDeletes: 100,
      dryRun: false,
      includeSavedUnreferenced: true,
      now: new Date('2026-06-09T00:00:00.000Z'),
    });

    expect(result).toMatchObject({
      scanned: 4,
      protected: 2,
      skippedRecent: 1,
      deleteCandidates: ['saved/user/entities/entity/reference-deleted.png'],
      deleted: ['saved/user/entities/entity/reference-deleted.png'],
      truncated: false,
    });
  });

  it('rejects traversal-like prefixes even under allowed roots', async () => {
    const service = new ImageStoragePruningService(
      new FakeStorage(new Map()),
      new FakeReferenceRepository(new Set()),
    );

    await expect(
      service.prune({
        prefixes: ['tmp/../saved/'],
        olderThanHours: 24,
        protectRecentCandidateHours: 48,
        maxDeletes: 100,
        dryRun: true,
      }),
    ).rejects.toEqual(
      new ValidationError('Image pruning is limited to tmp/ and session/ prefixes unless saved pruning is enabled'),
    );
  });
});
