import { Hono, type MiddlewareHandler } from 'hono';
import { z, type ZodError } from 'zod';
import {
  mobilePurchaseAccountBindingSchema,
  mobileStoreProductCatalogSchema,
  mobileStorePurchaseResultSchema,
  mobileStoreRestoreResultSchema,
} from '../../packages/api-contract/src/mobileApiSchemas.js';
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
import { assertMobileResponseContract } from './mobileResponseContract.js';
import { readJsonBody, REQUEST_BODY_LIMITS } from './requestBody.js';

export interface MobilePurchaseRouteDependencies {
  authMiddleware: MiddlewareHandler<AppEnv>;
  rateLimitMiddleware: MiddlewareHandler<AppEnv>;
  mobileStorePurchaseService: MobileStorePurchaseServicePort;
}

export function createMobilePurchaseRoutes(
  dependencies: MobilePurchaseRouteDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', dependencies.authMiddleware);
  app.use('*', dependencies.rateLimitMiddleware);

  app.get('/catalog/:store', (c) => {
    const store = parse(z.enum(STORE_PURCHASE_STORES).safeParse(c.req.param('store')));
    const payload = {
      store,
      products: dependencies.mobileStorePurchaseService
        .listProducts(store)
        .map(toProductResponse),
    };
    return c.json(assertMobileResponseContract(mobileStoreProductCatalogSchema, payload));
  });

  app.get('/binding', async (c) => {
    const binding = await dependencies.mobileStorePurchaseService.getAccountBinding(
      c.get('user').id,
    );
    c.header('Cache-Control', 'no-store');
    return c.json(
      assertMobileResponseContract(mobilePurchaseAccountBindingSchema, {
        apple_app_account_token: binding.appleAppAccountToken,
        google_obfuscated_account_id: binding.googleObfuscatedAccountId,
        subscription_purchase_allowed: binding.subscriptionPurchaseAllowed,
      }),
    );
  });

  app.post('/apple/verify', async (c) => {
    const body = parse(
      mobileAppleVerifyBodySchema.safeParse(
        await readJsonBody(c, {
          maxBytes: REQUEST_BODY_LIMITS.DEFAULT_JSON_BYTES,
          description: 'Apple store purchase verification',
        }),
      ),
    );
    const result = await dependencies.mobileStorePurchaseService.verifyApplePurchase({
      userId: c.get('user').id,
      signedTransaction: body.signed_transaction,
      environment: body.environment,
    });
    c.header('Cache-Control', 'no-store');
    return c.json(
      assertMobileResponseContract(
        mobileStorePurchaseResultSchema,
        toPurchaseResponse(result),
      ),
    );
  });

  app.post('/google/verify', async (c) => {
    const body = parse(
      mobileGoogleVerifyBodySchema.safeParse(
        await readJsonBody(c, {
          maxBytes: REQUEST_BODY_LIMITS.SMALL_JSON_BYTES,
          description: 'Google Play purchase verification',
        }),
      ),
    );
    const result = await dependencies.mobileStorePurchaseService.verifyGooglePurchase({
      userId: c.get('user').id,
      purchaseToken: body.purchase_token,
    });
    c.header('Cache-Control', 'no-store');
    return c.json(
      assertMobileResponseContract(
        mobileStorePurchaseResultSchema,
        toPurchaseResponse(result),
      ),
    );
  });

  app.post('/restore', async (c) => {
    const body = parse(
      mobileRestoreBodySchema.safeParse(
        await readJsonBody(c, {
          maxBytes: REQUEST_BODY_LIMITS.DEFAULT_JSON_BYTES,
          description: 'Mobile store purchase restore',
        }),
      ),
    );
    const results = await dependencies.mobileStorePurchaseService.restorePurchases({
      userId: c.get('user').id,
      appleSignedTransactions: body.apple_signed_transactions,
      googlePurchaseTokens: body.google_purchase_tokens,
    });
    c.header('Cache-Control', 'no-store');
    return c.json(
      assertMobileResponseContract(mobileStoreRestoreResultSchema, {
        purchases: results.map(toPurchaseResponse),
      }),
    );
  });

  return app;
}

function parse<T>(
  result: { success: true; data: T } | { success: false; error: ZodError },
): T {
  if (result.success) {
    return result.data;
  }
  throw new ValidationError(formatZodValidationError(result.error));
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
    credit_package_code:
      product.kind === 'credit_pack' ? product.creditPackageCode : null,
  };
}

function toPurchaseResponse(result: MobileStorePurchaseResult) {
  return {
    store: result.store,
    state: result.state,
    product_kind: result.productKind,
    plan_code: result.planCode,
    credit_package_code: result.creditPackageCode,
    credits_changed: result.creditsChanged,
    is_duplicate: result.isDuplicate,
  };
}
