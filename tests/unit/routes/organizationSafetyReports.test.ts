import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../../src/app.js';
import { NotFoundError } from '../../../src/domain/errors/index.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type { OrganizationCapability } from '../../../src/domain/types/organization.js';
import type { OrganizationServicePort } from '../../../src/services/organization/OrganizationService.js';
import type {
  OrganizationSafetyReportReceipt,
  OrganizationSafetyReportServicePort,
  SubmitOrganizationSafetyReportInput,
} from '../../../src/services/moderation/OrganizationSafetyReportService.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';
import type { RateLimitResult, RateLimitStore } from '../../../src/middleware/rateLimit.js';

const jwtSecret = 'unit-test-secret';
const user: AuthenticatedUser = {
  id: 'opaque-reporter-id',
  supabaseId: 'supabase-user-id',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};

class FakeUserProvisioningService implements UserProvisioningPort {
  public async provisionFromSupabaseClaims(claims: SupabaseJwtClaims): Promise<ProvisionedUser> {
    return { user: { ...user, supabaseId: claims.sub, email: claims.email }, isNewUser: false };
  }
}

class RecordingOrganizationSafetyReportService implements OrganizationSafetyReportServicePort {
  public readonly inputs: SubmitOrganizationSafetyReportInput[] = [];

  public async submit(input: SubmitOrganizationSafetyReportInput): Promise<OrganizationSafetyReportReceipt> {
    this.inputs.push(input);
    return { reportId: '8980e697-fc5e-4612-ac0d-9c2619f9cd51', status: 'received' };
  }
}

class MembershipCheckingOrganizationService {
  public readonly membershipChecks: Array<{
    organizationId: string;
    userId: string;
    capability: OrganizationCapability | undefined;
  }> = [];
  public rejectMembership = false;

  public async requireMembership(
    organizationId: string,
    userId: string,
    capability?: OrganizationCapability,
  ): Promise<never | { organizationId: string; userId: string }> {
    this.membershipChecks.push({ organizationId, userId, capability });
    if (this.rejectMembership) {
      throw new NotFoundError('Organization not found');
    }
    return { organizationId, userId };
  }
}

class BlockingRateLimitStore implements RateLimitStore {
  public async consume(): Promise<RateLimitResult> {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
      resetAt: new Date('2026-08-02T00:01:00.000Z'),
    };
  }
}

describe('organization safety report routes', () => {
  it('Authorizationヘッダーがない場合は組織安全報告を受け付けない', async () => {
    const reportService = new RecordingOrganizationSafetyReportService();
    const organizationService = new MembershipCheckingOrganizationService();
    const app = createTestApp(reportService, organizationService);

    const response = await app.request('/api/organization-safety-reports', {
      method: 'POST',
      body: JSON.stringify(validBody()),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(401);
    expect(organizationService.membershipChecks).toEqual([]);
    expect(reportService.inputs).toEqual([]);
  });

  it('未知フィールドまたは固定語彙以外の組織安全報告を拒否する', async () => {
    const reportService = new RecordingOrganizationSafetyReportService();
    const organizationService = new MembershipCheckingOrganizationService();
    const app = createTestApp(reportService, organizationService);
    const token = await createToken();

    const unknownFieldResponse = await app.request('/api/organization-safety-reports', {
      method: 'POST',
      body: JSON.stringify({ ...validBody(), target_user_id: 'must-never-be-accepted' }),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const invalidOrganizationResponse = await app.request('/api/organization-safety-reports', {
      method: 'POST',
      body: JSON.stringify({ ...validBody(), organization_id: 'not-a-uuid' }),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const invalidKindResponse = await app.request('/api/organization-safety-reports', {
      method: 'POST',
      body: JSON.stringify({ ...validBody(), target_kind: 'user' }),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    expect(unknownFieldResponse.status).toBe(422);
    expect(invalidOrganizationResponse.status).toBe(422);
    expect(invalidKindResponse.status).toBe(422);
    expect(organizationService.membershipChecks).toEqual([]);
    expect(reportService.inputs).toEqual([]);
  });

  it('組織メンバーではない場合は受付前に拒否する', async () => {
    const reportService = new RecordingOrganizationSafetyReportService();
    const organizationService = new MembershipCheckingOrganizationService();
    organizationService.rejectMembership = true;
    const app = createTestApp(reportService, organizationService);
    const token = await createToken();

    const response = await app.request('/api/organization-safety-reports', {
      method: 'POST',
      body: JSON.stringify(validBody()),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(404);
    expect(reportService.inputs).toEqual([]);
  });

  it('閲覧権限のある組織安全報告には202の受付スキーマを返す', async () => {
    const reportService = new RecordingOrganizationSafetyReportService();
    const organizationService = new MembershipCheckingOrganizationService();
    const app = createTestApp(reportService, organizationService);
    const token = await createToken();

    const response = await app.request('/api/organization-safety-reports', {
      method: 'POST',
      body: JSON.stringify(validBody()),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(202);
    const payload: unknown = await response.json();
    expect(z.object({ report_id: z.uuid(), status: z.literal('received') }).strict().safeParse(payload).success).toBe(true);
    expect(organizationService.membershipChecks).toEqual([
      {
        organizationId: 'fc6eaf92-d02d-4d18-ae12-68e16ecf8e03',
        userId: user.id,
        capability: 'view_work',
      },
    ]);
    expect(reportService.inputs).toEqual([
      expect.objectContaining({
        organizationId: 'fc6eaf92-d02d-4d18-ae12-68e16ecf8e03',
        reporterUserId: user.id,
        targetKind: 'workspace_content',
        reason: 'unsafe_or_inappropriate',
      }),
    ]);
  });

  it('認証済み組織メンバーでもrate limit超過時は報告を受け付けない', async () => {
    const reportService = new RecordingOrganizationSafetyReportService();
    const organizationService = new MembershipCheckingOrganizationService();
    const app = createTestApp(
      reportService,
      organizationService,
      new BlockingRateLimitStore(),
    );
    const token = await createToken();

    const response = await app.request('/api/organization-safety-reports', {
      method: 'POST',
      body: JSON.stringify(validBody()),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(429);
    expect(organizationService.membershipChecks).toEqual([]);
    expect(reportService.inputs).toEqual([]);
  });
});

function createTestApp(
  organizationSafetyReportService: OrganizationSafetyReportServicePort,
  organizationService: MembershipCheckingOrganizationService,
  rateLimitStore?: RateLimitStore,
): ReturnType<typeof createApp> {
  return createApp({
    rateLimitStore,
    organizationSafetyReportService,
    organizationService: organizationService as unknown as OrganizationServicePort,
    userProvisioningService: new FakeUserProvisioningService(),
    jwtSecret,
  });
}

function validBody(): Record<string, string> {
  return {
    organization_id: 'fc6eaf92-d02d-4d18-ae12-68e16ecf8e03',
    target_kind: 'workspace_content',
    reason: 'unsafe_or_inappropriate',
  };
}

async function createToken(): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.supabaseId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(jwtSecret));
}
