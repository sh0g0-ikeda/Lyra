import type { MiddlewareHandler } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  episodeExportAcceptedResponseSchema,
  episodeExportStatusResponseSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';
import { createApp } from '../../../src/app.js';
import type { AuthenticatedUser } from '../../../src/domain/types/user.js';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import { createEpisodeExportRoutes } from '../../../src/routes/episodeExports.js';
import type {
  CreateEpisodeExportRequest,
  EpisodeExportServicePort,
} from '../../../src/services/export/EpisodeExportService.js';
import type { OrganizationServicePort } from '../../../src/services/organization/OrganizationService.js';
import type { AppEnv } from '../../../src/types/app.js';

const user: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  supabaseId: 'subject-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};
const organizationId = '22222222-2222-4222-8222-222222222222';
const episodeId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const pageId = '55555555-5555-4555-8555-555555555555';

describe('createEpisodeExportRoutes', () => {
  it('既定構成ではexport APIを公開しない', async () => {
    const app = createApp({ enableDevAuthBypass: true });

    const response = await app.request(`/api/episodes/${episodeId}/exports`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'request-123',
      },
      body: JSON.stringify({ format: 'pdf', page_ids: [pageId] }),
    });

    expect(response.status).toBe(404);
  });

  it('注入されたserviceだけを/apiへ配線する', async () => {
    const service = new FakeService();
    const app = createApp({
      enableDevAuthBypass: true,
      episodeExportService: service,
    });

    const response = await app.request(`/api/episodes/${episodeId}/exports`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'request-123',
      },
      body: JSON.stringify({ format: 'pdf', page_ids: [pageId] }),
    });

    expect(response.status).toBe(202);
  });

  it('strict bodyとidempotency keyをserviceへ渡してno-storeの202を返す', async () => {
    const service = new FakeService();
    const app = createTestApp(service);

    const response = await app.request(`/episodes/${episodeId}/exports`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'request-123',
      },
      body: JSON.stringify({
        format: 'zip',
        page_ids: [pageId],
        filename: 'episode.zip',
      }),
    });

    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const payload: unknown = await response.json();
    expect(episodeExportAcceptedResponseSchema.safeParse(payload).success).toBe(true);
    expect(service.createCalls).toEqual([{
      userId: user.id,
      episodeId,
      organizationId: null,
      input: {
        format: 'zip',
        pageIds: [pageId],
        filename: 'episode.zip',
        idempotencyKey: 'request-123',
      },
    }]);
  });

  it('短いheader・重複page・余分field・不正UUIDをservice前に422へする', async () => {
    const service = new FakeService();
    const app = createTestApp(service);
    const cases = [
      {
        path: `/episodes/${episodeId}/exports`,
        header: 'short',
        body: { format: 'pdf', page_ids: [pageId] },
      },
      {
        path: `/episodes/${episodeId}/exports`,
        header: 'request-123',
        body: { format: 'pdf', page_ids: [pageId, pageId] },
      },
      {
        path: `/episodes/${episodeId}/exports`,
        header: 'request-123',
        body: { format: 'pdf', page_ids: [pageId], s3_key: 'unsafe' },
      },
      {
        path: '/episodes/not-a-uuid/exports',
        header: 'request-123',
        body: { format: 'pdf', page_ids: [pageId] },
      },
    ];

    for (const testCase of cases) {
      const response = await app.request(testCase.path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': testCase.header,
        },
        body: JSON.stringify(testCase.body),
      });
      expect(response.status).toBe(422);
    }
    expect(service.createCalls).toHaveLength(0);
  });

  it('statusはorganization export認可後にstrict safe payloadを返す', async () => {
    const service = new FakeService();
    const membershipCalls: string[] = [];
    const app = createTestApp(service, {
      async requireMembership(
        _requestedOrganizationId: string,
        _userId: string,
        capability: string,
      ) {
        membershipCalls.push(capability);
        return {};
      },
    } as unknown as OrganizationServicePort);

    const response = await app.request(
      `/exports/${jobId}?organization_id=${organizationId}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const payload: unknown = await response.json();
    expect(episodeExportStatusResponseSchema.safeParse(payload).success).toBe(true);
    expect(payload).not.toHaveProperty('artifact_s3_key');
    expect(membershipCalls).toEqual(['export']);
  });

  it('downloadは認証scopeを再確認しHTTPSへno-store redirectする', async () => {
    const service = new FakeService();
    const app = createTestApp(service);

    const response = await app.request(`/exports/${jobId}/download`, {
      redirect: 'manual',
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://downloads.lyra.test/signed');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(service.downloadCalls).toEqual([{
      userId: user.id,
      jobId,
      organizationId: null,
    }]);
  });
});

class FakeService implements EpisodeExportServicePort {
  public createCalls: Array<{
    userId: string;
    episodeId: string;
    input: CreateEpisodeExportRequest;
    organizationId: string | null;
  }> = [];
  public downloadCalls: Array<{
    userId: string;
    jobId: string;
    organizationId: string | null;
  }> = [];

  public async createExport(
    userId: string,
    requestedEpisodeId: string,
    input: CreateEpisodeExportRequest,
    requestedOrganizationId: string | null,
  ) {
    this.createCalls.push({
      userId,
      episodeId: requestedEpisodeId,
      input,
      organizationId: requestedOrganizationId,
    });
    return { jobId, status: 'queued' as const };
  }

  public async getExport() {
    return {
      jobId,
      status: 'completed' as const,
      progressStage: 'completed',
      progressPercent: 100,
      error: null,
      createdAt: new Date('2026-07-31T00:00:00.000Z'),
      startedAt: new Date('2026-07-31T00:00:10.000Z'),
      completedAt: new Date('2026-07-31T00:00:20.000Z'),
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      downloadReady: true,
    };
  }

  public async createDownload(
    userId: string,
    requestedJobId: string,
    requestedOrganizationId: string | null,
  ) {
    this.downloadCalls.push({
      userId,
      jobId: requestedJobId,
      organizationId: requestedOrganizationId,
    });
    return {
      url: 'https://downloads.lyra.test/signed',
      expiresAt: new Date('2026-07-31T00:05:00.000Z'),
    };
  }
}

function createTestApp(
  service: EpisodeExportServicePort,
  organizationService?: OrganizationServicePort,
) {
  const app = createEpisodeExportRoutes({
    authMiddleware: authenticatedAs(user),
    rateLimitMiddleware: passThrough(),
    episodeExportService: service,
    organizationService,
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
