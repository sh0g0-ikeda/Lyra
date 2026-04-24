import { describe, expect, it } from 'vitest';
import type { AppError } from '../../../../src/domain/errors/index.js';
import type {
  CreateEntityInput,
  Entity,
  EntityPrimaryReferenceImage,
  EntityRepository,
  UpdateEntityInput,
} from '../../../../src/repositories/EntityRepository.js';
import type { WorkReader } from '../../../../src/repositories/WorkRepository.js';
import { EntityService } from '../../../../src/services/entity/EntityService.js';

const now = new Date('2026-04-22T00:00:00.000Z');

class FakeWorkReader implements WorkReader {
  public ownedWorkIds = new Set<string>();

  public async findByIdAndUserId(id: string, userId: string): Promise<{ id: string; userId: string } | null> {
    return this.ownedWorkIds.has(`${userId}:${id}`) ? { id, userId } : null;
  }
}

class FakeEntityRepository implements EntityRepository {
  private readonly entities = new Map<string, Entity>();

  public async create(input: CreateEntityInput): Promise<Entity> {
    const entity: Entity = {
      id: `entity-${this.entities.size + 1}`,
      workId: input.workId,
      userId: input.userId,
      entityType: input.entityType,
      name: input.name,
      freeDescription: input.freeDescription,
      structuredFields: input.structuredFields,
      promptSupplement: null,
      speechProfile: input.speechProfile,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    this.entities.set(entity.id, entity);
    return entity;
  }

  public async findByIdAndUserId(id: string, userId: string): Promise<Entity | null> {
    const entity = this.entities.get(id);
    return entity?.userId === userId ? entity : null;
  }

  public async findByWorkIdAndUserId(workId: string, userId: string): Promise<Entity[]> {
    return [...this.entities.values()].filter(
      (entity) => entity.workId === workId && entity.userId === userId,
    );
  }

  public async countByIdsAndWorkIdAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
  ): Promise<number> {
    return [...this.entities.values()].filter(
      (entity) =>
        entityIds.includes(entity.id) && entity.workId === workId && entity.userId === userId,
    ).length;
  }

  public async findPrimaryReferenceImagesByEntityIdsAndUserId(): Promise<EntityPrimaryReferenceImage[]> {
    return [];
  }

  public async update(id: string, userId: string, input: UpdateEntityInput): Promise<Entity | null> {
    const currentEntity = await this.findByIdAndUserId(id, userId);
    if (currentEntity === null) {
      return null;
    }

    const nextEntity: Entity = {
      ...currentEntity,
      entityType: input.entityType ?? currentEntity.entityType,
      name: input.name ?? currentEntity.name,
      freeDescription:
        input.freeDescription === undefined ? currentEntity.freeDescription : input.freeDescription,
      structuredFields: input.structuredFields ?? currentEntity.structuredFields,
      speechProfile: input.speechProfile ?? currentEntity.speechProfile,
      updatedAt: now,
    };
    this.entities.set(id, nextEntity);
    return nextEntity;
  }

  public async delete(id: string, userId: string): Promise<boolean> {
    const currentEntity = await this.findByIdAndUserId(id, userId);
    if (currentEntity === null) {
      return false;
    }

    return this.entities.delete(id);
  }
}

describe('EntityService', () => {
  it('所有している作品の場合にエンティティを作成できる', async () => {
    const workReader = new FakeWorkReader();
    workReader.ownedWorkIds.add('user-1:work-1');
    const service = new EntityService(new FakeEntityRepository(), workReader);

    const result = await service.createEntity('user-1', 'work-1', {
      entityType: 'character',
      name: '月華',
      freeDescription: '黒髪ロングの女性将校',
      structuredFields: { art_style: 'anime' },
      speechProfile: {},
    });

    expect(result.status).toBe('draft');
    expect(result.userId).toBe('user-1');
    expect(result.workId).toBe('work-1');
  });

  it('object作成の場合にspeech_profileが空に正規化される', async () => {
    const workReader = new FakeWorkReader();
    workReader.ownedWorkIds.add('user-1:work-1');
    const service = new EntityService(new FakeEntityRepository(), workReader);

    const result = await service.createEntity('user-1', 'work-1', {
      entityType: 'object',
      name: '魔法剣',
      freeDescription: null,
      structuredFields: { category: 'weapon' },
      speechProfile: { tone: 'silent' },
    });

    expect(result.speechProfile).toEqual({});
  });

  it('所有していない作品の場合にNOT_FOUNDになる', async () => {
    const service = new EntityService(new FakeEntityRepository(), new FakeWorkReader());

    await expect(
      service.createEntity('user-1', 'work-1', {
        entityType: 'object',
        name: '魔法剣',
        freeDescription: null,
        structuredFields: { category: 'weapon' },
        speechProfile: {},
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' } satisfies Partial<AppError>);
  });

  it('別ユーザーのエンティティ取得の場合にNOT_FOUNDになる', async () => {
    const workReader = new FakeWorkReader();
    workReader.ownedWorkIds.add('user-1:work-1');
    const repository = new FakeEntityRepository();
    const service = new EntityService(repository, workReader);

    const entity = await service.createEntity('user-1', 'work-1', {
      entityType: 'nonhuman',
      name: '蒼い精霊',
      freeDescription: null,
      structuredFields: { base_form: 'spirit' },
      speechProfile: {},
    });

    await expect(service.getEntity('user-2', entity.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    } satisfies Partial<AppError>);
  });

  it('entity_typeだけをobjectに変更した場合にstructured_fieldsとspeech_profileが空に正規化される', async () => {
    const workReader = new FakeWorkReader();
    workReader.ownedWorkIds.add('user-1:work-1');
    const repository = new FakeEntityRepository();
    const service = new EntityService(repository, workReader);
    const entity = await service.createEntity('user-1', 'work-1', {
      entityType: 'character',
      name: '月華',
      freeDescription: null,
      structuredFields: {
        hair: { color: 'black' },
        art_style: 'anime',
      },
      speechProfile: { tone: 'calm' },
    });

    const updatedEntity = await service.updateEntity('user-1', entity.id, {
      entityType: 'object',
    });

    expect(updatedEntity.entityType).toBe('object');
    expect(updatedEntity.structuredFields).toEqual({});
    expect(updatedEntity.speechProfile).toEqual({});
  });

  it('entity_typeを変えずに更新する場合に既存structured_fieldsを保持する', async () => {
    const workReader = new FakeWorkReader();
    workReader.ownedWorkIds.add('user-1:work-1');
    const repository = new FakeEntityRepository();
    const service = new EntityService(repository, workReader);
    const entity = await service.createEntity('user-1', 'work-1', {
      entityType: 'character',
      name: '月華',
      freeDescription: null,
      structuredFields: { art_style: 'anime' },
      speechProfile: { tone: 'calm' },
    });

    const updatedEntity = await service.updateEntity('user-1', entity.id, {
      name: '月華 改',
    });

    expect(updatedEntity.structuredFields).toEqual({ art_style: 'anime' });
    expect(updatedEntity.speechProfile).toEqual({ tone: 'calm' });
  });
});
