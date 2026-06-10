import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../../../src/domain/errors/index.js';
import type { CreatePanelInput, Panel, UpdatePanelInput } from '../../../../src/domain/types/panel.js';
import type { PageLayoutFrameUpdate, PanelFrame } from '../../../../src/domain/types/panelFrame.js';
import type { PageStatus } from '../../../../src/domain/types/page.js';
import type { EntityReferenceReader } from '../../../../src/repositories/EntityRepository.js';
import type { PanelFrameRepository, UpsertPanelFrameInput } from '../../../../src/repositories/PanelFrameRepository.js';
import type { PagePanelContext, PanelContext, PanelRepository } from '../../../../src/repositories/PanelRepository.js';
import {
  PanelService,
  type CompositionGalleryReferenceReader,
} from '../../../../src/services/page/PanelService.js';

const userId = 'user-1';
const pageId = '11111111-1111-4111-8111-111111111111';
const panelId = '22222222-2222-4222-8222-222222222222';
const workId = '33333333-3333-4333-8333-333333333333';
const entityId = '44444444-4444-4444-8444-444444444444';

class FakePanelRepository implements PanelRepository {
  public pageContext: PagePanelContext | null = { pageId, workId, pageStatus: 'editing' };
  public panelContext: PanelContext | null = {
    panelId,
    pageId,
    panelOrder: 2,
    workId,
    pageStatus: 'editing',
  };
  public savedCreateInput: CreatePanelInput | null = null;
  public savedUpdateInput: UpdatePanelInput | null = null;
  public compactedDeleteOrder: number | null = null;
  public pagePanels: Panel[] = [buildPanel({ order: 1 }), buildPanel({ id: 'panel-3', order: 2 })];

  public async findPageContextByIdAndUserId(
    requestedPageId: string,
    _userId: string,
  ): Promise<PagePanelContext | null> {
    return this.pageContext === null ? null : { ...this.pageContext, pageId: requestedPageId };
  }

  public async findPanelContextByIdAndUserId(
    requestedPanelId: string,
    _userId: string,
  ): Promise<PanelContext | null> {
    return this.panelContext === null ? null : { ...this.panelContext, panelId: requestedPanelId };
  }

  public async createPanel(
    requestedPageId: string,
    _userId: string,
    input: CreatePanelInput,
  ): Promise<Panel | null> {
    this.savedCreateInput = input;
    return buildPanel({ pageId: requestedPageId, ...input });
  }

  public async findPanelsByPageIdAndUserId(requestedPageId: string, _userId: string): Promise<Panel[]> {
    return this.pagePanels.map((panel) => ({ ...panel, pageId: requestedPageId }));
  }

  public async updatePanel(
    requestedPanelId: string,
    _userId: string,
    input: UpdatePanelInput,
  ): Promise<Panel | null> {
    this.savedUpdateInput = input;
    return buildPanel({ id: requestedPanelId, ...input });
  }

  public async deletePanel(_requestedPanelId: string, _userId: string): Promise<boolean> {
    return true;
  }

  public async compactPanelOrdersAfterDelete(
    _requestedPageId: string,
    _userId: string,
    deletedOrder: number,
  ): Promise<void> {
    this.compactedDeleteOrder = deletedOrder;
  }
}

class FakePanelFrameRepository implements PanelFrameRepository {
  public frames: PanelFrame[] = [
    buildFrame('frame-1', 1),
    buildFrame('frame-2', 2),
    buildFrame('frame-3', 3),
  ];
  public replacedFrames: UpsertPanelFrameInput[] | null = null;
  public replacedLayoutUpdate: PageLayoutFrameUpdate | undefined;

  public async findPageContextByIdAndUserId(): Promise<never> {
    throw new Error('not used');
  }

  public async findPanelIdsByPageIdAndUserId(): Promise<never> {
    throw new Error('not used');
  }

  public async findFramesByPageIdAndUserId(): Promise<PanelFrame[]> {
    return this.frames.map((frame) => ({
      ...frame,
      vertices: frame.vertices.map((vertex) => ({ ...vertex })),
    }));
  }

