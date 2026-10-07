import { Hono, type MiddlewareHandler } from 'hono';
import {
  accountDeletionPreviewResponseSchema,
  deployedAccountDeletionPreviewSchema,
  deployedAccountDeletionResultSchema,
  accountDeletionResultResponseSchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
import { AppError, ValidationError } from '../domain/errors/index.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import { accountDeletionRequestBodySchema } from '../lib/validators/accountDeletion.schema.js';
import type {
  AccountDeletionPreview,
  AccountDeletionResult,
  AccountDeletionServicePort,
} from '../services/account/AccountDeletionService.js';
import type { AppEnv } from '../types/app.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

const RECENT_AUTH_MAX_AGE_SECONDS = 300;
const AUTH_CLOCK_SKEW_SECONDS = 60;

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

  app.get('/account/deletion-preview', async (c) => {
    const preview = await dependencies.accountDeletionService.getDeletionPreview(c.get('user').id);
    c.header('Cache-Control', 'no-store');
    return c.json(assertMobileResponseContract(deployedAccountDeletionPreviewSchema, {
      personal_data: { account: preview.personalData.account, personal_works: preview.personalData.personalWorks, organization_memberships: preview.personalData.organizationMemberships },
      unique_owner_organizations: preview.uniqueOwnerOrganizations,
      active_personal_subscription_count: preview.activePersonalStripeSubscriptionCount + preview.activeStoreSubscriptions.length,
      active_stripe_subscription_count: preview.activePersonalStripeSubscriptionCount,
      active_mobile_store_subscription_count: preview.activeStoreSubscriptions.length,
      // Conservatively include every protected personal asset, rather than hide
      // newer state/snapshot assets from a legacy client's confirmation.
      confirmed_personal_asset_count: preview.personalAssetCount,
    }));
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
    // Refreshing a JWT must not renew permission for this destructive action.
    // authTime comes only from the signature-verified Cognito ID token.
    const identity = c.get('cognitoIdentity');
    const now = Math.floor(Date.now() / 1000);
    if (identity === undefined || identity.subject !== user.supabaseId
      || !Number.isSafeInteger(identity.authTime) || identity.authTime <= 0
      || now - identity.authTime > RECENT_AUTH_MAX_AGE_SECONDS
      || identity.authTime - now > AUTH_CLOCK_SKEW_SECONDS) {
      throw new AppError('RECENT_AUTH_REQUIRED', 'Please sign in again before deleting your account.', 401);
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
    if (
      result.status === 'blocked'
      && result.blockers.some(
        (blocker) => blocker.code === 'CREDIT_RECOVERY_REQUIRED',
      )
    ) {
      throw new AppError(
        'ACCOUNT_CREDIT_RECOVERY_PENDING',
        'Resolve the pending payment adjustment before deleting your account.',
        409,
      );
    }
    const statusCode =
      result.status === 'blocked'
        ? 409
        : result.status === 'completed'
          ? 200
          : 202;
    c.header('Cache-Control', 'no-store');
    if (parsed.data.legacy_contract) return c.json(assertMobileResponseContract(deployedAccountDeletionResultSchema, toDeployedResult(result)), statusCode);
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

function toDeployedResult(result: AccountDeletionResult): Record<string, unknown> {
  if (result.status === 'blocked') {
    if (result.blockers.some(blocker => blocker.code === 'ACTIVE_PERSONAL_JOB')) {
      throw new AppError('ACCOUNT_HAS_ACTIVE_JOBS', 'Wait for active generation or export jobs to finish before deleting the account.', 409);
    }
    return { status: result.status, blockers: result.blockers.map(blocker => {
      if (blocker.code === 'ACTIVE_STORE_SUBSCRIPTION') return { code: 'ACTIVE_PERSONAL_SUBSCRIPTION', subscription_count: blocker.subscription_count };
      if (blocker.code === 'PERSONAL_ASSETS') return { code: 'CONFIRMED_PERSONAL_ASSETS', asset_count: blocker.asset_count };
      return blocker;
    }) };
  }
  if (result.status === 'pending_external_action') return { ...result,
    next_action: result.next_action === 'cancel_personal_subscriptions' ? 'cancel_subscription'
      : result.next_action === 'delete_personal_assets' ? 'schedule_asset_lifecycle' : result.next_action };
  return result;
}
