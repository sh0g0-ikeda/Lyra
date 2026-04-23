import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
import type { PanelFrame } from '../domain/types/panelFrame.js';
import {
  panelFrameUuidParamSchema,
  replacePanelFramesBodySchema,
} from '../lib/validators/panelFrame.schema.js';
import type { PanelFrameServicePort } from '../services/page/PanelFrameService.js';
import type { AppEnv } from '../types/app.js';

export interface PanelFrameRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  panelFrameService: PanelFrameServicePort;
}

export function createPanelFrameRoutes(dependencies: PanelFrameRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);

  app.get('/pages/:id/frames', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const frames = await dependencies.panelFrameService.listPageFrames(user.id, pageId);

    return c.json({ frames: frames.map(toPanelFrameResponse) });
  });

  app.put('/pages/:id/frames', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const body = replacePanelFramesBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    const frames = await dependencies.panelFrameService.replacePageFrames(
      user.id,
      pageId,
      body.data.frames.map((frame) => ({
        id: frame.id,
        panelId: frame.panel_id ?? null,
        vertices: frame.vertices,
        borderStyle: frame.border_style,
        borderWidth: frame.border_width,
        borderColor: frame.border_color,
        zIndex: frame.z_index,
        readingOrder: frame.reading_order,
      })),
    );

    return c.json({ frames: frames.map(toPanelFrameResponse) });
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
  const result = panelFrameUuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }

  return result.data;
}

function toPanelFrameResponse(frame: PanelFrame): Record<string, unknown> {
  return {
    id: frame.id,
    page_id: frame.pageId,
    panel_id: frame.panelId,
    vertices: frame.vertices,
    border_style: frame.borderStyle,
    border_width: frame.borderWidth,
    border_color: frame.borderColor,
    z_index: frame.zIndex,
    reading_order: frame.readingOrder,
  };
}
