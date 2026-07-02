import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { ForbiddenError, ValidationError } from '../domain/errors/index.js';
import type { OrganizationCreditBalance } from '../domain/types/organization.js';
import {
  adminOrganizationContractBodySchema,
  adminOrganizationCreditGrantBodySchema,
  organizationUuidParamSchema,
} from '../lib/validators/organization.schema.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import { buildOrganizationUsageCsv } from '../services/organization/OrganizationUsageCsv.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import type { AppEnv } from '../types/app.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

export interface AdminOrganizationRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  organizationService: OrganizationServicePort;
  adminEmails: readonly string[];
}

export function createAdminOrganizationRoutes(dependencies: AdminOrganizationRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('/admin/*', dependencies.authMiddleware);
  app.use('/admin/*', dependencies.rateLimitMiddleware);
  app.use('/admin/*', async (c, next) => {
    const user = c.get('user');
    if (!isAdminEmail(user.email, dependencies.adminEmails)) {
      throw new ForbiddenError('This action is limited to Lyra administrators');
    }
    await next();
  });

  app.patch('/admin/organizations/:organizationId/contract', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c.req.param('organizationId'));
    const body = adminOrganizationContractBodySchema.safeParse(await readSmallJsonBody(c));
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const organization = await dependencies.organizationService.adminUpdateOrganizationContract(
      user.id,
      organizationId,
      {
        planKey: body.data.plan_key,
        status: body.data.status,
        billingEmail: body.data.billing_email,
      },
    );

    return c.json({
      organization: {
        id: organization.id,
        name: organization.name,
        status: organization.status,
        plan_key: organization.planKey,
        billing_email: organization.billingEmail,
        updated_at: organization.updatedAt.toISOString(),
      },
    });
  });

  app.post('/admin/organizations/:organizationId/credits/grants', async (c) => {
    const user = c.get('user');
    const organizationId = parseOrganizationId(c.req.param('organizationId'));
    const body = adminOrganizationCreditGrantBodySchema.safeParse(await readSmallJsonBody(c));
    if (!body.success) {
      throw new ValidationError(formatZodValidationError(body.error));
    }

    const balance = await dependencies.organizationService.adminGrantCredits({
      organizationId,
      actorUserId: user.id,
      bucket: body.data.bucket,
      amount: body.data.amount,
      description: `Admin manual grant: ${body.data.description}`,
      packageCode: body.data.package_code ?? null,
      stripeEventId: null,
    });

    return c.json(toCreditBalanceResponse(balance), 201);
  });

  return app;
}

export const buildUsageCsv = buildOrganizationUsageCsv;

function parseOrganizationId(value: string): string {
  const parsed = organizationUuidParamSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('organizationId must be a valid UUID');
  }
  return parsed.data;
}

async function readSmallJsonBody(c: Context<AppEnv>): Promise<unknown> {
  return readJsonBody(c, {
    maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
    description: 'Admin organization request',
  });
}

function isAdminEmail(email: string, adminEmails: readonly string[]): boolean {
  const normalized = email.trim().toLowerCase();
  return adminEmails.some((adminEmail) => adminEmail.trim().toLowerCase() === normalized);
}

function toCreditBalanceResponse(balance: OrganizationCreditBalance): Record<string, unknown> {
  return {
    organization_id: balance.organizationId,
    monthly_credits: balance.monthlyCredits,
    purchased_credits: balance.purchasedCredits,
    total_credits: balance.monthlyCredits + balance.purchasedCredits,
    monthly_expires_at: balance.monthlyExpiresAt?.toISOString() ?? null,
    updated_at: balance.updatedAt.toISOString(),
  };
}
