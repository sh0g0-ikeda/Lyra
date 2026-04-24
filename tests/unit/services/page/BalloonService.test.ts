import { describe, expect, it } from 'vitest';
import type { AppError } from '../../../../src/domain/errors/index.js';
import type { Balloon, CreateBalloonInput, UpdateBalloonInput } from '../../../../src/domain/types/balloon.js';
import type { Entity } from '../../../../src/domain/types/entity.js';
import type {
  BalloonContext,
  BalloonRepository,
  PageBalloonContext,
} from '../../../../src/repositories/BalloonRepository.js';
import type { EntityReferenceReader } from '../../../../src/repositories/EntityRepository.js';
import { BalloonService } from '../../../../src/services/page/BalloonService.js';

const basePageContext: PageBalloonContext = {
  pageId: 'page-1',
  workId: 'work-1',
  status: 'editing',
  dialogueMode: 'mixed',
  hasGeneratedImage: true,
  panelCount: 3,
};

class FakeBalloonRepository implements BalloonRepository {
  private readonly pageContexts = new Map<string, PageBalloonContext>();
  private readonly balloonContexts = new Map<string, BalloonContext>();
  private readonly balloons = new Map<string, Balloon>();

  public addPageContext(userId: string, context: PageBalloonContext): void {
    this.pageContexts.set(`${userId}:${context.pageId}`, context);
  }

  public addBalloonContext(userId: string, context: BalloonContext): void {
    this.balloonContexts.set(`${userId}:${context.balloonId}`, context);
  }

  public seedBalloon(balloon: Balloon): void {
    this.balloons.set(balloon.id, balloon);
  }

  public async findPageContextByIdAndUserId(pageId: string, userId: string): Promise<PageBalloonContext | null> {
    return this.pageContexts.get(`${userId}:${pageId}`) ?? null;
  }

  public async findBalloonContextByIdAndUserId(
    balloonId: string,
    userId: string,
  ): Promise<BalloonContext | null> {
    return this.balloonContexts.get(`${userId}:${balloonId}`) ?? null;
  }

  public async createBalloon(pageId: string, input: CreateBalloonInput): Promise<Balloon> {
    const balloon = buildBalloon({
      id: `balloon-${this.balloons.size + 1}`,
      pageId,
      ...input,
    });
    this.balloons.set(balloon.id, balloon);
    return balloon;
  }

  public async findBalloonsByPageIdAndUserId(pageId: string, userId: string): Promise<Balloon[]> {
    const context = await this.findPageContextByIdAndUserId(pageId, userId);
    if (context === null) {
      return [];
    }

    return [...this.balloons.values()].filter((balloon) => balloon.pageId === context.pageId);
  }

  public async updateBalloon(
    balloonId: string,
    _userId: string,
    input: UpdateBalloonInput,
  ): Promise<Balloon | null> {
    const balloon = this.balloons.get(balloonId);
    if (balloon === undefined) {
      return null;
    }

    const updated: Balloon = {
      ...balloon,
      speakerEntityId: input.speakerEntityId === undefined ? balloon.speakerEntityId : input.speakerEntityId,
      balloonType: input.balloonType ?? balloon.balloonType,
      writingMode: input.writingMode ?? balloon.writingMode,
      text: input.text ?? balloon.text,
      position: input.position ?? balloon.position,
      tail: input.tail === undefined ? balloon.tail : input.tail,
      fontSize: input.fontSize ?? balloon.fontSize,
      fontFamily: input.fontFamily ?? balloon.fontFamily,
      panelOrderReference:
        input.panelOrderReference === undefined ? balloon.panelOrderReference : input.panelOrderReference,
      zIndex: input.zIndex ?? balloon.zIndex,
    };
    this.balloons.set(balloonId, updated);
    return updated;
  }

  public async deleteBalloon(balloonId: string, _userId: string): Promise<boolean> {
    return this.balloons.delete(balloonId);
  }
}

class FakeEntityReader implements EntityReferenceReader {
  private readonly entities = new Map<string, Entity>();

  public addEntity(entity: Entity): void {
    this.entities.set(`${entity.userId}:${entity.id}`, entity);
  }

  public async countByIdsAndWorkIdAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
  ): Promise<number> {
    return [...new Set(entityIds)].filter((entityId) => {
      const entity = this.entities.get(`${userId}:${entityId}`);
      return entity?.workId === workId;
    }).length;
  }
}

