import { Hono, type MiddlewareHandler } from 'hono';
import { ValidationError } from '../domain/errors/index.js';
import { accountDeletionRequestSchema } from '../lib/validators/account.schema.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type { AccountDeletionServicePort } from '../services/account/AccountDeletionService.js';
import type { AppEnv } from '../types/app.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';
import {
  accountDeletionPreviewSchema,
  accountDeletionResultSchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';

export interface AccountRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  accountDeletionService: AccountDeletionServicePort;
}

export function createAccountRoutes(dependencies: AccountRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/account/deletion-preview', dependencies.authMiddleware, dependencies.rateLimitMiddleware, async (c) => {
    const preview = await dependencies.accountDeletionService.getDeletionPreview(c.get('user').id);
    const payload = {
      personal_data: {
        account: preview.personalData.account,
        personal_works: preview.personalData.personalWorks,
        organization_memberships: preview.personalData.organizationMemberships,
      },
      unique_owner_organizations: preview.uniqueOwnerOrganizations,
      active_personal_subscription_count: preview.activePersonalSubscriptionCount,
      active_stripe_subscription_count: preview.activeStripeSubscriptionCount,
      active_mobile_store_subscription_count: preview.activeMobileStoreSubscriptionCount,
      confirmed_personal_asset_count: preview.confirmedPersonalAssetCount,
    };
    return c.json(assertMobileResponseContract(accountDeletionPreviewSchema, payload));
  });

  app.post('/account/deletion', dependencies.authMiddleware, dependencies.rateLimitMiddleware, async (c) => {
    const parsed = accountDeletionRequestSchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
        description: 'Account deletion request',
      }),
    );
    if (!parsed.success) {
      throw new ValidationError(formatZodValidationError(parsed.error));
    }

    const user = c.get('user');
    const result = await dependencies.accountDeletionService.requestDeletion({
      userId: user.id,
      identityId: user.supabaseId,
      confirmation: parsed.data.confirmation,
      acknowledgeActiveSubscription: parsed.data.acknowledge_active_subscription,
      acknowledgeConfirmedAssets: parsed.data.acknowledge_confirmed_assets,
    });

    return c.json(
      assertMobileResponseContract(accountDeletionResultSchema, result),
      result.status === 'blocked' ? 409 : result.status === 'completed' ? 200 : 202,
    );
  });

  return app;
}
