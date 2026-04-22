import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { Page, Panel } from '../../../src/domain/types/page.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type {
  CreatePageRequest,
  CreatePanelRequest,
  PageServicePort,
  UpdatePageRequest,
  UpdatePanelRequest,
} from '../../../src/services/page/PageService.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';
import type { ConsumeCreditsParams, CreditServicePort } from '../../../src/services/credit/CreditService.js';

const jwtSecret = 'unit-test-secret';
const user: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: 'supabase-user-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};
const episodeId = '33333333-3333-4333-8333-333333333333';
const sceneId = '44444444-4444-4444-8444-444444444444';
const pageId = '77777777-7777-4777-8777-777777777777';
const panelId = '88888888-8888-4888-8888-888888888888';
const entityId = '55555555-5555-4555-8555-555555555555';
const now = new Date('2026-04-22T00:00:00.000Z');

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

class FakePageService implements PageServicePort {
  public async createPage(
    _userId: string,
    requestedEpisodeId: string,
    input: CreatePageRequest,
  ): Promise<Page> {
    return buildPage({
      episodeId: requestedEpisodeId,
      sceneId: input.sceneId,
      pageNumber: input.pageNumber,
      layoutConfig: input.layoutConfig,
    });
  }

  public async listPages(_userId: string, requestedEpisodeId: string): Promise<Page[]> {
    return [buildPage({ episodeId: requestedEpisodeId })];
  }

  public async getPage(_userId: string, requestedPageId: string): Promise<Page> {
    return buildPage({ id: requestedPageId });
  }

  public async updatePage(
    _userId: string,
    requestedPageId: string,
    input: UpdatePageRequest,
  ): Promise<Page> {
    return buildPage({
      id: requestedPageId,
      pageNumber: input.pageNumber ?? 1,
      status: input.status ?? 'designing',
    });
  }

  public async deletePage(_userId: string, _requestedPageId: string): Promise<void> {}

  public async createPanel(_userId: string, requestedPageId: string, input: CreatePanelRequest): Promise<Panel> {
    return buildPanel({
      pageId: requestedPageId,
      order: input.order,
      panelRole: input.panelRole,
      entities: input.entities,
      dialogue: input.dialogue,
    });
  }

  public async listPanels(_userId: string, requestedPageId: string): Promise<Panel[]> {
    return [buildPanel({ pageId: requestedPageId })];
  }

  public async updatePanel(
    _userId: string,
    requestedPanelId: string,
    input: UpdatePanelRequest,
  ): Promise<Panel> {
    return buildPanel({
      id: requestedPanelId,
      order: input.order ?? 1,
      panelRole: input.panelRole ?? 'action',
    });
  }

  public async deletePanel(_userId: string, _requestedPanelId: string): Promise<void> {}
}

describe('page routes', () => {
  it('JWTが正しい場合にPageを作成できる', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request(`/api/episodes/${episodeId}/pages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        scene_id: sceneId,
        page_number: 1,
        layout_config: {
          type: 'template',
          template_id: 'standard_4',
          panel_count: 4,
        },
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      episode_id: episodeId,
      scene_id: sceneId,
      page_number: 1,
      layout_config: {
        template_id: 'standard_4',
        panel_count: 4,
      },
    });
  });

  it('Page番号が0の場合にVALIDATION_ERRORになる', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request(`/api/episodes/${episodeId}/pages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        page_number: 0,
      }),
    });

    expect(response.status).toBe(422);
  });

  it('Panelを作成できる', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request(`/api/pages/${pageId}/panels`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        order: 1,
        panel_role: 'action',
        entities: [
          {
            entity_id: entityId,
            role: 'primary',
            expression: 'determined',
            action: 'attacking',
            position: 'center',
          },
        ],
        dialogue: [
          {
            entity_id: entityId,
            text: '行くぞ',
            type: 'speech',
            position: 'bottom',
          },
        ],
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      page_id: pageId,
      order: 1,
      panel_role: 'action',
      entities: [
        {
          entity_id: entityId,
          role: 'primary',
        },
      ],
    });
  });

  it('Authorizationヘッダーがない場合に401になる', async () => {
    const app = createTestApp();

    const response = await app.request(`/api/pages/${pageId}`);

    expect(response.status).toBe(401);
  });
});

function createTestApp(): ReturnType<typeof createApp> {
  return createApp({
    creditService: new FakeCreditService(),
    pageService: new FakePageService(),
    userProvisioningService: new FakeUserProvisioningService(),
    jwtSecret,
  });
}

function buildPage(overrides: Partial<Page> = {}): Page {
  return {
    id: pageId,
    episodeId,
    sceneId: null,
    pageNumber: 1,
    layoutConfig: {
      type: 'template',
      templateId: 'standard_4',
      panelCount: 4,
      layoutReferenceS3Key: null,
      frameDefinitions: [],
    },
    dialogueMode: 'image_baked',
    pageDialogueToggle: true,
    generatedImage: null,
    generationMode: null,
    panelIds: [],
    status: 'designing',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildPanel(overrides: Partial<Panel> = {}): Panel {
  return {
    id: panelId,
    pageId,
    order: 1,
    panelRole: 'action',
    panelSize: 'standard',
    situationText: null,
    entities: [],
    composition: {
      source: 'ai_auto',
      galleryItemId: null,
      compositionPrompt: null,
      shotType: null,
      angle: null,
      customNote: null,
    },
    dialogueInPanel: true,
    dialogue: [],
    sfxText: null,
    backgroundNote: null,
    panelNotes: null,
    createdAt: now,
    updatedAt: now,
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
