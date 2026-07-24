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
import type {
  CompiledStyleReference,
  StyleReferenceCompilerPort,
} from '../../../../src/services/style/StyleReferenceCompiler.js';

const now = new Date('2026-04-22T00:00:00.000Z');

class FakeWorkReader implements WorkReader {
  public ownedWorkIds = new Set<string>();

  public async findByIdAndUserId(
    id: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<{ id: string; userId: string; organizationId: string | null } | null> {
    return this.ownedWorkIds.has(`${userId}:${id}`)
      ? { id, userId, organizationId }
      : null;
  }
}

class FakeEntityRepository implements EntityRepository {
  private readonly entities = new Map<string, Entity>();
  public staleUpdate = false;
  public disappearBeforeUpdate = false;
  public lastEntityPageRequest: { limit: number; cursor: { sort: string | number; id: string } | null } | null = null;

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

  public async findEntitiesPageByWorkIdAndUserId(
    workId: string,
    userId: string,
    request: { limit: number; cursor: { sort: string | number; id: string } | null },
  ): Promise<{ items: Entity[]; nextCursor: string | null }> {
    this.lastEntityPageRequest = request;
    return { items: await this.findByWorkIdAndUserId(workId, userId), nextCursor: null };
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
    if (this.disappearBeforeUpdate) {
      this.entities.delete(id);
      return null;
    }
    if (this.staleUpdate) {
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

class FakeStyleReferenceCompiler implements StyleReferenceCompilerPort {
  public async compileStyleReference(): Promise<CompiledStyleReference> {
    return {
      title: 'スタジオジブリ',
      notes: '柔らかい背景',
      compiledBrief:
        'Keep the title "スタジオジブリ" explicit as a style constraint, with soft rounded shape language, airy background treatment, gentle line simplification, restrained facial rendering, and calm atmospheric color staging.',
      anchors: {
        lineQuality: 'gentle line simplification with soft confidence',
        shapeLanguage: 'soft rounded shape language',
        faceRendering: 'restrained facial rendering with simplified anatomy',
        eyeRendering: null,
        hairRendering: null,
        clothingRendering: null,
        backgroundRendering: 'airy background treatment with light environmental density',
        shadingRendering: 'soft tonal separation with restrained contrast',
        textureFinish: null,
        motionTreatment: null,
        dialogueBalloonTreatment: null,
        atmosphere: 'calm atmospheric color staging',
      },
      compilerProvider: 'openai',
      compilerModel: 'gpt-5.4-mini',
      compilerPromptVersion: 'style_ref_v3',
      compiledAt: '2026-05-28T00:00:00.000Z',
    };
  }
}

describe('EntityService', () => {
  it('delegates a bounded entity page after confirming work access', async () => {
    const workReader = new FakeWorkReader();
    workReader.ownedWorkIds.add('user-1:work-1');
    const repository = new FakeEntityRepository();
    const service = new EntityService(repository, workReader);
    await service.createEntity('user-1', 'work-1', {
      entityType: 'character', name: 'Paged entity', freeDescription: null, structuredFields: {}, speechProfile: {},
    });

    const result = await service.listEntitiesPage('user-1', 'work-1', { limit: 2, cursor: null });

    expect(result.items).toHaveLength(1);
    expect(repository.lastEntityPageRequest).toEqual({ limit: 2, cursor: null });
  });
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

  it('character structured fields accept GUI custom text values', async () => {
    const workReader = new FakeWorkReader();
    workReader.ownedWorkIds.add('user-1:work-1');
    const service = new EntityService(new FakeEntityRepository(), workReader);

    const result = await service.createEntity('user-1', 'work-1', {
      entityType: 'character',
      name: 'Mizuki',
      freeDescription: null,
      structuredFields: {
        age_range: '高校二年生くらい',
        build: '華奢だが芯が強い立ち姿',
        hair: {
          color: '淡い青みの黒',
          length: '肩甲骨に届く長さ',
          style: '少し湿ったようにまとまる直毛',
          arrangement: '低い位置でゆるく結ぶ',
          bangs: '目元にかかる長めの前髪',
        },
        eyes: {
          color: '夜明け前の灰青',
          shape: '伏し目がちな切れ長',
        },
        clothing: {
          category: '白い医療施設風の制服',
          impression: '清潔だが不穏',
        },
        art_style: '細線の漫画調',
      },
      speechProfile: {},
    });

    expect(result.structuredFields).toMatchObject({
      age_range: '高校二年生くらい',
      build: '華奢だが芯が強い立ち姿',
      hair: {
        color: '淡い青みの黒',
        style: '少し湿ったようにまとまる直毛',
      },
      eyes: {
        color: '夜明け前の灰青',
      },
      clothing: {
        category: '白い医療施設風の制服',
      },
      art_style: '細線の漫画調',
    });
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
      expectedUpdatedAt: now.toISOString(),
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
      expectedUpdatedAt: now.toISOString(),
      name: '月華 改',
    });

    expect(updatedEntity.structuredFields).toEqual({ art_style: 'anime' });
    expect(updatedEntity.speechProfile).toEqual({ tone: 'calm' });
  });

  it('character の style reference を保存時にコンパイルする', async () => {
    const workReader = new FakeWorkReader();
    workReader.ownedWorkIds.add('user-1:work-1');
    const service = new EntityService(
      new FakeEntityRepository(),
      workReader,
      new FakeStyleReferenceCompiler(),
    );

    const entity = await service.createEntity('user-1', 'work-1', {
      entityType: 'character',
      name: 'ミネルバ',
      freeDescription: null,
      structuredFields: {
        art_style: 'manga',
        style_reference: {
          title: 'スタジオジブリ',
          notes: '柔らかい背景',
        },
      },
      speechProfile: {},
    });

    expect(entity.structuredFields).toMatchObject({
      art_style: 'manga',
      style_reference: {
        title: 'スタジオジブリ',
        notes: '柔らかい背景',
        compiled_brief: expect.stringContaining('スタジオジブリ'),
        anchors: expect.any(Object),
        compiler_provider: 'openai',
        compiler_prompt_version: 'style_ref_v3',
      },
    });
  });

  it('authorized entity revision conflict returns RESOURCE_STALE without mutation', async () => {
    const workReader = new FakeWorkReader();
    workReader.ownedWorkIds.add('user-1:work-1');
    const repository = new FakeEntityRepository();
    const service = new EntityService(repository, workReader);
    const entity = await service.createEntity('user-1', 'work-1', {
      entityType: 'character',
      name: 'Revision target',
      freeDescription: null,
      structuredFields: {},
      speechProfile: {},
    });
    repository.staleUpdate = true;

    await expect(
      service.updateEntity('user-1', entity.id, {
        expectedUpdatedAt: now.toISOString(),
        name: 'Must not persist',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_STALE' } satisfies Partial<AppError>);
    await expect(service.getEntity('user-1', entity.id)).resolves.toMatchObject({ name: 'Revision target' });
  });

  it('conditional update 後にアクセス可能なentityが消えた場合は NOT_FOUND を返す', async () => {
    const workReader = new FakeWorkReader();
    workReader.ownedWorkIds.add('user-1:work-1');
    const repository = new FakeEntityRepository();
    const service = new EntityService(repository, workReader);
    const entity = await service.createEntity('user-1', 'work-1', {
      entityType: 'character',
      name: 'Disappearing entity',
      freeDescription: null,
      structuredFields: {},
      speechProfile: {},
    });
    Object.assign(repository, { disappearBeforeUpdate: true });

    await expect(
      service.updateEntity('user-1', entity.id, {
        expectedUpdatedAt: now.toISOString(),
        name: 'Must not persist',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' } satisfies Partial<AppError>);
  });
});
