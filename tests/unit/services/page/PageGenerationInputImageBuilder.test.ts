import { describe, expect, it } from 'vitest';
import type { CreateEntityInput, Entity, UpdateEntityInput } from '../../../../src/domain/types/entity.js';
import type { EntityPrimaryReferenceImage, EntityRepository } from '../../../../src/repositories/EntityRepository.js';
import type { PageRepository } from '../../../../src/repositories/PageRepository.js';
import type {
  PageGenerationContext,
  PageGenerationStateUpdate,
  PagePromptContext,
} from '../../../../src/domain/types/page.js';
import type { LoadedStoredImage, StoredImageLoaderPort } from '../../../../src/infrastructure/aws/S3StoredImageLoader.js';
import { PageGenerationInputImageBuilder } from '../../../../src/services/page/PageGenerationInputImageBuilder.js';

class FakePageRepository implements PageRepository {
  public generationContext: PageGenerationContext | null = {
    pageId: 'page-1',
    workId: 'work-1',
    layoutConfig: { type: 'template' },
    generatedImage: null,
    generationMode: null,
    status: 'designing',
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
            stateId: null,
          },
        ],
      },
    ],
  };

  public async findGenerationContextByIdAndUserId(): Promise<PageGenerationContext | null> {
    return this.generationContext;
  }

  public async findPromptContextByIdAndUserId(): Promise<PagePromptContext | null> {
    throw new Error('not used');
  }

  public async updateGenerationState(
    _pageId: string,
    _userId: string,
    _input: PageGenerationStateUpdate,
  ): Promise<boolean> {
    throw new Error('not used');
  }
}

class FakeEntityRepository implements EntityRepository {
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
  public async findByWorkIdAndUserId(_workId: string, _userId: string): Promise<Entity[]> { throw new Error('not used'); }
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

describe('PageGenerationInputImageBuilder', () => {
  it('panel順の一意entityに対してreference画像をdataUrl化する', async () => {
    const loader = new FakeStoredImageLoader();
    const entityRepository = new FakeEntityRepository();
    const builder = new PageGenerationInputImageBuilder(
      new FakePageRepository(),
      entityRepository,
      loader,
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
    });
    expect(result[0]?.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });
});