describe('BalloonService', () => {
  it('生成済みの mixed ページなら Balloon を作成できる', async () => {
    const { service, repository } = createService();
    repository.addPageContext('user-1', basePageContext);

    const balloon = await service.createBalloon('user-1', 'page-1', buildCreateInput());

    expect(balloon.pageId).toBe('page-1');
    expect(balloon.text).toBe('hello');
  });

  it('image_baked ページでは作成できない', async () => {
    const { service, repository } = createService();
    repository.addPageContext('user-1', {
      ...basePageContext,
      dialogueMode: 'image_baked',
    });

    await expect(service.createBalloon('user-1', 'page-1', buildCreateInput())).rejects.toMatchObject({
      code: 'CONFLICT',
    } satisfies Partial<AppError>);
  });

  it('生成前ページでは一覧取得できない', async () => {
    const { service, repository } = createService();
    repository.addPageContext('user-1', {
      ...basePageContext,
      hasGeneratedImage: false,
    });

    await expect(service.listBalloons('user-1', 'page-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    } satisfies Partial<AppError>);
  });

  it('別作品の speaker entity は設定できない', async () => {
    const { service, repository, entityReader } = createService();
    repository.addPageContext('user-1', basePageContext);
    entityReader.addEntity(buildEntity({ id: 'entity-2', workId: 'work-2' }));

    await expect(
      service.createBalloon('user-1', 'page-1', buildCreateInput({ speakerEntityId: 'entity-2' })),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    } satisfies Partial<AppError>);
  });

  it('confirmed ページでは reopen 前に編集できない', async () => {
    const { service, repository } = createService();
    repository.addPageContext('user-1', {
      ...basePageContext,
      status: 'confirmed',
    });

    await expect(service.createBalloon('user-1', 'page-1', buildCreateInput())).rejects.toMatchObject({
      code: 'CONFLICT',
    } satisfies Partial<AppError>);
  });

  it('存在しない panel_order_reference は作成できない', async () => {
    const { service, repository } = createService();
    repository.addPageContext('user-1', basePageContext);

    await expect(
      service.createBalloon('user-1', 'page-1', buildCreateInput({ panelOrderReference: 4 })),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    } satisfies Partial<AppError>);
  });

  it('更新時も speaker entity の作品整合性を検証する', async () => {
    const { service, repository, entityReader } = createService();
    repository.addBalloonContext('user-1', {
      balloonId: 'balloon-1',
      pageId: 'page-1',
      workId: 'work-1',
      status: 'editing',
      dialogueMode: 'mixed',
      hasGeneratedImage: true,
      panelCount: 3,
    });
    repository.seedBalloon(buildBalloon({ id: 'balloon-1' }));
    entityReader.addEntity(buildEntity({ id: 'entity-9', workId: 'work-2' }));

    await expect(
      service.updateBalloon('user-1', 'balloon-1', { speakerEntityId: 'entity-9' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    } satisfies Partial<AppError>);
  });

  it('更新時も存在しない panel_order_reference を弾く', async () => {
    const { service, repository } = createService();
    repository.addBalloonContext('user-1', {
      balloonId: 'balloon-1',
      pageId: 'page-1',
      workId: 'work-1',
      status: 'editing',
      dialogueMode: 'mixed',
      hasGeneratedImage: true,
      panelCount: 2,
    });
    repository.seedBalloon(buildBalloon({ id: 'balloon-1' }));

    await expect(
      service.updateBalloon('user-1', 'balloon-1', { panelOrderReference: 3 }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    } satisfies Partial<AppError>);
  });

  it('Balloon が存在しなければ削除で NOT_FOUND になる', async () => {
    const { service } = createService();

    await expect(service.deleteBalloon('user-1', 'balloon-404')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    } satisfies Partial<AppError>);
  });
});

function createService(): {
  service: BalloonService;
  repository: FakeBalloonRepository;
  entityReader: FakeEntityReader;
} {
  const repository = new FakeBalloonRepository();
  const entityReader = new FakeEntityReader();

  return {
    service: new BalloonService(repository, entityReader),
    repository,
    entityReader,
  };
}

function buildCreateInput(overrides: Partial<CreateBalloonInput> = {}): CreateBalloonInput {
  return {
    speakerEntityId: null,
    balloonType: 'speech',
    writingMode: 'vertical',
    text: 'hello',
    position: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
    tail: { baseX: 0.2, baseY: 0.3, tipX: 0.4, tipY: 0.5 },
    fontSize: 18,
    fontFamily: 'manga_gothic',
    panelOrderReference: 1,
    zIndex: 10,
    ...overrides,
  };
}

function buildBalloon(overrides: Partial<Balloon> & Pick<Balloon, 'id'>): Balloon {
  const { id, ...rest } = overrides;

  return {
    id,
    pageId: 'page-1',
    speakerEntityId: null,
    balloonType: 'speech',
    writingMode: 'vertical',
    text: 'hello',
    position: { x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
    tail: { baseX: 0.2, baseY: 0.3, tipX: 0.4, tipY: 0.5 },
    fontSize: 18,
    fontFamily: 'manga_gothic',
    panelOrderReference: 1,
    zIndex: 10,
    ...rest,
  };
}

function buildEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'entity-1',
    workId: 'work-1',
    userId: 'user-1',
    entityType: 'character',
    name: 'hero',
    freeDescription: null,
    structuredFields: {},
    promptSupplement: null,
    speechProfile: {},
    status: 'draft',
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:00:00.000Z'),
    ...overrides,
  };
}
