import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '../../../../src/domain/errors/index.js';
import type {
  CreatePanelInput,
  Panel,
  UpdatePanelInput,
} from '../../../../src/domain/types/panel.js';
import type { EntityReferenceReader } from '../../../../src/repositories/EntityRepository.js';
import type {
  PagePanelContext,
  PanelContext,
  PanelRepository,
} from '../../../../src/repositories/PanelRepository.js';
import { PanelService } from '../../../../src/services/page/PanelService.js';

const userId = 'user-1';
const pageId = '11111111-1111-4111-8111-111111111111';
const panelId = '22222222-2222-4222-8222-222222222222';
const workId = '33333333-3333-4333-8333-333333333333';
const entityId = '44444444-4444-4444-8444-444444444444';

class FakePanelRepository implements PanelRepository {
  public pageContext: PagePanelContext | null = { pageId, workId };
  public panelContext: PanelContext | null = { panelId, pageId, workId };
  public savedCreateInput: CreatePanelInput | null = null;
  public savedUpdateInput: UpdatePanelInput | null = null;

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
    return [buildPanel({ pageId: requestedPageId })];
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

describe('PanelService', () => {
  it('Pageが存在する場合にPanelを作成できる', async () => {
    const repository = new FakePanelRepository();
    const entityReader = new FakeEntityReader();
    const service = new PanelService(repository, entityReader);

    const panel = await service.createPanel(userId, pageId, buildCreateInput());

    expect(repository.savedCreateInput).toMatchObject({
      order: 1,
      panelRole: 'action',
      dialogue: [expect.objectContaining({ entityId })],
    });
    expect(panel.id).toBe(panelId);
  });

  it('Pageが存在しない場合にNOT_FOUNDになる', async () => {
    const repository = new FakePanelRepository();
    repository.pageContext = null;
    const service = new PanelService(repository, new FakeEntityReader());

    await expect(service.createPanel(userId, pageId, buildCreateInput())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('dialogueのentityIdが別workの場合にVALIDATION_ERRORになる', async () => {
    const repository = new FakePanelRepository();
    const entityReader = new FakeEntityReader();
    entityReader.matchedEntityCount = 0;
    const service = new PanelService(repository, entityReader);

    await expect(service.createPanel(userId, pageId, buildCreateInput())).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('speaker必須のdialogueでentityIdがnullの場合にVALIDATION_ERRORになる', async () => {
    const repository = new FakePanelRepository();
    const service = new PanelService(repository, new FakeEntityReader());

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

  it('Panelが存在しない場合にNOT_FOUNDになる', async () => {
    const repository = new FakePanelRepository();
    repository.panelContext = null;
    const service = new PanelService(repository, new FakeEntityReader());

    await expect(
      service.updatePanel(userId, panelId, {
        panelNotes: 'updated',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('speaker不要のdialogueはentityId nullを許可する', async () => {
    const repository = new FakePanelRepository();
    const service = new PanelService(repository, new FakeEntityReader());

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

  it('gallery以外のcompositionではgalleryItemIdを保存しない', async () => {
    const repository = new FakePanelRepository();
    const service = new PanelService(repository, new FakeEntityReader());

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

  it('gallery compositionでgalleryItemIdがない場合にVALIDATION_ERRORになる', async () => {
    const repository = new FakePanelRepository();
    const service = new PanelService(repository, new FakeEntityReader());

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

  it('Panelが存在しない場合に削除でNOT_FOUNDになる', async () => {
    const repository = new FakePanelRepository();
    repository.deletePanel = async () => false;
    const service = new PanelService(repository, new FakeEntityReader());

    await expect(service.deletePanel(userId, panelId)).rejects.toBeInstanceOf(NotFoundError);
  });
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
