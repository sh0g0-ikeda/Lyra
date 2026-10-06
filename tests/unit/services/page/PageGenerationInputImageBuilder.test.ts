import { describe, expect, it, vi } from 'vitest';
import type { CreateEntityInput, Entity, UpdateEntityInput } from '../../../../src/domain/types/entity.js';
import type {
  EntityPrimaryReferenceImage,
  EntityRepository,
  EntityResolvedReferenceImage,
} from '../../../../src/repositories/EntityRepository.js';
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
import { OPENAI_INPUT_IMAGE_MAX_BYTES } from '../../../../src/domain/constants/imageInput.js';

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
    | { entityIds: string[]; workId: string; userId: string; organizationId: string | null }
    | null = null;
  public resolvedReferences: EntityResolvedReferenceImage[] | null = null;

  public async create(_input: CreateEntityInput): Promise<Entity> { throw new Error('not used'); }
  public async findByIdAndUserId(_id: string, _userId: string): Promise<Entity | null> { throw new Error('not used'); }
  public lastFindByWorkArgs: { workId: string; userId: string; organizationId: string | null } | null = null;
  public async findByWorkIdAndUserId(
    workId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<Entity[]> {
    this.lastFindByWorkArgs = { workId, userId, organizationId };
    return this.entities;
  }
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
    organizationId: string | null = null,
  ): Promise<EntityPrimaryReferenceImage[]> {
    this.lastArgs = { entityIds, workId, userId, organizationId };
    return this.references;
  }

  public async findResolvedReferenceImagesByAssignmentsAndUserId(
    assignments: Array<{ entityId: string; stateId: string | null }>,
    workId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<EntityResolvedReferenceImage[]> {
    this.lastArgs = {
      entityIds: Array.from(new Set(assignments.map((assignment) => assignment.entityId))),
      workId,
      userId,
      organizationId,
    };
    return this.resolvedReferences ?? assignments.map((assignment) => {
      const reference = this.references.find((candidate) => candidate.entityId === assignment.entityId);
      return {
        entityId: assignment.entityId,
        stateId: assignment.stateId,
        stateName: null,
        stateDescription: null,
        stateExists: assignment.stateId === null,
        ownerUserId: reference?.ownerUserId ?? userId,
        refId: reference?.refId ?? null,
        s3Key: reference?.s3Key ?? null,
        cdnUrl: reference?.cdnUrl ?? null,
        imageModel: null,
      };
    });
  }
}

class FakeStoredImageLoader implements StoredImageLoaderPort {
  public calls: string[] = [];
  public imageData = Buffer.from('image-bytes');

