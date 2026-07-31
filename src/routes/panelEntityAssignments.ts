import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { panelAssignmentsResponseSchema } from '../../packages/api-contract/src/mobileApiSchemas.js';
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
import {
  parseOptionalOrganizationId,
  requireOrganizationCapability,
} from './organizationRouteHelpers.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
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
      body.data.entities.map(toPanelEntityAssignmentRequest),
      organizationId,
      body.data.expected_entities?.map(toPanelEntityAssignmentRequest),
    );

    const payload = { entities: assignments.map(toPanelEntityAssignmentResponse) };
    return c.json(assertMobileResponseContract(panelAssignmentsResponseSchema, payload));
  });

  return app;
}

function toPanelEntityAssignmentRequest(
  assignment: ReturnType<typeof replacePanelEntityAssignmentsBodySchema.parse>['entities'][number],
): PanelEntityAssignment {
  return {
    entityId: assignment.entity_id,
    role: assignment.role,
    expression: assignment.expression,
    customExpression: assignment.expression === 'custom' ? assignment.custom_expression : null,
    action: assignment.action,
    customAction: assignment.action === 'custom' ? assignment.custom_action : null,
    position: assignment.position,
    facingDirection: assignment.facing_direction,
    effectNote: assignment.effect_note,
    stateId: assignment.state_id,
  };
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
    facing_direction: assignment.facingDirection,
    effect_note: assignment.effectNote,
    state_id: assignment.stateId,
  };
}
