import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { PageLayoutTemplateApplication } from '../../../src/domain/types/panelFrame.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../src/services/credit/CreditService.js';
import type {
  ApplyPageLayoutTemplateRequest,
  PageLayoutServicePort,
} from '../../../src/services/page/PageLayoutService.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';

const jwtSecret = 'unit-test-secret';
const pageId = '11111111-1111-4111-8111-111111111111';
const user: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: 'supabase-user-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};

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

  public async refundCredits(_params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance(_params.userId);
  }
}

class FakePageLayoutService implements PageLayoutServicePort {
  public lastRequest: ApplyPageLayoutTemplateRequest | null = null;

  public async applyTemplate(
    _userId: string,
    _pageId: string,
    input: ApplyPageLayoutTemplateRequest,
  ): Promise<PageLayoutTemplateApplication> {
    this.lastRequest = input;

    return {
      templateId: input.templateId,
      panelCount: 3,
      createdPanelCount: 0,
      deletedPanelCount: input.allowPanelTruncation ? 1 : 0,
      frames: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          pageId,
          panelId: '33333333-3333-4333-8333-333333333333',
          vertices: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
          borderStyle: 'solid',
          borderWidth: 3,
          borderColor: '#000000',
          zIndex: 1,
          readingOrder: 1,
        },
      ],
    };
  }
}

describe('page layout routes', () => {
  it('テンプレート適用時にパネル同期フラグをServiceへ渡す', async () => {
    const pageLayoutService = new FakePageLayoutService();
    const app = createTestApp(pageLayoutService);
    const token = await createToken();

    const response = await app.request(`/api/pages/${pageId}/layout-template`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template_id: 'top_wide_3',
        allow_panel_truncation: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(pageLayoutService.lastRequest).toEqual({
      templateId: 'top_wide_3',
      allowPanelTruncation: true,
    });
    await expect(response.json()).resolves.toMatchObject({
      template_id: 'top_wide_3',
      panel_count: 3,
      deleted_panel_count: 1,
      frames: [
        {
          page_id: pageId,
          panel_id: '33333333-3333-4333-8333-333333333333',
          reading_order: 1,
        },
      ],
    });
  });

  it('未定義テンプレートは422になる', async () => {
    const app = createTestApp(new FakePageLayoutService());
    const token = await createToken();

    const response = await app.request(`/api/pages/${pageId}/layout-template`, {
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

  it('契約外のlayout集計は500にする', async () => {
    const pageLayoutService = new FakePageLayoutService();
    pageLayoutService.applyTemplate = async (_userId, _pageId, input) => ({
      templateId: input.templateId,
      panelCount: -1,
      createdPanelCount: 0,
      deletedPanelCount: 0,
      frames: [],
    });
    const app = createTestApp(pageLayoutService);
    const token = await createToken();

    const response = await app.request(`/api/pages/${pageId}/layout-template`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template_id: 'standard_4',
      }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'CONFIGURATION_ERROR' },
    });
  });
});

function createTestApp(pageLayoutService: PageLayoutServicePort): ReturnType<typeof createApp> {
  return createApp({
    creditService: new FakeCreditService(),
    pageLayoutService,
    userProvisioningService: new FakeUserProvisioningService(),
    jwtSecret,
  });
}

async function createToken(): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.supabaseId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(jwtSecret));
}
