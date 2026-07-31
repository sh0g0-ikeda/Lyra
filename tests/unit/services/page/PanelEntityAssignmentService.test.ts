import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../../../src/domain/errors/index.js';
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
const anotherEntityId = '66666666-6666-4666-8666-666666666666';
const stateId = '55555555-5555-4555-8555-555555555555';

type ConditionalResult =
  | { status: 'saved'; assignments: PanelEntityAssignment[] }
  | {
      status:
        | 'not_found'
        | 'stale'
        | 'page_not_editable'
        | 'dialogue_speaker_not_assigned'
        | 'entity_not_in_work'
        | 'state_not_in_entity';
    };

class FakePanelEntityAssignmentRepository implements PanelEntityAssignmentRepository {
  public panelContext: PanelContext | null = { panelId, pageId, workId };
  public matchedEntityCount = 1;
  public matchedStatePairCount = 1;
  public savedAssignments: PanelEntityAssignment[] | null = null;
  public conditionalExpectedAssignments: PanelEntityAssignment[] | null = null;
  public conditionalOrganizationId: string | null = null;
  public conditionalResult: ConditionalResult = {
    status: 'saved',
    assignments: [buildAssignment()],
  };

  public async findPanelContextByIdAndUserId(
    requestedPanelId: string,
    _userId: string,
  ): Promise<PanelContext | null> {
    return this.panelContext === null ? null : { ...this.panelContext, panelId: requestedPanelId };
  }

  public async countEntitiesByIdsAndWorkIdAndUserId(
    entityIds: string[],
    _workId: string,
    _userId: string,
  ): Promise<number> {
    return entityIds.length === 0 ? 0 : this.matchedEntityCount;
  }

  public async countEntityStatePairsByWorkIdAndUserId(
    pairs: PanelEntityStateReference[],
    _workId: string,
    _userId: string,
  ): Promise<number> {
    return pairs.length === 0 ? 0 : this.matchedStatePairCount;
  }

  public async updatePanelEntityAssignments(
    _requestedPanelId: string,
    _userId: string,
    assignments: PanelEntityAssignment[],
  ): Promise<PanelEntityAssignment[] | null> {
    this.savedAssignments = assignments;
    return assignments;
  }

  public async replacePanelEntityAssignmentsConditionally(
    _requestedPanelId: string,
    _userId: string,
    expectedAssignments: PanelEntityAssignment[],
    _assignments: PanelEntityAssignment[],
    organizationId: string | null = null,
  ): Promise<ConditionalResult> {
    this.conditionalExpectedAssignments = expectedAssignments;
    this.conditionalOrganizationId = organizationId;
    return this.conditionalResult;
  }
}

