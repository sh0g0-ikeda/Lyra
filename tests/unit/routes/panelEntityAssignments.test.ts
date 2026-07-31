import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { PanelEntityAssignment } from '../../../src/domain/types/panelEntityAssignment.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../src/services/credit/CreditService.js';
import type { PanelEntityAssignmentServicePort } from '../../../src/services/page/PanelEntityAssignmentService.js';
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
const panelId = '11111111-1111-4111-8111-111111111111';
const entityId = '22222222-2222-4222-8222-222222222222';
const stateId = '33333333-3333-4333-8333-333333333333';

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

class FakePanelEntityAssignmentService implements PanelEntityAssignmentServicePort {
  public lastPanelId: string | null = null;
  public lastAssignments: PanelEntityAssignment[] | null = null;
  public lastExpectedAssignments: PanelEntityAssignment[] | null | undefined;

  public async replacePanelEntityAssignments(
    _userId: string,
    requestedPanelId: string,
    assignments: PanelEntityAssignment[],
    _organizationId?: string | null,
    expectedAssignments?: PanelEntityAssignment[] | null,
  ): Promise<PanelEntityAssignment[]> {
    this.lastPanelId = requestedPanelId;
    this.lastAssignments = assignments;
    this.lastExpectedAssignments = expectedAssignments;
    return assignments;
  }
}

class InvalidPanelEntityAssignmentService implements PanelEntityAssignmentServicePort {
  public async replacePanelEntityAssignments(
    _userId: string,
    _panelId: string,
    assignments: PanelEntityAssignment[],
  ): Promise<PanelEntityAssignment[]> {
    return assignments.map((assignment) => ({
      ...assignment,
      role: 'lead',
    })) as unknown as PanelEntityAssignment[];
  }
}

