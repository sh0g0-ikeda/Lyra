import { describe, expect, it } from 'vitest';
import { EntityReferenceUploadService } from '../../../../src/services/entity/EntityReferenceUploadService.js';
import type {
  CreateEntityReferenceUploadTokenInput,
  ConsumeEntityReferenceUploadTokenInput,
  EntityReferenceUploadTokenRepository,
} from '../../../../src/repositories/EntityReferenceUploadTokenRepository.js';
import type {
  EntityReferenceUploadStoragePort,
  LoadedEntityReferenceUploadImage,
} from '../../../../src/infrastructure/aws/S3EntityReferenceUploadStorage.js';
import type { EntityReferenceRepository } from '../../../../src/repositories/EntityRepository.js';
import type { EntityReferenceServicePort } from '../../../../src/services/entity/EntityReferenceService.js';
import type { OrganizationServicePort } from '../../../../src/services/organization/OrganizationService.js';
import type { EntityImportAnalysis, EntityReferenceContext } from '../../../../src/domain/types/entityReference.js';
import type { EntityReferenceUploadToken } from '../../../../src/domain/types/entityReferenceUpload.js';
import type { OrganizationMember } from '../../../../src/domain/types/organization.js';

const entityId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const createdAt = new Date('2026-07-25T00:00:00.000Z');
const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class FakeUploadTokenRepository implements EntityReferenceUploadTokenRepository {
  public created: CreateEntityReferenceUploadTokenInput | null = null;
  public inspected: ConsumeEntityReferenceUploadTokenInput | null = null;
  public consumed: ConsumeEntityReferenceUploadTokenInput | null = null;
  public token: EntityReferenceUploadToken | null = buildToken();
  public enforceContract = false;
  public consumeOnce = false;
  public now = createdAt;

  public async create(input: CreateEntityReferenceUploadTokenInput): Promise<EntityReferenceUploadToken> {
    this.created = input;
    this.token = {
      ...buildToken(),
      tokenHash: input.tokenHash,
      userId: input.userId,
      organizationId: input.organizationId,
      entityId: input.entityId,
      purpose: input.purpose,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      s3Key: input.s3Key,
      expiresAt: input.expiresAt,
    };
    return this.token;
  }

  public async inspect(input: ConsumeEntityReferenceUploadTokenInput): Promise<EntityReferenceUploadToken | null> {
    this.inspected = input;
    return this.matches(input) ? this.token : null;
  }

  public async consume(input: ConsumeEntityReferenceUploadTokenInput): Promise<EntityReferenceUploadToken | null> {
    this.consumed = input;
    if (!this.matches(input)) {
      return null;
    }
    const token = this.token;
    if (this.consumeOnce) {
      this.token = null;
    }
    return token;
  }

  private matches(input: ConsumeEntityReferenceUploadTokenInput): boolean {
    const token = this.token;
    if (token === null) {
      return false;
    }
    return !this.enforceContract || (
      token.userId === input.userId &&
      token.organizationId === input.organizationId &&
      token.purpose === input.purpose &&
      token.expiresAt > this.now
    );
  }
}

class FakeUploadStorage implements EntityReferenceUploadStoragePort {
  public presignInput: {
    s3Key: string;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    sizeBytes: number;
    expiresInSeconds: number;
  } | null = null;
  public loadInput: { s3Key: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; sizeBytes: number } | null = null;
  public image: LoadedEntityReferenceUploadImage | null = {
    imageData: validPng,
    mimeType: 'image/png',
    cdnUrl: 'https://cdn.lyra.test/tmp/user-1/entities/imports/upload.png',
  };
  public failLoadOnce = false;

