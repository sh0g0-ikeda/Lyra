import { describe, expect, it } from 'vitest';
import type { EntityReferenceUploadToken } from '../../../../src/domain/types/entityReferenceUpload.js';
import type {
  CreateEntityReferenceUploadTokenInput,
  ConsumeEntityReferenceUploadTokenInput,
  EntityReferenceUploadTokenRepository,
} from '../../../../src/repositories/EntityReferenceUploadTokenRepository.js';
import type { EntityReferenceContext } from '../../../../src/domain/types/entityReference.js';
import type { EntityReferenceRepository } from '../../../../src/repositories/EntityRepository.js';
import type {
  EntityReferenceUploadStoragePort,
  LoadedEntityReferenceUploadImage,
} from '../../../../src/services/entity/EntityReferenceUploadStorage.js';
import {
  EntityReferenceUploadService,
} from '../../../../src/services/entity/EntityReferenceUploadService.js';
import type { OrganizationServicePort } from '../../../../src/services/organization/OrganizationService.js';

const userId = '11111111-1111-4111-8111-111111111111';
const entityId = '22222222-2222-4222-8222-222222222222';
const organizationId = '33333333-3333-4333-8333-333333333333';
const createdAt = new Date('2026-07-31T00:00:00.000Z');
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class FakeTokenRepository implements EntityReferenceUploadTokenRepository {
  public created: CreateEntityReferenceUploadTokenInput | null = null;
  public inspected: ConsumeEntityReferenceUploadTokenInput | null = null;
  public consumed: ConsumeEntityReferenceUploadTokenInput | null = null;
  public token: EntityReferenceUploadToken | null = buildToken();
  public consumeOnce = false;

  public async create(input: CreateEntityReferenceUploadTokenInput): Promise<EntityReferenceUploadToken> {
    this.created = input;
    this.token = {
      ...buildToken(),
      ...input,
      id: '44444444-4444-4444-8444-444444444444',
      consumedAt: null,
      createdAt,
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
    return this.token !== null
      && this.token.userId === input.userId
      && this.token.organizationId === input.organizationId
      && this.token.purpose === input.purpose
      && this.token.expiresAt > createdAt;
  }
}

class FakeUploadStorage implements EntityReferenceUploadStoragePort {
  public presignInput: {
    s3Key: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    sizeBytes: number;
    expiresInSeconds: number;
  } | null = null;
  public loadInput: {
    s3Key: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    sizeBytes: number;
  } | null = null;
  public image: LoadedEntityReferenceUploadImage | null = {
    imageData: pngBytes,
    mimeType: 'image/png',
    eTag: '"verified-etag"',
    cdnUrl: `s3://lyra-images/tmp/${userId}/entities/imports/upload.png`,
  };
  public stabilizedInput: {
    sourceS3Key: string;
    destinationS3Key: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    eTag: string;
  } | null = null;
  public loadError: Error | null = null;
  public stabilizeError: Error | null = null;
  public events: string[] = [];

  public async createPresignedPutUrl(input: {
    s3Key: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<string> {
    this.presignInput = input;
    return 'https://uploads.lyra.test/presigned';
  }

  public async loadUploadedImage(input: {
    s3Key: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    sizeBytes: number;
  }): Promise<LoadedEntityReferenceUploadImage | null> {
    this.events.push('load');
    this.loadInput = input;
    if (this.loadError !== null) {
      throw this.loadError;
    }
    return this.image;
  }

  public async stabilizeUploadedImage(input: {
    sourceS3Key: string;
    destinationS3Key: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    eTag: string;
  }) {
    this.events.push('stabilize');
    this.stabilizedInput = input;
    if (this.stabilizeError !== null) {
      throw this.stabilizeError;
    }
    return {
      s3Key: input.destinationS3Key,
      cdnUrl: `s3://lyra-images/${input.destinationS3Key}`,
    };
  }
}

class FakeEntityRepository implements Pick<EntityReferenceRepository, 'findReferenceContextByIdAndUserId'> {
  public context: EntityReferenceContext | null = buildEntityContext();
  public calls: Array<{ entityId: string; userId: string; organizationId: string | null }> = [];

  public async findReferenceContextByIdAndUserId(
    requestedEntityId: string,
    requestedUserId: string,
    requestedOrganizationId: string | null = null,
  ): Promise<EntityReferenceContext | null> {
    this.calls.push({
      entityId: requestedEntityId,
      userId: requestedUserId,
      organizationId: requestedOrganizationId,
    });
    return this.context;
  }
}

class FakeImportService {
  public calls = 0;
  public events: string[] = [];

  public async importUploadedImage(
    requestedUserId: string,
    input: {
      entityType: 'character' | 'nonhuman' | 'object';
      imageData: Buffer;
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
      tmpImageS3Key: string;
      tmpImageCdnUrl: string;
    },
    requestedOrganizationId: string | null = null,
  ) {
    this.events.push('import');
    this.calls += 1;
    return {
      suggestedFields: { name: 'Lyra' },
      promptSupplement: 'reference',
      tmpImageS3Key: input.tmpImageS3Key,
      tmpImageCdnUrl: input.tmpImageCdnUrl,
      requestedUserId,
      requestedOrganizationId,
    };
  }
}

class FakeOrganizationService {
  public calls: Array<{ organizationId: string; userId: string; capability: string | undefined }> = [];

  public async requireMembership(
    requestedOrganizationId: string,
    requestedUserId: string,
    capability?: Parameters<OrganizationServicePort['requireMembership']>[2],
  ) {
    this.calls.push({
      organizationId: requestedOrganizationId,
      userId: requestedUserId,
      capability,
    });
    return {
      id: 'member-1',
      organizationId: requestedOrganizationId,
      userId: requestedUserId,
      email: 'user@example.com',
      displayName: null,
      role: 'editor' as const,
      status: 'active' as const,
      invitedByUserId: null,
      joinedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    };
  }
}

describe('EntityReferenceUploadService', () => {
  it('サーバー所有keyとhashだけを保存して短命PUT URLを返す', async () => {
    const tokens = new FakeTokenRepository();
    const storage = new FakeUploadStorage();
    const service = buildService({ tokens, storage, tokenGenerator: () => 'opaque-upload-token' });

    const result = await service.createPresignedUpload(userId, {
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
      entityId,
    });

    expect(result).toEqual({
      uploadUrl: 'https://uploads.lyra.test/presigned',
      uploadToken: 'opaque-upload-token',
      expiresAt: new Date('2026-07-31T00:05:00.000Z'),
      uploadHeaders: {
        'Content-Type': 'image/png',
        'x-amz-server-side-encryption': 'AES256',
      },
    });
    expect(result).not.toHaveProperty('s3Key');
    expect(tokens.created).toMatchObject({
      userId,
      organizationId: null,
      entityId,
      purpose: 'entity_reference_import',
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
    });
    expect(tokens.created?.tokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(tokens.created?.tokenHash).not.toContain('opaque-upload-token');
    expect(tokens.created?.s3Key).toMatch(
      new RegExp(`^tmp/${userId}/entities/imports/[0-9a-f-]+\\.png$`, 'u'),
    );
    expect(storage.presignInput).toMatchObject({
      s3Key: tokens.created?.s3Key,
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
      expiresInSeconds: 300,
    });
  });

  it('不正MIMEまたは5MiB超過ではtokenもURLも発行しない', async () => {
    const tokens = new FakeTokenRepository();
    const storage = new FakeUploadStorage();
    const service = buildService({ tokens, storage });

    await expect(service.createPresignedUpload(userId, {
      mimeType: 'image/gif' as 'image/png',
      sizeBytes: pngBytes.length,
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.createPresignedUpload(userId, {
      mimeType: 'image/png',
      sizeBytes: 5 * 1024 * 1024 + 1,
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(tokens.created).toBeNull();
    expect(storage.presignInput).toBeNull();
  });

  it('organizationと任意entityのscopeを発行時と利用時に検証する', async () => {
    const organizations = new FakeOrganizationService();
    const entities = new FakeEntityRepository();
    const service = buildService({ organizations, entities });

    await service.createPresignedUpload(userId, {
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
      entityId,
    }, organizationId);

    expect(organizations.calls).toEqual([
      { organizationId, userId, capability: 'generate' },
    ]);
    expect(entities.calls).toEqual([
      { entityId, userId, organizationId },
    ]);
  });

  it('S3検証後にtokenを一度だけ消費して既存解析へ渡す', async () => {
    const tokens = new FakeTokenRepository();
    tokens.consumeOnce = true;
    const storage = new FakeUploadStorage();
    const imports = new FakeImportService();
    const service = buildService({ tokens, storage, imports });

    const result = await service.importUploadedImage(userId, {
      uploadToken: 'opaque-upload-token',
      entityType: 'character',
      entityId,
    });

    expect(result).toMatchObject({
      suggestedFields: { name: 'Lyra' },
      entityId,
    });
    expect(storage.loadInput).toMatchObject({
      s3Key: `tmp/${userId}/entities/imports/upload.png`,
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
    });
    expect(storage.stabilizedInput).toMatchObject({
      sourceS3Key: `tmp/${userId}/entities/imports/upload.png`,
      destinationS3Key: expect.stringMatching(
        new RegExp(`^tmp/${userId}/entities/imports/[0-9a-f-]+\\.png$`, 'u'),
      ),
      mimeType: 'image/png',
      eTag: '"verified-etag"',
    });
    expect(tokens.inspected).toEqual(tokens.consumed);
    expect(imports.calls).toBe(1);

    await expect(service.importUploadedImage(userId, {
      uploadToken: 'opaque-upload-token',
      entityType: 'character',
      entityId,
    })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Upload is invalid or has expired',
    });
    expect(imports.calls).toBe(1);
  });

  it('S3失敗時はtokenを消費せず解析とcredit経路を開始しない', async () => {
    const tokens = new FakeTokenRepository();
    const storage = new FakeUploadStorage();
    storage.loadError = new Error('temporary provider detail');
    const imports = new FakeImportService();
    const service = buildService({ tokens, storage, imports });

    await expect(service.importUploadedImage(userId, {
      uploadToken: 'retryable-upload-token',
      entityType: 'character',
      entityId,
    })).rejects.toThrow('temporary provider detail');

    expect(tokens.inspected).not.toBeNull();
    expect(tokens.consumed).toBeNull();
    expect(imports.calls).toBe(0);
  });

  it('ETag条件copy失敗時はtokenを消費せず解析とcredit経路を開始しない', async () => {
    const tokens = new FakeTokenRepository();
    const storage = new FakeUploadStorage();
    storage.stabilizeError = new Error('source object changed');
    const imports = new FakeImportService();
    const service = buildService({ tokens, storage, imports });

    await expect(service.importUploadedImage(userId, {
      uploadToken: 'retryable-upload-token',
      entityType: 'character',
      entityId,
    })).rejects.toThrow('source object changed');

    expect(storage.stabilizedInput).not.toBeNull();
    expect(tokens.consumed).toBeNull();
    expect(imports.calls).toBe(0);
  });

  it('cross-organization tokenはS3検証前に同じ安全なerrorで拒否する', async () => {
    const storage = new FakeUploadStorage();
    const imports = new FakeImportService();
    const service = buildService({
      storage,
      imports,
      organizations: new FakeOrganizationService(),
    });

    await expect(service.importUploadedImage(userId, {
      uploadToken: 'cross-organization-token',
      entityType: 'character',
    }, organizationId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Upload is invalid or has expired',
    });

    expect(storage.loadInput).toBeNull();
    expect(imports.calls).toBe(0);
  });

  it('scope・entity・MIME・size・magic bytes不一致はconsumeと解析の前に拒否する', async () => {
    const invalidImages: Array<LoadedEntityReferenceUploadImage | null> = [
      null,
      {
        imageData: pngBytes,
        mimeType: 'image/jpeg',
        eTag: '"verified-etag"',
        cdnUrl: 's3://lyra-images/mismatch',
      },
      {
        imageData: Buffer.concat([pngBytes, Buffer.from([0])]),
        mimeType: 'image/png',
        eTag: '"verified-etag"',
        cdnUrl: 's3://lyra-images/mismatch',
      },
      {
        imageData: Buffer.from('not-an-image'),
        mimeType: 'image/png',
        eTag: '"verified-etag"',
        cdnUrl: 's3://lyra-images/mismatch',
      },
    ];

    for (const image of invalidImages) {
      const tokens = new FakeTokenRepository();
      const storage = new FakeUploadStorage();
      storage.image = image;
      const imports = new FakeImportService();
      const service = buildService({ tokens, storage, imports });

      await expect(service.importUploadedImage(userId, {
        uploadToken: 'opaque-upload-token',
        entityType: 'character',
        entityId,
      })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(tokens.consumed).toBeNull();
      expect(imports.calls).toBe(0);
    }

    const wrongEntityService = buildService();
    await expect(wrongEntityService.importUploadedImage(userId, {
      uploadToken: 'opaque-upload-token',
      entityType: 'character',
      entityId: '55555555-5555-4555-8555-555555555555',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

function buildService(overrides: {
  tokens?: FakeTokenRepository;
  storage?: FakeUploadStorage;
  entities?: FakeEntityRepository;
  imports?: FakeImportService;
  organizations?: FakeOrganizationService;
  tokenGenerator?: () => string;
} = {}): EntityReferenceUploadService {
  return new EntityReferenceUploadService({
    uploadTokenRepository: overrides.tokens ?? new FakeTokenRepository(),
    uploadStorage: overrides.storage ?? new FakeUploadStorage(),
    entityReferenceRepository: overrides.entities ?? new FakeEntityRepository(),
    entityReferenceService: overrides.imports ?? new FakeImportService(),
    organizationService: overrides.organizations,
    now: () => createdAt,
    tokenGenerator: overrides.tokenGenerator,
  });
}

function buildToken(): EntityReferenceUploadToken {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    tokenHash: 'a'.repeat(64),
    userId,
    organizationId: null,
    entityId,
    purpose: 'entity_reference_import',
    mimeType: 'image/png',
    sizeBytes: pngBytes.length,
    s3Key: `tmp/${userId}/entities/imports/upload.png`,
    expiresAt: new Date('2026-07-31T00:05:00.000Z'),
    consumedAt: null,
    createdAt,
  };
}

function buildEntityContext(): EntityReferenceContext {
  return {
    entityId,
    workId: '66666666-6666-4666-8666-666666666666',
    userId,
    entityType: 'character',
    name: 'Lyra',
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