  public async replaceFramesByPageIdAndUserId(
    _pageId: string,
    _userId: string,
    frames: UpsertPanelFrameInput[],
    layoutUpdate?: PageLayoutFrameUpdate,
  ): Promise<PanelFrame[]> {
    this.replacedFrames = frames;
    this.replacedLayoutUpdate = layoutUpdate;
    return frames.map((frame) => ({
      id: frame.id ?? 'generated-frame',
      pageId,
      panelId: frame.panelId,
      vertices: frame.vertices,
      borderStyle: frame.borderStyle,
      borderWidth: frame.borderWidth,
      borderColor: frame.borderColor,
      zIndex: frame.zIndex,
      readingOrder: frame.readingOrder,
    }));
  }
}

class FakeEntityReader implements EntityReferenceReader {
  public matchedEntityCount = 1;

  public async countByIdsAndWorkIdAndUserId(
    entityIds: string[],
    _workId: string,
    _userId: string,
  ): Promise<number> {
    return entityIds.length === 0 ? 0 : this.matchedEntityCount;
  }
}

class FakeCompositionGalleryReader implements CompositionGalleryReferenceReader {
  public itemIds = new Set(['battle_single_001']);

  public async findByIds(ids: string[]): Promise<Array<{ id: string }>> {
    return ids.filter((id) => this.itemIds.has(id)).map((id) => ({ id }));
  }
}

