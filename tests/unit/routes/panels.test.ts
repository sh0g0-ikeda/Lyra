import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { Panel } from '../../../src/domain/types/panel.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../src/services/credit/CreditService.js';
import type {
  CreatePanelRequest,
  PanelServicePort,
  UpdatePanelRequest,
} from '../../../src/services/page/PanelService.js';
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
const entityId = '33333333-3333-4333-8333-333333333333';

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

class FakePanelService implements PanelServicePort {
  public lastCreatedPageId: string | null = null;
  public lastCreateRequest: CreatePanelRequest | null = null;
  public lastUpdatedPanelId: string | null = null;
  public lastUpdateRequest: UpdatePanelRequest | null = null;
  public lastDeletedPanelId: string | null = null;
  public lastReorderedPageId: string | null = null;
  public lastReorderedPanelIds: string[] | null = null;

  public async createPanel(
    _userId: string,
    requestedPageId: string,
    input: CreatePanelRequest,
  ): Promise<Panel> {
    this.lastCreatedPageId = requestedPageId;
    this.lastCreateRequest = input;
    return buildPanel({ pageId: requestedPageId, ...input });
  }

  public async listPanels(_userId: string, requestedPageId: string): Promise<Panel[]> {
    return [buildPanel({ pageId: requestedPageId })];
  }

  public async updatePanel(
    _userId: string,
    requestedPanelId: string,
    input: UpdatePanelRequest,
  ): Promise<Panel> {
    this.lastUpdatedPanelId = requestedPanelId;
    this.lastUpdateRequest = input;
    return buildPanel({ id: requestedPanelId, ...input });
  }

  public async deletePanel(_userId: string, requestedPanelId: string): Promise<void> {
    this.lastDeletedPanelId = requestedPanelId;
  }

  public async reorderPanels(
    _userId: string,
    requestedPageId: string,
    panelIds: string[],
  ): Promise<Panel[]> {
    this.lastReorderedPageId = requestedPageId;
    this.lastReorderedPanelIds = panelIds;
    return panelIds.map((id, index) => buildPanel({ id, pageId: requestedPageId, order: index + 1 }));
  }
}

