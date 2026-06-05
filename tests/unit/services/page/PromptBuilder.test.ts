import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../../src/domain/errors/index.js';
import type { CompositionGalleryItem } from '../../../../src/domain/types/composition.js';
import type { Entity } from '../../../../src/domain/types/entity.js';
import type { Panel } from '../../../../src/domain/types/panel.js';
import type { PageGenerationContext, PagePromptContext, PageSummary } from '../../../../src/domain/types/page.js';
import type { CompositionGalleryRepository } from '../../../../src/repositories/CompositionGalleryRepository.js';
import type {
  EntityPrimaryReferenceImage,
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

  public async findPrimaryReferenceImagesByEntityIdsAndUserId(): Promise<EntityPrimaryReferenceImage[]> {
    return [
      {
        entityId: 'entity-1',
        refId: 'ref-1',
        s3Key: 'saved/user-1/entities/entity-1/ref-1.png',
        cdnUrl: 'https://img.lyra.app/ref-1.png',
      },
    ];
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
    expect(result.draftPrompt).toContain('Use the standard_4 template with 4 panels.');
    expect(result.draftPrompt).toContain('Image 1 (Aki): Aki character reference.');
    expect(result.draftPrompt).toContain('Aki is primary in the center zone, facing three quarter left');
    expect(result.draftPrompt).toContain('Sound effect text in the artwork: "WHOOSH".');
    expect(result.draftPrompt).toContain('Panel 1 dialogue by Aki: "I will finish this now." as speech at top.');
    expect(result.draftPrompt).toContain('Dialogue lock for panel 1: line 1 must stay assigned to Aki exactly as written: "I will finish this now."');
    expect(result.draftPrompt).toContain(
      'Visual lock for panel 1: subjects=Aki; shot=full_body; angle=three_quarter; background cue="Collapsed alley at dusk.".',
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
    expect(result.compilerBrief).toContain('- Dialogue lock: Dialogue lock for panel 1: line 1 must stay assigned to Aki exactly as written: "I will finish this now."');
    expect(result.compilerBrief).toContain(
      '- Visual lock: Visual lock for panel 1: subjects=Aki; shot=full_body; angle=three_quarter; background cue="Collapsed alley at dusk.".',
    );
    expect(result.compilerBrief).not.toContain('[CHARACTER CONSISTENCY]');
    expect(result.compilerBrief).not.toContain('Scene continuity:');
    expect(countOccurrences(result.compilerBrief, 'Image 1 (Aki): Aki character reference.')).toBe(1);
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
    expect(result.draftPrompt).toContain('panel 1 uses vertices (0.00, 0.00) -> (1.00, 0.00) -> (1.00, 0.50) -> (0.00, 0.50)');
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