  public async loadByS3Key(s3Key: string): Promise<LoadedStoredImage> {
    this.calls.push(s3Key);
    return {
      imageData: this.imageData,
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
  it('uses the resolved numbered map as the final image even when current layout changes', async () => {
    const {resolvePageGenerationLayoutControl} = await import('../../../../src/services/page/PageGenerationLayoutControl.js');
    const control=resolvePageGenerationLayoutControl({type:'template',template_id:'splash_1'},1)!;
    const renderer={render:vi.fn().mockReturnValue({imageData:Buffer.from('guide'),mimeType:'image/png'})};
    const builder=new PageGenerationInputImageBuilder(new FakePageRepository(),new FakeEntityRepository(),new FakeStoredImageLoader(),renderer);
    const result=await builder.buildInputImages({userId:'user-1',pageId:'page-1',layoutControl:control});
    expect(renderer.render).toHaveBeenCalledWith(control.frames,{numberFrames:true});
    expect(result.at(-1)?.role).toBe('layout_reference');
    expect(result.filter(image=>image.role==='entity_reference')).toHaveLength(2);
    renderer.render.mockClear();
    await builder.buildInputImages({userId:'user-1',pageId:'page-1',layoutControl:null});
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it.each([4, 13])('旧状態が%i件でも同じbase画像を一度だけ添付する', async (assignmentCount) => {
    const states = Array.from({ length: assignmentCount }, (_, index) => index === 0 ? null : `legacy-${index}`);
    const pageRepository = new FakePageRepository();
    pageRepository.generationContext = {
      ...pageRepository.generationContext!,
      panels: states.map((stateId) => ({
        ...buildTestPanel('entity-1'),
        entities: [{ ...buildTestPanel('entity-1').entities[0]!, stateId }],
      })),
    };
    const entityRepository = new FakeEntityRepository();
    entityRepository.resolvedReferences = states.map((stateId) => ({
      entityId: 'entity-1', stateId, stateName: stateId, stateDescription: null,
      stateExists: true, ownerUserId: 'user-1', refId: 'base-ref',
      s3Key: 'saved/user-1/entities/entity-1/base-ref.png', cdnUrl: null, imageModel: null,
    }));
    const loader = new FakeStoredImageLoader();
    const images = await new PageGenerationInputImageBuilder(
      pageRepository, entityRepository, loader, new FakeLayoutGuideImageRenderer(),
    ).buildInputImages({ userId: 'user-1', pageId: 'page-1' });

    expect(loader.calls).toEqual(['saved/user-1/entities/entity-1/base-ref.png']);
    expect(images).toEqual([expect.objectContaining({
      label: 'Aoi', reference: expect.objectContaining({ stateId: null, refId: 'base-ref', subjectLabel: 'Aoi' }),
    })]);
  });

  it('同じbase画像の別名でも所有者が不正な場合は重複排除で隠さず読み込み前に拒否する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.generationContext = {
      ...pageRepository.generationContext!,
      panels: [null, 'legacy-state'].map((stateId) => ({
        ...buildTestPanel('entity-1'),
        entities: [{ ...buildTestPanel('entity-1').entities[0]!, stateId }],
      })),
    };
    const entityRepository = new FakeEntityRepository();
    entityRepository.resolvedReferences = [null, 'legacy-state'].map((stateId) => ({
      entityId: 'entity-1', stateId, stateName: null, stateDescription: null,
      stateExists: true, ownerUserId: stateId === null ? 'user-1' : 'user-2',
      refId: 'base-ref', s3Key: 'saved/user-1/entities/entity-1/base-ref.png', cdnUrl: null, imageModel: null,
    }));
    const loader = new FakeStoredImageLoader();
    await expect(new PageGenerationInputImageBuilder(
      pageRepository, entityRepository, loader, new FakeLayoutGuideImageRenderer(),
    ).buildInputImages({ userId: 'user-1', pageId: 'page-1' })).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR', message: 'entity reference image key is outside the owner scope',
    });
    expect(loader.calls).toEqual([]);
  });

  it.each([false, true])('同じ人物の既定と確定済み状態を別の参照画像として読み込み旧状態=%sを統合する', async (includeLegacy) => {
    const entityRepository = new FakeEntityRepository();
    entityRepository.resolvedReferences = [
      { entityId: 'entity-1', stateId: null, stateName: null, stateDescription: null, stateExists: true, ownerUserId: 'user-1', refId: 'base-ref', s3Key: 'saved/user-1/entities/entity-1/base-ref.png', cdnUrl: 'https://img.lyra.app/base.png', imageModel: null },
      { entityId: 'entity-1', stateId: 'state-1', stateName: '外傷', stateDescription: '左頬の傷', stateExists: true, ownerUserId: 'user-1', refId: 'state-ref', s3Key: 'saved/user-1/entities/entity-1/state-ref.png', cdnUrl: 'https://img.lyra.app/state.png', imageModel: 'gpt-image-1' },
    ];
    const pageRepository = new FakePageRepository();
    pageRepository.generationContext = {
      ...pageRepository.generationContext!,
      panels: [
        { ...pageRepository.generationContext!.panels[0]!, entities: [{ ...pageRepository.generationContext!.panels[0]!.entities[0]!, stateId: null }] },
        { ...pageRepository.generationContext!.panels[1]!, entities: [{ ...pageRepository.generationContext!.panels[1]!.entities[0]!, entityId: 'entity-1', stateId: 'state-1' }] },
      ],
    };
    if (includeLegacy) {
      entityRepository.resolvedReferences.push({
        ...entityRepository.resolvedReferences[0]!, stateId: 'legacy-state', stateName: 'legacy note',
      });
      pageRepository.generationContext.panels.unshift({
        ...buildTestPanel('entity-1'),
        entities: [{ ...buildTestPanel('entity-1').entities[0]!, stateId: 'legacy-state' }],
      });
    }
    const loader = new FakeStoredImageLoader();
    const images = await new PageGenerationInputImageBuilder(
      pageRepository, entityRepository, loader, new FakeLayoutGuideImageRenderer(),
    ).buildInputImages({ userId: 'user-1', pageId: 'page-1' });

    expect(images.filter((image) => image.role === 'entity_reference').map((image) => image.label))
      .toEqual(['Aoi / default', 'Aoi / 外傷']);
    expect(loader.calls).toEqual([
      'saved/user-1/entities/entity-1/base-ref.png',
      'saved/user-1/entities/entity-1/state-ref.png',
    ]);
    expect(images.filter((image) => image.role === 'entity_reference').map((image) => image.reference))
      .toEqual([
        {
          entityId: 'entity-1', stateId: null, refId: 'base-ref',
          s3Key: 'saved/user-1/entities/entity-1/base-ref.png', imageModel: null, subjectLabel: 'Aoi / default',
        },
        {
          entityId: 'entity-1', stateId: 'state-1', refId: 'state-ref',
          s3Key: 'saved/user-1/entities/entity-1/state-ref.png', imageModel: 'gpt-image-1', subjectLabel: 'Aoi / 外傷',
        },
      ]);
  });