describe('PanelEntityAssignmentService', () => {
  it('Panelが存在する場合にエンティティ割当を保存できる', async () => {
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

  it('Entityが別workに属する場合にVALIDATION_ERRORになる', async () => {
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

  it('同じentityIdを重複割当するとVALIDATION_ERRORになる', async () => {
    const repository = new FakePanelEntityAssignmentRepository();
    repository.matchedEntityCount = 2;
    const service = new PanelEntityAssignmentService(repository);

    await expect(
      service.replacePanelEntityAssignments(userId, panelId, [
        buildAssignment(),
        buildAssignment({
          role: 'secondary',
          entityId,
          expression: 'calm',
          action: 'running',
          position: 'right',
          stateId: null,
        }),
      ]),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(repository.savedAssignments).toBeNull();
  });

  it('custom以外の表情と動作ではcustom値を保存しない', async () => {
    const repository = new FakePanelEntityAssignmentRepository();
    const service = new PanelEntityAssignmentService(repository);

    const assignments = await service.replacePanelEntityAssignments(userId, panelId, [
      buildAssignment({
        expression: 'calm',
        customExpression: 'stale custom expression',
        action: 'running',
        customAction: 'stale custom action',
      }),
    ]);

    expect(repository.savedAssignments?.[0]).toMatchObject({
      entityId,
      expression: 'calm',
      customExpression: null,
      action: 'running',
      customAction: null,
      effectNote: null,
    });
    expect(assignments[0]).toMatchObject({
      entityId,
      expression: 'calm',
      customExpression: null,
      action: 'running',
      customAction: null,
      effectNote: null,
    });
  });

  it('向きとエフェクトメモを保存できる', async () => {
    const repository = new FakePanelEntityAssignmentRepository();
    const service = new PanelEntityAssignmentService(repository);

    const assignments = await service.replacePanelEntityAssignments(userId, panelId, [
      buildAssignment({
        facingDirection: 'three_quarter_left',
        effectNote: 'speed lines around the shoulders',
      }),
    ]);

    expect(repository.savedAssignments?.[0]).toMatchObject({
      entityId,
      facingDirection: 'three_quarter_left',
      effectNote: 'speed lines around the shoulders',
    });
    expect(assignments[0]).toMatchObject({
      entityId,
      facingDirection: 'three_quarter_left',
      effectNote: 'speed lines around the shoulders',
    });
  });

  it('複数entityを保存する場合は件数分の所属確認を通す', async () => {
    const repository = new FakePanelEntityAssignmentRepository();
    repository.matchedEntityCount = 2;
    const service = new PanelEntityAssignmentService(repository);

    const assignments = await service.replacePanelEntityAssignments(userId, panelId, [
      buildAssignment(),
      buildAssignment({
        entityId: anotherEntityId,
        role: 'secondary',
        expression: 'sad',
        action: 'defending',
        position: 'left',
        stateId: null,
      }),
    ]);

    expect(assignments).toHaveLength(2);
    expect(repository.savedAssignments).toHaveLength(2);
  });

  it('expected snapshotがある場合は正規化してorganization scope付き条件保存を使う', async () => {
    const repository = new FakePanelEntityAssignmentRepository();
    const service = new PanelEntityAssignmentService(repository);
    const expected = [buildAssignment({
      expression: 'calm',
      customExpression: 'stale custom expression',
      action: 'running',
      customAction: 'stale custom action',
      effectNote: '  before  ',
    })];

    const assignments = await service.replacePanelEntityAssignments(
      userId,
      panelId,
      [buildAssignment({ effectNote: 'after' })],
      '77777777-7777-4777-8777-777777777777',
      expected,
    );

    expect(repository.savedAssignments).toBeNull();
    expect(repository.conditionalOrganizationId).toBe('77777777-7777-4777-8777-777777777777');
    expect(repository.conditionalExpectedAssignments).toEqual([
      buildAssignment({
        expression: 'calm',
        customExpression: null,
        action: 'running',
        customAction: null,
        effectNote: 'before',
      }),
    ]);
    expect(assignments).toEqual([buildAssignment()]);
  });

  it.each(['stale', 'page_not_editable'] as const)(
    '条件付き保存が%sの場合はCONFLICTになりlegacy更新しない',
    async (status) => {
      const repository = new FakePanelEntityAssignmentRepository();
      repository.conditionalResult = { status };
      const service = new PanelEntityAssignmentService(repository);

      await expect(
        service.replacePanelEntityAssignments(
          userId,
          panelId,
          [buildAssignment()],
          null,
          [buildAssignment()],
        ),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(repository.savedAssignments).toBeNull();
    },
  );

  it.each([
    'dialogue_speaker_not_assigned',
    'entity_not_in_work',
    'state_not_in_entity',
  ] as const)('条件付き保存が%sの場合はVALIDATION_ERRORになる', async (status) => {
    const repository = new FakePanelEntityAssignmentRepository();
    repository.conditionalResult = { status };
    const service = new PanelEntityAssignmentService(repository);

    await expect(
      service.replacePanelEntityAssignments(
        userId,
        panelId,
        [buildAssignment()],
        null,
        [buildAssignment()],
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('条件付き保存中にPanelが消失した場合はNOT_FOUNDになる', async () => {
    const repository = new FakePanelEntityAssignmentRepository();
    repository.conditionalResult = { status: 'not_found' };
    const service = new PanelEntityAssignmentService(repository);

    await expect(
      service.replacePanelEntityAssignments(
        userId,
        panelId,
        [buildAssignment()],
        null,
        [buildAssignment()],
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
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
    facingDirection: null,
    effectNote: null,
    stateId,
    ...overrides,
  };
}
