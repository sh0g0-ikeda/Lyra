import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type {
  PanelFrame,
  PanelFrameTemplateApplication,
  PanelFrameTemplateId,
} from '../../../src/domain/types/panelFrame.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type { ConsumeCreditsParams, CreditServicePort } from '../../../src/services/credit/CreditService.js';
import type {
  PanelFrameServicePort,
  UpsertPanelFrameRequest,
} from '../../../src/services/page/PanelFrameService.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';

const jwtSecret = 'unit-test-secret';
const user: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: 'supabase-user-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};
const pageId = '11111111-1111-4111-8111-111111111111';
const panelId = '22222222-2222-4222-8222-222222222222';
const frameId = '33333333-3333-4333-8333-333333333333';

class FakeUserProvisioningService implements UserProvisioningPort {
  public async provisionFromSupabaseClaims(claims: SupabaseJwtClaims): Promise<ProvisionedUser> {
    return {
      user: {
        ...user,
        supabaseId: claims.sub,
        email: claims.email,
      },
      isNewUser: false,
    };
  }
}

class FakeCreditService implements CreditServicePort {
  public async getBalance(_userId: string): Promise<CreditBalanceSnapshot> {
    return { monthlyCredits: 0, purchasedCredits: 0, totalCredits: 0, monthlyExpiresAt: null };
  }

  public async grantSignupBonus(_userId: string): Promise<CreditBalanceSnapshot> {
    return this.getBalance(_userId);
  }

  public async consumeCredits(_params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance(_params.userId);
  }
}

class FakePanelFrameService implements PanelFrameServicePort {
  public lastSaveRequest: UpsertPanelFrameRequest[] | null = null;
  public lastTemplateId: PanelFrameTemplateId | null = null;

  public async listPageFrames(_userId: string, requestedPageId: string): Promise<PanelFrame[]> {
    return [buildFrame({ pageId: requestedPageId })];
  }

  public async replacePageFrames(
    _userId: string,
    requestedPageId: string,
    frames: UpsertPanelFrameRequest[],
  ): Promise<PanelFrame[]> {
    this.lastSaveRequest = frames;
    return frames.map((frame, index) =>
      buildFrame({
        id: frame.id ?? frameId,
        pageId: requestedPageId,
        panelId: frame.panelId ?? null,
        vertices: frame.vertices,
        borderStyle: frame.borderStyle,
        borderWidth: frame.borderWidth,
        borderColor: frame.borderColor,
        zIndex: frame.zIndex,
        readingOrder: frame.readingOrder ?? index + 1,
      }),
    );
  }

  public async applyTemplate(
    _userId: string,
    requestedPageId: string,
    templateId: PanelFrameTemplateId,
  ): Promise<PanelFrameTemplateApplication> {
    this.lastTemplateId = templateId;
    const frames = [
      buildFrame({ pageId: requestedPageId, panelId: null, readingOrder: 1 }),
      buildFrame({ pageId: requestedPageId, panelId: null, readingOrder: 2 }),
      buildFrame({ pageId: requestedPageId, panelId: null, readingOrder: 3 }),
      buildFrame({ pageId: requestedPageId, panelId: null, readingOrder: 4 }),
    ];

    return {
      templateId,
      panelCount: frames.length,
      frames,
    };
  }
}

describe('panel frame routes', () => {
  it('JWTが正しい場合にページのPanelFrame一覧を取得できる', async () => {
    const app = createTestApp(new FakePanelFrameService());
    const token = await createToken();

    const response = await app.request(`/api/pages/${pageId}/frames`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      frames: [
        {
          id: frameId,
          page_id: pageId,
          panel_id: panelId,
          border_style: 'solid',
          border_width: 3,
          border_color: '#000000',
          z_index: 1,
          reading_order: 1,
        },
      ],
    });
  });

  it('JWTが正しい場合にページのPanelFrameを一括保存できる', async () => {
    const panelFrameService = new FakePanelFrameService();
    const app = createTestApp(panelFrameService);
    const token = await createToken();

    const response = await app.request(`/api/pages/${pageId}/frames`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        frames: [
          {
            panel_id: panelId,
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 0.5 },
              { x: 0, y: 0.5 },
            ],
            reading_order: 1,
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(panelFrameService.lastSaveRequest?.[0]).toMatchObject({
      panelId,
      borderStyle: 'solid',
      borderWidth: 3,
      borderColor: '#000000',
      zIndex: 1,
      readingOrder: 1,
    });
  });

  it('頂点が4点ではない場合にVALIDATION_ERRORになる', async () => {
    const app = createTestApp(new FakePanelFrameService());
    const token = await createToken();

    const response = await app.request(`/api/pages/${pageId}/frames`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        frames: [
          {
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 0.5 },
            ],
            reading_order: 1,
          },
        ],
      }),
    });

    expect(response.status).toBe(422);
  });

  it('JWTが正しい場合にテンプレートをページへ適用できる', async () => {
    const panelFrameService = new FakePanelFrameService();
    const app = createTestApp(panelFrameService);
    const token = await createToken();

    const response = await app.request(`/api/pages/${pageId}/frames/apply-template`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template_id: 'standard_4',
      }),
    });

    expect(response.status).toBe(200);
    expect(panelFrameService.lastTemplateId).toBe('standard_4');
    const body = (await response.json()) as {
      template_id: string;
      panel_count: number;
      frames: Array<Record<string, unknown>>;
    };
    expect(body).toMatchObject({
      template_id: 'standard_4',
      panel_count: 4,
    });
    expect(body.frames).toHaveLength(4);
    expect(body.frames[0]).toMatchObject({
      page_id: pageId,
      panel_id: null,
      reading_order: 1,
    });
  });

  it('未定義テンプレートの場合にVALIDATION_ERRORになる', async () => {
    const app = createTestApp(new FakePanelFrameService());
    const token = await createToken();

    const response = await app.request(`/api/pages/${pageId}/frames/apply-template`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template_id: 'unknown_template',
      }),
    });

    expect(response.status).toBe(422);
  });

  it('Authorizationヘッダーがない場合に401になる', async () => {
    const app = createTestApp(new FakePanelFrameService());

    const response = await app.request(`/api/pages/${pageId}/frames`);

    expect(response.status).toBe(401);
  });
});

function createTestApp(panelFrameService: PanelFrameServicePort): ReturnType<typeof createApp> {
  return createApp({
    creditService: new FakeCreditService(),
    panelFrameService,
    userProvisioningService: new FakeUserProvisioningService(),
    jwtSecret,
  });
}

function buildFrame(overrides: Partial<PanelFrame> = {}): PanelFrame {
  return {
    id: frameId,
    pageId,
    panelId,
    vertices: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0.5 },
      { x: 0, y: 0.5 },
    ],
    borderStyle: 'solid',
    borderWidth: 3,
    borderColor: '#000000',
    zIndex: 1,
    readingOrder: 1,
    ...overrides,
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
