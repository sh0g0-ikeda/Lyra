import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '../../../../src/domain/errors/index.js';
import type {
  PanelEntityAssignment,
  PanelEntityStateReference,
} from '../../../../src/domain/types/panelEntityAssignment.js';
import type {
  PanelContext,
  PanelEntityAssignmentRepository,
} from '../../../../src/repositories/PanelEntityAssignmentRepository.js';
import { PanelEntityAssignmentService } from '../../../../src/services/page/PanelEntityAssignmentService.js';

const userId = 'user-1';
const panelId = '11111111-1111-4111-8111-111111111111';
const pageId = '22222222-2222-4222-8222-222222222222';
const workId = '33333333-3333-4333-8333-333333333333';
const entityId = '44444444-4444-4444-8444-444444444444';
const stateId = '55555555-5555-4555-8555-555555555555';

class FakePanelEntityAssignmentRepository implements PanelEntityAssignmentRepository {
  public panelContext: PanelContext | null = { panelId, pageId, workId };
  public matchedEntityCount = 1;
  public matchedStatePairCount = 1;
  public savedAssignments: PanelEntityAssignment[] | null = null;

  public async findPanelContextByIdAndUserId(
    requestedPanelId: string,
    _userId: string,
  ): Promise<PanelContext | null> {
    return this.panelContext === null ? null : { ...this.panelContext, panelId: requestedPanelId };
  }

  public async countEntitiesByIdsAndWorkIdAndUserId(
    _entityIds: string[],
    _workId: string,
    _userId: string,
  ): Promise<number> {
    return this.matchedEntityCount;
  }

  public async countEntityStatePairsByWorkIdAndUserId(
    _pairs: PanelEntityStateReference[],
    _workId: string,
    _userId: string,
  ): Promise<number> {
    return this.matchedStatePairCount;
  }

  public async updatePanelEntityAssignments(
    _requestedPanelId: string,
    _userId: string,
    assignments: PanelEntityAssignment[],
  ): Promise<PanelEntityAssignment[] | null> {
    this.savedAssignments = assignments;
    return assignments;
  }
}

describe('PanelEntityAssignmentService', () => {
  it('Panel所有者の場合にエンティティ割り当てを保存できる', async () => {
    const repository = new FakePanelEntityAssignmentRepository();
    const service = new PanelEntityAssignmentService(repository);

    const assignments = await service.replacePanelEntityAssignments(userId, panelId, [
      buildAssignment(),
    ]);

    expect(repository.savedAssignments?.[0]).toMatchObject({ entityId, stateId });
    expect(assignments[0]).toMatchObject({ entityId, role: 'primary' });
  });

  it('Panelが存在しない場合にNOT_FOUNDになる', async () => {
    const repository = new FakePanelEntityAssignmentRepository();
    repository.panelContext = null;
    const service = new PanelEntityAssignmentService(repository);

    await expect(
      service.replacePanelEntityAssignments(userId, panelId, [buildAssignment()]),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('Entityが同じworkに属さない場合にVALIDATION_ERRORになる', async () => {
    const repository = new FakePanelEntityAssignmentRepository();
    repository.matchedEntityCount = 0;
    const service = new PanelEntityAssignmentService(repository);

    await expect(
      service.replacePanelEntityAssignments(userId, panelId, [buildAssignment()]),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('state_idがentityに属さない場合にVALIDATION_ERRORになる', async () => {
    const repository = new FakePanelEntityAssignmentRepository();
    repository.matchedStatePairCount = 0;
    const service = new PanelEntityAssignmentService(repository);

    await expect(
      service.replacePanelEntityAssignments(userId, panelId, [buildAssignment()]),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

function buildAssignment(overrides: Partial<PanelEntityAssignment> = {}): PanelEntityAssignment {
  return {
    entityId,
    role: 'primary',
    expression: 'determined',
    customExpression: null,
    action: 'attacking',
    customAction: null,
    position: 'center',
    stateId,
    ...overrides,
  };
}
