import { describe, expect, it } from 'vitest';
import type { AppError } from '../../../../src/domain/errors/index.js';
import type {
  CreatePageInput,
  CreatePanelInput,
  Page,
  PageContext,
  PageRepository,
  PageSceneContext,
  Panel,
  PanelContext,
  PanelEntityStateReference,
  UpdatePageInput,
  UpdatePanelInput,
} from '../../../../src/repositories/PageRepository.js';
import { PageService, type PageEntityReferenceReader } from '../../../../src/services/page/PageService.js';

const now = new Date('2026-04-22T00:00:00.000Z');

class FakePageRepository implements PageRepository {
  private readonly episodeContexts = new Map<string, PageContext>();
  private readonly sceneContexts = new Map<string, PageSceneContext>();
  private readonly pages = new Map<string, Page>();
  private readonly panels = new Map<string, Panel>();
  private readonly validStateReferences = new Set<string>();

  public addEpisodeContext(userId: string, episodeId: string, workId: string): void {
    this.episodeContexts.set(`${userId}:${episodeId}`, { episodeId, workId });
  }

  public addSceneContext(userId: string, sceneId: string, episodeId: string, workId: string): void {
    this.sceneContexts.set(`${userId}:${sceneId}`, { sceneId, episodeId, workId });
  }

  public addStateReference(userId: string, workId: string, entityId: string, stateId: string): void {
    this.validStateReferences.add(`${userId}:${workId}:${entityId}:${stateId}`);
  }

  public async findEpisodeContextByIdAndUserId(episodeId: string, userId: string): Promise<PageContext | null> {
    return this.episodeContexts.get(`${userId}:${episodeId}`) ?? null;
  }

  public async findSceneContextByIdAndUserId(sceneId: string, userId: string): Promise<PageSceneContext | null> {
    return this.sceneContexts.get(`${userId}:${sceneId}`) ?? null;
  }

  public async findPageContextByIdAndUserId(pageId: string, userId: string): Promise<PageContext | null> {
    const page = this.pages.get(pageId);
    if (page === undefined) {
      return null;
    }

    return this.findEpisodeContextByIdAndUserId(page.episodeId, userId);
  }

  public async findPanelContextByIdAndUserId(panelId: string, userId: string): Promise<PanelContext | null> {
    const panel = this.panels.get(panelId);
    if (panel === undefined) {
      return null;
    }

    const pageContext = await this.findPageContextByIdAndUserId(panel.pageId, userId);
    if (pageContext === null) {
      return null;
    }

    return { panelId, pageId: panel.pageId, episodeId: pageContext.episodeId, workId: pageContext.workId };
  }

  public async createPage(episodeId: string, input: CreatePageInput): Promise<Page> {
    const page = buildPage({
      id: `page-${this.pages.size + 1}`,
      episodeId,
      sceneId: input.sceneId,
      pageNumber: input.pageNumber,
      layoutConfig: input.layoutConfig,
      dialogueMode: input.dialogueMode,
      pageDialogueToggle: input.pageDialogueToggle,
    });
    this.pages.set(page.id, page);
    return page;
  }

  public async findPagesByEpisodeIdAndUserId(episodeId: string, userId: string): Promise<Page[]> {
    const episodeContext = await this.findEpisodeContextByIdAndUserId(episodeId, userId);
    if (episodeContext === null) {
      return [];
    }

    return [...this.pages.values()].filter((page) => page.episodeId === episodeId);
  }

  public async findPageByIdAndUserId(pageId: string, userId: string): Promise<Page | null> {
    const pageContext = await this.findPageContextByIdAndUserId(pageId, userId);
    return pageContext === null ? null : this.pages.get(pageId) ?? null;
  }

  public async updatePage(pageId: string, userId: string, input: UpdatePageInput): Promise<Page | null> {
    const page = await this.findPageByIdAndUserId(pageId, userId);
    if (page === null) {
      return null;
    }

    const updatedPage = buildPage({
      ...page,
      sceneId: input.sceneId === undefined ? page.sceneId : input.sceneId,
      pageNumber: input.pageNumber ?? page.pageNumber,
      layoutConfig: input.layoutConfig ?? page.layoutConfig,
      dialogueMode: input.dialogueMode ?? page.dialogueMode,
      pageDialogueToggle: input.pageDialogueToggle ?? page.pageDialogueToggle,
      status: input.status ?? page.status,
      updatedAt: now,
    });
    this.pages.set(pageId, updatedPage);
    return updatedPage;
  }

