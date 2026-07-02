import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
import type { PanelEntityAssignment } from '../domain/types/panelEntityAssignment.js';
import {
  panelEntityAssignmentUuidParamSchema,
  replacePanelEntityAssignmentsBodySchema,
} from '../lib/validators/panelEntityAssignment.schema.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import type { PanelEntityAssignmentServicePort } from '../services/page/PanelEntityAssignmentService.js';
import type { AppEnv } from '../types/app.js';
import { readJsonBody } from './requestBody.js';

export interface PanelEntityAssignmentRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  panelEntityAssignmentService: PanelEntityAssignmentServicePort;
  organizationService?: OrganizationServicePort;
}

export function createPanelEntityAssignmentRoutes(
  dependencies: PanelEntityAssignmentRouteDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.put('/panels/:id/entities', async (c) => {
    const user = c.get('user');
    const panelId = parseUuidParam(c, 'id');
    const organizationId = parseOptionalOrganizationId(c);
    await requireOrganizationCapability(c, dependencies, organizationId, 'edit_work');
    const body = replacePanelEntityAssignmentsBodySchema.safeParse(await readJsonBody(c));

    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const assignments = await dependencies.panelEntityAssignmentService.replacePanelEntityAssignments(
      user.id,
      panelId,
      body.data.entities.map((assignment) => ({
        entityId: assignment.entity_id,
        role: assignment.role,
        expression: assignment.expression,
        customExpression:
          assignment.expression === 'custom' ? assignment.custom_expression : null,
        action: assignment.action,
        customAction: assignment.action === 'custom' ? assignment.custom_action : null,
        position: assignment.position,
        facingDirection: assignment.facing_direction,
        effectNote: assignment.effect_note,
        stateId: assignment.state_id,
      })),
      organizationId,
    );

    return c.json({ entities: assignments.map(toPanelEntityAssignmentResponse) });
  });

  return app;
}

function parseUuidParam(c: Context<AppEnv>, name: string): string {
  const result = panelEntityAssignmentUuidParamSchema.safeParse(c.req.param(name));
  if (!result.success) {
    throw new ValidationError(`${name} must be a valid UUID`);
  }

  return result.data;
}

function parseOptionalOrganizationId(c: Context<AppEnv>): string | null {
  const raw = c.req.query('organization_id');
  if (raw === undefined || raw.trim().length === 0) {
    return null;
  }

  const result = panelEntityAssignmentUuidParamSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError('organization_id must be a valid UUID');
  }

  return result.data;
}

async function requireOrganizationCapability(
  c: Context<AppEnv>,
  dependencies: PanelEntityAssignmentRouteDependencies,
  organizationId: string | null,
  capability: Parameters<OrganizationServicePort['requireMembership']>[2],
): Promise<void> {
  if (organizationId === null) {
    return;
  }
  if (dependencies.organizationService === undefined) {
    throw new ValidationError('Organization workspace is unavailable');
  }

  const user = c.get('user');
  await dependencies.organizationService.requireMembership(organizationId, user.id, capability);
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
    facing_direction: assignment.facingDirection,
    effect_note: assignment.effectNote,
    state_id: assignment.stateId,
  };
}
