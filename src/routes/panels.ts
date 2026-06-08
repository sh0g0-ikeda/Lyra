import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
import type { Panel, PanelDialogueLine } from '../domain/types/panel.js';
import { createPanelBodySchema, panelUuidParamSchema, updatePanelBodySchema } from '../lib/validators/panel.schema.js';
import type { PanelServicePort } from '../services/page/PanelService.js';
import type { AppEnv } from '../types/app.js';
import { readJsonBody } from './requestBody.js';

export interface PanelRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  panelService: PanelServicePort;
}

export function createPanelRoutes(dependencies: PanelRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.post('/pages/:id/panels', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const body = createPanelBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    const panel = await dependencies.panelService.createPanel(user.id, pageId, {
      order: body.data.order,
      panelRole: body.data.panel_role,
      panelSize: body.data.panel_size,
      situationText: body.data.situation_text ?? null,
      composition: toCompositionRequest(body.data.composition),
      dialogueInPanel: body.data.dialogue_in_panel,
      dialogue: body.data.dialogue.map(toDialogueLineRequest),
      sfxText: body.data.sfx_text ?? null,
      backgroundNote: body.data.background_note ?? null,
      panelNotes: body.data.panel_notes ?? null,
    });

    return c.json(toPanelResponse(panel), 201);
  });

  app.get('/pages/:id/panels', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const panels = await dependencies.panelService.listPanels(user.id, pageId);

    return c.json({ panels: panels.map(toPanelResponse) });
  });

  app.put('/panels/:id', async (c) => {
    const user = c.get('user');
    const panelId = parseUuidParam(c, 'id');
    const body = updatePanelBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    const panel = await dependencies.panelService.updatePanel(user.id, panelId, {
      order: body.data.order,
      panelRole: body.data.panel_role,
      panelSize: body.data.panel_size,
      situationText: body.data.situation_text,
      composition:
        body.data.composition === undefined ? undefined : toCompositionRequest(body.data.composition),
      dialogueInPanel: body.data.dialogue_in_panel,
      dialogue:
        body.data.dialogue === undefined ? undefined : body.data.dialogue.map(toDialogueLineRequest),
      sfxText: body.data.sfx_text,
      backgroundNote: body.data.background_note,
      panelNotes: body.data.panel_notes,
    });

    return c.json(toPanelResponse(panel));
  });

  app.delete('/panels/:id', async (c) => {
    const user = c.get('user');
    const panelId = parseUuidParam(c, 'id');
    await dependencies.panelService.deletePanel(user.id, panelId);

    return c.body(null, 204);
  });

  return app;
}

function parseUuidParam(c: Context<AppEnv>, name: string): string {
  const result = panelUuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }

  return result.data;
}

function toCompositionRequest(
  composition: NonNullable<ReturnType<typeof createPanelBodySchema.parse>['composition']>,
): Panel['composition'] {
  return {
    source: composition.source,
    galleryItemId: composition.gallery_item_id,
    compositionPrompt: composition.composition_prompt,
    shotType: composition.shot_type,
    angle: composition.angle,
    customNote: composition.custom_note,
  };
}

function toDialogueLineRequest(
  line: NonNullable<ReturnType<typeof createPanelBodySchema.parse>['dialogue']>[number],
): PanelDialogueLine {
  return {
    entityId: line.entity_id,
    text: line.text,
    type: line.type,
    position: line.position,
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
    entities: panel.entities.map((assignment) => ({
      entity_id: assignment.entityId,
      role: assignment.role,
      expression: assignment.expression,
      custom_expression: assignment.customExpression,
      action: assignment.action,
      custom_action: assignment.customAction,
      position: assignment.position,
      facing_direction: assignment.facingDirection,
      effect_note: assignment.effectNote,
      state_id: assignment.stateId,
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
    dialogue: panel.dialogue.map((line) => ({
      entity_id: line.entityId,
      text: line.text,
      type: line.type,
      position: line.position,
    })),
    sfx_text: panel.sfxText,
    background_note: panel.backgroundNote,
    panel_notes: panel.panelNotes,
    created_at: panel.createdAt.toISOString(),
    updated_at: panel.updatedAt.toISOString(),
  };
}
