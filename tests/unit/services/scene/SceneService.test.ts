import { describe, expect, it } from 'vitest';
import type { AppError } from '../../../../src/domain/errors/index.js';
import type { Entity } from '../../../../src/domain/types/entity.js';
import type {
  CreateEntityStateInput,
  CreateSceneInput,
  EntityState,
  EpisodeSceneContext,
  Scene,
  SceneRepository,
  SceneWorkContext,
  UpdateEntityStateInput,
  UpdateSceneInput,
} from '../../../../src/repositories/SceneRepository.js';
import { SceneService, type SceneEntityReader } from '../../../../src/services/scene/SceneService.js';

const now = new Date('2026-04-22T00:00:00.000Z');

class FakeSceneRepository implements SceneRepository {
  private readonly episodeContexts = new Map<string, EpisodeSceneContext>();
  private readonly scenes = new Map<string, Scene>();
  private readonly entityStates = new Map<string, EntityState>();

  public addEpisodeContext(userId: string, episodeId: string, workId: string): void {
    this.episodeContexts.set(`${userId}:${episodeId}`, { episodeId, workId });
  }

  public async findEpisodeContextByIdAndUserId(
    episodeId: string,
    userId: string,
  ): Promise<EpisodeSceneContext | null> {
    return this.episodeContexts.get(`${userId}:${episodeId}`) ?? null;
  }

  public async findSceneContextByIdAndUserId(
    sceneId: string,
    userId: string,
  ): Promise<SceneWorkContext | null> {
    const scene = this.scenes.get(sceneId);
    if (scene === undefined) {
      return null;
    }

    const episodeContext = await this.findEpisodeContextByIdAndUserId(scene.episodeId, userId);
    if (episodeContext === null) {
      return null;
    }

    return { sceneId, episodeId: scene.episodeId, workId: episodeContext.workId };
  }

  public async createScene(episodeId: string, input: CreateSceneInput): Promise<Scene> {
    const scene: Scene = {
      id: `scene-${this.scenes.size + 1}`,
      episodeId,
      order: input.order,
      location: input.location,
      time: input.time,
      atmosphere: input.atmosphere,
      involvedEntityIds: input.involvedEntityIds,
      entityStates: [],
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    this.scenes.set(scene.id, scene);
    return scene;
  }

  public async findScenesByEpisodeIdAndUserId(
    episodeId: string,
    userId: string,
  ): Promise<Scene[]> {
    const episodeContext = await this.findEpisodeContextByIdAndUserId(episodeId, userId);
    if (episodeContext === null) {
      return [];
    }

    return [...this.scenes.values()].filter((scene) => scene.episodeId === episodeId);
  }

  public async updateScene(
    sceneId: string,
    userId: string,
    input: UpdateSceneInput,
  ): Promise<Scene | null> {
    const sceneContext = await this.findSceneContextByIdAndUserId(sceneId, userId);
    if (sceneContext === null) {
      return null;
    }

    const scene = this.scenes.get(sceneId);
    if (scene === undefined) {
      return null;
    }

    const updatedScene: Scene = {
      ...scene,
      order: input.order ?? scene.order,
      location: input.location === undefined ? scene.location : input.location,
      time: input.time === undefined ? scene.time : input.time,
      atmosphere: input.atmosphere === undefined ? scene.atmosphere : input.atmosphere,
      involvedEntityIds: input.involvedEntityIds ?? scene.involvedEntityIds,
      status: input.status ?? scene.status,
      updatedAt: now,
    };
    this.scenes.set(sceneId, updatedScene);
    return updatedScene;
  }

  public async deleteScene(sceneId: string, userId: string): Promise<boolean> {
    const sceneContext = await this.findSceneContextByIdAndUserId(sceneId, userId);
    return sceneContext === null ? false : this.scenes.delete(sceneId);
  }

  public async findEntityStatesByEntityIdAndUserId(
    entityId: string,
    _userId: string,
  ): Promise<EntityState[]> {
    return [...this.entityStates.values()].filter((entityState) => entityState.entityId === entityId);
  }

  public async createEntityState(entityId: string, input: CreateEntityStateInput): Promise<EntityState> {
    const entityState: EntityState = {
      id: `state-${this.entityStates.size + 1}`,
      entityId,
      sceneId: input.sceneId,
      costumeNote: input.costumeNote,
      costumeRefId: input.costumeRefId,
      conditionNote: input.conditionNote,
      hairNote: input.hairNote,
      expressionDefault: input.expressionDefault,
      extraNote: input.extraNote,
      createdAt: now,
    };
    this.entityStates.set(entityState.id, entityState);
    return entityState;
  }

  public async updateEntityState(
    entityId: string,
    stateId: string,
    _userId: string,
    input: UpdateEntityStateInput,
  ): Promise<EntityState | null> {
    const entityState = this.entityStates.get(stateId);
    if (entityState === undefined || entityState.entityId !== entityId) {
      return null;
    }

    const updatedEntityState: EntityState = {
      ...entityState,
      sceneId: input.sceneId === undefined ? entityState.sceneId : input.sceneId,
      costumeNote: input.costumeNote === undefined ? entityState.costumeNote : input.costumeNote,
      costumeRefId: input.costumeRefId === undefined ? entityState.costumeRefId : input.costumeRefId,
      conditionNote: input.conditionNote === undefined ? entityState.conditionNote : input.conditionNote,
      hairNote: input.hairNote === undefined ? entityState.hairNote : input.hairNote,
      expressionDefault:
        input.expressionDefault === undefined ? entityState.expressionDefault : input.expressionDefault,
      extraNote: input.extraNote === undefined ? entityState.extraNote : input.extraNote,
    };
    this.entityStates.set(stateId, updatedEntityState);
    return updatedEntityState;
  }
}

class FakeEntityReader implements SceneEntityReader {
  private readonly entities = new Map<string, Entity>();

