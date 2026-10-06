import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../../src/domain/errors/index.js';
import type { CompositionGalleryItem } from '../../../../src/domain/types/composition.js';
import type { Entity } from '../../../../src/domain/types/entity.js';
import type { Panel } from '../../../../src/domain/types/panel.js';
import type { PageGenerationContext, PagePromptContext, PageSummary } from '../../../../src/domain/types/page.js';
import type { CompositionGalleryRepository } from '../../../../src/repositories/CompositionGalleryRepository.js';
import type {
  EntityPrimaryReferenceImage,
  EntityResolvedReferenceImage,
  EntityRepository,
} from '../../../../src/repositories/EntityRepository.js';
import type { PageRepository } from '../../../../src/repositories/PageRepository.js';
import type { CreatePanelInput, UpdatePanelInput } from '../../../../src/domain/types/panel.js';
import type { CreateEntityInput, UpdateEntityInput } from '../../../../src/domain/types/entity.js';
import type { PagePanelContext, PanelContext, PanelRepository } from '../../../../src/repositories/PanelRepository.js';
import type { PageGenerationStateUpdate } from '../../../../src/repositories/PageRepository.js';
import { PromptBuilder } from '../../../../src/services/page/PromptBuilder.js';

class FakePageRepository implements PageRepository {
  public promptContext: PagePromptContext | null = buildPagePromptContext();

  public async findPagesByEpisodeIdAndUserId(): Promise<[]> {
    return [];
  }

  public async findPageByIdAndUserId(): Promise<PageSummary | null> {
    return null;
  }

  public async findGenerationContextByIdAndUserId(): Promise<PageGenerationContext | null> {
    throw new Error('not used');
  }

  public async findPromptContextByIdAndUserId(): Promise<PagePromptContext | null> {
    return this.promptContext;
  }

  public async findAutofillContextByIdAndUserId(): Promise<never> {
    throw new Error('not used');
  }

