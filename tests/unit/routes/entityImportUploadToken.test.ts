import { describe, expect, it } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import { createEntityRoutes } from '../../../src/routes/entities.js';
import type { EntityServicePort } from '../../../src/services/entity/EntityService.js';
import type { EntityReferenceServicePort } from '../../../src/services/entity/EntityReferenceService.js';
import type { EntityReferenceImageExportServicePort } from '../../../src/services/entity/EntityReferenceImageExportService.js';
import type { EntityReferenceUploadServicePort } from '../../../src/services/entity/EntityReferenceUploadService.js';
import type { AuthenticatedUser } from '../../../src/domain/types/user.js';
import type { AppEnv } from '../../../src/types/app.js';

const user: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  supabaseId: 'subject-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};
const entityId = '22222222-2222-4222-8222-222222222222';

class FakeUploadService implements Pick<EntityReferenceUploadServicePort, 'importUploadedImage'> {
  public input: {
    userId: string;
    uploadToken: string;
    entityType: 'character' | 'nonhuman' | 'object';
    entityId: string | null;
    organizationId: string | null;
  } | null = null;

  public async importUploadedImage(
    userId: string,
    input: { uploadToken: string; entityType: 'character' | 'nonhuman' | 'object'; entityId?: string | null },
    organizationId: string | null = null,
  ): Promise<{
    suggestedFields: Record<string, unknown>;
    promptSupplement: string;
    tmpImageS3Key: string;
    tmpImageCdnUrl: string;
    entityId: string | null;
  }> {
    this.input = {
      userId,
      uploadToken: input.uploadToken,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      organizationId,
    };
    return {
      suggestedFields: { art_style: 'anime' },
      promptSupplement: 'reference from mobile upload',
      tmpImageS3Key: 'tmp/user-1/entities/imports/server-generated.png',
      tmpImageCdnUrl: 's3://lyra-images/tmp/user-1/entities/imports/server-generated.png',
      entityId,
    };
  }
}

describe('entity import upload token route', () => {
  it('upload_token form は raw S3 key を受け取らず既存 import response に変換する', async () => {
    const uploads = new FakeUploadService();
    const app = createTestApp(uploads);

    const response = await app.request('/entities/import-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        upload_token: 'opaque-upload-token',
        entity_type: 'character',
        entity_id: entityId,
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as Record<string, unknown>;
    expect(payload).toMatchObject({
      suggested_fields: { art_style: 'anime' },
      prompt_supplement: 'reference from mobile upload',
      tmp_image_token: expect.any(String),
    });
    expect(payload).not.toHaveProperty('tmp_image_s3_key');
    expect(uploads.input).toEqual({
      userId: user.id,
      uploadToken: 'opaque-upload-token',
      entityType: 'character',
      entityId,
      organizationId: null,
    });
  });

  it('base64 と upload_token の混在、token なしの token form は validation error にする', async () => {
    const uploads = new FakeUploadService();
    const app = createTestApp(uploads);

    const mixed = await app.request('/entities/import-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        upload_token: 'opaque-upload-token',
        image_base64: 'data:image/png;base64,iVBORw0KGgo=',
        entity_type: 'character',
      }),
    });
    expect(mixed.status).toBe(422);
    expect(uploads.input).toBeNull();
  });
});

function createTestApp(uploads: FakeUploadService) {
  const app = createEntityRoutes({
    authMiddleware: authenticatedAs(user),
    rateLimitMiddleware: passThrough(),
    entityService: {} as EntityServicePort,
    entityReferenceService: {} as EntityReferenceServicePort,
    entityReferenceImageExportService: {} as EntityReferenceImageExportServicePort,
    entityReferenceUploadService: uploads as unknown as EntityReferenceUploadServicePort,
  });
  app.onError(errorHandler);
  return app;
}

function authenticatedAs(authenticatedUser: AuthenticatedUser): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('user', authenticatedUser);
    await next();
  };
}

function passThrough(): MiddlewareHandler<AppEnv> {
  return async (_c, next) => {
    await next();
  };
}
