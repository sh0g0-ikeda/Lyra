import { NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type { Entity } from '../../domain/types/entity.js';
import type {
  CreateEntityStateInput,
  CreateSceneInput,
  EntityState,
  Scene,
  UpdateEntityStateInput,
  UpdateSceneInput,
} from '../../domain/types/scene.js';
import type { EntityReferenceReader } from '../../repositories/EntityRepository.js';
import type { SceneRepository } from '../../repositories/SceneRepository.js';

export type {
  CreateEntityStateInput as CreateEntityStateRequest,
  CreateSceneInput as CreateSceneRequest,
  EntityState,
  Scene,
  UpdateEntityStateInput as UpdateEntityStateRequest,
  UpdateSceneInput as UpdateSceneRequest,
};

export interface SceneEntityReader extends EntityReferenceReader {
  findByIdAndUserId(entityId: string, userId: string, organizationId?: string | null): Promise<Entity | null>;
}

export interface SceneServicePort {
  createScene(userId: string, episodeId: string, input: CreateSceneInput, organizationId?: string | null): Promise<Scene>;
  listScenes(userId: string, episodeId: string, organizationId?: string | null): Promise<Scene[]>;
  updateScene(userId: string, sceneId: string, input: UpdateSceneInput, organizationId?: string | null): Promise<Scene>;
  deleteScene(userId: string, sceneId: string, organizationId?: string | null): Promise<void>;
  listEntityStates(
    userId: string,
    entityId: string,
    organizationId?: string | null,
  ): Promise<EntityState[]>;
  createEntityState(
    userId: string,
    entityId: string,
    input: CreateEntityStateInput,
    organizationId?: string | null,
  ): Promise<EntityState>;
  updateEntityState(
    userId: string,
    entityId: string,
    stateId: string,
    input: UpdateEntityStateInput,
    organizationId?: string | null,
  ): Promise<EntityState>;
}

/**
 * Coordinates Scene/entity_state writes so every request is checked against
 * both the authenticated user and the parent work before persistence.
 */
export class SceneService implements SceneServicePort {
  public constructor(
    private readonly sceneRepository: SceneRepository,
    private readonly entityReader: SceneEntityReader,
  ) {}

  public async createScene(
    userId: string,
    episodeId: string,
    input: CreateSceneInput,
    organizationId: string | null = null,
  ): Promise<Scene> {
    const episodeContext = await this.sceneRepository.findEpisodeContextByIdAndUserId(
      episodeId,
      userId,
      organizationId,
    );
    if (episodeContext === null) {
      throw new NotFoundError('Episode not found');
    }

    await this.ensureEntitiesBelongToWork(userId, episodeContext.workId, input.involvedEntityIds, organizationId);
    return this.sceneRepository.createScene(episodeId, input);
  }

  public async listScenes(
    userId: string,
    episodeId: string,
    organizationId: string | null = null,
  ): Promise<Scene[]> {
    const episodeContext = await this.sceneRepository.findEpisodeContextByIdAndUserId(
      episodeId,
      userId,
      organizationId,
    );
    if (episodeContext === null) {
      throw new NotFoundError('Episode not found');
    }

    return this.sceneRepository.findScenesByEpisodeIdAndUserId(episodeId, userId, organizationId);
  }

  public async updateScene(
    userId: string,
    sceneId: string,
    input: UpdateSceneInput,
    organizationId: string | null = null,
  ): Promise<Scene> {
    const sceneContext = await this.sceneRepository.findSceneContextByIdAndUserId(sceneId, userId, organizationId);
    if (sceneContext === null) {
      throw new NotFoundError('Scene not found');
    }

    if (input.involvedEntityIds !== undefined) {
      await this.ensureEntitiesBelongToWork(userId, sceneContext.workId, input.involvedEntityIds, organizationId);
    }

    const scene = await this.sceneRepository.updateScene(sceneId, userId, input, organizationId);
    if (scene === null) {
      throw new NotFoundError('Scene not found');
    }

    return scene;
  }

  public async deleteScene(userId: string, sceneId: string, organizationId: string | null = null): Promise<void> {
    const deleted = await this.sceneRepository.deleteScene(sceneId, userId, organizationId);
    if (!deleted) {
      throw new NotFoundError('Scene not found');
    }
  }

  public async createEntityState(
    userId: string,
    entityId: string,
    input: CreateEntityStateInput,
    organizationId: string | null = null,
  ): Promise<EntityState> {
    const entity = await this.ensureEntityOwnedByUser(userId, entityId, organizationId);
    await this.ensureSceneMatchesEntityWork(userId, entity.workId, input.sceneId, organizationId);

    return this.sceneRepository.createEntityState(entityId, input);
  }

  public async listEntityStates(
    userId: string,
    entityId: string,
    organizationId: string | null = null,
  ): Promise<EntityState[]> {
    await this.ensureEntityOwnedByUser(userId, entityId, organizationId);

    return this.sceneRepository.findEntityStatesByEntityIdAndUserId(
      entityId,
      userId,
      organizationId,
    );
  }

  public async updateEntityState(
    userId: string,
    entityId: string,
    stateId: string,
    input: UpdateEntityStateInput,
    organizationId: string | null = null,
  ): Promise<EntityState> {
    const entity = await this.ensureEntityOwnedByUser(userId, entityId, organizationId);
    if (input.sceneId !== undefined) {
      await this.ensureSceneMatchesEntityWork(userId, entity.workId, input.sceneId, organizationId);
    }

    const entityState = await this.sceneRepository.updateEntityState(
      entityId,
      stateId,
      userId,
      input,
      organizationId,
    );
    if (entityState === null) {
      throw new NotFoundError('Entity state not found');
    }

    return entityState;
  }

  private async ensureEntityOwnedByUser(
    userId: string,
    entityId: string,
    organizationId: string | null,
  ): Promise<Entity> {
    const entity = await this.entityReader.findByIdAndUserId(entityId, userId, organizationId);
    if (entity === null) {
      throw new NotFoundError('Entity not found');
    }

    return entity;
  }

  private async ensureSceneMatchesEntityWork(
    userId: string,
    entityWorkId: string,
    sceneId: string | null,
    organizationId: string | null,
  ): Promise<void> {
    if (sceneId === null) {
      return;
    }

    const sceneContext = await this.sceneRepository.findSceneContextByIdAndUserId(sceneId, userId, organizationId);
    if (sceneContext === null) {
      throw new NotFoundError('Scene not found');
    }

    if (sceneContext.workId !== entityWorkId) {
      throw new ValidationError('Scene must belong to the same work as the entity');
    }
  }

  private async ensureEntitiesBelongToWork(
    userId: string,
    workId: string,
    entityIds: string[],
    organizationId: string | null,
  ): Promise<void> {
    const uniqueEntityIds = [...new Set(entityIds)];
    if (uniqueEntityIds.length === 0) {
      return;
    }

    const matchedEntityCount =
      organizationId === null || this.entityReader.countByIdsAndWorkId === undefined
        ? await this.entityReader.countByIdsAndWorkIdAndUserId(uniqueEntityIds, workId, userId, organizationId)
        : await this.entityReader.countByIdsAndWorkId(uniqueEntityIds, workId);
    if (matchedEntityCount !== uniqueEntityIds.length) {
      throw new ValidationError('All referenced entities must belong to the work');
    }
  }
}