  public addEntity(entity: Entity): void {
    this.entities.set(`${entity.userId}:${entity.id}`, entity);
  }

  public async findByIdAndUserId(entityId: string, userId: string): Promise<Entity | null> {
    return this.entities.get(`${userId}:${entityId}`) ?? null;
  }

  public async countByIdsAndWorkIdAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
  ): Promise<number> {
    const uniqueEntityIds = [...new Set(entityIds)];
    return uniqueEntityIds.filter((entityId) => {
      const entity = this.entities.get(`${userId}:${entityId}`);
      return entity?.workId === workId;
    }).length;
  }
}

describe('SceneService', () => {
  it('所有している話へSceneを作成できる', async () => {
    const { service, sceneRepository, entityReader } = createService();
    sceneRepository.addEpisodeContext('user-1', 'episode-1', 'work-1');
    entityReader.addEntity(buildEntity({ id: 'entity-1', workId: 'work-1' }));

    const scene = await service.createScene('user-1', 'episode-1', {
      order: 1,
      location: '廃墟の広場',
      time: '夜',
      atmosphere: 'tense',
      involvedEntityIds: ['entity-1'],
    });

    expect(scene.episodeId).toBe('episode-1');
    expect(scene.involvedEntityIds).toEqual(['entity-1']);
  });

  it('所有していない話へSceneを作成する場合にNOT_FOUNDになる', async () => {
    const { service } = createService();

    await expect(
      service.createScene('user-2', 'episode-1', {
        order: 1,
        location: null,
        time: null,
        atmosphere: null,
        involvedEntityIds: [],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' } satisfies Partial<AppError>);
  });

  it('作品外のエンティティをSceneに紐づける場合にVALIDATION_ERRORになる', async () => {
    const { service, sceneRepository, entityReader } = createService();
    sceneRepository.addEpisodeContext('user-1', 'episode-1', 'work-1');
    entityReader.addEntity(buildEntity({ id: 'entity-1', workId: 'work-2' }));

    await expect(
      service.createScene('user-1', 'episode-1', {
        order: 1,
        location: null,
        time: null,
        atmosphere: null,
        involvedEntityIds: ['entity-1'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' } satisfies Partial<AppError>);
  });

  it('sceneなしでentity_stateを作成できる', async () => {
    const { service, entityReader } = createService();
    entityReader.addEntity(buildEntity({ id: 'entity-1', workId: 'work-1' }));

    const entityState = await service.createEntityState('user-1', 'entity-1', {
      sceneId: null,
      costumeNote: '黒のタクティカルスーツ',
      costumeRefId: null,
      conditionNote: null,
      hairNote: null,
      expressionDefault: 'determined',
      extraNote: null,
    });

    expect(entityState.entityId).toBe('entity-1');
    expect(entityState.sceneId).toBeNull();
    expect(entityState.expressionDefault).toBe('determined');
  });

  it('本人が所有するentityのstateだけを一覧取得できる', async () => {
    const { service, sceneRepository, entityReader } = createService();
    entityReader.addEntity(buildEntity({ id: 'entity-1', workId: 'work-1' }));
    entityReader.addEntity(buildEntity({ id: 'entity-2', workId: 'work-1' }));
    await sceneRepository.createEntityState('entity-1', {
      sceneId: null,
      costumeNote: '制服',
      costumeRefId: null,
      conditionNote: null,
      hairNote: null,
      expressionDefault: 'neutral',
      extraNote: null,
    });
    await sceneRepository.createEntityState('entity-2', {
      sceneId: null,
      costumeNote: '私服',
      costumeRefId: null,
      conditionNote: null,
      hairNote: null,
      expressionDefault: 'neutral',
      extraNote: null,
    });

    await expect(service.listEntityStates('user-1', 'entity-1')).resolves.toMatchObject([
      { entityId: 'entity-1', costumeNote: '制服' },
    ]);
    await expect(service.listEntityStates('user-2', 'entity-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    } satisfies Partial<AppError>);
  });

  it('entity_stateのSceneが別作品の場合にVALIDATION_ERRORになる', async () => {
    const { service, sceneRepository, entityReader } = createService();
    entityReader.addEntity(buildEntity({ id: 'entity-1', workId: 'work-1' }));
    sceneRepository.addEpisodeContext('user-1', 'episode-1', 'work-2');
    await sceneRepository.createScene('episode-1', {
      order: 1,
      location: null,
      time: null,
      atmosphere: null,
      involvedEntityIds: [],
    });

    await expect(
      service.createEntityState('user-1', 'entity-1', {
        sceneId: 'scene-1',
        costumeNote: null,
        costumeRefId: null,
        conditionNote: null,
        hairNote: null,
        expressionDefault: 'neutral',
        extraNote: null,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' } satisfies Partial<AppError>);
  });
});

function createService(): {
  service: SceneService;
  sceneRepository: FakeSceneRepository;
  entityReader: FakeEntityReader;
} {
  const sceneRepository = new FakeSceneRepository();
  const entityReader = new FakeEntityReader();
  return {
    service: new SceneService(sceneRepository, entityReader),
    sceneRepository,
    entityReader,
  };
}

function buildEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'entity-1',
    workId: 'work-1',
    userId: 'user-1',
    entityType: 'character',
    name: '月華',
    freeDescription: null,
    structuredFields: {},
    promptSupplement: null,
    speechProfile: {},
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
