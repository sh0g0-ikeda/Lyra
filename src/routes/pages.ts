import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import {
  DEFAULT_LAYOUT_TEMPLATE_ID,
  LAYOUT_TEMPLATES,
  type LayoutTemplateId,
} from '../domain/constants/layoutTemplates.js';
import { ValidationError } from '../domain/errors/index.js';
import type {
  Page,
  PageLayoutConfig,
  Panel,
  PanelComposition,
  PanelDialogue,
  PanelEntity,
} from '../domain/types/page.js';
import {
  createPageBodySchema,
  createPanelBodySchema,
  pageLayoutConfigBodySchema,
  pageUuidParamSchema,
  updatePageBodySchema,
  updatePanelBodySchema,
} from '../lib/validators/page.schema.js';
import type { PageServicePort } from '../services/page/PageService.js';
import type { AppEnv } from '../types/app.js';

type PageLayoutConfigBody = z.infer<typeof pageLayoutConfigBodySchema>;

export interface PageRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  pageService: PageServicePort;
}

export function createPageRoutes(dependencies: PageRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);

  app.post('/episodes/:id/pages', async (c) => {
    const user = c.get('user');
    const episodeId = parseUuidParam(c, 'id');
    const body = createPageBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    const page = await dependencies.pageService.createPage(user.id, episodeId, {
      sceneId: body.data.scene_id ?? null,
      pageNumber: body.data.page_number,
      layoutConfig: toPageLayoutConfig(body.data.layout_config),
      dialogueMode: body.data.dialogue_mode,
      pageDialogueToggle: body.data.page_dialogue_toggle,
    });

    return c.json(toPageResponse(page), 201);
  });

  app.get('/episodes/:id/pages', async (c) => {
    const user = c.get('user');
    const episodeId = parseUuidParam(c, 'id');
    const pages = await dependencies.pageService.listPages(user.id, episodeId);

    return c.json({ pages: pages.map(toPageResponse) });
  });

  app.get('/pages/:id', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const page = await dependencies.pageService.getPage(user.id, pageId);

    return c.json(toPageResponse(page));
  });

  app.put('/pages/:id', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const body = updatePageBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    const page = await dependencies.pageService.updatePage(user.id, pageId, {
      sceneId: body.data.scene_id,
      pageNumber: body.data.page_number,
      layoutConfig:
        body.data.layout_config === undefined ? undefined : toPageLayoutConfig(body.data.layout_config),
      dialogueMode: body.data.dialogue_mode,
      pageDialogueToggle: body.data.page_dialogue_toggle,
      status: body.data.status,
    });

    return c.json(toPageResponse(page));
  });

  app.delete('/pages/:id', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    await dependencies.pageService.deletePage(user.id, pageId);

    return c.body(null, 204);
  });

  app.post('/pages/:id/panels', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const body = createPanelBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    const panel = await dependencies.pageService.createPanel(user.id, pageId, {
      order: body.data.order,
      panelRole: body.data.panel_role,
      panelSize: body.data.panel_size,
      situationText: body.data.situation_text ?? null,
      entities: (body.data.entities ?? []).map(toPanelEntity),
      composition: toPanelComposition(body.data.composition),
      dialogueInPanel: body.data.dialogue_in_panel,
      dialogue: (body.data.dialogue ?? []).map(toPanelDialogue),
      sfxText: body.data.sfx_text ?? null,
      backgroundNote: body.data.background_note ?? null,
      panelNotes: body.data.panel_notes ?? null,
    });

    return c.json(toPanelResponse(panel), 201);
  });

  app.get('/pages/:id/panels', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const panels = await dependencies.pageService.listPanels(user.id, pageId);

    return c.json({ panels: panels.map(toPanelResponse) });
  });

  app.put('/panels/:id', async (c) => {
    const user = c.get('user');
    const panelId = parseUuidParam(c, 'id');
    const body = updatePanelBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    const panel = await dependencies.pageService.updatePanel(user.id, panelId, {
      order: body.data.order,
      panelRole: body.data.panel_role,
      panelSize: body.data.panel_size,
      situationText: body.data.situation_text,
      entities: body.data.entities?.map(toPanelEntity),
      composition:
        body.data.composition === undefined ? undefined : toPanelComposition(body.data.composition),
      dialogueInPanel: body.data.dialogue_in_panel,
      dialogue: body.data.dialogue?.map(toPanelDialogue),
      sfxText: body.data.sfx_text,
      backgroundNote: body.data.background_note,
      panelNotes: body.data.panel_notes,
    });

    return c.json(toPanelResponse(panel));
  });

  app.delete('/panels/:id', async (c) => {
    const user = c.get('user');
    const panelId = parseUuidParam(c, 'id');
    await dependencies.pageService.deletePanel(user.id, panelId);

    return c.body(null, 204);
  });

  return app;
}

async function readJsonBody(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
}

function parseUuidParam(c: Context<AppEnv>, name: string): string {
  const result = pageUuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }

  return result.data;
}

