import { PANEL_FRAME_TEMPLATE_IDS, getPanelFrameTemplate } from '../../../../src/domain/constants/panelFrameTemplates.js';
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

  public async reorderPanels(): Promise<Panel[]> {
    throw new Error('not used');
  }
}

class FakeEntityRepository implements EntityRepository {
  public entities: Entity[] = [buildEntity()];
  public missingReferenceEntityIds = new Set<string>();
  public lastFindByWorkArgs: { workId: string; userId: string; organizationId: string | null } | null = null;
  public lastReferenceArgs:
    | { entityIds: string[]; workId: string; userId: string; organizationId: string | null }
    | null = null;

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
      .filter((entityId) => !this.missingReferenceEntityIds.has(entityId))
      .map((entityId, index) => ({
        entityId,
        refId: `ref-${index + 1}`,
        s3Key: `saved/user-1/entities/${entityId}/ref-${index + 1}.png`,
        cdnUrl: `https://img.lyra.app/ref-${index + 1}.png`,
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
  it('includes layout, references, setting, and dialogue without redundant sections', async () => {
    const panels = new FakePanelRepository();
    panels.panels = Array.from({ length: 4 }, (_, i) => ({ ...buildPanel(), id: `panel-${i+1}`, order: i+1, entities: i === 0 ? buildPanel().entities : [] }));
    const builder = new PromptBuilder(
      new FakePageRepository(),
      panels,
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
    expect(result.draftPrompt).toContain(
      'panel 1 is the upper-right or rightmost top entry',
    );
    expect(result.draftPrompt).toContain(
      'follow numbered panels generally right-to-left and downward toward the lower-left',
    );
    expect(result.draftPrompt).toContain(
      'never override an authored position to force placement',
    );
    expect(result.draftPrompt).toContain(
      'Authoritative frame map (follow P numbers and coordinates exactly for asymmetric or custom layouts): P1=[(0.50,0.00),(1.00,0.00),(1.00,0.50),(0.50,0.50)]',
    );
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
    expect(result.draftPrompt).toContain('at its authored top position');
    expect(result.draftPrompt).toContain(
      'Baked Japanese dialogue and narration must use vertical tategaki',
    );
    expect(result.draftPrompt).toContain(
      'glyphs top-to-bottom, columns right-to-left',
    );
    expect(result.draftPrompt).toContain(
      'Do not change authored action, composition, or camera direction merely to fit text.',
    );
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
      'Baked Japanese dialogue and narration must use vertical tategaki',
    );
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
      panelCount: 4,
      panels: expect.arrayContaining([
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
      ]),
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
    expect(result.draftPrompt).not.toContain('vertical tategaki');
    expect(result.compilerBrief).not.toContain('vertical tategaki');
  });

  it('image_baked はoff-panel話者の実体と非表示を明示し見える人への尾を禁止する', async () => {
    const panelRepository = new FakePanelRepository();
    panelRepository.panels = [{
      ...buildPanel(),
      dialogue: [
        {
          entityId: 'entity-2',
          text: '廉下から呼びかける。',
          type: 'speech',
          position: 'top',
        },
        {
          entityId: 'entity-2',
          text: 'まだ姿は見せられない。',
          type: 'thought',
          position: 'bottom',
        },
        {
          entityId: 'entity-2',
          text: '夜が深まった。',
          type: 'narration',
          position: 'center',
        },
        {
          entityId: null,
          text: '誰かいるのか。',
          type: 'speech',
          position: 'left',
        },
      ],
    }];
    const entityRepository = new FakeEntityRepository();
    entityRepository.entities = [
      buildEntity(),
      buildEntity({ id: 'entity-2', name: 'Emile', promptSupplement: null }),
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
      generationMode: 'standard',
    });

    expect(result.draftPrompt).toContain('dialogue by Emile (off-panel real speaker)');
    expect(result.draftPrompt).toContain('Emile is off-panel and must not be drawn in panel 1');
    expect(result.draftPrompt).toContain('Do not point a balloon tail at Aki, reference Image 1 (Aki) or any other visible person');
    expect(result.draftPrompt).toContain('thought balloons must not use a speech tail');
    expect(result.draftPrompt).toContain('is narration text and must remain narration, not character speech');
    expect(result.draftPrompt).not.toContain('narration by Emile');
    expect(result.draftPrompt).toContain('dialogue with an unresolved real speaker');
    expect(result.draftPrompt).toContain('Do not invent or reassign the speaker');
    expect(result.draftPrompt).not.toContain('unresolved real speaker (off-panel real speaker)');
    expect(result.inputSnapshot.panels[0]?.dialogue).toEqual([
      expect.objectContaining({ entityId: 'entity-2', speakerName: 'Emile', type: 'speech' }),
      expect.objectContaining({ entityId: 'entity-2', speakerName: 'Emile', type: 'thought' }),
      expect.objectContaining({ entityId: null, speakerName: null, type: 'narration' }),
      expect.objectContaining({ entityId: null, speakerName: null, type: 'speech' }),
    ]);
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
    expect(result.draftPrompt).toContain(
      'Authoritative frame map (follow P numbers and coordinates exactly for asymmetric or custom layouts): P1=[(0.00,0.00),(1.00,0.00),(1.00,0.50),(0.00,0.50)]',
    );
    expect(result.compilerBrief).toContain('Image 2 (layout): Layout reference.');
  });

  it('keeps an asymmetric template frame sequence authoritative', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.promptContext = buildPagePromptContext({
      layoutConfig: {
        type: 'template',
        template_id: 'split_6',
      },
    });
    const panelRepository = new FakePanelRepository();
    panelRepository.panels = Array.from({ length: 6 }, (_, index) => ({
      ...buildPanel(),
      id: `panel-${index + 1}`,
      order: index + 1,
    }));
    const builder = new PromptBuilder(
      pageRepository,
      panelRepository,
      new FakeEntityRepository(),
      new FakeCompositionGalleryRepository(),
    );

    const result = await builder.buildPagePrompt({
      userId: 'user-1',
      pageId: 'page-1',
      requestKind: 'initial',
      generationMode: 'standard',
    });

    expect(result.draftPrompt).toContain(
      'Authoritative frame map (follow P numbers and coordinates exactly for asymmetric or custom layouts)',
    );
    expect(result.draftPrompt).toContain(
      'P1=[(0.48,0.00),(1.00,0.00),(1.00,0.33),(0.48,0.33)]; P2=[(0.48,0.33),(1.00,0.33),(1.00,0.67),(0.48,0.67)]',
    );
    expect(result.draftPrompt).toContain(
      'P4=[(0.00,0.00),(0.48,0.00),(0.48,0.33),(0.00,0.33)]',
    );
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

  // Spec 6/8: actual image labels replace repeated structured appearance in both
  // prompt paths. Keep no-image fallback, authored beats/dialogue, age and explicit
  // notes, image order, layout locks and the worker's Visual lock parse contract.
  // This is a service-only change; auth, persistence, credits and client contracts stay intact.
  it('参照画像がある場合に外見の反復を省き名前と画像番号で被写体と話者を指定する', async () => {
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
    for (const prompt of [result.draftPrompt, result.compilerBrief]) {
      expect(prompt).not.toContain('visual identity');
      expect(prompt).not.toContain('black short straight hair');
      expect(prompt).not.toContain('sailor collar');
      expect(prompt).toContain('Kasane, reference Image 1 (Kasane), role primary, center zone, facing front');
      expect(prompt).toContain('Kasane, reference Image 1 (Kasane), is primary in the center zone, facing front, showing calm, with standing firm body language');
      expect(prompt).toContain('line 1 must stay assigned to Kasane, reference Image 1 (Kasane) exactly as written: "What is this?" at its authored bottom position');
      expect(prompt).toContain('line 2 must stay assigned to Aki, reference Image 2 (Aki) exactly as written: "You do not know rhythm games?" at its authored right position');
      expect(prompt).toContain('Do not assign this line to any other subject or reference image.');
      expect(prompt).toContain('Visual lock for panel 1: subjects=Kasane [Image 1 (Kasane)]|Aki [Image 2 (Aki)];');
    }
  });

  it.each([
    ['standard', 'initial', 'image_baked'],
    ['thinking', 'regenerate', 'image_baked'],
    ['standard', 'regenerate', 'balloon_only'],
    ['thinking', 'initial', 'balloon_only'],
  ] as const)('%s/%s/%sの場合に参照の年齢と追加条件を一度だけ残し各コマは画像番号で指定する', async (generationMode, requestKind, dialogueMode) => {
    const pages = new FakePageRepository();
    pages.promptContext = buildPagePromptContext({ dialogueMode });
    const panels = new FakePanelRepository();
    panels.panels = Array.from({ length: 4 }, (_, index) => ({ ...buildPanel(), id: `panel-${index + 1}`, order: index + 1 }));
    const entities = new FakeEntityRepository();
    entities.entities = [buildEntity({
      name: '葵',
      structuredFields: { hair: { color: 'silver', length: 'long' }, age_range: 'child' },
      promptSupplement: null,
      freeDescription: '魔法を使うときだけ右手が光る。',
    })];
    const result = await new PromptBuilder(pages, panels, entities, new FakeCompositionGalleryRepository())
      .buildPagePrompt({ userId: 'user-1', pageId: 'page-1', generationMode, requestKind });

    for (const prompt of [result.draftPrompt, result.compilerBrief]) {
      expect(prompt).not.toContain('silver long hair');
      expect(countOccurrences(prompt, 'child')).toBe(1);
      expect(countOccurrences(prompt, '魔法を使うときだけ右手が光る。')).toBe(1);
      expect(countOccurrences(prompt, 'Image 1 (葵): 葵 character reference.')).toBe(1);
      expect(prompt).toContain('Image 2 (layout): Layout reference.');
      for (let order = 1; order <= 4; order += 1) {
        expect(prompt).toContain(`Panel ${order} subject lock: required visible subjects are 葵, reference Image 1 (葵), role primary`);
        expect(prompt).toContain(`Visual lock for panel ${order}: subjects=葵 [Image 1 (葵)];`);
        expect(prompt).toContain(`bind this scene and dialogue to guide P${order}`);
      }
      expect(prompt).toContain('showing determined, with attacking body language, accented by speed lines around the blade');
      if (dialogueMode === 'image_baked') {
        expect(prompt).toContain('葵, reference Image 1 (葵) exactly as written: "I will finish this now."');
      } else {
        expect(prompt).not.toContain('I will finish this now.');
      }
    }
  });

  it('参照画像がないキャラが混在する場合に外見を残し後続の画像番号を詰める', async () => {
    const panels = new FakePanelRepository();
    const panel = buildPanel();
    panels.panels = [{
      ...panel,
      entities: [...panel.entities, { ...panel.entities[0]!, entityId: 'entity-2', role: 'secondary', position: 'left' }],
      dialogue: [...panel.dialogue, { entityId: 'entity-2', text: '待って！', type: 'speech', position: 'left' }],
    }];
    const entities = new FakeEntityRepository();
    entities.missingReferenceEntityIds.add('entity-1');
    entities.entities = [
      buildEntity({ structuredFields: { hair: { color: 'red', length: 'short' } } }),
      buildEntity({ id: 'entity-2', name: '凛', structuredFields: { hair: { color: 'blue', length: 'long' } }, promptSupplement: null, freeDescription: null }),
    ];
    const result = await new PromptBuilder(new FakePageRepository(), panels, entities, new FakeCompositionGalleryRepository())
      .buildPagePrompt({ userId: 'user-1', pageId: 'page-1', generationMode: 'standard', requestKind: 'initial' });

    for (const prompt of [result.draftPrompt, result.compilerBrief]) {
      expect(prompt).toContain('Aki, visual identity red short hair, role primary');
      expect(prompt).toContain('Aki, visual identity red short hair, is primary');
      expect(prompt).toContain('Aki, visual identity red short hair exactly as written');
      expect(prompt).toContain('subjects=Aki [red short hair]|凛 [Image 1 (凛)];');
      expect(prompt).toContain('凛, reference Image 1 (凛) exactly as written: "待って！"');
      expect(prompt).not.toContain('blue long hair');
      expect(prompt).not.toContain('Image 1 (Aki)');
      expect(prompt).not.toContain('Image 2 (凛)');
    }
  });

  it('参照画像の追加条件が長い場合に補足の優先順位と長さ制限を維持する', async () => {
    const entities = new FakeEntityRepository();
    entities.entities = [buildEntity({
      structuredFields: { age_range: 'late_teens', hair: { color: 'silver' } },
      promptSupplement: `Only use magic while holding the staff. ${'Keep this condition. '.repeat(20)}`,
      freeDescription: 'Fallback-only description.',
    })];
    const result = await new PromptBuilder(new FakePageRepository(), new FakePanelRepository(), entities, new FakeCompositionGalleryRepository())
      .buildPagePrompt({ userId: 'user-1', pageId: 'page-1', generationMode: 'standard', requestKind: 'initial' });
    for (const prompt of [result.draftPrompt, result.compilerBrief]) {
      expect(countOccurrences(prompt, 'Age range for Aki: late teens.')).toBe(1);
      expect(countOccurrences(prompt, 'Only use magic while holding the staff.')).toBe(1);
      const note = prompt.match(/Keep these anchor traits stable: (.*?\.\.\.)/u)?.[1];
      expect(note).toBeDefined();
      expect(note!.length).toBeLessThanOrEqual(160);
      expect(prompt).not.toContain('Fallback-only description.');
      expect(prompt).not.toContain('silver hair');
    }
  });

  it('同名キャラと画面外話者がいる場合に画像番号と非表示指定で区別する', async () => {
    const panel = buildPanel();
    const panels = new FakePanelRepository();
    panels.panels = [
      { ...panel, dialogue: [{ entityId: 'entity-2', type: 'thought', text: 'ここで待とう。', position: 'right' }] },
      { ...panel, id: 'panel-2', order: 2, entities: [{ ...panel.entities[0]!, entityId: 'entity-2' }] },
    ];
    const entities = new FakeEntityRepository();
    entities.entities = [
      buildEntity({ name: '葵', structuredFields: { hair: { color: 'red' } } }),
      buildEntity({ id: 'entity-2', name: '葵', structuredFields: { hair: { color: 'blue' } }, promptSupplement: null, freeDescription: null }),
    ];
    const result = await new PromptBuilder(new FakePageRepository(), panels, entities, new FakeCompositionGalleryRepository())
      .buildPagePrompt({ userId: 'user-1', pageId: 'page-1', generationMode: 'thinking', requestKind: 'initial' });
    for (const prompt of [result.draftPrompt, result.compilerBrief]) {
      expect(prompt).toContain('Panel 1 subject lock: required visible subjects are 葵, reference Image 1 (葵)');
      expect(prompt).toContain('Panel 2 subject lock: required visible subjects are 葵, reference Image 2 (葵)');
      expect(prompt).toContain('line 1 real speaker is 葵, reference Image 2 (葵) and is off-panel, exactly as written: "ここで待とう。" at its authored right position');
      expect(prompt).toContain('葵, reference Image 2 (葵) is off-panel and must not be drawn in panel 1');
      expect(prompt).toContain('Do not assign this line to 葵, reference Image 1 (葵) or any other visible listener');
      expect(prompt).toContain('Do not point a balloon tail at 葵, reference Image 1 (葵) or any other visible person');
      expect(prompt).not.toContain('Do not assign this line to 葵 or');
      expect(prompt).not.toContain('Do not point a balloon tail at 葵 or');
      expect(prompt).toContain('thought balloons must not use a speech tail');
      expect(prompt).not.toContain('visual identity');
    }
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
    expect(result.draftPrompt).toContain(longAnchor.slice(0, 150));
    expect(result.compilerBrief).not.toContain(longCompiledBrief.slice(0, 1200));
    expect(result.compilerBrief).not.toContain(longAnchor.slice(0, 150));
    expect(result.compilerBrief).toContain('Named style reference constraint: "Long Page Style"');
    expect(result.compilerBrief).toContain('Generalized style interpretation: precise page rendering');
    expect(result.compilerBrief).toContain('line quality: hard edged line treatment');
    expect(result.compilerBrief).toContain('shading: hard edged line treatment');
    expect(result.compilerBrief).toContain('background rendering: hard edged line treatment');
    expect(result.compilerBrief).toContain('motion treatment: hard edged line treatment');
    expect(result.compilerBrief).toContain('atmosphere: hard edged line treatment');
    expect(result.compilerBrief).toContain('User notes: keep the page readable');
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

  it.each(PANEL_FRAME_TEMPLATE_IDS)('%s の場合に各コマの描写と配置ガイドの番号が一致する', async (templateId) => {
    const template = getPanelFrameTemplate(templateId);
    const pages = new FakePageRepository();
    pages.promptContext = buildPagePromptContext({ layoutConfig: { type: 'template', template_id: templateId } });
    const panels = new FakePanelRepository();
    panels.panels = template.frames.map((frame) => ({ ...buildPanel(), id: `panel-${frame.readingOrder}`, order: frame.readingOrder, entities: frame.readingOrder === 1 ? buildPanel().entities : [] }));
    const result = await new PromptBuilder(pages, panels, new FakeEntityRepository(), new FakeCompositionGalleryRepository()).buildPagePrompt({ userId: 'user-1', pageId: 'page-1', requestKind: 'initial', generationMode: 'standard' });
    expect(result.layoutControl?.frames).toHaveLength(template.panelCount);
    for (const frame of result.layoutControl!.frames) {
      expect(result.draftPrompt).toContain(`Panel ${frame.readingOrder} physical placement: ${frame.physicalPlacement}`);
      expect(result.compilerBrief).toContain(`- Physical placement: ${frame.physicalPlacement}`);
    }
    expect(result.compilerBrief).toContain('Image 2 (layout): Layout reference.');
  });

  it('コマ数がテンプレートと異なる既存ページの場合に誤った枠数や添付画像を指示しない', async () => {
    const result = await new PromptBuilder(new FakePageRepository(), new FakePanelRepository(), new FakeEntityRepository(), new FakeCompositionGalleryRepository()).buildPagePrompt({ userId: 'user-1', pageId: 'page-1', requestKind: 'initial', generationMode: 'standard' });
    expect(result.layoutControl).toBeNull();
    expect(result.draftPrompt).not.toContain('template with 4 panels');
    expect(result.draftPrompt).not.toContain('(layout)');
    expect(result.draftPrompt).toContain('exactly 1 panels');
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