  it('未確定またはstaleな新しい状態に既定画像を代入せず生成を止める', async () => {
    const entityRepository = new FakeEntityRepository();
    entityRepository.resolvedReferences = [{
      entityId: 'entity-1', stateId: 'state-1', stateName: '外傷', stateDescription: '左頬の傷',
      stateExists: true, ownerUserId: null, refId: null, s3Key: null, cdnUrl: null, imageModel: null,
    }];
    const pageRepository = new FakePageRepository();
    pageRepository.generationContext = {
      ...pageRepository.generationContext!,
      panels: [{
        ...pageRepository.generationContext!.panels[0]!,
        entities: [{ ...pageRepository.generationContext!.panels[0]!.entities[0]!, stateId: 'state-1' }],
      }],
    };
    const loader = new FakeStoredImageLoader();

    await expect(new PageGenerationInputImageBuilder(
      pageRepository, entityRepository, loader, new FakeLayoutGuideImageRenderer(),
    ).buildInputImages({ userId: 'user-1', pageId: 'page-1' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(loader.calls).toEqual([]);
  });

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
      organizationId: null,
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      role: 'entity_reference',
      label: 'Aoi',
    });
    expect(result[0]?.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('法人Workspaceのページでは参照画像取得にも同じorganizationIdを使う', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.generationContext = {
      ...pageRepository.generationContext!,
      organizationId: 'org-1',
    };
    const entityRepository = new FakeEntityRepository();
    const layoutGuideImageRenderer = new FakeLayoutGuideImageRenderer();
    layoutGuideImageRenderer.nextResult = null;
    const builder = new PageGenerationInputImageBuilder(
      pageRepository,
      entityRepository,
      new FakeStoredImageLoader(),
      layoutGuideImageRenderer,
    );

    await builder.buildInputImages({
      userId: 'user-1',
      organizationId: 'org-1',
      pageId: 'page-1',
    });

    expect(entityRepository.lastFindByWorkArgs).toEqual({
      workId: 'work-1',
      userId: 'user-1',
      organizationId: 'org-1',
    });
    expect(entityRepository.lastArgs).toEqual({
      entityIds: ['entity-1', 'entity-2'],
      workId: 'work-1',
      userId: 'user-1',
      organizationId: 'org-1',
    });
  });

  it('custom layout では最後に layout_reference を追加する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.generationContext = {
      ...pageRepository.generationContext!,
      panels: [pageRepository.generationContext!.panels[0]!],
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

  it('同一人物でも状態別のdistinct assignmentが上限を超える場合は画像を読み込まない', async () => {
    const assignmentCount = PAGE_GENERATION_INPUT_IMAGE_LIMITS.MAX_ENTITY_REFERENCE_IMAGES + 1;
    const entityRepository = new FakeEntityRepository();
    entityRepository.resolvedReferences = Array.from({ length: assignmentCount }, (_, index) => ({
      entityId: 'entity-1',
      stateId: `state-${index + 1}`,
      stateName: `状態${index + 1}`,
      stateDescription: '確認済み',
      stateExists: true,
      ownerUserId: 'user-1',
      refId: `state-ref-${index + 1}`,
      s3Key: `saved/user-1/entities/entity-1/state-ref-${index + 1}.png`,
      cdnUrl: null,
      imageModel: 'gpt-image-2',
    }));
    const pageRepository = new FakePageRepository();
    pageRepository.generationContext = {
      ...pageRepository.generationContext!,
      panels: Array.from({ length: assignmentCount }, (_, index) => ({
        ...buildTestPanel('entity-1'),
        panelId: `panel-state-${index + 1}`,
        entities: [{ ...buildTestPanel('entity-1').entities[0]!, stateId: `state-${index + 1}` }],
      })),
    };
    const loader = new FakeStoredImageLoader();

    await expect(new PageGenerationInputImageBuilder(
      pageRepository, entityRepository, loader, new FakeLayoutGuideImageRenderer(),
    ).buildInputImages({ userId: 'user-1', pageId: 'page-1' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('reference images'),
    });
    expect(loader.calls).toEqual([]);
  });

  it('参照画像の無いobject割当が12件を超えても画像上限としては拒否しない', async () => {
    const pageRepository = new FakePageRepository();
    const entityRepository = new FakeEntityRepository();
    const imageLoader = new FakeStoredImageLoader();
    entityRepository.resolvedReferences = [];
    pageRepository.generationContext = {
      ...pageRepository.generationContext!,
      panels: Array.from({ length: PAGE_GENERATION_INPUT_IMAGE_LIMITS.MAX_ENTITY_REFERENCE_IMAGES + 1 }, (_, index) =>
        buildTestPanel(`object-${index + 1}`)),
    };
    const builder = new PageGenerationInputImageBuilder(
      pageRepository, entityRepository, imageLoader, new FakeLayoutGuideImageRenderer(),
    );

    await expect(builder.buildInputImages({ userId: 'user-1', pageId: 'page-1' })).resolves.toEqual([]);
    expect(imageLoader.calls).toEqual([]);
  });

  it('stored reference image key が所有者スコープ外なら loader に渡さない', async () => {
    const loader = new FakeStoredImageLoader();
    const entityRepository = new FakeEntityRepository();
    entityRepository.references = [
      {
        entityId: 'entity-1',
        refId: 'ref-1',
        s3Key: 'saved/user-2/entities/entity-1/ref-1.png',
        cdnUrl: 'https://img.lyra.app/ref-1.png',
      },
    ];
    const builder = new PageGenerationInputImageBuilder(
      new FakePageRepository(),
      entityRepository,
      loader,
      new FakeLayoutGuideImageRenderer(),
    );

    await expect(builder.buildInputImages({ userId: 'user-1', pageId: 'page-1' })).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: 'entity reference image key is outside the owner scope',
    });
    expect(loader.calls).toEqual([]);
  });

  it('状態descriptorのstorage ownerとkeyが一致しない場合はloaderに渡さない', async () => {
    const entityRepository = new FakeEntityRepository();
    entityRepository.resolvedReferences = [{
      entityId: 'entity-1', stateId: 'state-1', stateName: '外傷', stateDescription: '左頬の傷',
      stateExists: true, ownerUserId: 'user-2', refId: 'state-ref-1',
      s3Key: 'saved/user-1/entities/entity-1/state-ref-1.png', cdnUrl: null, imageModel: 'gpt-image-2',
    }];
    const pageRepository = new FakePageRepository();
    pageRepository.generationContext = {
      ...pageRepository.generationContext!,
      panels: [{
        ...pageRepository.generationContext!.panels[0]!,
        entities: [{ ...pageRepository.generationContext!.panels[0]!.entities[0]!, stateId: 'state-1' }],
      }],
    };
    const loader = new FakeStoredImageLoader();

    await expect(new PageGenerationInputImageBuilder(
      pageRepository, entityRepository, loader, new FakeLayoutGuideImageRenderer(),
    ).buildInputImages({ userId: 'user-1', pageId: 'page-1' })).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: 'entity reference image key is outside the owner scope',
    });
    expect(loader.calls).toEqual([]);
  });

  it('active confirmed Hy4 referenceは画像読込前に409で拒否する', async () => {
    const entityRepository = new FakeEntityRepository();
    entityRepository.resolvedReferences = [{
      entityId: 'entity-1', stateId: null, stateName: null, stateDescription: null,
      stateExists: true, ownerUserId: 'user-1', refId: 'hy4-ref',
      s3Key: 'saved/user-1/entities/entity-1/hy4-ref.png', cdnUrl: null,
      imageModel: 'hy4-preview', providerModelId: 'hy4-preview', provider: 'tencent',
    }];
    const loader = new FakeStoredImageLoader();
    const builder = new PageGenerationInputImageBuilder(
      new FakePageRepository(), entityRepository, loader, new FakeLayoutGuideImageRenderer(),
    );

    await expect(builder.assertRenderableState({ userId: 'user-1', pageId: 'page-1' }))
      .rejects.toMatchObject({ code: 'PAGE_REFERENCE_MODEL_INCOMPATIBLE', statusCode: 409 });
    await expect(builder.buildInputImages({ userId: 'user-1', pageId: 'page-1' }))
      .rejects.toMatchObject({ code: 'PAGE_REFERENCE_MODEL_INCOMPATIBLE', statusCode: 409 });
    expect(loader.calls).toEqual([]);
  });

  it.each([
    ['Hy4 primary + GPT named state', 'hy4-preview', 'gpt-image-2'],
    ['GPT primary + Hy4 named state', 'gpt-image-2', 'hy4-preview'],
  ])('%sは画像読込前に409で拒否する', async (_label, primaryModel, stateModel) => {
    const pageRepository = new FakePageRepository();
    pageRepository.generationContext = {
      ...pageRepository.generationContext!,
      panels: [{
        ...pageRepository.generationContext!.panels[0]!,
        entities: [{ ...pageRepository.generationContext!.panels[0]!.entities[0]!, stateId: 'state-1' }],
      }],
    };
    const entityRepository = new FakeEntityRepository();
    entityRepository.references = [{
      entityId: 'entity-1', refId: 'primary-ref',
      s3Key: 'saved/user-1/entities/entity-1/primary-ref.png', cdnUrl: 'https://img.lyra.app/primary-ref.png',
      imageModel: primaryModel,
      providerModelId: primaryModel,
      provider: primaryModel === 'hy4-preview' ? 'tencent' : 'openai',
    }];
    entityRepository.resolvedReferences = [{
      entityId: 'entity-1', stateId: 'state-1', stateName: '外傷', stateDescription: '左頬の傷',
      stateExists: true, ownerUserId: 'user-1', refId: 'state-ref',
      s3Key: 'saved/user-1/entities/entity-1/state-ref.png', cdnUrl: null,
      imageModel: stateModel,
      providerModelId: stateModel,
      provider: stateModel === 'hy4-preview' ? 'tencent' : 'openai',
    }];
    const loader = new FakeStoredImageLoader();
    const builder = new PageGenerationInputImageBuilder(
      pageRepository, entityRepository, loader, new FakeLayoutGuideImageRenderer(),
    );

    await expect(builder.assertRenderableState({ userId: 'user-1', pageId: 'page-1' }))
      .rejects.toMatchObject({ code: 'PAGE_REFERENCE_MODEL_INCOMPATIBLE', statusCode: 409 });
    expect(loader.calls).toEqual([]);
  });

  it('reference画像が入力上限を超える場合はOpenAI入力を作らない', async () => {
    const loader = new FakeStoredImageLoader();
    loader.imageData = Buffer.alloc(OPENAI_INPUT_IMAGE_MAX_BYTES + 1);
    const layoutGuideImageRenderer = new FakeLayoutGuideImageRenderer();
    layoutGuideImageRenderer.nextResult = null;
    const builder = new PageGenerationInputImageBuilder(
      new FakePageRepository(),
      new FakeEntityRepository(),
      loader,
      layoutGuideImageRenderer,
    );

    await expect(builder.buildInputImages({ userId: 'user-1', pageId: 'page-1' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('input image is too large'),
    });
  });
});