function toPageLayoutConfig(input?: PageLayoutConfigBody): PageLayoutConfig {
  const layoutType = input?.type ?? 'template';
  const templateId = toTemplateId(layoutType, input?.template_id ?? undefined);
  const defaultPanelCount =
    templateId === null ? 4 : LAYOUT_TEMPLATES[templateId].panelCount;

  return {
    type: layoutType,
    templateId,
    panelCount: input?.panel_count ?? defaultPanelCount,
    layoutReferenceS3Key: input?.layout_reference_s3_key ?? null,
    frameDefinitions: input?.frame_definitions ?? [],
  };
}

function toTemplateId(
  layoutType: PageLayoutConfig['type'],
  templateId?: LayoutTemplateId | null,
): LayoutTemplateId | null {
  if (layoutType !== 'template') {
    return templateId ?? null;
  }

  return templateId ?? DEFAULT_LAYOUT_TEMPLATE_ID;
}

function toPanelEntity(input: {
  entity_id: string;
  role: PanelEntity['role'];
  expression: PanelEntity['expression'];
  custom_expression?: string | null;
  action: PanelEntity['action'];
  custom_action?: string | null;
  position: PanelEntity['position'];
  state_id?: string | null;
}): PanelEntity {
  return {
    entityId: input.entity_id,
    role: input.role,
    expression: input.expression,
    customExpression: input.custom_expression ?? null,
    action: input.action,
    customAction: input.custom_action ?? null,
    position: input.position,
    stateId: input.state_id ?? null,
  };
}

function toPanelComposition(
  input?: {
    source: PanelComposition['source'];
    gallery_item_id?: string | null;
    composition_prompt?: string | null;
    shot_type?: string | null;
    angle?: string | null;
    custom_note?: string | null;
  },
): PanelComposition {
  return {
    source: input?.source ?? 'ai_auto',
    galleryItemId: input?.gallery_item_id ?? null,
    compositionPrompt: input?.composition_prompt ?? null,
    shotType: input?.shot_type ?? null,
    angle: input?.angle ?? null,
    customNote: input?.custom_note ?? null,
  };
}

function toPanelDialogue(input: {
  entity_id: string;
  text: string;
  type: PanelDialogue['type'];
  position: PanelDialogue['position'];
}): PanelDialogue {
  return {
    entityId: input.entity_id,
    text: input.text,
    type: input.type,
    position: input.position,
  };
}

function toPageResponse(page: Page): Record<string, unknown> {
  return {
    id: page.id,
    episode_id: page.episodeId,
    scene_id: page.sceneId,
    page_number: page.pageNumber,
    layout_config: toPageLayoutConfigResponse(page.layoutConfig),
    dialogue_mode: page.dialogueMode,
    page_dialogue_toggle: page.pageDialogueToggle,
    generated_image: page.generatedImage === null
      ? null
      : {
          s3_key: page.generatedImage.s3Key,
          cdn_url: page.generatedImage.cdnUrl,
          generation_mode: page.generatedImage.generationMode,
          generated_at: page.generatedImage.generatedAt,
        },
    generation_mode: page.generationMode,
    panels: page.panelIds,
    status: page.status,
    created_at: page.createdAt.toISOString(),
    updated_at: page.updatedAt.toISOString(),
  };
}

function toPanelResponse(panel: Panel): Record<string, unknown> {
  return {
    id: panel.id,
    page_id: panel.pageId,
    order: panel.order,
    panel_role: panel.panelRole,
    panel_size: panel.panelSize,
    situation_text: panel.situationText,
    entities: panel.entities.map((entity) => ({
      entity_id: entity.entityId,
      role: entity.role,
      expression: entity.expression,
      custom_expression: entity.customExpression,
      action: entity.action,
      custom_action: entity.customAction,
      position: entity.position,
      state_id: entity.stateId,
    })),
    composition: {
      source: panel.composition.source,
      gallery_item_id: panel.composition.galleryItemId,
      composition_prompt: panel.composition.compositionPrompt,
      shot_type: panel.composition.shotType,
      angle: panel.composition.angle,
      custom_note: panel.composition.customNote,
    },
    dialogue_in_panel: panel.dialogueInPanel,
    dialogue: panel.dialogue.map((dialogue) => ({
      entity_id: dialogue.entityId,
      text: dialogue.text,
      type: dialogue.type,
      position: dialogue.position,
    })),
    sfx_text: panel.sfxText,
    background_note: panel.backgroundNote,
    panel_notes: panel.panelNotes,
    created_at: panel.createdAt.toISOString(),
    updated_at: panel.updatedAt.toISOString(),
  };
}

function toPageLayoutConfigResponse(layoutConfig: PageLayoutConfig): Record<string, unknown> {
  return {
    type: layoutConfig.type,
    template_id: layoutConfig.templateId,
    panel_count: layoutConfig.panelCount,
    layout_reference_s3_key: layoutConfig.layoutReferenceS3Key,
    frame_definitions: layoutConfig.frameDefinitions,
  };
}
