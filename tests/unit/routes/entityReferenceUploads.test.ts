import { describe, expect, it } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import { createApp } from '../../../src/app.js';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import { createEntityReferenceUploadRoutes } from '../../../src/routes/entityReferenceUploads.js';
import type {
  EntityReferenceUploadServicePort,
} from '../../../src/services/entity/EntityReferenceUploadService.js';
import type { OrganizationServicePort } from '../../../src/services/organization/OrganizationService.js';
import type { OrganizationMember } from '../../../src/domain/types/organization.js';
import type { AuthenticatedUser } from '../../../src/domain/types/user.js';
import type { AppEnv } from '../../../src/types/app.js';
import { entityReferenceUploadPresignResponseSchema } from '../../../packages/api-contract/src/mobileApiSchemas.js';

const user: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  supabaseId: 'subject-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};
const entityId = '22222222-2222-4222-8222-222222222222';
const organizationId = '33333333-3333-4333-8333-333333333333';

class FakeEntityReferenceUploadService implements EntityReferenceUploadServicePort {
  public uploadUrl = 'https://uploads.lyra.test/opaque-presigned-url';
  public calls: Array<{
    userId: string;
    input: { mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; sizeBytes: number; entityId: string | null };
    organizationId: string | null;
  }> = [];

  public async createPresignedUpload(
    userId: string,
    input: { mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; sizeBytes: number; entityId?: string | null },
    requestedOrganizationId: string | null = null,
  ): Promise<{
    uploadUrl: string;
    uploadToken: string;
    expiresAt: Date;
    uploadHeaders: Record<string, string>;
  }> {
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
      expiresAt: new Date('2026-07-25T00:05:00.000Z'),
      uploadHeaders: {
        'Content-Type': input.mimeType,
        'x-amz-server-side-encryption': 'AES256',
      },
    };
  }

  public async importUploadedImage(): Promise<never> {
    throw new Error('not used by upload presign route');
  }
}

describe('createEntityReferenceUploadRoutes', () => {
  it('createAppがdirect upload presign APIを/apiへ配線する', async () => {
    const service = new FakeEntityReferenceUploadService();
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

  it('authenticated user に PUT URL と opaque token だけを返す', async () => {
    const service = new FakeEntityReferenceUploadService();
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
    const payload = await response.json();
    expect(entityReferenceUploadPresignResponseSchema.safeParse(payload).success).toBe(true);
    expect(payload).toEqual({
      upload_url: 'https://uploads.lyra.test/opaque-presigned-url',
      upload_token: 'opaque-upload-token',
      expires_at: '2026-07-25T00:05:00.000Z',
      upload_headers: {
        'Content-Type': 'image/png',
        'x-amz-server-side-encryption': 'AES256',
      },
    });
    expect(service.calls).toEqual([
      {
        userId: user.id,
        input: { mimeType: 'image/png', sizeBytes: 8, entityId },
        organizationId: null,
      },
    ]);
  });

  it('organization scope を query から渡し、MIME と size が不正なら service を実行しない', async () => {
    const service = new FakeEntityReferenceUploadService();
    const app = createTestApp(service);

    const valid = await app.request(`/uploads/entity-reference/presign?organization_id=${organizationId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mime_type: 'image/webp', size_bytes: 16 }),
    });
    expect(valid.status).toBe(201);
    expect(service.calls[0]?.organizationId).toBe(organizationId);

    const invalid = await app.request('/uploads/entity-reference/presign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mime_type: 'image/gif', size_bytes: 5 * 1024 * 1024 + 1 }),
    });
    expect(invalid.status).toBe(422);
    expect(service.calls).toHaveLength(1);
  });

  it('rejects a presign response that violates the HTTPS mobile contract', async () => {
    const service = new FakeEntityReferenceUploadService();
    service.uploadUrl = 'http://uploads.lyra.test/unsafe-presigned-url';
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
        return {
          id: 'member-1',
          organizationId,
          userId: user.id,
          email: user.email,
          displayName: null,
          role: 'editor',
          status: 'active',
          invitedByUserId: null,
          joinedAt: new Date('2026-07-25T00:00:00.000Z'),
          createdAt: new Date('2026-07-25T00:00:00.000Z'),
          updatedAt: new Date('2026-07-25T00:00:00.000Z'),
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
