import { describe, expect, it } from 'vitest';
import type { CreateEntityInput, Entity, UpdateEntityInput } from '../../../../src/domain/types/entity.js';
import type { EntityPrimaryReferenceImage, EntityRepository } from '../../../../src/repositories/EntityRepository.js';
import type { PageRepository } from '../../../../src/repositories/PageRepository.js';
import type {
  PageGenerationContext,
  PageGenerationStateUpdate,
  PageSummary,
  PagePromptContext,
} from '../../../../src/domain/types/page.js';
import type { LoadedStoredImage, StoredImageLoaderPort } from '../../../../src/infrastructure/aws/S3StoredImageLoader.js';
import type { LayoutGuideImageRendererPort } from '../../../../src/services/page/LayoutGuideImageRenderer.js';
import { PageGenerationInputImageBuilder } from '../../../../src/services/page/PageGenerationInputImageBuilder.js';
import { PAGE_GENERATION_INPUT_IMAGE_LIMITS } from '../../../../src/domain/constants/generation.js';

class FakePageRepository implements PageRepository {
  public generationContext: PageGenerationContext | null = {
    pageId: 'page-1',
    workId: 'work-1',
    layoutConfig: { type: 'template' },
    generatedImage: null,
    generationMode: null,
    status: 'designing',
    frameCount: 2,
    panels: [
      {
        panelId: 'panel-1',
        entities: [
          {
            entityId: 'entity-1',
            role: 'primary',
            expression: 'determined',
            customExpression: null,
            action: 'attacking',
            customAction: null,
            position: 'center',
            facingDirection: null,
            effectNote: null,
            stateId: null,
          },
          {
            entityId: 'entity-2',
            role: 'secondary',
            expression: 'calm',
            customExpression: null,
            action: 'standing_firm',
            customAction: null,
            position: 'left',
            facingDirection: null,
            effectNote: null,
            stateId: null,
          },
        ],
      },
      {
        panelId: 'panel-2',
        entities: [
          {
            entityId: 'entity-1',
            role: 'primary',
            expression: 'determined',
            customExpression: null,
            action: 'attacking',
            customAction: null,
            position: 'center',
            facingDirection: null,
            effectNote: null,
            stateId: null,
          },
        ],
      },
    ],
  };

  public async findPagesByEpisodeIdAndUserId(): Promise<[]> {
    return [];
  }

  public async findPageByIdAndUserId(): Promise<PageSummary | null> {
    return null;
  }

  public async findAutofillContextByIdAndUserId(): Promise<never> {
    throw new Error('not used');
  }

  public async findEpisodePlanningContextByIdAndUserId(): Promise<never> {
    throw new Error('not used');
  }

  public async findGenerationContextByIdAndUserId(): Promise<PageGenerationContext | null> {
    return this.generationContext;
  }

  public async findPromptContextByIdAndUserId(): Promise<PagePromptContext | null> {
    throw new Error('not used');
  }

  public async updatePageSettings(): Promise<PageSummary | null> {
    throw new Error('not used');
  }

  public async updateGenerationState(
    _pageId: string,
    _userId: string,
    _input: PageGenerationStateUpdate,
  ): Promise<boolean> {
    throw new Error('not used');
  }

  public async updateGeneratedImageAndState(): Promise<boolean> {
    throw new Error('not used');
  }
}

class FakeEntityRepository implements EntityRepository {
  public entities: Entity[] = [
    {
      id: 'entity-1',
      workId: 'work-1',
      userId: 'user-1',
      entityType: 'character',
      name: 'Aoi',
      freeDescription: null,
      promptSupplement: null,
      structuredFields: {},
      speechProfile: {},
      status: 'draft',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      id: 'entity-2',
      workId: 'work-1',
      userId: 'user-1',
      entityType: 'character',
      name: 'Leo',
      freeDescription: null,
      promptSupplement: null,
      structuredFields: {},
      speechProfile: {},
      status: 'draft',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ];
  public references: EntityPrimaryReferenceImage[] = [
    {
      entityId: 'entity-1',
      refId: 'ref-1',
      s3Key: 'saved/user-1/entities/entity-1/ref-1.png',
      cdnUrl: 'https://img.lyra.app/ref-1.png',
    },
    {
      entityId: 'entity-2',
      refId: 'ref-2',
      s3Key: 'saved/user-1/entities/entity-2/ref-2.png',
      cdnUrl: 'https://img.lyra.app/ref-2.png',
    },
  ];
  public lastArgs:
    | { entityIds: string[]; workId: string; userId: string }
    | null = null;

  public async create(_input: CreateEntityInput): Promise<Entity> { throw new Error('not used'); }
  public async findByIdAndUserId(_id: string, _userId: string): Promise<Entity | null> { throw new Error('not used'); }
  public async findByWorkIdAndUserId(_workId: string, _userId: string): Promise<Entity[]> { return this.entities; }
  public async countByIdsAndWorkIdAndUserId(
    _entityIds: string[],
    _workId: string,
    _userId: string,
  ): Promise<number> { throw new Error('not used'); }
  public async update(_id: string, _userId: string, _input: UpdateEntityInput): Promise<Entity | null> { throw new Error('not used'); }
  public async delete(_id: string, _userId: string): Promise<boolean> { throw new Error('not used'); }
  public async findPrimaryReferenceImagesByEntityIdsAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
  ): Promise<EntityPrimaryReferenceImage[]> {
    this.lastArgs = { entityIds, workId, userId };
    return this.references;
  }
}

