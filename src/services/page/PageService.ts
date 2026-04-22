import { LAYOUT_TEMPLATES } from '../../domain/constants/layoutTemplates.js';
import { NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type {
  CreatePageInput,
  CreatePanelInput,
  Page,
  PageLayoutConfig,
  Panel,
  PanelDialogue,
  PanelEntity,
  UpdatePageInput,
  UpdatePanelInput,
} from '../../domain/types/page.js';
import type { EntityReferenceReader } from '../../repositories/EntityRepository.js';
import type {
  PageRepository,
  PanelEntityStateReference,
} from '../../repositories/PageRepository.js';

export type {
  CreatePageInput as CreatePageRequest,
  CreatePanelInput as CreatePanelRequest,
  Page,
  Panel,
  UpdatePageInput as UpdatePageRequest,
  UpdatePanelInput as UpdatePanelRequest,
};

export interface PageEntityReferenceReader extends EntityReferenceReader {}

export interface PageServicePort {
  createPage(userId: string, episodeId: string, input: CreatePageInput): Promise<Page>;
  listPages(userId: string, episodeId: string): Promise<Page[]>;
  getPage(userId: string, pageId: string): Promise<Page>;
  updatePage(userId: string, pageId: string, input: UpdatePageInput): Promise<Page>;
  deletePage(userId: string, pageId: string): Promise<void>;
  createPanel(userId: string, pageId: string, input: CreatePanelInput): Promise<Panel>;
  listPanels(userId: string, pageId: string): Promise<Panel[]>;
  updatePanel(userId: string, panelId: string, input: UpdatePanelInput): Promise<Panel>;
  deletePanel(userId: string, panelId: string): Promise<void>;
}

/**
 * Owns Page/Panel design invariants: episode ownership, scene/page alignment,
 * layout template consistency, and entity/state references inside panels.
 */
export class PageService implements PageServicePort {
  public constructor(
    private readonly pageRepository: PageRepository,
    private readonly entityReferenceReader: PageEntityReferenceReader,
  ) {}

  public async createPage(userId: string, episodeId: string, input: CreatePageInput): Promise<Page> {
    const episodeContext = await this.pageRepository.findEpisodeContextByIdAndUserId(episodeId, userId);
    if (episodeContext === null) {
      throw new NotFoundError('Episode not found');
    }

    this.ensureLayoutConfigIsConsistent(input.layoutConfig);
    await this.ensureSceneMatchesEpisode(userId, episodeId, episodeContext.workId, input.sceneId);

    return this.pageRepository.createPage(episodeId, input);
  }

  public async listPages(userId: string, episodeId: string): Promise<Page[]> {
    const episodeContext = await this.pageRepository.findEpisodeContextByIdAndUserId(episodeId, userId);
    if (episodeContext === null) {
      throw new NotFoundError('Episode not found');
    }

    return this.pageRepository.findPagesByEpisodeIdAndUserId(episodeId, userId);
  }

  public async getPage(userId: string, pageId: string): Promise<Page> {
    const page = await this.pageRepository.findPageByIdAndUserId(pageId, userId);
    if (page === null) {
      throw new NotFoundError('Page not found');
    }

    return page;
  }

  public async updatePage(userId: string, pageId: string, input: UpdatePageInput): Promise<Page> {
    const pageContext = await this.pageRepository.findPageContextByIdAndUserId(pageId, userId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }

    if (input.layoutConfig !== undefined) {
      this.ensureLayoutConfigIsConsistent(input.layoutConfig);
    }
    if (input.sceneId !== undefined) {
      await this.ensureSceneMatchesEpisode(userId, pageContext.episodeId, pageContext.workId, input.sceneId);
    }

    const page = await this.pageRepository.updatePage(pageId, userId, input);
    if (page === null) {
      throw new NotFoundError('Page not found');
    }

    return page;
  }

  public async deletePage(userId: string, pageId: string): Promise<void> {
    const deleted = await this.pageRepository.deletePage(pageId, userId);
    if (!deleted) {
      throw new NotFoundError('Page not found');
    }
  }

  public async createPanel(userId: string, pageId: string, input: CreatePanelInput): Promise<Panel> {
    const pageContext = await this.pageRepository.findPageContextByIdAndUserId(pageId, userId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }

    await this.ensurePanelReferencesBelongToWork(userId, pageContext.workId, input.entities, input.dialogue);
    await this.ensurePanelStateReferencesAreValid(userId, pageContext.workId, input.entities);

    return this.pageRepository.createPanel(pageId, input);
  }

  public async listPanels(userId: string, pageId: string): Promise<Panel[]> {
    const pageContext = await this.pageRepository.findPageContextByIdAndUserId(pageId, userId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }

    return this.pageRepository.findPanelsByPageIdAndUserId(pageId, userId);
  }

  public async updatePanel(userId: string, panelId: string, input: UpdatePanelInput): Promise<Panel> {
    const panelContext = await this.pageRepository.findPanelContextByIdAndUserId(panelId, userId);
    if (panelContext === null) {
      throw new NotFoundError('Panel not found');
    }

    if (input.entities !== undefined || input.dialogue !== undefined) {
      await this.ensurePanelReferencesBelongToWork(
        userId,
        panelContext.workId,
        input.entities ?? [],
        input.dialogue ?? [],
      );
    }
    if (input.entities !== undefined) {
      await this.ensurePanelStateReferencesAreValid(userId, panelContext.workId, input.entities);
    }

    const panel = await this.pageRepository.updatePanel(panelId, userId, input);
    if (panel === null) {
      throw new NotFoundError('Panel not found');
    }

    return panel;
  }

  public async deletePanel(userId: string, panelId: string): Promise<void> {
    const deleted = await this.pageRepository.deletePanel(panelId, userId);
    if (!deleted) {
      throw new NotFoundError('Panel not found');
    }
  }

  private async ensureSceneMatchesEpisode(
    userId: string,
    episodeId: string,
    workId: string,
    sceneId: string | null,
  ): Promise<void> {
    if (sceneId === null) {
      return;
    }

    const sceneContext = await this.pageRepository.findSceneContextByIdAndUserId(sceneId, userId);
    if (sceneContext === null) {
      throw new NotFoundError('Scene not found');
    }

    if (sceneContext.episodeId !== episodeId || sceneContext.workId !== workId) {
      throw new ValidationError('Scene must belong to the same episode as the page');
    }
  }

  private ensureLayoutConfigIsConsistent(layoutConfig: PageLayoutConfig): void {
    if (layoutConfig.type !== 'template') {
      return;
    }

    if (layoutConfig.templateId === null) {
      throw new ValidationError('templateId is required when layout type is template');
    }

    const expectedPanelCount = LAYOUT_TEMPLATES[layoutConfig.templateId].panelCount;
    if (layoutConfig.panelCount !== expectedPanelCount) {
      throw new ValidationError('panelCount must match the selected layout template');
    }
  }

  private async ensurePanelReferencesBelongToWork(
    userId: string,
    workId: string,
    entities: PanelEntity[],
    dialogue: PanelDialogue[],
  ): Promise<void> {
    const entityIds = [
      ...entities.map((entity) => entity.entityId),
      ...dialogue.map((dialogueItem) => dialogueItem.entityId),
    ];
    const uniqueEntityIds = [...new Set(entityIds)];
    if (uniqueEntityIds.length === 0) {
      return;
    }

    const matchedEntityCount = await this.entityReferenceReader.countByIdsAndWorkIdAndUserId(
      uniqueEntityIds,
      workId,
      userId,
    );
    if (matchedEntityCount !== uniqueEntityIds.length) {
      throw new ValidationError('All panel entity references must belong to the work');
    }
  }

  private async ensurePanelStateReferencesAreValid(
    userId: string,
    workId: string,
    entities: PanelEntity[],
  ): Promise<void> {
    const references = toUniqueStateReferences(entities);
    if (references.length === 0) {
      return;
    }

    const matchedReferenceCount =
      await this.pageRepository.countEntityStatesByReferencesAndWorkIdAndUserId(
        references,
        workId,
        userId,
      );
    if (matchedReferenceCount !== references.length) {
      throw new ValidationError('All panel state references must belong to the referenced entity');
    }
  }
}

function toUniqueStateReferences(entities: PanelEntity[]): PanelEntityStateReference[] {
  const references = new Map<string, PanelEntityStateReference>();

  for (const entity of entities) {
    if (entity.stateId === null) {
      continue;
    }

    references.set(`${entity.entityId}:${entity.stateId}`, {
      entityId: entity.entityId,
      stateId: entity.stateId,
    });
  }

  return [...references.values()];
}
