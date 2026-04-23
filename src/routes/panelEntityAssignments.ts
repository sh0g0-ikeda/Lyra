import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
import type { PanelEntityAssignment } from '../domain/types/panelEntityAssignment.js';
import {
  panelEntityAssignmentUuidParamSchema,
  replacePanelEntityAssignmentsBodySchema,
} from '../lib/validators/panelEntityAssignment.schema.js';
import type { PanelEntityAssignmentServicePort } from '../services/page/PanelEntityAssignmentService.js';
import type { AppEnv } from '../types/app.js';

export interface PanelEntityAssignmentRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  panelEntityAssignmentService: PanelEntityAssignmentServicePort;
}

export function createPanelEntityAssignmentRoutes(
  dependencies: PanelEntityAssignmentRouteDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);

  app.put('/panels/:id/entities', async (c) => {
    const user = c.get('user');
    const panelId = parseUuidParam(c, 'id');
    const body = replacePanelEntityAssignmentsBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    const assignments = await dependencies.panelEntityAssignmentService.replacePanelEntityAssignments(
      user.id,
      panelId,
      body.data.entities.map((assignment) => ({
        entityId: assignment.entity_id,
        role: assignment.role,
        expression: assignment.expression,
        customExpression: assignment.custom_expression,
        action: assignment.action,
        customAction: assignment.custom_action,
        position: assignment.position,
        stateId: assignment.state_id,
      })),
    );

    return c.json({ entities: assignments.map(toPanelEntityAssignmentResponse) });
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
  const result = panelEntityAssignmentUuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }

  return result.data;
}

function toPanelEntityAssignmentResponse(assignment: PanelEntityAssignment): Record<string, unknown> {
  return {
    entity_id: assignment.entityId,
    role: assignment.role,
    expression: assignment.expression,
    custom_expression: assignment.customExpression,
    action: assignment.action,
    custom_action: assignment.customAction,
    position: assignment.position,
    state_id: assignment.stateId,
  };
}
