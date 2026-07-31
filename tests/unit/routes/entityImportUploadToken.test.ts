import type { MiddlewareHandler } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../../src/domain/types/user.js';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import { createEntityRoutes } from '../../../src/routes/entities.js';
import type { EntityServicePort } from '../../../src/services/entity/EntityService.js';
import type {
  EntityReferenceImageExportServicePort,
} from '../../../src/services/entity/EntityReferenceImageExportService.js';
import type {
  EntityReferenceServicePort,
} from '../../../src/services/entity/EntityReferenceService.js';
import type {
  EntityReferenceUploadServicePort,
} from '../../../src/services/entity/EntityReferenceUploadService.js';
import type { AppEnv } from '../../../src/types/app.js';

const user: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  supabaseId: 'subject-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};
const entityId = '22222222-2222-4222-8222-222222222222';
const pngDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

class FakeUploadService implements Pick<EntityReferenceUploadServicePort, 'importUploadedImage'> {
  public input: {
    userId: string;
    uploadToken: string;
    entityType: 'character' | 'nonhuman' | 'object';
    entityId: string | undefined;
    organizationId: string | null;
  } | null = null;

  public async importUploadedImage(
    userId: string,
    input: {
      uploadToken: string;
      entityType: 'character' | 'nonhuman' | 'object';
      entityId?: string | null;
    },
    organizationId: string | null = null,
  ) {
    this.input = {
      userId,
      uploadToken: input.uploadToken,
      entityType: input.entityType,
      entityId: input.entityId ?? undefined,
      organizationId,
    };
    return {
      suggestedFields: { name: 'Lyra' },
      promptSupplement: 'reference from mobile upload',
      tmpImageS3Key: `tmp/${user.id}/entities/imports/server-generated.png`,
      tmpImageCdnUrl: `s3://lyra-images/tmp/${user.id}/entities/imports/server-generated.png`,
      entityId,
    };
  }
}

class FakeReferenceService implements Pick<EntityReferenceServicePort, 'importImage'> {
  public base64Calls = 0;

  public async importImage() {
    this.base64Calls += 1;
    return {
      suggestedFields: { name: 'Existing path' },
      promptSupplement: 'existing base64',
      tmpImageS3Key: `tmp/${user.id}/entities/imports/base64.png`,
      tmpImageCdnUrl: `s3://lyra-images/tmp/${user.id}/entities/imports/base64.png`,
    };
  }
}

describe('entity import upload token route', () => {
  it('upload_token formをraw S3 keyなしで既存responseへ変換する', async () => {
    const uploads = new FakeUploadService();
    const references = new FakeReferenceService();
    const app = createTestApp(uploads, references);

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
      suggested_fields: { name: 'Lyra' },
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
    expect(references.base64Calls).toBe(0);
  });

  it('entity_id省略時はtoken側bindingを利用できるようundefinedで渡す', async () => {
    const uploads = new FakeUploadService();
    const app = createTestApp(uploads, new FakeReferenceService());

    const response = await app.request('/entities/import-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        upload_token: 'opaque-upload-token',
        entity_type: 'character',
      }),
    });

    expect(response.status).toBe(200);
    expect(uploads.input?.entityId).toBeUndefined();
  });

  it('base64 formは従来のservice経路とresponseを維持する', async () => {
    const uploads = new FakeUploadService();
    const references = new FakeReferenceService();
    const app = createTestApp(uploads, references);

    const response = await app.request('/entities/import-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        image_base64: pngDataUrl,
        entity_type: 'character',
      }),
    });

    expect(response.status).toBe(200);
    expect(references.base64Calls).toBe(1);
    expect(uploads.input).toBeNull();
  });

  it('base64とupload_tokenの混在およびraw S3 keyを422にする', async () => {
    const uploads = new FakeUploadService();
    const app = createTestApp(uploads, new FakeReferenceService());

    for (const body of [
      {
        upload_token: 'opaque-upload-token',
        image_base64: pngDataUrl,
        entity_type: 'character',
      },
      {
        upload_token: 'opaque-upload-token',
        entity_type: 'character',
        s3_key: `tmp/${user.id}/entities/imports/client-controlled.png`,
      },
    ]) {
      const response = await app.request('/entities/import-image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(422);
    }
    expect(uploads.input).toBeNull();
  });
});

function createTestApp(
  uploads: FakeUploadService,
  references: FakeReferenceService,
) {
  const app = createEntityRoutes({
    authMiddleware: authenticatedAs(user),
    rateLimitMiddleware: passThrough(),
    entityService: {} as EntityServicePort,
    entityReferenceService: references as unknown as EntityReferenceServicePort,
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
