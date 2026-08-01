import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { pagePanelStructureResponseSchema } from '../../packages/api-contract/src/mobileApiSchemas.js';
import { ValidationError } from '../domain/errors/index.js';
import type { PanelFrame } from '../domain/types/panelFrame.js';
import { applyPagePanelStructureBodySchema } from '../lib/validators/pagePanelStructure.schema.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import type {
  ApplyPagePanelStructureRequest,
  PagePanelStructureServicePort,
} from '../services/page/PagePanelStructureService.js';
import type { AppEnv } from '../types/app.js';
import {
  parseOptionalOrganizationId,
  recordOrganizationAudit,
  requireOrganizationCapability,
} from './organizationRouteHelpers.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

const uuidParamSchema = z.string().uuid();

export interface PagePanelStructureRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  pagePanelStructureService: PagePanelStructureServicePort;
  organizationService?: OrganizationServicePort;
}

export function createPagePanelStructureRoutes(
  dependencies: PagePanelStructureRouteDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.put('/pages/:id/panel-structure', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = applyPagePanelStructureBodySchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
        description: 'Page panel structure',
      }),
    );
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const request = toServiceRequest(body.data);
    const result = await dependencies.pagePanelStructureService.apply(
      user.id,
      pageId,
      request,
      organizationId,
    );
    await recordOrganizationAudit(
      dependencies,
      organizationId,
      user.id,
      'page.panel_structure_updated',
      'page',
      pageId,
      {
        operation: request.operation.type,
        panel_count: result.panelIds.length,
        created_panel_id: result.createdPanelId,
        balloon_reference_updated_count: result.balloonReferenceUpdatedCount,
        balloon_reference_cleared_count: result.balloonReferenceClearedCount,
      },
    );

    const payload = {
      panel_ids: result.panelIds,
      created_panel_id: result.createdPanelId,
      layout_template_id: result.layoutTemplateId,
      frames: result.frames.map(toPanelFrameResponse),
      balloon_reference_updated_count: result.balloonReferenceUpdatedCount,
      balloon_reference_cleared_count: result.balloonReferenceClearedCount,
    };
    return c.json(assertMobileResponseContract(pagePanelStructureResponseSchema, payload));
  });

  return app;
}

function parseUuidParam(c: Context<AppEnv>, name: string): string {
  const result = uuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }
  return result.data;
}

function toServiceRequest(
  body: ReturnType<typeof applyPagePanelStructureBodySchema.parse>,
): ApplyPagePanelStructureRequest {
  if (body.operation.type === 'append') {
    return {
      expectedPanelIds: [...body.expected_panel_ids],
      operation: { type: 'append' },
    };
  }
  if (body.operation.type === 'delete') {
    return {
      expectedPanelIds: [...body.expected_panel_ids],
      operation: { type: 'delete', panelId: body.operation.panel_id },
    };
  }
  return {
    expectedPanelIds: [...body.expected_panel_ids],
    operation: { type: 'reorder', panelIds: [...body.operation.panel_ids] },
  };
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
