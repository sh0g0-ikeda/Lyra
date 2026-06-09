import { describe, expect, it } from 'vitest';
import type { EntityReferenceContext } from '../../../../src/domain/types/entityReference.js';
import type { LoadedStoredImage, StoredImageLoaderPort } from '../../../../src/infrastructure/aws/S3StoredImageLoader.js';
import { EntityReferenceImageExportService } from '../../../../src/services/entity/EntityReferenceImageExportService.js';

class FakeEntityReferenceRepository {
  public context: EntityReferenceContext | null = buildReferenceContext();
  public lastRequest: { entityId: string; userId: string } | null = null;

  public async findReferenceContextByIdAndUserId(
    entityId: string,
    userId: string,
  ): Promise<EntityReferenceContext | null> {
    this.lastRequest = { entityId, userId };
    return this.context;
  }

  public async saveConfirmedReferences(): Promise<never> {
    throw new Error('not implemented');
  }

  public async deleteReferenceImage(): Promise<never> {
    throw new Error('not implemented');
  }

  public async countEntityStateUsageByReferenceId(): Promise<never> {
    throw new Error('not implemented');
  }
}

class FakeStoredImageLoader implements StoredImageLoaderPort {
  public lastS3Key: string | null = null;

  public async loadByS3Key(s3Key: string): Promise<LoadedStoredImage> {
    this.lastS3Key = s3Key;
    return {
      imageData: Buffer.from('reference-image'),
      mimeType: 'image/png',
    };
  }
}

describe('EntityReferenceImageExportService', () => {
  it('loads an owned confirmed reference image by s3_key', async () => {
    const repository = new FakeEntityReferenceRepository();
    const loader = new FakeStoredImageLoader();
    const service = new EntityReferenceImageExportService(
      repository,
      loader,
    );

    const result = await service.exportReferenceImage('user-1', 'entity-1', 'ref-1');

    expect(repository.lastRequest).toEqual({ entityId: 'entity-1', userId: 'user-1' });
    expect(loader.lastS3Key).toBe('saved/user-1/entities/entity-1/ref-1.png');
    expect(result).toEqual({
      imageData: Buffer.from('reference-image'),
      mimeType: 'image/png',
    });
  });

  it('rejects a confirmed reference image outside the owner scope before loading', async () => {
    const repository = new FakeEntityReferenceRepository();
    repository.context!.referenceSet.images[0]!.s3Key = 'saved/user-2/entities/entity-1/ref-1.png';
    const loader = new FakeStoredImageLoader();
    const service = new EntityReferenceImageExportService(
      repository,
      loader,
    );

    await expect(service.exportReferenceImage('user-1', 'entity-1', 'ref-1')).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: 'entity reference image key is outside the owner scope',
    });
    expect(loader.lastS3Key).toBeNull();
  });

  it('returns NOT_FOUND when the entity is missing', async () => {
    const repository = new FakeEntityReferenceRepository();
    repository.context = null;
    const service = new EntityReferenceImageExportService(
      repository,
      new FakeStoredImageLoader(),
    );

    await expect(service.exportReferenceImage('user-1', 'entity-1', 'ref-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Entity not found',
    });
  });

  it('returns NOT_FOUND when the ref_id is missing', async () => {
    const repository = new FakeEntityReferenceRepository();
    const service = new EntityReferenceImageExportService(
      repository,
      new FakeStoredImageLoader(),
    );

    await expect(service.exportReferenceImage('user-1', 'entity-1', 'missing-ref')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Reference image not found',
    });
  });

  it('loads an owned temporary candidate image by s3_key', async () => {
    const repository = new FakeEntityReferenceRepository();
    const loader = new FakeStoredImageLoader();
    const service = new EntityReferenceImageExportService(
      repository,
      loader,
    );

    const result = await service.exportCandidateImage(
      'user-1',
      'entity-1',
      'tmp/user-1/entities/imports/source.png',
    );

    expect(loader.lastS3Key).toBe('tmp/user-1/entities/imports/source.png');
    expect(result.mimeType).toBe('image/png');
  });

  it('loads an owned generated candidate image by s3_key', async () => {
    const repository = new FakeEntityReferenceRepository();
    const loader = new FakeStoredImageLoader();
    const service = new EntityReferenceImageExportService(
      repository,
      loader,
    );

    await service.exportCandidateImage(
      'user-1',
      'entity-1',
      'session/user-1/entities/entity-1/job-1-0.png',
    );

    expect(loader.lastS3Key).toBe('session/user-1/entities/entity-1/job-1-0.png');
  });

  it('rejects candidate images outside the owner scope', async () => {
    const repository = new FakeEntityReferenceRepository();
    const service = new EntityReferenceImageExportService(
      repository,
      new FakeStoredImageLoader(),
    );

    await expect(
      service.exportCandidateImage('user-1', 'entity-1', 'tmp/user-2/entities/imports/source.png'),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});

function buildReferenceContext(): EntityReferenceContext {
  return {
    entityId: 'entity-1',
    workId: 'work-1',
    userId: 'user-1',
    entityType: 'character',
    name: 'Mizuki',
    freeDescription: null,
    structuredFields: {},
    promptSupplement: null,
    status: 'ready',
    referenceSet: {
      entityId: 'entity-1',
      images: [
        {
          refId: 'ref-1',
          s3Key: 'saved/user-1/entities/entity-1/ref-1.png',
          cdnUrl: 'https://cdn.lyra.test/saved/user-1/entities/entity-1/ref-1.png',
          source: 'upload',
          createdAt: '2026-04-22T00:00:00.000Z',
        },
      ],
      primaryRefId: 'ref-1',
      status: 'ready',
      updatedAt: new Date('2026-04-22T00:00:00.000Z'),
    },
  };
}
