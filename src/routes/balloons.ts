import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
import type { Balloon } from '../domain/types/balloon.js';
import {
  balloonUuidParamSchema,
  createBalloonBodySchema,
  updateBalloonBodySchema,
} from '../lib/validators/balloon.schema.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import type { BalloonServicePort } from '../services/page/BalloonService.js';
import type { AppEnv } from '../types/app.js';
import {
  parseOptionalOrganizationId,
  requireOrganizationCapability,
} from './organizationRouteHelpers.js';
import { readJsonBody } from './requestBody.js';

export interface BalloonRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  balloonService: BalloonServicePort;
  organizationService?: OrganizationServicePort;
}

export function createBalloonRoutes(dependencies: BalloonRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.post('/pages/:id/balloons', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = createBalloonBodySchema.safeParse(await readJsonBody(c));
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const balloon = await dependencies.balloonService.createBalloon(
      user.id,
      pageId,
      {
        speakerEntityId: body.data.speaker_entity_id ?? null,
        balloonType: body.data.balloon_type,
        writingMode: body.data.writing_mode,
        text: body.data.text,
        position: body.data.position,
        tail: body.data.tail === undefined ? null : body.data.tail === null ? null : {
          baseX: body.data.tail.base_x,
          baseY: body.data.tail.base_y,
          tipX: body.data.tail.tip_x,
          tipY: body.data.tail.tip_y,
        },
        fontSize: body.data.font_size,
        fontFamily: body.data.font_family,
        panelOrderReference: body.data.panel_order_reference ?? null,
        zIndex: body.data.z_index,
      },
      organizationId,
    );

    return c.json(toBalloonResponse(balloon), 201);
  });

  app.get('/pages/:id/balloons', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'view_work');
    const balloons = await dependencies.balloonService.listBalloons(user.id, pageId, organizationId);

    return c.json({ balloons: balloons.map(toBalloonResponse) });
  });

  app.post('/pages/:id/auto-balloons', async (c) => {
    const user = c.get('user');
    const pageId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const balloons = await dependencies.balloonService.autoGenerateBalloons(user.id, pageId, organizationId);

    return c.json({ balloons: balloons.map(toBalloonResponse) });
  });

  app.put('/balloons/:id', async (c) => {
    const user = c.get('user');
    const balloonId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = updateBalloonBodySchema.safeParse(await readJsonBody(c));
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const balloon = await dependencies.balloonService.updateBalloon(
      user.id,
      balloonId,
      {
        speakerEntityId: body.data.speaker_entity_id,
        balloonType: body.data.balloon_type,
        writingMode: body.data.writing_mode,
        text: body.data.text,
        position: body.data.position,
        tail: body.data.tail === undefined ? undefined : body.data.tail === null ? null : {
          baseX: body.data.tail.base_x,
          baseY: body.data.tail.base_y,
          tipX: body.data.tail.tip_x,
          tipY: body.data.tail.tip_y,
        },
        fontSize: body.data.font_size,
        fontFamily: body.data.font_family,
        panelOrderReference: body.data.panel_order_reference,
        zIndex: body.data.z_index,
      },
      organizationId,
    );

    return c.json(toBalloonResponse(balloon));
  });

  app.delete('/balloons/:id', async (c) => {
    const user = c.get('user');
    const balloonId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    await dependencies.balloonService.deleteBalloon(user.id, balloonId, organizationId);

    return c.body(null, 204);
  });

  return app;
}

function parseUuidParam(c: Context<AppEnv>, name: string): string {
  const result = balloonUuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }

  return result.data;
}

function toBalloonResponse(balloon: Balloon): Record<string, unknown> {
  return {
    id: balloon.id,
    page_id: balloon.pageId,
    speaker_entity_id: balloon.speakerEntityId,
    balloon_type: balloon.balloonType,
    writing_mode: balloon.writingMode,
    text: balloon.text,
    position: balloon.position,
    tail: balloon.tail === null ? null : {
      base_x: balloon.tail.baseX,
      base_y: balloon.tail.baseY,
      tip_x: balloon.tail.tipX,
      tip_y: balloon.tail.tipY,
    },
    font_size: balloon.fontSize,
    font_family: balloon.fontFamily,
    panel_order_reference: balloon.panelOrderReference,
    z_index: balloon.zIndex,
  };
}