  public async deletePage(pageId: string, userId: string): Promise<boolean> {
    const page = await this.findPageByIdAndUserId(pageId, userId);
    return page === null ? false : this.pages.delete(pageId);
  }

  public async createPanel(pageId: string, input: CreatePanelInput): Promise<Panel> {
    const panel = buildPanel({
      id: `panel-${this.panels.size + 1}`,
      pageId,
      order: input.order,
      entities: input.entities,
      dialogue: input.dialogue,
    });
    this.panels.set(panel.id, panel);
    return panel;
  }

  public async findPanelsByPageIdAndUserId(pageId: string, userId: string): Promise<Panel[]> {
    const pageContext = await this.findPageContextByIdAndUserId(pageId, userId);
    if (pageContext === null) {
      return [];
    }

    return [...this.panels.values()].filter((panel) => panel.pageId === pageId);
  }

  public async updatePanel(panelId: string, userId: string, input: UpdatePanelInput): Promise<Panel | null> {
    const panelContext = await this.findPanelContextByIdAndUserId(panelId, userId);
    if (panelContext === null) {
      return null;
    }

    const panel = this.panels.get(panelId);
    if (panel === undefined) {
      return null;
    }

    const updatedPanel = buildPanel({
      ...panel,
      order: input.order ?? panel.order,
      entities: input.entities ?? panel.entities,
      dialogue: input.dialogue ?? panel.dialogue,
      updatedAt: now,
    });
    this.panels.set(panelId, updatedPanel);
    return updatedPanel;
  }

  public async deletePanel(panelId: string, userId: string): Promise<boolean> {
    const panelContext = await this.findPanelContextByIdAndUserId(panelId, userId);
    return panelContext === null ? false : this.panels.delete(panelId);
  }

  public async countEntityStatesByReferencesAndWorkIdAndUserId(
    references: PanelEntityStateReference[],
    workId: string,
    userId: string,
  ): Promise<number> {
    return references.filter((reference) =>
      this.validStateReferences.has(`${userId}:${workId}:${reference.entityId}:${reference.stateId}`),
    ).length;
  }
}

class FakeEntityReferenceReader implements PageEntityReferenceReader {
  public ownedEntityIds = new Set<string>();

  public async countByIdsAndWorkIdAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
  ): Promise<number> {
    return entityIds.filter((entityId) => this.ownedEntityIds.has(`${userId}:${workId}:${entityId}`))
      .length;
  }
}

