import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
import type { PanelFrame, PanelFrameTemplateApplication } from '../domain/types/panelFrame.js';
import {
  applyPanelFrameTemplateBodySchema,
  panelFrameUuidParamSchema,
  replacePanelFramesBodySchema,
} from '../lib/validators/panelFrame.schema.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import type { PanelFrameServicePort } from '../services/page/PanelFrameService.js';
import type { AppEnv } from '../types/app.js';
import {
  parseOptionalOrganizationId,
  recordOrganizationAudit,
  requireOrganizationCapability,
} from './organizationRouteHelpers.js';
import { readJsonBody } from './requestBody.js';

export interface PanelFrameRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  panelFrameService: PanelFrameServicePort;
  organizationService?: OrganizationServicePort;
}

export function createPanelFrameRoutes(dependencies: PanelFrameRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.get('/pages/:id/frames', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const frames = await dependencies.panelFrameService.listPageFrames(user.id, pageId, organizationId);

    return c.json({ frames: frames.map(toPanelFrameResponse) });
  });

  app.post('/pages/:id/frames/apply-template', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = applyPanelFrameTemplateBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const application = await dependencies.panelFrameService.applyTemplate(
      user.id,
      pageId,
      body.data.template_id,
      organizationId,
    );
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'panel_frame.template_applied', 'page', pageId, {
      template_id: application.templateId,
      panel_count: application.panelCount,
      frame_count: application.frames.length,
    });

    return c.json(toPanelFrameTemplateApplicationResponse(application));
  });

  app.put('/pages/:id/frames', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = replacePanelFramesBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
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
      organizationId,
    );
    await recordOrganizationAudit(dependencies, organizationId, user.id, 'panel_frame.replaced', 'page', pageId, {
      frame_count: frames.length,
    });

    return c.json({ frames: frames.map(toPanelFrameResponse) });
  });

  return app;
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

function toPanelFrameTemplateApplicationResponse(
  application: PanelFrameTemplateApplication,
): Record<string, unknown> {
  return {
    template_id: application.templateId,
    panel_count: application.panelCount,
    frames: application.frames.map(toPanelFrameResponse),
  };
}