class FakeStoredImageLoader implements StoredImageLoaderPort {
  public calls: string[] = [];

  public async loadByS3Key(s3Key: string): Promise<LoadedStoredImage> {
    this.calls.push(s3Key);
    return {
      imageData: Buffer.from(s3Key),
      mimeType: 'image/png',
    };
  }
}

class FakeLayoutGuideImageRenderer implements LayoutGuideImageRendererPort {
  public calls: unknown[] = [];
  public nextResult: { imageData: Buffer; mimeType: 'image/png' } | null = {
    imageData: Buffer.from('layout-guide'),
    mimeType: 'image/png',
  };

  public render(frameDefinitions: unknown) {
    this.calls.push(frameDefinitions);
    return this.nextResult;
  }
}

function buildTestEntity(id: string, name: string): Entity {
  return {
    id,
    workId: 'work-1',
    userId: 'user-1',
    entityType: 'character',
    name,
    freeDescription: null,
    promptSupplement: null,
    structuredFields: {},
    speechProfile: {},
    status: 'draft',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function buildTestPanel(entityId: string): PageGenerationContext['panels'][number] {
  return {
    panelId: `panel-${entityId}`,
    entities: [
      {
        entityId,
        role: 'primary',
        expression: 'determined',
        customExpression: null,
        action: 'attacking',
        customAction: null,
        position: 'center',
        facingDirection: null,
        effectNote: null,
        stateId: null,
      },
    ],
  };
}

describe('PageGenerationInputImageBuilder', () => {
  it('panel順の一意entityに対してreference画像をdataUrl化する', async () => {
    const loader = new FakeStoredImageLoader();
    const entityRepository = new FakeEntityRepository();
    const layoutGuideImageRenderer = new FakeLayoutGuideImageRenderer();
    layoutGuideImageRenderer.nextResult = null;
    const builder = new PageGenerationInputImageBuilder(
      new FakePageRepository(),
      entityRepository,
      loader,
      layoutGuideImageRenderer,
    );

    const result = await builder.buildInputImages({
      userId: 'user-1',
      pageId: 'page-1',
    });

    expect(loader.calls).toEqual([
      'saved/user-1/entities/entity-1/ref-1.png',
      'saved/user-1/entities/entity-2/ref-2.png',
    ]);
    expect(entityRepository.lastArgs).toEqual({
      entityIds: ['entity-1', 'entity-2'],
      workId: 'work-1',
      userId: 'user-1',
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      role: 'entity_reference',
      label: 'Aoi',
    });
    expect(result[0]?.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('custom layout では最後に layout_reference を追加する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.generationContext = {
      ...pageRepository.generationContext!,
      layoutConfig: {
        type: 'custom',
        frame_definitions: [
          {
            reading_order: 1,
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
              { x: 0, y: 1 },
            ],
          },
        ],
      },
    };
    const layoutGuideImageRenderer = new FakeLayoutGuideImageRenderer();
    const builder = new PageGenerationInputImageBuilder(
      pageRepository,
      new FakeEntityRepository(),
      new FakeStoredImageLoader(),
      layoutGuideImageRenderer,
    );

    const result = await builder.buildInputImages({
      userId: 'user-1',
      pageId: 'page-1',
    });

    expect(layoutGuideImageRenderer.calls).toHaveLength(1);
    expect(result.at(-1)).toMatchObject({
      role: 'layout_reference',
      label: 'page-layout-reference',
    });
  });

  it('reference image count が上限を超える場合はOpenAI入力画像を作らない', async () => {
    const entityCount = PAGE_GENERATION_INPUT_IMAGE_LIMITS.MAX_ENTITY_REFERENCE_IMAGES + 1;
    const entityRepository = new FakeEntityRepository();
    const pageRepository = new FakePageRepository();
    const loader = new FakeStoredImageLoader();

    entityRepository.entities = Array.from({ length: entityCount }, (_, index) =>
      buildTestEntity(`entity-${index + 1}`, `Character ${index + 1}`),
    );
    entityRepository.references = entityRepository.entities.map((entity, index) => ({
      entityId: entity.id,
      refId: `ref-${index + 1}`,
      s3Key: `saved/user-1/entities/${entity.id}/ref-${index + 1}.png`,
      cdnUrl: `https://img.lyra.app/${entity.id}.png`,
    }));
    pageRepository.generationContext = {
      ...pageRepository.generationContext!,
      frameCount: entityCount,
      panels: entityRepository.entities.map((entity) => buildTestPanel(entity.id)),
    };

    const builder = new PageGenerationInputImageBuilder(
      pageRepository,
      entityRepository,
      loader,
      new FakeLayoutGuideImageRenderer(),
    );

    await expect(builder.buildInputImages({ userId: 'user-1', pageId: 'page-1' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('reference images'),
    });
    expect(loader.calls).toEqual([]);
  });
});
