import { describe, expect, it } from 'vitest';
import type { AppError } from '../../../../src/domain/errors/index.js';
import type { Balloon, CreateBalloonInput, UpdateBalloonInput } from '../../../../src/domain/types/balloon.js';
import type { Entity } from '../../../../src/domain/types/entity.js';
import type { Panel } from '../../../../src/domain/types/panel.js';
import type { PanelFrame } from '../../../../src/domain/types/panelFrame.js';
import type {
  BalloonContext,
  BalloonRepository,
  PageBalloonContext,
} from '../../../../src/repositories/BalloonRepository.js';
import type { EntityReferenceReader } from '../../../../src/repositories/EntityRepository.js';
import { BalloonService, type BalloonFrameReader, type BalloonPanelReader } from '../../../../src/services/page/BalloonService.js';

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
  public replacedInputs: CreateBalloonInput[] | null = null;

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

  public async replaceBalloonsByPageIdAndUserId(
    pageId: string,
    _userId: string,
    inputs: CreateBalloonInput[],
  ): Promise<Balloon[]> {
    this.replacedInputs = inputs;
    this.balloons.clear();
    return inputs.map((input, index) => {
      const balloon = buildBalloon({
        id: `auto-${index + 1}`,
        pageId,
        ...input,
      });
      this.balloons.set(balloon.id, balloon);
      return balloon;
    });
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

class FakePanelReader implements BalloonPanelReader {
  public panels: Panel[] = [];

  public async findPanelsByPageIdAndUserId(_pageId: string, _userId: string): Promise<Panel[]> {
    return this.panels;
  }
}

class FakeFrameReader implements BalloonFrameReader {
  public frames: PanelFrame[] = [];

  public async findFramesByPageIdAndUserId(_pageId: string, _userId: string): Promise<PanelFrame[]> {
    return this.frames;
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

  it('auto-balloons は mixed ページで dialogue_in_panel=false の台詞だけ配置する', async () => {
    const { service, repository, panelReader, frameReader, entityReader } = createService();
    repository.addPageContext('user-1', basePageContext);
    entityReader.addEntity(buildEntity());
    panelReader.panels = [
      buildPanel({
        id: 'panel-1',
        order: 1,
        dialogueInPanel: false,
        dialogue: [
          {
            entityId: 'entity-1',
            text: 'first',
            type: 'speech',
            position: 'top',
          },
        ],
      }),
      buildPanel({
        id: 'panel-2',
        order: 2,
        dialogueInPanel: true,
        dialogue: [
          {
            entityId: 'entity-1',
            text: 'baked',
            type: 'speech',
            position: 'bottom',
          },
        ],
      }),
    ];
    frameReader.frames = [
      buildFrame({ id: 'frame-1', panelId: 'panel-1', readingOrder: 1 }),
      buildFrame({ id: 'frame-2', panelId: 'panel-2', readingOrder: 2 }),
    ];

    const balloons = await service.autoGenerateBalloons('user-1', 'page-1');

    expect(balloons).toHaveLength(1);
    expect(repository.replacedInputs).toHaveLength(1);
    expect(repository.replacedInputs?.[0]).toMatchObject({
      text: 'first',
      panelOrderReference: 1,
      balloonType: 'speech',
    });
  });

  it('auto-balloons は balloon_only ページで全ての台詞を対象にする', async () => {
    const { service, repository, panelReader, frameReader, entityReader } = createService();
    repository.addPageContext('user-1', {
      ...basePageContext,
      dialogueMode: 'balloon_only',
    });
    entityReader.addEntity(buildEntity());
    panelReader.panels = [
      buildPanel({
        id: 'panel-1',
        order: 1,
        dialogueInPanel: true,
        dialogue: [
          {
            entityId: 'entity-1',
            text: 'speech',
            type: 'speech',
            position: 'top',
          },
          {
            entityId: null,
            text: 'boom',
            type: 'sfx',
            position: 'center',
          },
        ],
      }),
    ];
    frameReader.frames = [buildFrame({ id: 'frame-1', panelId: 'panel-1', readingOrder: 1 })];

    const balloons = await service.autoGenerateBalloons('user-1', 'page-1');

    expect(balloons).toHaveLength(2);
    expect(repository.replacedInputs?.[1]).toMatchObject({
      text: 'boom',
      balloonType: 'sfx',
      writingMode: 'horizontal',
    });
  });

  it('auto-balloons は対象台詞がなければ VALIDATION_ERROR になる', async () => {
    const { service, repository } = createService();
    repository.addPageContext('user-1', basePageContext);

    await expect(service.autoGenerateBalloons('user-1', 'page-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    } satisfies Partial<AppError>);
  });

  it('auto-balloons は frame が足りないと VALIDATION_ERROR になる', async () => {
    const { service, repository, panelReader } = createService();
    repository.addPageContext('user-1', basePageContext);
    panelReader.panels = [
      buildPanel({
        id: 'panel-1',
        order: 1,
        dialogueInPanel: false,
        dialogue: [
          {
            entityId: 'entity-1',
            text: 'first',
            type: 'speech',
            position: 'top',
          },
        ],
      }),
    ];

    await expect(service.autoGenerateBalloons('user-1', 'page-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    } satisfies Partial<AppError>);
  });

  it('auto-balloons は小さい frame でも panel 内に収める', async () => {
    const { service, repository, panelReader, frameReader, entityReader } = createService();
    repository.addPageContext('user-1', basePageContext);
    entityReader.addEntity(buildEntity());
    panelReader.panels = [
      buildPanel({
        id: 'panel-1',
        order: 1,
        dialogueInPanel: false,
        dialogue: [
          {
            entityId: 'entity-1',
            text: 'tight',
            type: 'speech',
            position: 'top',
          },
        ],
      }),
    ];
    frameReader.frames = [
      buildFrame({
        id: 'frame-1',
        panelId: 'panel-1',
        vertices: [
          { x: 0.05, y: 0.05 },
          { x: 0.14, y: 0.05 },
          { x: 0.14, y: 0.18 },
          { x: 0.05, y: 0.18 },
        ],
      }),
    ];

    await service.autoGenerateBalloons('user-1', 'page-1');

    const position = repository.replacedInputs?.[0]?.position;

    expect((position?.width ?? 1) <= 0.09 * 0.88 + 1e-6).toBe(true);
    expect((position?.height ?? 1) <= 0.13 * 0.88 + 1e-6).toBe(true);
    expect(position === undefined ? undefined : { ...position }).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    });
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
  panelReader: FakePanelReader;
  frameReader: FakeFrameReader;
} {
  const repository = new FakeBalloonRepository();
  const entityReader = new FakeEntityReader();
  const panelReader = new FakePanelReader();
  const frameReader = new FakeFrameReader();

  return {
    service: new BalloonService(repository, entityReader, panelReader, frameReader),
    repository,
    entityReader,
    panelReader,
    frameReader,
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

function buildPanel(overrides: Partial<Panel> = {}): Panel {
  return {
    id: 'panel-1',
    pageId: 'page-1',
    order: 1,
    panelRole: 'action',
    panelSize: 'standard',
    situationText: null,
    entities: [],
    composition: {
      source: 'custom',
      galleryItemId: null,
      compositionPrompt: null,
      shotType: null,
      angle: null,
      customNote: null,
    },
    dialogueInPanel: false,
    dialogue: [],
    sfxText: null,
    backgroundNote: null,
    panelNotes: null,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:00:00.000Z'),
    ...overrides,
  };
}

function buildFrame(overrides: Partial<PanelFrame> & Pick<PanelFrame, 'id'>): PanelFrame {
  const { id, ...rest } = overrides;

  return {
    id,
    pageId: 'page-1',
    panelId: 'panel-1',
    vertices: [
      { x: 0.05, y: 0.05 },
      { x: 0.45, y: 0.05 },
      { x: 0.45, y: 0.45 },
      { x: 0.05, y: 0.45 },
    ],
    borderStyle: 'solid',
    borderWidth: 3,
    borderColor: '#000000',
    zIndex: 1,
    readingOrder: 1,
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
