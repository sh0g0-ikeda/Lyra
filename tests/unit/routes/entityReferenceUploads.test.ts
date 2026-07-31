import type { MiddlewareHandler } from 'hono';
import { describe, expect, it } from 'vitest';
import { entityReferenceUploadPresignResponseSchema } from '../../../packages/api-contract/src/mobileApiSchemas.js';
import { createApp } from '../../../src/app.js';
import type { OrganizationMember } from '../../../src/domain/types/organization.js';
import type { AuthenticatedUser } from '../../../src/domain/types/user.js';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import {
  createEntityReferenceUploadRoutes,
} from '../../../src/routes/entityReferenceUploads.js';
import type {
  EntityReferenceUploadServicePort,
} from '../../../src/services/entity/EntityReferenceUploadService.js';
import type { OrganizationServicePort } from '../../../src/services/organization/OrganizationService.js';
import type { AppEnv } from '../../../src/types/app.js';

const user: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  supabaseId: 'subject-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};
const entityId = '22222222-2222-4222-8222-222222222222';
const organizationId = '33333333-3333-4333-8333-333333333333';

class FakeUploadService implements EntityReferenceUploadServicePort {
  public uploadUrl = 'https://uploads.lyra.test/opaque-presigned-url';
  public calls: Array<{
    userId: string;
    input: {
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
      sizeBytes: number;
      entityId: string | null;
    };
    organizationId: string | null;
  }> = [];

  public async createPresignedUpload(
    userId: string,
    input: {
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
      sizeBytes: number;
      entityId?: string | null;
    },
    requestedOrganizationId: string | null = null,
  ) {
    this.calls.push({
      userId,
      input: {
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        entityId: input.entityId ?? null,
      },
      organizationId: requestedOrganizationId,
    });
    return {
      uploadUrl: this.uploadUrl,
      uploadToken: 'opaque-upload-token',
      expiresAt: new Date('2026-07-31T00:05:00.000Z'),
      uploadHeaders: {
        'Content-Type': input.mimeType,
        'x-amz-server-side-encryption': 'AES256' as const,
      },
    };
  }

  public async importUploadedImage(): Promise<never> {
    throw new Error('not used');
  }
}

describe('createEntityReferenceUploadRoutes', () => {
  it('明示的に有効化されていない既定構成ではpresign APIを公開しない', async () => {
    const app = createApp({ enableDevAuthBypass: true });

    const response = await app.request('/api/uploads/entity-reference/presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mime_type: 'image/png', size_bytes: 8 }),
    });

    expect(response.status).toBe(404);
  });

  it('createAppがpresign APIを/api配下へ配線する', async () => {
    const service = new FakeUploadService();
    const app = createApp({
      enableDevAuthBypass: true,
      entityReferenceUploadService: service,
    });

    const response = await app.request('/api/uploads/entity-reference/presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mime_type: 'image/png',
        size_bytes: 8,
        entity_id: entityId,
      }),
    });

    expect(response.status).toBe(201);
    expect(service.calls).toHaveLength(1);
  });

  it('認証済み利用者へHTTPS URLとopaque tokenだけをno-storeで返す', async () => {
    const service = new FakeUploadService();
    const app = createTestApp(service);

    const response = await app.request('/uploads/entity-reference/presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mime_type: 'image/png',
        size_bytes: 8,
        entity_id: entityId,
      }),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const payload: unknown = await response.json();
    expect(entityReferenceUploadPresignResponseSchema.safeParse(payload).success).toBe(true);
    expect(payload).toEqual({
      upload_url: 'https://uploads.lyra.test/opaque-presigned-url',
      upload_token: 'opaque-upload-token',
      expires_at: '2026-07-31T00:05:00.000Z',
      upload_headers: {
        'Content-Type': 'image/png',
        'x-amz-server-side-encryption': 'AES256',
      },
    });
  });

  it('organization scopeを渡し不正MIME・size・余分fieldはservice前に422にする', async () => {
    const service = new FakeUploadService();
    const app = createTestApp(service);

    const valid = await app.request(
      `/uploads/entity-reference/presign?organization_id=${organizationId}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mime_type: 'image/webp', size_bytes: 16 }),
      },
    );
    expect(valid.status).toBe(201);
    expect(service.calls[0]?.organizationId).toBe(organizationId);

    for (const body of [
      { mime_type: 'image/gif', size_bytes: 16 },
      { mime_type: 'image/png', size_bytes: 5 * 1024 * 1024 + 1 },
      { mime_type: 'image/png', size_bytes: 8, s3_key: 'client-controlled' },
    ]) {
      const invalid = await app.request('/uploads/entity-reference/presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(invalid.status).toBe(422);
    }
    expect(service.calls).toHaveLength(1);
  });

  it('HTTPS契約に違反するpresign responseは500にする', async () => {
    const service = new FakeUploadService();
    service.uploadUrl = 'http://uploads.lyra.test/unsafe';
    const app = createTestApp(service);

    const response = await app.request('/uploads/entity-reference/presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mime_type: 'image/png', size_bytes: 8 }),
    });

    expect(response.status).toBe(500);
  });
});

function createTestApp(service: EntityReferenceUploadServicePort) {
  const app = createEntityReferenceUploadRoutes({
    authMiddleware: authenticatedAs(user),
    rateLimitMiddleware: passThrough(),
    entityReferenceUploadService: service,
    organizationService: {
      async requireMembership(): Promise<OrganizationMember> {
        const now = new Date('2026-07-31T00:00:00.000Z');
        return {
          id: 'member-1',
          organizationId,
          userId: user.id,
          email: user.email,
          displayName: null,
          role: 'editor',
          status: 'active',
          invitedByUserId: null,
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        };
      },
    } as unknown as OrganizationServicePort,
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
