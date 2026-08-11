import { Hono, type MiddlewareHandler } from 'hono';
import { z, type ZodError } from 'zod';
import type {
  ConsumerPaidPlanCode,
  CreditPackageCode,
} from '../domain/constants/billing.js';
import { ValidationError } from '../domain/errors/index.js';
import {
  STORE_PURCHASE_STORES,
  type StoreProductDefinition,
} from '../domain/storePurchase.js';
import {
  mobileAppleVerifyBodySchema,
  mobileGoogleVerifyBodySchema,
  mobileRestoreBodySchema,
} from '../lib/validators/mobilePurchase.schema.js';
import { formatZodValidationError } from '../lib/validationErrorFormatter.js';
import type {
  MobileStorePurchaseResult,
  MobileStorePurchaseServicePort,
} from '../services/billing/MobileStorePurchaseService.js';
import type { AppEnv } from '../types/app.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';
import {
  mobilePurchaseAccountBindingSchema,
  mobileStoreProductCatalogSchema,
  mobileStorePurchaseResultSchema,
  mobileStoreRestoreResultSchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
import { assertMobileResponseContract } from './mobileResponseContract.js';

export interface MobilePurchaseRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  mobileStorePurchaseService: MobileStorePurchaseServicePort;
}

export function createMobilePurchaseRoutes(dependencies: MobilePurchaseRouteDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.get('/catalog/:store', (c) => {
    const store = parseBody(z.enum(STORE_PURCHASE_STORES).safeParse(c.req.param('store')));
    const products = dependencies.mobileStorePurchaseService.listProducts(store);
    const payload = {
      store,
      products: products.map(toProductResponse),
    };
    return c.json(assertMobileResponseContract(mobileStoreProductCatalogSchema, payload));
  });

  app.get('/binding', async (c) => {
    const user = c.get('user');
    const binding = await dependencies.mobileStorePurchaseService.getAccountBinding(user.id);
    const payload = {
      apple_app_account_token: binding.appleAppAccountToken,
      google_obfuscated_account_id: binding.googleObfuscatedAccountId,
      subscription_purchase_allowed: binding.subscriptionPurchaseAllowed,
    };
    return c.json(assertMobileResponseContract(mobilePurchaseAccountBindingSchema, payload));
  });

  app.post('/apple/verify', async (c) => {
    const user = c.get('user');
    const body = parseBody(mobileAppleVerifyBodySchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.DEFAULT_JSON_BYTES,
        description: 'Apple store purchase verification',
      }),
    ));
    const result = await dependencies.mobileStorePurchaseService.verifyApplePurchase({
      userId: user.id,
      signedTransaction: body.signed_transaction,
      environment: body.environment,
    });

    const payload = toResponse(result);
    return c.json(assertMobileResponseContract(mobileStorePurchaseResultSchema, payload));
  });

  app.post('/google/verify', async (c) => {
    const user = c.get('user');
    const body = parseBody(mobileGoogleVerifyBodySchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
        description: 'Google Play purchase verification',
      }),
    ));
    const result = await dependencies.mobileStorePurchaseService.verifyGooglePurchase({
      userId: user.id,
      purchaseToken: body.purchase_token,
    });

    const payload = toResponse(result);
    return c.json(assertMobileResponseContract(mobileStorePurchaseResultSchema, payload));
  });

  app.post('/restore', async (c) => {
    const user = c.get('user');
    const body = parseBody(mobileRestoreBodySchema.safeParse(
      await readJsonBody(c, {
        maxBytes: REQUEST_BODY_LIMITS.DEFAULT_JSON_BYTES,
        description: 'Mobile store purchase restore',
      }),
    ));
    const purchases = await dependencies.mobileStorePurchaseService.restorePurchases({
      userId: user.id,
      appleSignedTransactions: body.apple_signed_transactions,
      googlePurchaseTokens: body.google_purchase_tokens,
    });

    const payload = { purchases: purchases.map(toResponse) };
    return c.json(assertMobileResponseContract(mobileStoreRestoreResultSchema, payload));
  });

  return app;
}

function toProductResponse(product: StoreProductDefinition): {
  product_id: string;
  kind: StoreProductDefinition['kind'];
  plan_code: ConsumerPaidPlanCode | null;
  credit_package_code: CreditPackageCode | null;
} {
  return {
    product_id: product.productId,
    kind: product.kind,
    plan_code: product.kind === 'subscription' ? product.planCode : null,
    credit_package_code: product.kind === 'credit_pack' ? product.creditPackageCode : null,
  };
}

function parseBody<T>(result: { success: true; data: T } | { success: false; error: ZodError }): T {
  if (result.success) {
    return result.data;
  }

  throw new ValidationError(formatZodValidationError(result.error));
}

function toResponse(result: MobileStorePurchaseResult): {
  store: MobileStorePurchaseResult['store'];
  state: MobileStorePurchaseResult['state'];
  product_kind: MobileStorePurchaseResult['productKind'];
  plan_code: MobileStorePurchaseResult['planCode'];
  scheduled_plan_code: MobileStorePurchaseResult['scheduledPlanCode'];
  scheduled_plan_effective_at: string | null;
  credit_package_code: MobileStorePurchaseResult['creditPackageCode'];
  credits_changed: number;
  is_duplicate: boolean;
} {
  return {
    store: result.store,
    state: result.state,
    product_kind: result.productKind,
    plan_code: result.planCode,
    scheduled_plan_code: result.scheduledPlanCode,
    scheduled_plan_effective_at: result.scheduledPlanEffectiveAt?.toISOString() ?? null,
    credit_package_code: result.creditPackageCode,
    credits_changed: result.creditsChanged,
    is_duplicate: result.isDuplicate,
  };
}
