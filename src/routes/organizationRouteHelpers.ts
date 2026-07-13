import type { Context } from 'hono';
import { z } from 'zod';
import { ValidationError } from '../domain/errors/index.js';
import type { OrganizationCapability } from '../domain/types/organization.js';
import { sanitizePersistedErrorMessage } from '../lib/errorSanitizer.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import type { AppEnv } from '../types/app.js';

const organizationIdQuerySchema = z.string().uuid();
const ORGANIZATION_AUDIT_WRITE_MAX_ATTEMPTS = 3;

export interface OrganizationRouteDependencies {
  organizationService?: OrganizationServicePort;
}

export function parseOptionalOrganizationId(c: Context<AppEnv>): string | null {
  const raw = c.req.query('organization_id');
  if (raw === undefined || raw.trim().length === 0) {
    return null;
  }

  const result = organizationIdQuerySchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError('organization_id must be a valid UUID');
  }

  return result.data;
}

export async function requireOrganizationCapability(
  c: Context<AppEnv>,
  dependencies: OrganizationRouteDependencies,
  organizationId: string | null,
  capability: OrganizationCapability,
): Promise<void> {
  if (organizationId === null) {
    return;
  }
  if (dependencies.organizationService === undefined) {
    throw new ValidationError('Organization service is not configured');
  }

  const user = c.get('user');
  await dependencies.organizationService.requireMembership(organizationId, user.id, capability);
}

export async function recordOrganizationAudit(
  dependencies: OrganizationRouteDependencies,
  organizationId: string | null,
  actorUserId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (organizationId === null || dependencies.organizationService === undefined) {
    return;
  }

  for (let attempt = 1; attempt <= ORGANIZATION_AUDIT_WRITE_MAX_ATTEMPTS; attempt += 1) {
    try {
      await dependencies.organizationService.recordAuditEvent({
        organizationId,
        actorUserId,
        action,
        targetType,
        targetId,
        metadata,
      });
      return;
    } catch (error) {
      if (attempt < ORGANIZATION_AUDIT_WRITE_MAX_ATTEMPTS) {
        continue;
      }
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'organization_audit_log_failed',
          organization_id: organizationId,
          action,
          target_type: targetType,
          target_id: targetId,
          attempts: ORGANIZATION_AUDIT_WRITE_MAX_ATTEMPTS,
          message: sanitizePersistedErrorMessage(error, 'Organization audit log failed'),
        }),
      );
    }
  }
}
