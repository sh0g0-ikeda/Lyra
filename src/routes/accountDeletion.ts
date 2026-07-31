import { Hono, type MiddlewareHandler } from 'hono';
import {
  accountDeletionPreviewResponseSchema,
  accountDeletionResultResponseSchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
import { ValidationError } from '../domain/errors/index.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import { accountDeletionRequestBodySchema } from '../lib/validators/accountDeletion.schema.js';
import type {
  AccountDeletionPreview,
  AccountDeletionServicePort,
} from '../services/account/AccountDeletionService.js';
import type { AppEnv } from '../types/app.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

export interface AccountDeletionRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  accountDeletionService: AccountDeletionServicePort;
}

export function createAccountDeletionRoutes(
  dependencies: AccountDeletionRouteDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.get('/account/deletion', async (c) => {
    const preview = await dependencies.accountDeletionService.getDeletionPreview(
      c.get('user').id,
    );
    c.header('Cache-Control', 'no-store');
    return c.json(
      assertMobileResponseContract(
        accountDeletionPreviewResponseSchema,
        toPreviewResponse(preview),
      ),
    );
  });

  app.post('/account/deletion', async (c) => {
    const user = c.get('user');
    const parsed = accountDeletionRequestBodySchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
        description: 'Account deletion request',
      }),
    );
    if (!parsed.success) {
      throw new ValidationError(formatZodValidationError(parsed.error));
    }
    const result = await dependencies.accountDeletionService.requestDeletion({
      userId: user.id,
      identityId: user.supabaseId,
      confirmation: parsed.data.confirmation,
      acknowledgePersonalSubscriptions:
        parsed.data.acknowledge_personal_subscriptions,
      acknowledgeStoreBilling: parsed.data.acknowledge_store_billing,
      acknowledgePersonalAssets: parsed.data.acknowledge_personal_assets,
    });
    const statusCode =
      result.status === 'blocked'
        ? 409
        : result.status === 'completed'
          ? 200
          : 202;
    c.header('Cache-Control', 'no-store');
    return c.json(
      assertMobileResponseContract(accountDeletionResultResponseSchema, result),
      statusCode,
    );
  });

  return app;
}

function toPreviewResponse(preview: AccountDeletionPreview): Record<string, unknown> {
  return {
    personal_data: {
      account: preview.personalData.account,
      personal_works: preview.personalData.personalWorks,
      organization_memberships:
        preview.personalData.organizationMemberships,
      billing_records: preview.personalData.billingRecords,
    },
    unique_owner_organizations: preview.uniqueOwnerOrganizations,
    active_personal_stripe_subscription_count:
      preview.activePersonalStripeSubscriptionCount,
    active_store_subscriptions: preview.activeStoreSubscriptions.map(
      (subscription) => ({
        store: subscription.store,
        expires_at: subscription.expiresAt?.toISOString() ?? null,
        auto_renew_enabled: subscription.autoRenewEnabled,
        manage_url: subscription.manageUrl,
      }),
    ),
    personal_asset_count: preview.personalAssetCount,
    active_personal_job_count: preview.activePersonalJobCount,
  };
}