describe('panel routes', () => {
  it('JWTが正しい場合にページのPanel一覧を取得できる', async () => {
    const app = createTestApp(new FakePanelService());
    const token = await createToken();

    const response = await app.request(`/api/pages/${pageId}/panels`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      panels: [
        {
          id: panelId,
          page_id: pageId,
          order: 1,
          panel_role: 'action',
          panel_size: 'standard',
          entities: [
            {
              entity_id: entityId,
            },
          ],
          composition: {
            source: 'custom',
          },
          dialogue: [
            {
              entity_id: entityId,
              type: 'speech',
            },
          ],
        },
      ],
    });
  });

  it('JWTが正しい場合にPanelを作成できる', async () => {
    const panelService = new FakePanelService();
    const app = createTestApp(panelService);
    const token = await createToken();

    const response = await app.request(`/api/pages/${pageId}/panels`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        order: 2,
        panel_role: 'reaction',
        panel_size: 'wide',
        situation_text: 'The hero reacts to the explosion.',
        composition: {
          source: 'gallery',
          gallery_item_id: 'battle_single_001',
          composition_prompt: 'hero close-up with smoke',
          shot_type: 'close_up',
          angle: 'three_quarter',
          custom_note: 'Focus on the eyes',
        },
        dialogue_in_panel: true,
        dialogue: [
          {
            entity_id: entityId,
            text: 'What was that?',
            type: 'speech',
            position: 'top',
          },
          {
            entity_id: null,
            text: 'Boom',
            type: 'sfx',
            position: 'center',
          },
        ],
        sfx_text: 'BOOM',
        background_note: 'Dust and debris',
        panel_notes: 'Large reaction panel',
      }),
    });

    expect(response.status).toBe(201);
    expect(panelService.lastCreatedPageId).toBe(pageId);
    expect(panelService.lastCreateRequest).toMatchObject({
      order: 2,
      panelRole: 'reaction',
      panelSize: 'wide',
      situationText: 'The hero reacts to the explosion.',
      dialogueInPanel: true,
      sfxText: 'BOOM',
      backgroundNote: 'Dust and debris',
      panelNotes: 'Large reaction panel',
      composition: {
        source: 'gallery',
        galleryItemId: 'battle_single_001',
        shotType: 'close_up',
        angle: 'three_quarter',
      },
      dialogue: [
        {
          entityId,
          type: 'speech',
          position: 'top',
        },
        {
          entityId: null,
          type: 'sfx',
          position: 'center',
        },
      ],
    });
  });

  it('speakerが必要なdialogueでentity_idがない場合にVALIDATION_ERRORになる', async () => {
    const app = createTestApp(new FakePanelService());
    const token = await createToken();

    const response = await app.request(`/api/panels/${panelId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dialogue: [
          {
            text: 'No speaker',
            type: 'speech',
            position: 'top',
          },
        ],
      }),
    });

    expect(response.status).toBe(422);
  });

  it('未知のトップレベル項目を含む場合にVALIDATION_ERRORになる', async () => {
    const app = createTestApp(new FakePanelService());
    const token = await createToken();

    const response = await app.request(`/api/pages/${pageId}/panels`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        order: 1,
        unknown_field: 'unexpected',
      }),
    });

    expect(response.status).toBe(422);
  });

  it('JWTが正しい場合にPanelを削除できる', async () => {
    const panelService = new FakePanelService();
    const app = createTestApp(panelService);
    const token = await createToken();

    const response = await app.request(`/api/panels/${panelId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(204);
    expect(panelService.lastDeletedPanelId).toBe(panelId);
  });

  it('Authorizationヘッダーがない場合に401になる', async () => {
    const app = createTestApp(new FakePanelService());

    const response = await app.request(`/api/pages/${pageId}/panels`);

    expect(response.status).toBe(401);
  });

  it('JWT is valid, panels can be reordered for a page', async () => {
    const panelService = new FakePanelService();
    const app = createTestApp(panelService);
    const token = await createToken();
    const nextPanelIds = [
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ];

    const response = await app.request(`/api/pages/${pageId}/panels/order`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        panel_ids: nextPanelIds,
      }),
    });

    expect(response.status).toBe(200);
    expect(panelService.lastReorderedPageId).toBe(pageId);
    expect(panelService.lastReorderedPanelIds).toEqual(nextPanelIds);
    await expect(response.json()).resolves.toMatchObject({
      panels: [
        { id: nextPanelIds[0], order: 1 },
        { id: nextPanelIds[1], order: 2 },
      ],
    });
  });
});

function createTestApp(panelService: PanelServicePort): ReturnType<typeof createApp> {
  return createApp({
    creditService: new FakeCreditService(),
    panelService,
    userProvisioningService: new FakeUserProvisioningService(),
    jwtSecret,
    enableDevAuthBypass: false,
  });
}

function buildPanel(overrides: Partial<Panel> = {}): Panel {
  return {
    id: panelId,
    pageId,
    order: 1,
    panelRole: 'action',
    panelSize: 'standard',
    situationText: 'A dramatic action panel',
    entities: [
      {
        entityId,
        role: 'primary',
        expression: 'determined',
        customExpression: null,
        action: 'attacking',
        customAction: null,
        position: 'center',
        facingDirection: null,
        effectNote: null,
        stateId: null,
      },
    ],
    composition: {
      source: 'custom',
      galleryItemId: null,
      compositionPrompt: null,
      shotType: null,
      angle: null,
      customNote: null,
    },
    dialogueInPanel: true,
    dialogue: [
      {
        entityId,
        text: 'Take this!',
        type: 'speech',
        position: 'top',
      },
    ],
    sfxText: null,
    backgroundNote: null,
    panelNotes: null,
    createdAt: new Date('2026-04-23T00:00:00.000Z'),
    updatedAt: new Date('2026-04-23T00:00:00.000Z'),
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