describe('panel entity assignment routes', () => {
  it('JWTが正しい場合にPanelへエンティティ割当を保存できる', async () => {
    const panelEntityAssignmentService = new FakePanelEntityAssignmentService();
    const app = createTestApp(panelEntityAssignmentService);
    const token = await createToken();

    const response = await app.request(`/api/panels/${panelId}/entities`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        entities: [
          {
            entity_id: entityId,
            role: 'primary',
            expression: 'custom',
            custom_expression: 'thin smile',
            action: 'attacking',
            position: 'center',
            facing_direction: 'left',
            effect_note: 'speed lines',
            state_id: stateId,
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(panelEntityAssignmentService.lastPanelId).toBe(panelId);
    expect(panelEntityAssignmentService.lastExpectedAssignments).toBeUndefined();
    expect(panelEntityAssignmentService.lastAssignments?.[0]).toMatchObject({
      entityId,
      role: 'primary',
      expression: 'custom',
      customExpression: 'thin smile',
      action: 'attacking',
      customAction: null,
      position: 'center',
      facingDirection: 'left',
      effectNote: 'speed lines',
      stateId,
    });
    await expect(response.json()).resolves.toMatchObject({
      entities: [
        {
          entity_id: entityId,
          role: 'primary',
          expression: 'custom',
          custom_expression: 'thin smile',
          action: 'attacking',
          custom_action: null,
          position: 'center',
          facing_direction: 'left',
          effect_note: 'speed lines',
          state_id: stateId,
        },
      ],
    });
  });

  it('custom以外の表情と動作ではcustom値を保存しない', async () => {
    const panelEntityAssignmentService = new FakePanelEntityAssignmentService();
    const app = createTestApp(panelEntityAssignmentService);
    const token = await createToken();

    const response = await app.request(`/api/panels/${panelId}/entities`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        entities: [
          {
            entity_id: entityId,
            role: 'primary',
            expression: 'calm',
            custom_expression: 'stale custom expression',
            action: 'running',
            custom_action: 'stale custom action',
            position: 'center',
            state_id: stateId,
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(panelEntityAssignmentService.lastAssignments?.[0]).toMatchObject({
      entityId,
      expression: 'calm',
      customExpression: null,
      action: 'running',
      customAction: null,
      stateId,
    });
    await expect(response.json()).resolves.toMatchObject({
      entities: [
        {
          entity_id: entityId,
          expression: 'calm',
          custom_expression: null,
          action: 'running',
          custom_action: null,
          state_id: stateId,
        },
      ],
    });
  });

  it('expected_entitiesを正規化して条件付き保存へ渡す', async () => {
    const panelEntityAssignmentService = new FakePanelEntityAssignmentService();
    const app = createTestApp(panelEntityAssignmentService);
    const token = await createToken();

    const response = await app.request(`/api/panels/${panelId}/entities`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expected_entities: [
          {
            entity_id: entityId,
            role: 'secondary',
            expression: 'calm',
            custom_expression: 'discarded legacy value',
            action: 'running',
            custom_action: 'discarded legacy action',
            position: 'left',
          },
        ],
        entities: [
          {
            entity_id: entityId,
            role: 'primary',
            expression: 'custom',
            custom_expression: 'thin smile',
            action: 'custom',
            custom_action: 'draws a sword',
            position: 'center',
            facing_direction: 'front',
            effect_note: 'speed lines',
            state_id: stateId,
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(panelEntityAssignmentService.lastExpectedAssignments).toEqual([
      {
        entityId,
        role: 'secondary',
        expression: 'calm',
        customExpression: null,
        action: 'running',
        customAction: null,
        position: 'left',
        facingDirection: null,
        effectNote: null,
        stateId: null,
      },
    ]);
    expect(panelEntityAssignmentService.lastAssignments?.[0]).toMatchObject({
      entityId,
      customExpression: 'thin smile',
      customAction: 'draws a sword',
      stateId,
    });
  });

  it('custom表情でcustom_expressionがない場合にVALIDATION_ERRORになる', async () => {
    const app = createTestApp(new FakePanelEntityAssignmentService());
    const token = await createToken();

    const response = await app.request(`/api/panels/${panelId}/entities`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        entities: [
          {
            entity_id: entityId,
            role: 'primary',
            expression: 'custom',
            action: 'attacking',
            position: 'center',
          },
        ],
      }),
    });

    expect(response.status).toBe(422);
  });

  it('同じentity_idを同一panelに重複登録するとVALIDATION_ERRORになる', async () => {
    const app = createTestApp(new FakePanelEntityAssignmentService());
    const token = await createToken();

    const response = await app.request(`/api/panels/${panelId}/entities`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        entities: [
          {
            entity_id: entityId,
            role: 'primary',
            expression: 'calm',
            action: 'attacking',
            position: 'left',
          },
          {
            entity_id: entityId,
            role: 'secondary',
            expression: 'sad',
            action: 'running',
            position: 'right',
          },
        ],
      }),
    });

    expect(response.status).toBe(422);
  });

  it('expected_entitiesのentity_id重複もVALIDATION_ERRORになる', async () => {
    const app = createTestApp(new FakePanelEntityAssignmentService());
    const token = await createToken();
    const expected = {
      entity_id: entityId,
      role: 'primary',
      expression: 'calm',
      action: 'running',
      position: 'center',
    };

    const response = await app.request(`/api/panels/${panelId}/entities`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expected_entities: [expected, expected],
        entities: [],
      }),
    });

    expect(response.status).toBe(422);
  });

  it('expected_entitiesが20件を超える場合はVALIDATION_ERRORになる', async () => {
    const app = createTestApp(new FakePanelEntityAssignmentService());
    const token = await createToken();
    const expectedEntities = Array.from({ length: 21 }, (_, index) => ({
      entity_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      role: 'background',
      expression: 'calm',
      action: 'standing_firm',
      position: 'background',
    }));

    const response = await app.request(`/api/panels/${panelId}/entities`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expected_entities: expectedEntities,
        entities: [],
      }),
    });

    expect(response.status).toBe(422);
  });

  it('Authorizationヘッダーがない場合に401になる', async () => {
    const app = createTestApp(new FakePanelEntityAssignmentService());

    const response = await app.request(`/api/panels/${panelId}/entities`, {
      method: 'PUT',
      body: JSON.stringify({ entities: [] }),
    });

    expect(response.status).toBe(401);
  });

  it('Serviceが契約外の割り当てを返す場合は500にする', async () => {
    const app = createTestApp(new InvalidPanelEntityAssignmentService());
    const token = await createToken();

    const response = await app.request(`/api/panels/${panelId}/entities`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        entities: [
          {
            entity_id: entityId,
            role: 'primary',
            expression: 'calm',
            action: 'running',
            position: 'center',
          },
        ],
      }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'CONFIGURATION_ERROR',
      },
    });
  });
});

function createTestApp(
  panelEntityAssignmentService: PanelEntityAssignmentServicePort,
): ReturnType<typeof createApp> {
  return createApp({
    creditService: new FakeCreditService(),
    panelEntityAssignmentService,
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
