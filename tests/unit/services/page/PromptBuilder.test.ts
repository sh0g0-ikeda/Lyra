import { describe, expect, it } from 'vitest';
import type { CompositionGalleryItem } from '../../../../src/domain/types/composition.js';
import type { Entity } from '../../../../src/domain/types/entity.js';
import type { Panel } from '../../../../src/domain/types/panel.js';
import type { PageGenerationContext, PagePromptContext } from '../../../../src/domain/types/page.js';
import type { CompositionGalleryRepository } from '../../../../src/repositories/CompositionGalleryRepository.js';
import type { EntityRepository } from '../../../../src/repositories/EntityRepository.js';
import type { PageRepository } from '../../../../src/repositories/PageRepository.js';
import type { CreatePanelInput, UpdatePanelInput } from '../../../../src/domain/types/panel.js';
import type { CreateEntityInput, UpdateEntityInput } from '../../../../src/domain/types/entity.js';
import type { PagePanelContext, PanelContext, PanelRepository } from '../../../../src/repositories/PanelRepository.js';
import type { PageGenerationStateUpdate } from '../../../../src/repositories/PageRepository.js';
import { PromptBuilder } from '../../../../src/services/page/PromptBuilder.js';

class FakePageRepository implements PageRepository {
  public promptContext: PagePromptContext | null = buildPagePromptContext();

  public async findGenerationContextByIdAndUserId(): Promise<PageGenerationContext | null> {
    throw new Error('not used');
  }

  public async findPromptContextByIdAndUserId(): Promise<PagePromptContext | null> {
    return this.promptContext;
  }

  public async updateGenerationState(
    _pageId: string,
    _userId: string,
    _input: PageGenerationStateUpdate,
  ): Promise<boolean> {
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
}

class FakeEntityRepository implements EntityRepository {
  public entities: Entity[] = [buildEntity()];

  public async create(_input: CreateEntityInput): Promise<Entity> {
    throw new Error('not used');
  }

  public async findByIdAndUserId(_id: string, _userId: string): Promise<Entity | null> {
    throw new Error('not used');
  }

  public async findByWorkIdAndUserId(): Promise<Entity[]> {
    return this.entities;
  }

  public async countByIdsAndWorkIdAndUserId(): Promise<number> {
    return 1;
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
  it('template layout と panel/entity/dialogue を prompt に組み立てる', async () => {
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

    expect(result.prompt).toContain('This is page 3 of the episode: The hero confronts the rival.');
    expect(result.prompt).toContain('Use a standard_4 layout with 4 panels.');
    expect(result.prompt).toContain('Panel 1 (action, standard): Hero lunges forward.');
    expect(result.prompt).toContain('Image 1 is the appearance reference for Aki.');
    expect(countOccurrences(result.prompt, 'Image 1 is the appearance reference for Aki.')).toBe(1);
    expect(result.prompt).toContain('navy military uniform');
    expect(result.prompt).toContain("Panel 1 dialogue by Aki: 'I will finish this now.' as speech at top.");
    expect(result.prompt).toContain('anime manga illustration');
  });

  it('balloon_only では dialogue を prompt に入れない', async () => {
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

    expect(result.prompt).not.toContain('Panel 1 dialogue');
  });

  it('custom layout では frame_definitions を prompt に含める', async () => {
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

    expect(result.prompt).toContain('Follow the custom panel layout defined for this page exactly.');
    expect(result.prompt).toContain('Frame 1: vertices (0.00, 0.00) -> (1.00, 0.00) -> (1.00, 0.50) -> (0.00, 0.50).');
  });

  it('同一エンティティが複数panelに出ても reference 番号は1回だけ出す', async () => {
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

    expect(countOccurrences(result.prompt, 'Image 1 is the appearance reference for Aki.')).toBe(1);
  });
});

function buildPagePromptContext(overrides: Partial<PagePromptContext> = {}): PagePromptContext {
  return {
    pageId: 'page-1',
    workId: 'work-1',
    pageNumber: 3,
    episodePurpose: 'The hero confronts the rival.',
    layoutConfig: {
      type: 'template',
      template_id: 'standard_4',
    },
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

function buildEntity(): Entity {
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
