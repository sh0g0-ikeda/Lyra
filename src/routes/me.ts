import { Hono, type MiddlewareHandler } from 'hono';
import type { OrganizationWorkspaceSummary } from '../domain/types/organization.js';
import type { AuthenticatedUser } from '../domain/types/user.js';
import type { CreditServicePort } from '../services/credit/CreditService.js';
import type { OrganizationServicePort } from '../services/organization/OrganizationService.js';
import type { AppEnv } from '../types/app.js';
import { currentSessionSchema } from '../../packages/api-contract/src/mobileApiSchemas.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';

export interface MeRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  creditService?: CreditServicePort;
  organizationService?: OrganizationServicePort;
}

/**
 * Returns the signed-in user's session context. Enterprise workspace data is
 * intentionally summarized here so the web app can decide which scope to use
 * without reading billing, members, or work content implicitly.
 */
export function createMeRoutes(dependencies: MeRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.get('/me', async (c) => {
    const user = c.get('user');
    const organizations =
      dependencies.organizationService === undefined
        ? []
        : await dependencies.organizationService.listWorkspaces(user.id);
    const personalCredits =
      dependencies.creditService === undefined
        ? null
        : await dependencies.creditService.getBalance(user.id);

    const payload = {
      user: toUserResponse(user),
      personal_credits:
        personalCredits === null
          ? null
          : {
              monthly_credits: personalCredits.monthlyCredits,
              purchased_credits: personalCredits.purchasedCredits,
              total_credits: personalCredits.totalCredits,
              monthly_expires_at: personalCredits.monthlyExpiresAt?.toISOString() ?? null,
            },
      organizations: organizations.map(toWorkspaceResponse),
    };

    return c.json(assertMobileResponseContract(currentSessionSchema, payload));
  });

  return app;
}

function toUserResponse(user: AuthenticatedUser): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName,
    plan_code: user.planCode,
  };
}

function toWorkspaceResponse(workspace: OrganizationWorkspaceSummary): Record<string, unknown> {
  const balance = workspace.balance;
  return {
    id: workspace.organization.id,
    name: workspace.organization.name,
    status: workspace.organization.status,
    plan_key: workspace.organization.planKey,
    role: workspace.membership.role,
    membership_status: workspace.membership.status,
    monthly_credits: balance?.monthlyCredits ?? 0,
    purchased_credits: balance?.purchasedCredits ?? 0,
    total_credits: (balance?.monthlyCredits ?? 0) + (balance?.purchasedCredits ?? 0),
    monthly_expires_at: balance?.monthlyExpiresAt?.toISOString() ?? null,
  };
}