describe('PanelService', () => {
  it('creates a panel when the page is editable', async () => {
    const repository = new FakePanelRepository();
    const entityReader = new FakeEntityReader();
    const service = new PanelService(repository, entityReader, new FakePanelFrameRepository());

    const panel = await service.createPanel(userId, pageId, buildCreateInput());

    expect(repository.savedCreateInput).toMatchObject({
      order: 1,
      panelRole: 'action',
      dialogue: [expect.objectContaining({ entityId })],
    });
    expect(panel.id).toBe(panelId);
  });

  it('throws not found when the page does not exist', async () => {
    const repository = new FakePanelRepository();
    repository.pageContext = null;
    const service = new PanelService(repository, new FakeEntityReader(), new FakePanelFrameRepository());

    await expect(service.createPanel(userId, pageId, buildCreateInput())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('throws validation error when dialogue speaker is outside the work', async () => {
    const repository = new FakePanelRepository();
    const entityReader = new FakeEntityReader();
    entityReader.matchedEntityCount = 0;
    const service = new PanelService(repository, entityReader, new FakePanelFrameRepository());

    await expect(service.createPanel(userId, pageId, buildCreateInput())).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('requires speaker entity ids for spoken dialogue', async () => {
    const repository = new FakePanelRepository();
    const service = new PanelService(repository, new FakeEntityReader(), new FakePanelFrameRepository());

    await expect(
      service.createPanel(userId, pageId, {
        ...buildCreateInput(),
        dialogue: [
          {
            entityId: null,
            text: 'Take this!',
            type: 'speech',
            position: 'top',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws not found when the panel does not exist during update', async () => {
    const repository = new FakePanelRepository();
    repository.panelContext = null;
    const service = new PanelService(repository, new FakeEntityReader(), new FakePanelFrameRepository());

    await expect(
      service.updatePanel(userId, panelId, {
        panelNotes: 'updated',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('allows null speaker ids for sfx dialogue', async () => {
    const repository = new FakePanelRepository();
    const service = new PanelService(repository, new FakeEntityReader(), new FakePanelFrameRepository());

    const panel = await service.createPanel(userId, pageId, {
      ...buildCreateInput(),
      dialogue: [
        {
          entityId: null,
          text: 'Boom',
          type: 'sfx',
          position: 'center',
        },
      ],
    });

    expect(repository.savedCreateInput?.dialogue?.[0]).toMatchObject({
      entityId: null,
      type: 'sfx',
    });
    expect(panel.dialogue[0]?.entityId).toBeNull();
  });

  it('clears stale gallery ids for custom composition', async () => {
    const repository = new FakePanelRepository();
    const service = new PanelService(repository, new FakeEntityReader(), new FakePanelFrameRepository());

    const panel = await service.createPanel(userId, pageId, {
      ...buildCreateInput(),
      composition: {
        source: 'custom',
        galleryItemId: 'stale-gallery-id',
        compositionPrompt: 'full body',
        shotType: 'full_body',
        angle: 'front',
        customNote: null,
      },
    });

    expect(repository.savedCreateInput?.composition).toMatchObject({
      source: 'custom',
      galleryItemId: null,
      compositionPrompt: 'full body',
      shotType: 'full_body',
      angle: 'front',
    });
    expect(panel.composition.galleryItemId).toBeNull();
  });

  it('requires a gallery item id when composition source is gallery', async () => {
    const repository = new FakePanelRepository();
    const service = new PanelService(repository, new FakeEntityReader(), new FakePanelFrameRepository());

    await expect(
      service.createPanel(userId, pageId, {
        ...buildCreateInput(),
        composition: {
          source: 'gallery',
          galleryItemId: null,
          compositionPrompt: null,
          shotType: null,
          angle: null,
          customNote: null,
        },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects unknown gallery item ids before saving panel composition', async () => {
    const repository = new FakePanelRepository();
    const galleryReader = new FakeCompositionGalleryReader();
    galleryReader.itemIds.clear();
    const service = new PanelService(
      repository,
      new FakeEntityReader(),
      new FakePanelFrameRepository(),
      galleryReader,
    );

    await expect(
      service.createPanel(userId, pageId, {
        ...buildCreateInput(),
        composition: {
          source: 'gallery',
          galleryItemId: 'missing-gallery-id',
          compositionPrompt: null,
          shotType: null,
          angle: null,
          customNote: null,
        },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repository.savedCreateInput).toBeNull();
  });

  it('throws not found when delete reports false', async () => {
    const repository = new FakePanelRepository();
    repository.deletePanel = async () => false;
    const service = new PanelService(repository, new FakeEntityReader(), new FakePanelFrameRepository());

    await expect(service.deletePanel(userId, panelId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('compacts panel order and frame order together after delete', async () => {
    const repository = new FakePanelRepository();
    const frameRepository = new FakePanelFrameRepository();
    const service = new PanelService(repository, new FakeEntityReader(), frameRepository);

    await service.deletePanel(userId, panelId);

    expect(repository.compactedDeleteOrder).toBe(2);
    expect(frameRepository.replacedFrames).toMatchObject([
      { id: 'frame-1', readingOrder: 1 },
      { id: 'frame-3', readingOrder: 2 },
    ]);
    expect(frameRepository.replacedLayoutUpdate).toMatchObject({
      type: 'custom',
      panelCount: 2,
    });
  });

  it.each(['confirmed', 'generating'] satisfies PageStatus[])(
    '%s page cannot create panels',
    async (pageStatus) => {
      const repository = new FakePanelRepository();
      repository.pageContext = { pageId, workId, pageStatus };
      const service = new PanelService(repository, new FakeEntityReader(), new FakePanelFrameRepository());

      await expect(service.createPanel(userId, pageId, buildCreateInput())).rejects.toBeInstanceOf(
        ConflictError,
      );
    },
  );

  it.each(['confirmed', 'generating'] satisfies PageStatus[])(
    '%s page cannot update panels',
    async (pageStatus) => {
      const repository = new FakePanelRepository();
      repository.panelContext = { panelId, pageId, panelOrder: 2, workId, pageStatus };
      const service = new PanelService(repository, new FakeEntityReader(), new FakePanelFrameRepository());

      await expect(
        service.updatePanel(userId, panelId, { panelNotes: 'updated' }),
      ).rejects.toBeInstanceOf(ConflictError);
    },
  );

  it.each(['confirmed', 'generating'] satisfies PageStatus[])(
    '%s page cannot delete panels',
    async (pageStatus) => {
      const repository = new FakePanelRepository();
      repository.panelContext = { panelId, pageId, panelOrder: 2, workId, pageStatus };
      const service = new PanelService(repository, new FakeEntityReader(), new FakePanelFrameRepository());

      await expect(service.deletePanel(userId, panelId)).rejects.toBeInstanceOf(ConflictError);
    },
  );
});

function buildCreateInput(overrides: Partial<CreatePanelInput> = {}): CreatePanelInput {
  return {
    order: 1,
    panelRole: 'action',
    panelSize: 'standard',
    situationText: 'A dramatic action panel',
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
    situationText: 'A dramatic action panel',
    entities: [],
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

function buildFrame(id: string, readingOrder: number): PanelFrame {
  return {
    id,
    pageId,
    panelId: null,
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
    readingOrder,
  };
}
