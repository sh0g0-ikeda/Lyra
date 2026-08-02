import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../../src/app.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type {
  AiContentReportReceipt,
  AiContentReportServicePort,
  SubmitAiContentReportInput,
} from '../../../src/services/moderation/AiContentReportService.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';
import type { RateLimitResult, RateLimitStore } from '../../../src/middleware/rateLimit.js';

const jwtSecret = 'unit-test-secret';
const user: AuthenticatedUser = {
  id: 'opaque-user-id',
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

class RecordingAiContentReportService implements AiContentReportServicePort {
  public readonly inputs: SubmitAiContentReportInput[] = [];

  public async submit(input: SubmitAiContentReportInput): Promise<AiContentReportReceipt> {
    this.inputs.push(input);
    return { reportId: '6d4aeb9d-5271-4b22-8075-255f212f3b30', status: 'received' };
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

describe('AI content report routes', () => {
  it('Authorizationヘッダーがない場合はAI報告を受け付けない', async () => {
    const service = new RecordingAiContentReportService();
    const app = createTestApp(service);

    const response = await app.request('/api/ai-content-reports', {
      method: 'POST',
      body: JSON.stringify(validBody()),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(401);
    expect(service.inputs).toEqual([]);
  });

  it('未知フィールド、固定語彙以外、または不正なcontent_idを含む報告を拒否する', async () => {
    const service = new RecordingAiContentReportService();
    const app = createTestApp(service);
    const token = await createToken();

    const unknownFieldResponse = await app.request('/api/ai-content-reports', {
      method: 'POST',
      body: JSON.stringify({ ...validBody(), prompt: 'must never be accepted' }),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const invalidIdResponse = await app.request('/api/ai-content-reports', {
      method: 'POST',
      body: JSON.stringify({ ...validBody(), content_id: 'not-a-uuid' }),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const invalidKindResponse = await app.request('/api/ai-content-reports', {
      method: 'POST',
      body: JSON.stringify({ ...validBody(), content_kind: 'generated_text' }),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const invalidReasonResponse = await app.request('/api/ai-content-reports', {
      method: 'POST',
      body: JSON.stringify({ ...validBody(), reason: 'other' }),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    expect(unknownFieldResponse.status).toBe(422);
    expect(invalidIdResponse.status).toBe(422);
    expect(invalidKindResponse.status).toBe(422);
    expect(invalidReasonResponse.status).toBe(422);
    expect(service.inputs).toEqual([]);
  });

  it('有効なAI報告には202の受付スキーマを返し内容を参照しない', async () => {
    const service = new RecordingAiContentReportService();
    const app = createTestApp(service);
    const token = await createToken();

    const response = await app.request('/api/ai-content-reports', {
      method: 'POST',
      body: JSON.stringify(validBody()),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(202);
    const payload: unknown = await response.json();
    expect(z.object({ report_id: z.uuid(), status: z.literal('received') }).strict().safeParse(payload).success).toBe(true);
    expect(service.inputs).toEqual([
      expect.objectContaining({
        userId: user.id,
        contentKind: 'generated_image',
        contentId: 'd2719e3d-f6b2-4501-9919-d64076d6c0fe',
        reason: 'unsafe_or_inappropriate',
      }),
    ]);
  });

  it('認証済みでもrate limit超過時は報告を受け付けない', async () => {
    const service = new RecordingAiContentReportService();
    const app = createTestApp(service, new BlockingRateLimitStore());
    const token = await createToken();

    const response = await app.request('/api/ai-content-reports', {
      method: 'POST',
      body: JSON.stringify(validBody()),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(429);
    expect(service.inputs).toEqual([]);
  });
});

function createTestApp(
  service: AiContentReportServicePort,
  rateLimitStore?: RateLimitStore,
): ReturnType<typeof createApp> {
  return createApp({
    aiContentReportService: service,
    rateLimitStore,
    userProvisioningService: new FakeUserProvisioningService(),
    jwtSecret,
  });
}

function validBody(): Record<string, string> {
  return {
    content_kind: 'generated_image',
    content_id: 'd2719e3d-f6b2-4501-9919-d64076d6c0fe',
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