  public async createPresignedPutUrl(input: {
    s3Key: string;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<string> {
    this.presignInput = input;
    return 'https://uploads.lyra.test/presigned';
  }

  public async loadUploadedImage(input: {
    s3Key: string;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    sizeBytes: number;
  }): Promise<LoadedEntityReferenceUploadImage | null> {
    this.loadInput = input;
    if (this.failLoadOnce) {
      this.failLoadOnce = false;
      throw new Error('temporary S3 read failure');
    }
    return this.image;
  }
}

class FakeEntityReferenceRepository implements Pick<EntityReferenceRepository, 'findReferenceContextByIdAndUserId'> {
  public calls: Array<{ entityId: string; userId: string; organizationId: string | null }> = [];
  public context: EntityReferenceContext | null = buildEntityReferenceContext();

  public async findReferenceContextByIdAndUserId(
    requestedEntityId: string,
    userId: string,
    requestedOrganizationId: string | null = null,
  ): Promise<EntityReferenceContext | null> {
    this.calls.push({ entityId: requestedEntityId, userId, organizationId: requestedOrganizationId });
    return this.context;
  }
}

class FakeEntityReferenceService implements Pick<EntityReferenceServicePort, 'importUploadedImage'> {
  public input: {
    userId: string;
    entityType: 'character' | 'nonhuman' | 'object';
    imageData: Buffer;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    tmpImageS3Key: string;
    tmpImageCdnUrl: string;
    organizationId: string | null;
  } | null = null;

  public async importUploadedImage(
    userId: string,
    input: {
      entityType: 'character' | 'nonhuman' | 'object';
      imageData: Buffer;
      mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
      tmpImageS3Key: string;
      tmpImageCdnUrl: string;
    },
    requestedOrganizationId: string | null = null,
  ): Promise<EntityImportAnalysis> {
    this.input = { userId, ...input, organizationId: requestedOrganizationId };
    return {
      suggestedFields: { art_style: 'anime' },
      promptSupplement: 'full body reference',
      tmpImageS3Key: input.tmpImageS3Key,
      tmpImageCdnUrl: input.tmpImageCdnUrl,
    };
  }
}

class FakeOrganizationService implements Pick<OrganizationServicePort, 'requireMembership'> {
  public calls: Array<{ organizationId: string; userId: string; capability: string | undefined }> = [];

  public async requireMembership(
    requestedOrganizationId: string,
    userId: string,
    capability?: Parameters<OrganizationServicePort['requireMembership']>[2],
  ): Promise<OrganizationMember> {
    this.calls.push({ organizationId: requestedOrganizationId, userId, capability });
    return {
      id: 'member-1',
      organizationId: requestedOrganizationId,
      userId,
      email: 'user@example.com',
      displayName: null,
      role: 'editor',
      status: 'active',
      invitedByUserId: null,
      joinedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    };
  }
}

describe('EntityReferenceUploadService', () => {
  it('サーバー生成 key と不透明 token で entity reference upload の PUT URL を発行する', async () => {
    const tokens = new FakeUploadTokenRepository();
    const storage = new FakeUploadStorage();
    const service = buildService({ tokens, storage, tokenGenerator: () => 'opaque-upload-token' });

    const result = await service.createPresignedUpload('user-1', {
      mimeType: 'image/png',
      sizeBytes: validPng.length,
      entityId,
    });

    expect(result).toEqual({
      uploadUrl: 'https://uploads.lyra.test/presigned',
      uploadToken: 'opaque-upload-token',
      expiresAt: new Date('2026-07-25T00:05:00.000Z'),
      uploadHeaders: {
        'Content-Type': 'image/png',
        'x-amz-server-side-encryption': 'AES256',
      },
    });
    expect(result).not.toHaveProperty('s3Key');
    expect(tokens.created).toMatchObject({
      userId: 'user-1',
      entityId,
      organizationId: null,
      purpose: 'entity_reference_import',
      mimeType: 'image/png',
      sizeBytes: validPng.length,
    });
    expect(tokens.created?.tokenHash).not.toContain('opaque-upload-token');
    expect(tokens.created?.s3Key).toMatch(/^tmp\/user-1\/entities\/imports\/[0-9a-f-]+\.png$/u);
    expect(tokens.created?.s3Key).not.toContain('filename');
    expect(storage.presignInput).toMatchObject({
      s3Key: tokens.created?.s3Key,
      mimeType: 'image/png',
      sizeBytes: validPng.length,
      expiresInSeconds: 300,
    });
  });

  it('MIME または 5MB を超える upload は token と PUT URL を発行しない', async () => {
    const tokens = new FakeUploadTokenRepository();
    const storage = new FakeUploadStorage();
    const service = buildService({ tokens, storage });

    await expect(
      service.createPresignedUpload('user-1', {
        mimeType: 'image/gif' as 'image/png',
        sizeBytes: validPng.length,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      service.createPresignedUpload('user-1', {
        mimeType: 'image/png',
        sizeBytes: 5 * 1024 * 1024 + 1,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(tokens.created).toBeNull();
    expect(storage.presignInput).toBeNull();
  });

  it('organization upload は active membership と entity owner scope を発行時に検証する', async () => {
    const organizations = new FakeOrganizationService();
    const entities = new FakeEntityReferenceRepository();
    const service = buildService({ organizations, entities });

    await service.createPresignedUpload('user-1', {
      mimeType: 'image/png',
      sizeBytes: validPng.length,
      entityId,
    }, organizationId);

    expect(organizations.calls).toEqual([
      { organizationId, userId: 'user-1', capability: 'generate' },
    ]);
    expect(entities.calls).toEqual([
      { entityId, userId: 'user-1', organizationId },
    ]);
  });

  it('upload token を一度だけ消費して S3 object を検証後に既存の import analysis へ渡す', async () => {
    const tokens = new FakeUploadTokenRepository();
    const storage = new FakeUploadStorage();
    const imports = new FakeEntityReferenceService();
    const service = buildService({ tokens, storage, imports });

    const result = await service.importUploadedImage('user-1', {
      uploadToken: 'opaque-upload-token',
      entityType: 'character',
    });

    expect(result).toMatchObject({
      suggestedFields: { art_style: 'anime' },
      entityId,
    });
    expect(tokens.consumed).toMatchObject({
      userId: 'user-1',
      organizationId: null,
      purpose: 'entity_reference_import',
    });
    expect(tokens.inspected).toEqual(tokens.consumed);
    expect(storage.loadInput).toMatchObject({
      s3Key: 'tmp/user-1/entities/imports/upload.png',
      mimeType: 'image/png',
      sizeBytes: validPng.length,
    });
    expect(imports.input).toMatchObject({
      userId: 'user-1',
      entityType: 'character',
      mimeType: 'image/png',
      imageData: validPng,
      tmpImageS3Key: 'tmp/user-1/entities/imports/upload.png',
      organizationId: null,
    });
  });

  it('S3 検証が一時失敗した場合は token を消費せず同じ upload を再試行できる', async () => {
    const tokens = new FakeUploadTokenRepository();
    tokens.consumeOnce = true;
    const storage = new FakeUploadStorage();
    storage.failLoadOnce = true;
    const imports = new FakeEntityReferenceService();
    const service = buildService({ tokens, storage, imports });

    await expect(
      service.importUploadedImage('user-1', {
        uploadToken: 'retryable-upload-token',
        entityType: 'character',
      }),
    ).rejects.toThrow('temporary S3 read failure');

    expect(tokens.inspected).not.toBeNull();
    expect(tokens.consumed).toBeNull();
    expect(imports.input).toBeNull();

    await expect(
      service.importUploadedImage('user-1', {
        uploadToken: 'retryable-upload-token',
        entityType: 'character',
      }),
    ).resolves.toMatchObject({ entityId });
    expect(tokens.consumed).not.toBeNull();
  });

  it('cross-user と cross-organization token は解析前に同じ安全な validation error で拒否する', async () => {
    const tokens = new FakeUploadTokenRepository();
    tokens.enforceContract = true;
    const storage = new FakeUploadStorage();
    const imports = new FakeEntityReferenceService();
    const service = buildService({
      tokens,
      storage,
      imports,
      organizations: new FakeOrganizationService(),
    });

    await expect(
      service.importUploadedImage('other-user', {
        uploadToken: 'cross-user-token',
        entityType: 'character',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Upload is invalid or has expired',
    });

    await expect(
      service.importUploadedImage('user-1', {
        uploadToken: 'cross-organization-token',
        entityType: 'character',
      }, organizationId),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Upload is invalid or has expired',
    });
    expect(storage.loadInput).toBeNull();
    expect(imports.input).toBeNull();
  });

  it('replay と expiry token は一度も二重解析せず validation error にする', async () => {
    const tokens = new FakeUploadTokenRepository();
    tokens.enforceContract = true;
    tokens.consumeOnce = true;
    const imports = new FakeEntityReferenceService();
    const service = buildService({ tokens, imports });

    await service.importUploadedImage('user-1', {
      uploadToken: 'one-time-token',
      entityType: 'character',
    });
    await expect(
      service.importUploadedImage('user-1', {
        uploadToken: 'one-time-token',
        entityType: 'character',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Upload is invalid or has expired',
    });

    const expiredTokens = new FakeUploadTokenRepository();
    expiredTokens.enforceContract = true;
    expiredTokens.token = {
      ...buildToken(),
      expiresAt: createdAt,
    };
    const expiredImports = new FakeEntityReferenceService();
    const expiredService = buildService({ tokens: expiredTokens, imports: expiredImports });
    await expect(
      expiredService.importUploadedImage('user-1', {
        uploadToken: 'expired-token',
        entityType: 'character',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Upload is invalid or has expired',
    });
    expect(expiredImports.input).toBeNull();
  });

  it('missing object、MIME/size mismatch、magic bytes mismatch は credit 消費前に拒否する', async () => {
    const cases: Array<{ name: string; image: LoadedEntityReferenceUploadImage | null }> = [
      { name: 'missing', image: null },
      {
        name: 'mime',
        image: {
          imageData: validPng,
          mimeType: 'image/jpeg',
          cdnUrl: 'https://cdn.lyra.test/tmp/user-1/entities/imports/upload.png',
        },
      },
      {
        name: 'size',
        image: {
          imageData: Buffer.concat([validPng, Buffer.from([0x00])]),
          mimeType: 'image/png',
          cdnUrl: 'https://cdn.lyra.test/tmp/user-1/entities/imports/upload.png',
        },
      },
      {
        name: 'magic',
        image: {
          imageData: Buffer.from('notimage'),
          mimeType: 'image/png',
          cdnUrl: 'https://cdn.lyra.test/tmp/user-1/entities/imports/upload.png',
        },
      },
    ];

    for (const testCase of cases) {
      const storage = new FakeUploadStorage();
      storage.image = testCase.image;
      const imports = new FakeEntityReferenceService();
      const service = buildService({ storage, imports });

      await expect(
        service.importUploadedImage('user-1', {
          uploadToken: `${testCase.name}-token`,
          entityType: 'character',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(imports.input).toBeNull();
    }
  });
});

function buildService(overrides: {
  tokens?: FakeUploadTokenRepository;
  storage?: FakeUploadStorage;
  entities?: FakeEntityReferenceRepository;
  imports?: FakeEntityReferenceService;
  organizations?: FakeOrganizationService;
  tokenGenerator?: () => string;
} = {}): EntityReferenceUploadService {
  return new EntityReferenceUploadService({
    uploadTokenRepository: overrides.tokens ?? new FakeUploadTokenRepository(),
    uploadStorage: overrides.storage ?? new FakeUploadStorage(),
    entityReferenceRepository: overrides.entities ?? new FakeEntityReferenceRepository(),
    entityReferenceService: overrides.imports ?? new FakeEntityReferenceService(),
    organizationService: overrides.organizations,
    now: () => createdAt,
    tokenGenerator: overrides.tokenGenerator,
  });
}

function buildToken(): EntityReferenceUploadToken {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    tokenHash: 'hash',
    userId: 'user-1',
    organizationId: null,
    entityId,
    purpose: 'entity_reference_import',
    mimeType: 'image/png',
    sizeBytes: validPng.length,
    s3Key: 'tmp/user-1/entities/imports/upload.png',
    expiresAt: new Date('2026-07-25T00:05:00.000Z'),
    consumedAt: null,
    createdAt,
  };
}

function buildEntityReferenceContext(): EntityReferenceContext {
  return {
    entityId,
    workId: '44444444-4444-4444-8444-444444444444',
    userId: 'user-1',
    entityType: 'character',
    name: 'Mizuki',
    freeDescription: null,
    structuredFields: {},
    promptSupplement: null,
    status: 'draft',
    referenceSet: {
      entityId,
      images: [],
      primaryRefId: null,
      status: 'empty',
      updatedAt: createdAt,
    },
  };
}
