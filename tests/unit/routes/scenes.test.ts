import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../src/app.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type { EntityState, Scene } from '../../../src/domain/types/scene.js';
import type {
  CreateEntityStateRequest,
  CreateSceneRequest,
  SceneServicePort,
  UpdateEntityStateRequest,
  UpdateSceneRequest,
} from '../../../src/services/scene/SceneService.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../src/services/credit/CreditService.js';
import type { OrganizationServicePort } from '../../../src/services/organization/OrganizationService.js';

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
const entityId = '55555555-5555-4555-8555-555555555555';
const stateId = '66666666-6666-4666-8666-666666666666';
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

  public async refundCredits(_params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance(_params.userId);
  }
}

class FakeSceneService implements SceneServicePort {
  public async createScene(
    _userId: string,
    requestedEpisodeId: string,
    input: CreateSceneRequest,
  ): Promise<Scene> {
    return buildScene({
      episodeId: requestedEpisodeId,
      order: input.order,
      location: input.location,
      time: input.time,
      atmosphere: input.atmosphere,
      involvedEntityIds: input.involvedEntityIds,
    });
  }

  public async listScenes(_userId: string, requestedEpisodeId: string): Promise<Scene[]> {
    return [buildScene({ episodeId: requestedEpisodeId })];
  }

  public async updateScene(
    _userId: string,
    requestedSceneId: string,
    input: UpdateSceneRequest,
  ): Promise<Scene> {
    return buildScene({
      id: requestedSceneId,
      order: input.order ?? 1,
      location: input.location ?? '廃墟の広場',
    });
  }

  public async deleteScene(_userId: string, _requestedSceneId: string): Promise<void> {}

  public async listEntityStates(_userId: string, requestedEntityId: string): Promise<EntityState[]> {
    return [buildEntityState({ entityId: requestedEntityId })];
  }

  public async createEntityState(
    _userId: string,
    requestedEntityId: string,
    input: CreateEntityStateRequest,
  ): Promise<EntityState> {
    return buildEntityState({
      entityId: requestedEntityId,
      sceneId: input.sceneId,
      costumeNote: input.costumeNote,
      expressionDefault: input.expressionDefault,
    });
  }

  public async updateEntityState(
    _userId: string,
    requestedEntityId: string,
    requestedStateId: string,
    input: UpdateEntityStateRequest,
  ): Promise<EntityState> {
    return buildEntityState({
      id: requestedStateId,
      entityId: requestedEntityId,
      sceneId: input.sceneId === undefined ? sceneId : input.sceneId,
      costumeNote: input.costumeNote ?? '黒のタクティカルスーツ',
    });
  }
}

describe('scene routes', () => {
  it('JWTが正しい場合にSceneを作成できる', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request(`/api/episodes/${episodeId}/scenes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        order: 1,
        location: '廃墟の広場',
        time: '夜',
        involved_entity_ids: [entityId],
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      episode_id: episodeId,
      order: 1,
      location: '廃墟の広場',
      involved_entity_ids: [entityId],
    });
  });

  it('Sceneのorderが0の場合にVALIDATION_ERRORになる', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request(`/api/episodes/${episodeId}/scenes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        order: 0,
      }),
    });

    expect(response.status).toBe(422);
  });

  it('entity_stateを作成できる', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request(`/api/entities/${entityId}/states`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        scene_id: sceneId,
        costume_note: '黒のタクティカルスーツ',
        expression_default: 'determined',
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      entity_id: entityId,
      scene_id: sceneId,
      costume_note: '黒のタクティカルスーツ',
      expression_default: 'determined',
    });
  });

  it('Authorizationヘッダーがない場合に401になる', async () => {
    const app = createTestApp();

    const response = await app.request(`/api/episodes/${episodeId}/scenes`);

    expect(response.status).toBe(401);
  });

  it('entity_stateを本人の一覧として取得できる', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request(`/api/entities/${entityId}/states`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      entity_states: [{ id: stateId, entity_id: entityId, scene_id: sceneId }],
    });
  });

  it('法人のentity_state一覧はview_work権限を要求する', async () => {
    const requireMembership = vi.fn().mockResolvedValue(undefined);
    const app = createTestApp({
      organizationService: { requireMembership } as unknown as OrganizationServicePort,
    });
    const token = await createToken();
    const organizationId = '77777777-7777-4777-8777-777777777777';

    const response = await app.request(`/api/entities/${entityId}/states?organization_id=${organizationId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(requireMembership).toHaveBeenCalledWith(organizationId, user.id, 'view_work');
  });

  it('Scene一覧の成功応答がcanonical schemaに違反する場合は500になる', async () => {
    const sceneService = new FakeSceneService();
    sceneService.listScenes = async () => [buildScene({ order: 0 })];
    const app = createTestApp({ sceneService });
    const token = await createToken();

    const response = await app.request(`/api/episodes/${episodeId}/scenes`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(500);
  });
});

function createTestApp(overrides: {
  organizationService?: OrganizationServicePort;
  sceneService?: SceneServicePort;
} = {}): ReturnType<typeof createApp> {
  return createApp({
    creditService: new FakeCreditService(),
    sceneService: new FakeSceneService(),
    userProvisioningService: new FakeUserProvisioningService(),
    jwtSecret,
    ...overrides,
  });
}

function buildScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: sceneId,
    episodeId,
    order: 1,
    location: '廃墟の広場',
    time: '夜',
    atmosphere: 'tense',
    involvedEntityIds: [],
    entityStates: [],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildEntityState(overrides: Partial<EntityState> = {}): EntityState {
  return {
    id: stateId,
    entityId,
    sceneId,
    costumeNote: null,
    costumeRefId: null,
    conditionNote: null,
    hairNote: null,
    expressionDefault: 'neutral',
    extraNote: null,
    createdAt: now,
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
