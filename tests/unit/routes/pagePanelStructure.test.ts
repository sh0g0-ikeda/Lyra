import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../src/services/credit/CreditService.js';
import type {
  ApplyPagePanelStructureRequest,
  PagePanelStructureServicePort,
} from '../../../src/services/page/PagePanelStructureService.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';

const jwtSecret = 'unit-test-secret';
const pageId = '11111111-1111-4111-8111-111111111111';
const panelId1 = '22222222-2222-4222-8222-222222222221';
const panelId2 = '22222222-2222-4222-8222-222222222222';
const frameId = '33333333-3333-4333-8333-333333333333';
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
      user: { ...user, supabaseId: claims.sub, email: claims.email },
      isNewUser: false,
    };
  }
}

class FakeCreditService implements CreditServicePort {
  public async getBalance(_userId: string): Promise<CreditBalanceSnapshot> {
    return { monthlyCredits: 0, purchasedCredits: 0, totalCredits: 0, monthlyExpiresAt: null };
  }
  public async grantSignupBonus(userId: string): Promise<CreditBalanceSnapshot> {
    return this.getBalance(userId);
  }
  public async consumeCredits(params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance(params.userId);
  }
  public async refundCredits(params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance(params.userId);
  }
}

class FakePagePanelStructureService implements PagePanelStructureServicePort {
  public lastRequest: ApplyPagePanelStructureRequest | null = null;

  public async apply(
    _userId: string,
    _pageId: string,
    input: ApplyPagePanelStructureRequest,
  ) {
    this.lastRequest = input;
    return {
      panelIds: [panelId2, panelId1],
      createdPanelId: null,
      layoutTemplateId: null,
      frames: [
        {
          id: frameId,
          pageId,
          panelId: panelId2,
          vertices: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
          ],
          borderStyle: 'solid' as const,
          borderWidth: 3,
          borderColor: '#000000',
          zIndex: 1,
          readingOrder: 1,
        },
      ],
      balloonReferenceUpdatedCount: 2,
      balloonReferenceClearedCount: 0,
    };
  }
}

describe('page panel structure route', () => {
  it('現在のIDと並び替え要求を追加契約へ変換して返す', async () => {
    const service = new FakePagePanelStructureService();
    const app = createTestApp(service);
    const token = await createToken();

    const response = await app.request(`/api/pages/${pageId}/panel-structure`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expected_panel_ids: [panelId1, panelId2],
        operation: { type: 'reorder', panel_ids: [panelId2, panelId1] },
      }),
    });

    expect(response.status).toBe(200);
    expect(service.lastRequest).toEqual({
      expectedPanelIds: [panelId1, panelId2],
      operation: { type: 'reorder', panelIds: [panelId2, panelId1] },
    });
    await expect(response.json()).resolves.toEqual({
      panel_ids: [panelId2, panelId1],
      created_panel_id: null,
      layout_template_id: null,
      frames: [
        {
          id: frameId,
          page_id: pageId,
          panel_id: panelId2,
          vertices: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
          ],
          border_style: 'solid',
          border_width: 3,
          border_color: '#000000',
          z_index: 1,
          reading_order: 1,
        },
      ],
      balloon_reference_updated_count: 2,
      balloon_reference_cleared_count: 0,
    });
  });

  it('期待IDに重複がある場合に422を返してServiceを呼ばない', async () => {
    const service = new FakePagePanelStructureService();
    const app = createTestApp(service);
    const token = await createToken();

    const response = await app.request(`/api/pages/${pageId}/panel-structure`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expected_panel_ids: [panelId1, panelId1],
        operation: { type: 'append' },
      }),
    });

    expect(response.status).toBe(422);
    expect(service.lastRequest).toBeNull();
  });

  it('9件の期待IDがある場合に422を返す', async () => {
    const service = new FakePagePanelStructureService();
    const app = createTestApp(service);
    const token = await createToken();
    const expectedPanelIds = Array.from({ length: 9 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );

    const response = await app.request(`/api/pages/${pageId}/panel-structure`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expected_panel_ids: expectedPanelIds,
        operation: { type: 'append' },
      }),
    });

    expect(response.status).toBe(422);
    expect(service.lastRequest).toBeNull();
  });
});

function createTestApp(pagePanelStructureService: PagePanelStructureServicePort): ReturnType<typeof createApp> {
  return createApp({
    creditService: new FakeCreditService(),
    pagePanelStructureService,
    userProvisioningService: new FakeUserProvisioningService(),
    jwtSecret,
    enableDevAuthBypass: false,
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