describe('PageService', () => {
  it('所有している話へPageを作成できる', async () => {
    const { service, pageRepository } = createService();
    pageRepository.addEpisodeContext('user-1', 'episode-1', 'work-1');
    pageRepository.addSceneContext('user-1', 'scene-1', 'episode-1', 'work-1');

    const page = await service.createPage('user-1', 'episode-1', {
      sceneId: 'scene-1',
      pageNumber: 1,
      layoutConfig: buildLayoutConfig(),
      dialogueMode: 'image_baked',
      pageDialogueToggle: true,
    });

    expect(page.episodeId).toBe('episode-1');
    expect(page.sceneId).toBe('scene-1');
    expect(page.layoutConfig.templateId).toBe('standard_4');
  });

  it('Page作成でSceneが別Episodeの場合にVALIDATION_ERRORになる', async () => {
    const { service, pageRepository } = createService();
    pageRepository.addEpisodeContext('user-1', 'episode-1', 'work-1');
    pageRepository.addSceneContext('user-1', 'scene-1', 'episode-2', 'work-1');

    await expect(
      service.createPage('user-1', 'episode-1', {
        sceneId: 'scene-1',
        pageNumber: 1,
        layoutConfig: buildLayoutConfig(),
        dialogueMode: 'image_baked',
        pageDialogueToggle: true,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' } satisfies Partial<AppError>);
  });

  it('テンプレートのpanelCountが一致しない場合にVALIDATION_ERRORになる', async () => {
    const { service, pageRepository } = createService();
    pageRepository.addEpisodeContext('user-1', 'episode-1', 'work-1');

    await expect(
      service.createPage('user-1', 'episode-1', {
        sceneId: null,
        pageNumber: 1,
        layoutConfig: {
          ...buildLayoutConfig(),
          panelCount: 3,
        },
        dialogueMode: 'image_baked',
        pageDialogueToggle: true,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' } satisfies Partial<AppError>);
  });

  it('所有していないPage取得の場合にNOT_FOUNDになる', async () => {
    const { service } = createService();

    await expect(service.getPage('user-2', 'page-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    } satisfies Partial<AppError>);
  });

  it('Panel内の作品外エンティティ参照の場合にVALIDATION_ERRORになる', async () => {
    const { service, pageRepository } = createService();
    pageRepository.addEpisodeContext('user-1', 'episode-1', 'work-1');
    await pageRepository.createPage('episode-1', {
      sceneId: null,
      pageNumber: 1,
      layoutConfig: buildLayoutConfig(),
      dialogueMode: 'image_baked',
      pageDialogueToggle: true,
    });

    await expect(
      service.createPanel('user-1', 'page-1', {
        order: 1,
        panelRole: 'action',
        panelSize: 'standard',
        situationText: null,
        entities: [
          {
            entityId: 'entity-1',
            role: 'primary',
            expression: 'determined',
            customExpression: null,
            action: 'attacking',
            customAction: null,
            position: 'center',
            stateId: null,
          },
        ],
        composition: buildComposition(),
        dialogueInPanel: true,
        dialogue: [],
        sfxText: null,
        backgroundNote: null,
        panelNotes: null,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' } satisfies Partial<AppError>);
  });

  it('Panel内のentity_stateがentityと一致する場合にPanelを作成できる', async () => {
    const { service, pageRepository, entityReferenceReader } = createService();
    pageRepository.addEpisodeContext('user-1', 'episode-1', 'work-1');
    entityReferenceReader.ownedEntityIds.add('user-1:work-1:entity-1');
    pageRepository.addStateReference('user-1', 'work-1', 'entity-1', 'state-1');
    await pageRepository.createPage('episode-1', {
      sceneId: null,
      pageNumber: 1,
      layoutConfig: buildLayoutConfig(),
      dialogueMode: 'image_baked',
      pageDialogueToggle: true,
    });

    const panel = await service.createPanel('user-1', 'page-1', {
      order: 1,
      panelRole: 'action',
      panelSize: 'standard',
      situationText: '月華が槍を構える',
      entities: [
        {
          entityId: 'entity-1',
          role: 'primary',
          expression: 'determined',
          customExpression: null,
          action: 'attacking',
          customAction: null,
          position: 'center',
          stateId: 'state-1',
        },
      ],
      composition: buildComposition(),
      dialogueInPanel: true,
      dialogue: [
        {
          entityId: 'entity-1',
          text: '行くぞ',
          type: 'speech',
          position: 'bottom',
        },
      ],
      sfxText: null,
      backgroundNote: null,
      panelNotes: null,
    });

    expect(panel.pageId).toBe('page-1');
    expect(panel.entities[0]?.stateId).toBe('state-1');
  });
});

function createService(): {
  service: PageService;
  pageRepository: FakePageRepository;
  entityReferenceReader: FakeEntityReferenceReader;
} {
  const pageRepository = new FakePageRepository();
  const entityReferenceReader = new FakeEntityReferenceReader();
  return {
    service: new PageService(pageRepository, entityReferenceReader),
    pageRepository,
    entityReferenceReader,
  };
}

function buildPage(overrides: Partial<Page> = {}): Page {
  return {
    id: 'page-1',
    episodeId: 'episode-1',
    sceneId: null,
    pageNumber: 1,
    layoutConfig: buildLayoutConfig(),
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
    id: 'panel-1',
    pageId: 'page-1',
    order: 1,
    panelRole: 'action',
    panelSize: 'standard',
    situationText: null,
    entities: [],
    composition: buildComposition(),
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

function buildLayoutConfig(): Page['layoutConfig'] {
  return {
    type: 'template',
    templateId: 'standard_4',
    panelCount: 4,
    layoutReferenceS3Key: null,
    frameDefinitions: [],
  };
}

function buildComposition(): Panel['composition'] {
  return {
    source: 'ai_auto',
    galleryItemId: null,
    compositionPrompt: null,
    shotType: null,
    angle: null,
    customNote: null,
  };
}