  public async findEpisodePlanningContextByIdAndUserId(): Promise<never> {
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

class FakePanelRepository implements PanelRepository {
  public panels: Panel[] = [buildPanel()];

  public async findPageContextByIdAndUserId(): Promise<PagePanelContext | null> {
    throw new Error('not used');
  }

  public async findPanelContextByIdAndUserId(): Promise<PanelContext | null> {
    throw new Error('not used');
  }

  public async createPanel(
    _pageId: string,
    _userId: string,
    _input: CreatePanelInput,
  ): Promise<Panel | null> {
    throw new Error('not used');
  }

  public async findPanelsByPageIdAndUserId(): Promise<Panel[]> {
    return this.panels;
  }

  public async updatePanel(
    _panelId: string,
    _userId: string,
    _input: UpdatePanelInput,
  ): Promise<Panel | null> {
    throw new Error('not used');
  }

  public async deletePanel(_panelId: string, _userId: string): Promise<boolean> {
    throw new Error('not used');
  }

  public async compactPanelOrdersAfterDelete(): Promise<void> {
    throw new Error('not used');
  }

  public async reorderPanels(): Promise<Panel[]> {
    throw new Error('not used');
  }
}

class FakeEntityRepository implements EntityRepository {
  public entities: Entity[] = [buildEntity()];
  public lastFindByWorkArgs: { workId: string; userId: string; organizationId: string | null } | null = null;
  public lastReferenceArgs:
    | { entityIds: string[]; workId: string; userId: string; organizationId: string | null }
    | null = null;
  public resolvedReferences: EntityResolvedReferenceImage[] | null = null;

  public async create(_input: CreateEntityInput): Promise<Entity> {
    throw new Error('not used');
  }

  public async findByIdAndUserId(_id: string, _userId: string): Promise<Entity | null> {
    throw new Error('not used');
  }

  public async findByWorkIdAndUserId(
    workId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<Entity[]> {
    this.lastFindByWorkArgs = { workId, userId, organizationId };
    return this.entities;
  }

  public async countByIdsAndWorkIdAndUserId(): Promise<number> {
    return 1;
  }

  public async findPrimaryReferenceImagesByEntityIdsAndUserId(
    entityIds: string[],
    workId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<EntityPrimaryReferenceImage[]> {
    this.lastReferenceArgs = { entityIds, workId, userId, organizationId };
    return entityIds
      .filter((entityId) => this.entities.some((entity) => entity.id === entityId))
      .map((entityId, index) => ({
        entityId,
        refId: `ref-${index + 1}`,
        s3Key: `saved/user-1/entities/${entityId}/ref-${index + 1}.png`,
        cdnUrl: `https://img.lyra.app/ref-${index + 1}.png`,
      }));
  }

  public async findResolvedReferenceImagesByAssignmentsAndUserId(
    assignments: Array<{ entityId: string; stateId: string | null }>,
    workId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<EntityResolvedReferenceImage[]> {
    this.lastReferenceArgs = {
      entityIds: Array.from(new Set(assignments.map((assignment) => assignment.entityId))),
      workId,
      userId,
      organizationId,
    };
    return this.resolvedReferences ?? assignments.map((assignment, index) => ({
      entityId: assignment.entityId,
      stateId: assignment.stateId,
      stateName: null,
      stateDescription: null,
      stateExists: assignment.stateId === null,
      ownerUserId: 'user-1',
      refId: `ref-${index + 1}`,
      s3Key: `saved/user-1/entities/${assignment.entityId}/ref-${index + 1}.png`,
      cdnUrl: null,
      imageModel: null,
    }));
  }

  public async update(_id: string, _userId: string, _input: UpdateEntityInput): Promise<Entity | null> {
    throw new Error('not used');
  }

  public async delete(_id: string, _userId: string): Promise<boolean> {
    throw new Error('not used');
  }
}

class FakeCompositionGalleryRepository implements CompositionGalleryRepository {
  public items: CompositionGalleryItem[] = [buildCompositionGalleryItem()];

  public async findMany(): Promise<CompositionGalleryItem[]> {
    return this.items;
  }

  public async findByIds(): Promise<CompositionGalleryItem[]> {
    return this.items;
  }
}

describe('PromptBuilder', () => {
  it('keeps off-panel thought identity without adding a visible subject or image reference', async () => {
    const panels=new FakePanelRepository();const entities=new FakeEntityRepository();
    entities.entities.push({...entities.entities[0]!,id:'off-panel',name:'Mio'});
    panels.panels[0]!.dialogue=[{entityId:'off-panel',text:'I remember.',type:'thought',position:'right'},{entityId:null,text:'Later.',type:'narration',position:'left'}];
    const result=await new PromptBuilder(new FakePageRepository(),panels,entities,new FakeCompositionGalleryRepository()).buildPagePrompt({userId:'user-1',pageId:'page-1',requestKind:'initial',generationMode:'standard'});
    expect(result.draftPrompt).toContain('off-panel');
    expect(result.draftPrompt).toContain('thought has no speech tail');
    expect(result.draftPrompt).toContain('Mio');
    expect(result.inputSnapshot.panels[0]?.entityIds).toEqual(['entity-1']);
    expect(result.inputSnapshot.references).toHaveLength(1);
    expect(result.inputSnapshot.panels[0]?.dialogue[0]?.entityId).toBe('off-panel');
  });

  it('freezes a complete numbered frame map with the prompt and marks the last image as layout', async () => {
    const page=new FakePageRepository();page.promptContext=buildPagePromptContext({layoutConfig:{type:'template',template_id:'splash_1'}});
    const result=await new PromptBuilder(page,new FakePanelRepository(),new FakeEntityRepository(),new FakeCompositionGalleryRepository()).buildPagePrompt({userId:'user-1',pageId:'page-1',requestKind:'initial',generationMode:'standard'});
    expect(result.layoutControl?.frames[0]?.physicalPlacement).toContain('full page');
    expect(result.compilerBrief).toContain('P1: full page');
    expect(result.compilerBrief).toContain('Image 2 (layout)');
    expect(result.inputSnapshot.references).toHaveLength(1);
  });

  it.each([false, true])('旧状態の別名を同一Imageに割当て全panelを許可しvariant=%sを保持する', async (includeVariant) => {
    const states = ['legacy-first', null, 'legacy-second', ...(includeVariant ? ['state-injured'] : [])];
    const panelRepository = new FakePanelRepository();
    panelRepository.panels = states.map((stateId, index) => ({
      ...buildPanel(), id: `panel-${index + 1}`, order: index + 1,
      entities: [{ ...buildPanel().entities[0]!, stateId }],
    }));
    const entityRepository = new FakeEntityRepository();
    entityRepository.resolvedReferences = states.map((stateId) => ({
      entityId: 'entity-1', stateId, stateName: stateId === 'state-injured' ? 'injured' : stateId,
      stateDescription: stateId === 'state-injured' ? 'cheek scar' : null,
      stateExists: true, ownerUserId: 'user-1',
      refId: stateId === 'state-injured' ? 'injured-ref' : 'base-ref',
      s3Key: `saved/user-1/entities/entity-1/${stateId === 'state-injured' ? 'injured-ref' : 'base-ref'}.png`,
      cdnUrl: null, imageModel: null,
    }));
    const pageRepository = new FakePageRepository();
    pageRepository.promptContext = buildPagePromptContext({ layoutConfig: { type: 'custom' } });
    const result = await new PromptBuilder(
      pageRepository, panelRepository, entityRepository, new FakeCompositionGalleryRepository(),
    ).buildPagePrompt({ userId: 'user-1', pageId: 'page-1', requestKind: 'initial', generationMode: 'standard' });

    const baseLabel = includeVariant ? 'Aki / default' : 'Aki';
    for (const order of [1, 2, 3]) {
      expect(result.draftPrompt).toContain(`Panel ${order} subject lock: required visible subjects are Aki, reference Image 1 (${baseLabel})`);
      expect(result.draftPrompt).toContain(`Panel ${order} dialogue by Aki, reference Image 1 (${baseLabel})`);
    }
    expect(result.draftPrompt).toContain(`${baseLabel} is allowed only in panels 1, 2, 3`);
    expect(result.draftPrompt).not.toContain(`Image ${includeVariant ? 3 : 2} (layout)`);
    expect(result.inputSnapshot.references?.map((reference) => [reference.stateId, reference.refId, reference.modelInputOrder, reference.subjectLabel]))
      .toEqual([
        [null, 'base-ref', 1, baseLabel],
        ...(includeVariant ? [['state-injured', 'injured-ref', 2, 'Aki / injured']] : []),
      ]);
  });

  it('同一人物の既定と状態を別Imageに割当て、subject lockとsnapshotへ固定する', async () => {
    const panelRepository = new FakePanelRepository();
    panelRepository.panels = [
      buildPanel(),
      {
        ...buildPanel(),
        id: 'panel-2',
        order: 2,
        entities: [{ ...buildPanel().entities[0]!, stateId: 'state-injured' }],
      },
    ];
    const entityRepository = new FakeEntityRepository();
    entityRepository.resolvedReferences = [
      {
        entityId: 'entity-1', stateId: null, stateName: null, stateDescription: null,
        stateExists: true, ownerUserId: 'user-1', refId: 'base-ref',
        s3Key: 'saved/user-1/entities/entity-1/base-ref.png', cdnUrl: null, imageModel: null,
      },
      {
        entityId: 'entity-1', stateId: 'state-injured', stateName: 'injured', stateDescription: 'cheek scar',
        stateExists: true, ownerUserId: 'user-1', refId: 'injured-ref',
        s3Key: 'saved/user-1/entities/entity-1/injured-ref.png', cdnUrl: null, imageModel: 'gpt-image-2',
      },
    ];
    const builder = new PromptBuilder(
      new FakePageRepository(),
      panelRepository,
      entityRepository,
      new FakeCompositionGalleryRepository(),
    );

    const result = await builder.buildPagePrompt({
      userId: 'user-1', pageId: 'page-1', requestKind: 'initial', generationMode: 'thinking',
    });

    expect(result.draftPrompt).toContain('Image 1 (Aki / default)');
    expect(result.draftPrompt).toContain('Image 2 (Aki / injured)');
    expect(result.draftPrompt).toContain('Panel 1 subject lock: required visible subjects are Aki, reference Image 1 (Aki / default)');
    expect(result.draftPrompt).toContain('Panel 2 subject lock: required visible subjects are Aki, reference Image 2 (Aki / injured)');
    expect(result.draftPrompt).toContain('Panel 2 dialogue by Aki, reference Image 2 (Aki / injured)');
    expect(result.draftPrompt).toContain('Visual lock for panel 2: subjects=Aki [Image 2 (Aki / injured)]');
    expect(result.inputSnapshot.references).toEqual([
      {
        entityId: 'entity-1', stateId: null, refId: 'base-ref',
        s3Key: 'saved/user-1/entities/entity-1/base-ref.png', imageModel: null,
        subjectLabel: 'Aki / default', modelInputOrder: 1,
      },
      {
        entityId: 'entity-1', stateId: 'state-injured', refId: 'injured-ref',
        s3Key: 'saved/user-1/entities/entity-1/injured-ref.png', imageModel: 'gpt-image-2',
        subjectLabel: 'Aki / injured', modelInputOrder: 2,
      },
    ]);
    const monochrome = await builder.buildPagePrompt({
      userId: 'user-1', pageId: 'page-1', requestKind: 'initial',
      generationMode: 'thinking', renderStyle: 'monochrome',
    });
    expect(monochrome.draftPrompt).toContain('black-and-white manga');
    expect(monochrome.draftPrompt).toContain('Image 2 (Aki / injured)');
    expect(monochrome.inputSnapshot.references).toEqual(result.inputSnapshot.references);
    expect(monochrome.inputSnapshot.renderStyle).toBe('monochrome');
  });

  it('未確定variantを旧base画像へ戻さず明示的に止める', async () => {
    const panelRepository = new FakePanelRepository();
    panelRepository.panels = [{
      ...buildPanel(),
      entities: [{ ...buildPanel().entities[0]!, stateId: 'state-injured' }],
    }];
    const entityRepository = new FakeEntityRepository();
    entityRepository.resolvedReferences = [{
      entityId: 'entity-1', stateId: 'state-injured', stateName: 'injured', stateDescription: 'cheek scar',
      stateExists: true, ownerUserId: null, refId: null, s3Key: null, cdnUrl: null, imageModel: null,
    }];
    const builder = new PromptBuilder(
      new FakePageRepository(), panelRepository, entityRepository, new FakeCompositionGalleryRepository(),
    );

    await expect(builder.buildPagePrompt({
      userId: 'user-1', pageId: 'page-1', requestKind: 'initial', generationMode: 'thinking',
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('複数stateをpanel順に別々のreferenceとsnapshotへ固定する', async () => {
    const panelRepository = new FakePanelRepository();
    panelRepository.panels = [
      { ...buildPanel(), entities: [{ ...buildPanel().entities[0]!, stateId: 'state-injured' }] },
      {
        ...buildPanel(), id: 'panel-2', order: 2,
        entities: [{ ...buildPanel().entities[0]!, stateId: 'state-rain' }],
      },
    ];
    const entityRepository = new FakeEntityRepository();
    entityRepository.resolvedReferences = [
      {
        entityId: 'entity-1', stateId: 'state-injured', stateName: 'injured', stateDescription: 'cheek scar',
        stateExists: true, ownerUserId: 'user-1', refId: 'injured-ref',
        s3Key: 'saved/user-1/entities/entity-1/injured-ref.png', cdnUrl: null, imageModel: 'gpt-image-2',
      },
      {
        entityId: 'entity-1', stateId: 'state-rain', stateName: 'rain', stateDescription: 'wet hair',
        stateExists: true, ownerUserId: 'user-1', refId: 'rain-ref',
        s3Key: 'saved/user-1/entities/entity-1/rain-ref.png', cdnUrl: null, imageModel: 'gpt-image-2',
      },
    ];

    const result = await new PromptBuilder(
      new FakePageRepository(), panelRepository, entityRepository, new FakeCompositionGalleryRepository(),
    ).buildPagePrompt({
      userId: 'user-1', pageId: 'page-1', requestKind: 'initial', generationMode: 'thinking',
    });

    expect(result.draftPrompt).toContain('Image 1 (Aki / injured)');
    expect(result.draftPrompt).toContain('Image 2 (Aki / rain)');
    expect(result.inputSnapshot.references?.map((reference) => [reference.stateId, reference.refId, reference.modelInputOrder]))
      .toEqual([
        ['state-injured', 'injured-ref', 1],
        ['state-rain', 'rain-ref', 2],
      ]);
  });

  it('白黒生成の場合に白黒styleを固定しカラー指示を出さない', async () => {
    const builder = new PromptBuilder(
      new FakePageRepository(), new FakePanelRepository(),
      new FakeEntityRepository(), new FakeCompositionGalleryRepository(),
    );
    const result = await builder.buildPagePrompt({
      userId: 'user-1', pageId: 'page-1', requestKind: 'initial',
      generationMode: 'standard', renderStyle: 'monochrome',
    });

    expect(result.draftPrompt).toContain('black-and-white manga');
    expect(result.compilerBrief).toContain('black-and-white manga');
    expect(result.draftPrompt).not.toContain('flat colors with manga-style shading');
    expect(result.inputSnapshot).toMatchObject({ renderStyle: 'monochrome' });
  });
  it('includes layout, references, setting, and dialogue without redundant sections', async () => {
    const builder = new PromptBuilder(
      new FakePageRepository(),
      new FakePanelRepository(),
      new FakeEntityRepository(),
      new FakeCompositionGalleryRepository(),
    );

    const result = await builder.buildPagePrompt({
      userId: 'user-1',
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'thinking',
    });

    expect(result.draftPrompt).toContain('Create page 3 of the episode, covering The hero confronts the rival.');
    expect(result.draftPrompt).toContain('No complete saved frame map is available. Keep exactly 1 panels');
    expect(result.draftPrompt).toContain('Image 1 (Aki): Aki character reference.');
    expect(result.draftPrompt).toContain('Use this image only for Aki; never use it as another character.');
    expect(result.draftPrompt).toContain('Aki is allowed only in panel 1 where listed in the subject lock.');
    expect(result.draftPrompt).toContain(
      'Panel 1 subject lock: required visible subjects are Aki, reference Image 1 (Aki), role primary, center zone, facing three quarter left.',
    );
    expect(result.draftPrompt).toContain('Every listed subject must be visibly present and recognizable in this panel.');
    expect(result.draftPrompt).toContain('Do not substitute, merge, swap, or replace these subjects with any other character or reference image.');
    expect(result.draftPrompt).toContain('Aki, reference Image 1 (Aki), is primary in the center zone, facing three quarter left');
    expect(result.draftPrompt).toContain('Sound effect text in the artwork: "WHOOSH".');
    expect(result.draftPrompt).toContain('Panel 1 dialogue by Aki, reference Image 1 (Aki): "I will finish this now." as speech at top.');
    expect(result.draftPrompt).toContain('Dialogue lock for panel 1: line 1 must stay assigned to Aki, reference Image 1 (Aki) exactly as written: "I will finish this now."');
    expect(result.draftPrompt).toContain(
      'Visual lock for panel 1: subjects=Aki [Image 1 (Aki)]; situation cue="Hero lunges forward."; shot=full_body; angle=three_quarter; background cue="Collapsed alley at dusk.".',
    );
    expect(result.draftPrompt).toContain('Reference image roles:');
    expect(result.draftPrompt).toContain('Style lock: anime manga illustration');
    expect(result.draftPrompt).toContain('Page setting continuity: Scene 1: Rooftop / night / tense.');
    expect(result.draftPrompt).toContain(
      'Page purpose: This page escalates the rooftop confrontation without breaking the uneasy calm.',
    );
    expect(result.draftPrompt).toContain(
      'Continuity note: Carry the moonlit tension forward into the next page.',
    );
    expect(result.compilerBrief).toContain('[REFERENCE IMAGE ROLES]');
    expect(result.compilerBrief).toContain('[PANEL INSTRUCTIONS]');
    expect(result.compilerBrief).toContain('[SETTING]');
    expect(result.compilerBrief).toContain(
      'Page purpose: This page escalates the rooftop confrontation without breaking the uneasy calm.',
    );
    expect(result.compilerBrief).toContain(
      'Continuity note: Carry the moonlit tension forward into the next page.',
    );
    expect(result.compilerBrief).toContain('- Dialogue lock: Dialogue lock for panel 1: line 1 must stay assigned to Aki, reference Image 1 (Aki) exactly as written: "I will finish this now."');
    expect(result.compilerBrief).toContain(
      '- Subject lock: Panel 1 subject lock: required visible subjects are Aki, reference Image 1 (Aki), role primary, center zone, facing three quarter left.',
    );
    expect(result.compilerBrief).toContain(
      '- Visual lock: Visual lock for panel 1: subjects=Aki [Image 1 (Aki)]; situation cue="Hero lunges forward."; shot=full_body; angle=three_quarter; background cue="Collapsed alley at dusk.".',
    );
    expect(result.compilerBrief).not.toContain('[CHARACTER CONSISTENCY]');
    expect(result.compilerBrief).not.toContain('Scene continuity:');
    expect(countOccurrences(result.compilerBrief, 'Image 1 (Aki): Aki character reference.')).toBe(1);
    expect(result.inputSnapshot).toMatchObject({
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'thinking',
      panelCount: 1,
      panels: [
        {
          panelId: 'panel-1',
          order: 1,
          entityIds: ['entity-1'],
          entityNames: ['Aki'],
          dialogue: [
            {
              entityId: 'entity-1',
              speakerName: 'Aki',
              type: 'speech',
              position: 'top',
              text: 'I will finish this now.',
            },
          ],
        },
      ],
    });
  });

  it('法人Workspaceのページではプロンプト用entityとreferenceもorganizationIdで読む', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.promptContext = buildPagePromptContext({ organizationId: 'org-1' });
    const entityRepository = new FakeEntityRepository();
    const builder = new PromptBuilder(
      pageRepository,
      new FakePanelRepository(),
      entityRepository,
      new FakeCompositionGalleryRepository(),
    );

    await builder.buildPagePrompt({
      userId: 'user-1',
      organizationId: 'org-1',
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'standard',
    });

    expect(entityRepository.lastFindByWorkArgs).toEqual({
      workId: 'work-1',
      userId: 'user-1',
      organizationId: 'org-1',
    });
    expect(entityRepository.lastReferenceArgs).toEqual({
      entityIds: ['entity-1'],
      workId: 'work-1',
      userId: 'user-1',
      organizationId: 'org-1',
    });
  });

  it('treats regeneration prompts as fresh renders from current inputs', async () => {
    const builder = new PromptBuilder(
      new FakePageRepository(),
      new FakePanelRepository(),
      new FakeEntityRepository(),
      new FakeCompositionGalleryRepository(),
    );

    const result = await builder.buildPagePrompt({
      userId: 'user-1',
      pageId: 'page-1',
      requestKind: 'regenerate',
      generationMode: 'standard',
    });

    expect(result.draftPrompt).toContain(
      'fresh standard generation request based only on the current saved page inputs',
    );
    expect(result.draftPrompt).toContain(
      'Do not treat this as an edit, continuation, or restoration of any previously generated page image.',
    );
    expect(result.draftPrompt).toContain(
      'Treat uploaded images only as character or layout references, never as a previous page image or an edit target.',
    );
    expect(result.compilerBrief).toContain(
      'fresh standard generation request based only on the current saved page inputs',
    );
    expect(result.compilerBrief).not.toContain('regenerate');
  });

  it('omits dialogue instructions for balloon_only pages', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.promptContext = buildPagePromptContext({
      dialogueMode: 'balloon_only',
    });
    const builder = new PromptBuilder(
      pageRepository,
      new FakePanelRepository(),
      new FakeEntityRepository(),
      new FakeCompositionGalleryRepository(),
    );

    const result = await builder.buildPagePrompt({
      userId: 'user-1',
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'standard',
    });

    expect(result.draftPrompt).not.toContain('Panel 1 dialogue by Aki');
    expect(result.compilerBrief).not.toContain('Panel 1 dialogue by Aki');
  });

  it('includes frame definitions for custom layout pages', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.promptContext = buildPagePromptContext({
      layoutConfig: {
        type: 'custom',
        frame_definitions: [
          {
            reading_order: 1,
            vertices: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 0.5 },
              { x: 0, y: 0.5 },
            ],
          },
        ],
      },
    });
    const builder = new PromptBuilder(
      pageRepository,
      new FakePanelRepository(),
      new FakeEntityRepository(),
      new FakeCompositionGalleryRepository(),
    );

    const result = await builder.buildPagePrompt({
      userId: 'user-1',
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'standard',
    });

    expect(result.draftPrompt).toContain('Follow the uploaded layout reference image exactly for panel borders, gutter spacing, and reading order.');
    expect(result.draftPrompt).toContain('P1=[(0.00,0.00),(1.00,0.00),(1.00,0.50),(0.00,0.50)]');
    expect(result.compilerBrief).toContain('Image 2 (layout): Layout reference.');
  });

  it('mentions each entity reference once even across multiple panels', async () => {
    const panelRepository = new FakePanelRepository();
    panelRepository.panels = [
      buildPanel(),
      {
        ...buildPanel(),
        id: 'panel-2',
        order: 2,
        situationText: 'Aki braces for impact.',
      },
    ];
    const builder = new PromptBuilder(
      new FakePageRepository(),
      panelRepository,
      new FakeEntityRepository(),
      new FakeCompositionGalleryRepository(),
    );

    const result = await builder.buildPagePrompt({
      userId: 'user-1',
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'thinking',
    });

    expect(countOccurrences(result.compilerBrief, 'Image 1 (Aki): Aki character reference.')).toBe(1);
  });

  it('binds reference image labels and structured visual anchors to panel subjects and speakers', async () => {
    const panelRepository = new FakePanelRepository();
    panelRepository.panels = [
      {
        ...buildPanel(),
        entities: [
          {
            entityId: 'entity-2',
            role: 'primary',
            expression: 'calm',
            customExpression: null,
            action: 'standing_firm',
            customAction: null,
            position: 'center',
            facingDirection: 'front',
            effectNote: null,
            stateId: null,
          },
          {
            entityId: 'entity-1',
            role: 'secondary',
            expression: 'surprised',
            customExpression: null,
            action: 'standing_firm',
            customAction: null,
            position: 'right',
            facingDirection: 'left',
            effectNote: null,
            stateId: null,
          },
        ],
        dialogue: [
          {
            entityId: 'entity-2',
            text: 'What is this?',
            type: 'speech',
            position: 'bottom',
          },
          {
            entityId: 'entity-1',
            text: 'You do not know rhythm games?',
            type: 'speech',
            position: 'right',
          },
        ],
      },
    ];
    const entityRepository = new FakeEntityRepository();
    entityRepository.entities = [
      buildEntity(),
      buildEntity({
        id: 'entity-2',
        name: 'Kasane',
        promptSupplement: null,
        freeDescription: null,
        structuredFields: {
          gender_expression: 'female',
          hair: {
            color: 'black',
            length: 'short',
            style: 'straight',
            bangs: 'heavy',
          },
          hair_detail: {
            front_shape: 'blunt front',
            back_shape: 'clean bob back',
          },
          eyes: {
            color: 'silver',
            shape: 'sharp',
          },
          clothing: {
            category: 'school',
            main_color: 'navy',
          },
          outfit_detail: {
            collar_shape: 'sailor collar',
            skirt_or_pants_shape: 'short skirt',
          },
          build: 'slender',
          height: 'average',
        },
      }),
    ];
    const builder = new PromptBuilder(
      new FakePageRepository(),
      panelRepository,
      entityRepository,
      new FakeCompositionGalleryRepository(),
    );

    const result = await builder.buildPagePrompt({
      userId: 'user-1',
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'thinking',
    });

    expect(result.draftPrompt).toContain(
      'Image 1 (Kasane): Kasane character reference. Use this image only for Kasane',
    );
    expect(result.draftPrompt).toContain(
      'Kasane visual identity: female, black short straight hair, heavy bangs, blunt front, clean bob back, silver sharp eyes, navy school outfit, sailor collar, short skirt, slender build, average height.',
    );
    expect(result.draftPrompt).toContain(
      'Kasane, reference Image 1 (Kasane), visual identity female, black short straight hair',
    );
    expect(result.draftPrompt).toContain(
      'line 1 must stay assigned to Kasane, reference Image 1 (Kasane), visual identity female, black short straight hair',
    );
    expect(result.draftPrompt).toContain(
      'Do not assign this line to any other subject or reference image.',
    );
    expect(result.draftPrompt).toContain(
      'Visual lock for panel 1: subjects=Kasane [Image 1 (Kasane), female, black short straight hair',
    );
  });

  it('drops redundant long panel notes from the prompt brief', async () => {
    const panelRepository = new FakePanelRepository();
    panelRepository.panels = [
      {
        ...buildPanel(),
        panelNotes:
          'Focus this page on Rooftop / night / tense. Maintain the scene mood: tense. Page 3 should read naturally into the next page without adding a new event.',
      },
    ];
    const builder = new PromptBuilder(
      new FakePageRepository(),
      panelRepository,
      new FakeEntityRepository(),
      new FakeCompositionGalleryRepository(),
    );

    const result = await builder.buildPagePrompt({
      userId: 'user-1',
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'thinking',
    });

    expect(result.draftPrompt).not.toContain('Panel-specific note: Focus this page on Rooftop');
    expect(result.compilerBrief).not.toContain('Panel-specific note: Focus this page on Rooftop');
  });

  it('includes named style reference title and compiled brief in page prompts', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.promptContext = buildPagePromptContext({
      styleReference: {
        title: 'AKIRA',
        notes: '硬質な都市背景',
        compiledBrief:
          'Keep the title "AKIRA" explicit as a style constraint, with precise mechanical linework, dense urban perspective, hard-edged shadow shapes, and disciplined environment rendering.',
        anchors: {
          lineQuality: 'precise mechanical linework with confident contour control',
          shapeLanguage: 'hard-edged industrial forms with disciplined perspective',
          faceRendering: null,
          eyeRendering: null,
          hairRendering: null,
          clothingRendering: 'functional clothing folds with restrained stylization',
          backgroundRendering: 'dense urban structures with explicit depth and infrastructure detail',
          shadingRendering: 'hard-edged shadow blocks with restrained gradients',
          textureFinish: 'clean ink finish with selective grit in environments',
          motionTreatment: 'controlled action accents without abstract streak overload',
          dialogueBalloonTreatment: 'page remains readable even when dialogue density rises',
          atmosphere: 'tense, heavy urban pressure',
        },
        compilerProvider: 'openai',
        compilerModel: 'gpt-5.4-mini',
        compilerPromptVersion: 'style_ref_v3',
        compiledAt: '2026-05-28T00:00:00.000Z',
      },
    });
    const builder = new PromptBuilder(
      pageRepository,
      new FakePanelRepository(),
      new FakeEntityRepository(),
      new FakeCompositionGalleryRepository(),
    );

    const result = await builder.buildPagePrompt({
      userId: 'user-1',
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'thinking',
    });

    expect(result.draftPrompt).toContain('Named style reference constraint: "AKIRA".');
    expect(result.draftPrompt).toContain('Generalized style interpretation: Keep the title "AKIRA" explicit as a style constraint');
    expect(result.draftPrompt).toContain('Apply these style anchors to line treatment, shading, finish, background treatment, motion accents, and page atmosphere');
    expect(result.draftPrompt).toContain('line quality: precise mechanical linework with confident contour control');
    expect(result.compilerBrief).toContain('Named style reference constraint: "AKIRA".');
    expect(result.compilerBrief).toContain('[GLOBAL STYLE]');
  });

  it('compacts long page style reference text before building image prompts', async () => {
    const pageRepository = new FakePageRepository();
    const longCompiledBrief = 'precise page rendering with dense controlled background structure '.repeat(120);
    const longAnchor = 'hard edged line treatment with controlled black shape rhythm '.repeat(30);
    pageRepository.promptContext = buildPagePromptContext({
      styleReference: {
        title: 'Long Page Style',
        notes: 'keep the page readable and avoid noisy over-rendering '.repeat(80),
        compiledBrief: longCompiledBrief,
        anchors: {
          lineQuality: longAnchor,
          shapeLanguage: null,
          faceRendering: null,
          eyeRendering: null,
          hairRendering: null,
          clothingRendering: null,
          backgroundRendering: longAnchor,
          shadingRendering: longAnchor,
          textureFinish: null,
          motionTreatment: longAnchor,
          dialogueBalloonTreatment: null,
          atmosphere: longAnchor,
        },
        compilerProvider: 'openai',
        compilerModel: 'gpt-5.4-mini',
        compilerPromptVersion: 'style_ref_v3',
        compiledAt: '2026-05-28T00:00:00.000Z',
      },
    });
    const builder = new PromptBuilder(
      pageRepository,
      new FakePanelRepository(),
      new FakeEntityRepository(),
      new FakeCompositionGalleryRepository(),
    );

    const result = await builder.buildPagePrompt({
      userId: 'user-1',
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'thinking',
    });

    expect(result.draftPrompt).toContain('Generalized style interpretation: precise page rendering');
    expect(result.draftPrompt).toContain('...');
    expect(result.draftPrompt).not.toContain(longCompiledBrief.slice(0, 1200));
    expect(result.compilerBrief).not.toContain(longCompiledBrief.slice(0, 1200));
    expect(result.compilerBrief.length).toBeLessThan(7_000);
  });

  it('fails when panel orders are not contiguous', async () => {
    const panelRepository = new FakePanelRepository();
    panelRepository.panels = [
      buildPanel(),
      {
        ...buildPanel(),
        id: 'panel-3',
        order: 3,
      },
    ];
    const builder = new PromptBuilder(
      new FakePageRepository(),
      panelRepository,
      new FakeEntityRepository(),
      new FakeCompositionGalleryRepository(),
    );

    await expect(
      builder.buildPagePrompt({
        userId: 'user-1',
        pageId: 'page-1',
        requestKind: 'initial',
        generationMode: 'standard',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('fails when panel orders are duplicated', async () => {
    const panelRepository = new FakePanelRepository();
    panelRepository.panels = [
      buildPanel(),
      {
        ...buildPanel(),
        id: 'panel-1b',
        order: 1,
      },
    ];
    const builder = new PromptBuilder(
      new FakePageRepository(),
      panelRepository,
      new FakeEntityRepository(),
      new FakeCompositionGalleryRepository(),
    );

    await expect(
      builder.buildPagePrompt({
        userId: 'user-1',
        pageId: 'page-1',
        requestKind: 'initial',
        generationMode: 'standard',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

function buildPagePromptContext(overrides: Partial<PagePromptContext> = {}): PagePromptContext {
  return {
    pageId: 'page-1',
    workId: 'work-1',
    pageNumber: 3,
    episodePurpose: 'The hero confronts the rival.',
    sceneSummaries: ['Scene 1: Rooftop / night / tense'],
    storyPagePurpose: 'This page escalates the rooftop confrontation without breaking the uneasy calm.',
    storyContinuityNote: 'Carry the moonlit tension forward into the next page.',
    layoutConfig: {
      type: 'template',
      template_id: 'standard_4',
    },
    styleReference: null,
    dialogueMode: 'image_baked',
    pageDialogueToggle: true,
    ...overrides,
  };
}

function buildPanel(): Panel {
  return {
    id: 'panel-1',
    pageId: 'page-1',
    order: 1,
    panelRole: 'action',
    panelSize: 'standard',
    situationText: 'Hero lunges forward.',
    entities: [
      {
        entityId: 'entity-1',
        role: 'primary',
        expression: 'determined',
        customExpression: null,
        action: 'attacking',
        customAction: null,
        position: 'center',
        facingDirection: 'three_quarter_left',
        effectNote: 'speed lines around the blade',
        stateId: null,
      },
    ],
    composition: {
      source: 'gallery',
      galleryItemId: 'gallery-1',
      compositionPrompt: null,
      shotType: null,
      angle: null,
      customNote: 'Focus on forward motion.',
    },
    dialogueInPanel: true,
    dialogue: [
      {
        entityId: 'entity-1',
        text: 'I will finish this now.',
        type: 'speech',
        position: 'top',
      },
    ],
    sfxText: 'WHOOSH',
    backgroundNote: 'Collapsed alley at dusk.',
    panelNotes: null,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:00:00.000Z'),
  };
}

function buildEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'entity-1',
    workId: 'work-1',
    userId: 'user-1',
    entityType: 'character',
    name: 'Aki',
    freeDescription: 'Long dark hair and a navy military uniform.',
    structuredFields: {},
    promptSupplement: 'Long straight black hair, navy military uniform with gold trim.',
    speechProfile: {},
    status: 'ready',
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:00:00.000Z'),
    ...overrides,
  };
}

function buildCompositionGalleryItem(): CompositionGalleryItem {
  return {
    id: 'gallery-1',
    name: 'Battle Charge',
    category: 'action',
    entityCount: 1,
    previewS3Key: 'composition/gallery-1.png',
    previewCdnUrl: 'https://cdn.lyra.test/composition/gallery-1.png',
    compositionPrompt: 'A dynamic forward charge with strong speed lines.',
    shotType: 'full_body',
    angle: 'three_quarter',
    tags: ['combat'],
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
  };
}

function countOccurrences(text: string, pattern: string): number {
  return text.split(pattern).length - 1;
}
