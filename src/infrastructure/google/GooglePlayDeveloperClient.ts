import { google } from 'googleapis';
import { z } from 'zod';
import { ValidationError } from '../../domain/errors/index.js';
import type { StorePurchaseState, VerifiedStorePurchase } from '../../domain/storePurchase.js';
import type { GooglePlayPurchaseVerifierPort } from '../../services/billing/MobileStorePurchaseService.js';

export interface GooglePlayDeveloperApiPort {
  getSubscriptionPurchase(purchaseToken: string): Promise<unknown>;
  getOneTimeProductPurchase(purchaseToken: string): Promise<unknown>;
}

export interface GooglePlayDeveloperClientConfig {
  packageName: string;
  serviceAccountJsonBase64: string;
}

export class GooglePlayDeveloperClient implements GooglePlayPurchaseVerifierPort {
  public constructor(private readonly api: GooglePlayDeveloperApiPort) {}

  public static fromServiceAccount(config: GooglePlayDeveloperClientConfig): GooglePlayDeveloperClient {
    const credentials = parseServiceAccountCredentials(config.serviceAccountJsonBase64);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    const publisher = google.androidpublisher({ version: 'v3', auth });
    return new GooglePlayDeveloperClient({
      getSubscriptionPurchase: async (purchaseToken) => {
        const response = await publisher.purchases.subscriptionsv2.get({
          packageName: config.packageName,
          token: purchaseToken,
        });
        return response.data;
      },
      getOneTimeProductPurchase: async (purchaseToken) => {
        const response = await publisher.purchases.productsv2.getproductpurchasev2({
          packageName: config.packageName,
          token: purchaseToken,
        });
        return response.data;
      },
    });
  }

  public async verifyPurchase(input: { purchaseToken: string }): Promise<VerifiedStorePurchase> {
    try {
      const subscription = await this.api.getSubscriptionPurchase(input.purchaseToken);
      return parseSubscriptionPurchase(subscription, input.purchaseToken);
    } catch (error) {
      if (!isProductTypeMismatchError(error)) {
        throw new ValidationError('Store purchase could not be verified');
      }
    }

    try {
      const oneTimePurchase = await this.api.getOneTimeProductPurchase(input.purchaseToken);
      return parseOneTimePurchase(oneTimePurchase, input.purchaseToken);
    } catch {
      throw new ValidationError('Store purchase could not be verified');
    }
  }
}

const subscriptionPurchaseSchema = z.object({
  subscriptionState: z.string().min(1),
  latestOrderId: z.string().min(1).optional(),
  linkedPurchaseToken: z.string().min(1).optional(),
  lineItems: z
    .array(
      z.object({
        productId: z.string().min(1),
        latestSuccessfulOrderId: z.string().min(1).optional(),
        expiryTime: z.string().min(1).optional(),
        autoRenewingPlan: z
          .object({
            autoRenewEnabled: z.boolean().optional(),
          })
          .optional(),
        deferredItemReplacement: z.object({ productId: z.string().min(1) }).optional(),
      }),
    )
    .min(1)
    .max(10),
  externalAccountIdentifiers: z
    .object({
      obfuscatedExternalAccountId: z.string().min(1).optional(),
    })
    .optional(),
  testPurchase: z.unknown().optional(),
});

const oneTimePurchaseSchema = z.object({
  purchaseStateContext: z.object({ purchaseState: z.string().min(1) }),
  orderId: z.string().min(1).optional(),
  productLineItem: z.array(z.object({ productId: z.string().min(1) })).length(1),
  obfuscatedExternalAccountId: z.string().min(1).optional(),
  testPurchaseContext: z.unknown().optional(),
});

function parseSubscriptionPurchase(value: unknown, purchaseToken: string): VerifiedStorePurchase {
  const parsed = subscriptionPurchaseSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Store purchase could not be verified');
  }
  const item = selectCurrentSubscriptionItem(parsed.data.lineItems);
  const state = googleSubscriptionState(parsed.data.subscriptionState);
  return {
    store: 'google',
    environment: parsed.data.testPurchase === undefined ? 'production' : 'sandbox',
    productId: item.productId,
    externalPurchaseId: purchaseToken,
    transactionId: item.latestSuccessfulOrderId ?? parsed.data.latestOrderId ?? purchaseToken,
    eventId: null,
    state,
    observedAt: new Date(),
    expiresAt: parseGoogleTimestamp(item.expiryTime),
    autoRenewEnabled: item.autoRenewingPlan?.autoRenewEnabled ?? null,
    renewalProductId: item.deferredItemReplacement?.productId ?? null,
    linkedExternalPurchaseId: parsed.data.linkedPurchaseToken ?? null,
    accountBinding: parsed.data.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    isTestPurchase: parsed.data.testPurchase !== undefined,
    providerEventType: 'google.play.subscription',
  };
}

function parseOneTimePurchase(value: unknown, purchaseToken: string): VerifiedStorePurchase {
  const parsed = oneTimePurchaseSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Store purchase could not be verified');
  }
  return {
    store: 'google',
    environment: parsed.data.testPurchaseContext === undefined ? 'production' : 'sandbox',
    productId: parsed.data.productLineItem[0].productId,
    externalPurchaseId: purchaseToken,
    transactionId: parsed.data.orderId ?? purchaseToken,
    eventId: null,
    state: googleOneTimeState(parsed.data.purchaseStateContext.purchaseState),
    observedAt: new Date(),
    expiresAt: null,
    autoRenewEnabled: null,
    renewalProductId: null,
    linkedExternalPurchaseId: null,
    accountBinding: parsed.data.obfuscatedExternalAccountId ?? null,
    isTestPurchase: parsed.data.testPurchaseContext !== undefined,
    providerEventType: 'google.play.one_time',
  };
}

function selectCurrentSubscriptionItem(
  items: Array<z.infer<typeof subscriptionPurchaseSchema>['lineItems'][number]>,
): z.infer<typeof subscriptionPurchaseSchema>['lineItems'][number] {
  const purchasedItems = items.filter((item) => item.latestSuccessfulOrderId !== undefined);
  if (purchasedItems.length === 1) {
    return purchasedItems[0];
  }
  if (items.length === 1) {
    return items[0];
  }
  throw new ValidationError('Store purchase could not be verified');
}

function googleSubscriptionState(value: string): StorePurchaseState {
  switch (value) {
    case 'SUBSCRIPTION_STATE_PENDING':
    case 'SUBSCRIPTION_STATE_PAUSED':
    case 'SUBSCRIPTION_STATE_ON_HOLD':
      return 'pending';
    case 'SUBSCRIPTION_STATE_ACTIVE':
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
      return 'active';
    case 'SUBSCRIPTION_STATE_CANCELED':
      return 'cancelled';
    case 'SUBSCRIPTION_STATE_EXPIRED':
      return 'expired';
    case 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED':
      return 'cancelled';
    default:
      return 'failed';
  }
}

function googleOneTimeState(value: string): StorePurchaseState {
  switch (value) {
    case 'PURCHASED':
    case 'PURCHASE_STATE_PURCHASED':
      return 'active';
    case 'PENDING':
    case 'PURCHASE_STATE_PENDING':
      return 'pending';
    case 'CANCELLED':
    case 'PURCHASE_STATE_CANCELLED':
      return 'cancelled';
    default:
      return 'failed';
  }
}

function parseGoogleTimestamp(value: string | undefined): Date | null {
  if (value === undefined) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError('Store purchase could not be verified');
  }
  return date;
}

type GoogleAuthCredentials = NonNullable<
  NonNullable<ConstructorParameters<typeof google.auth.GoogleAuth>[0]>['credentials']
>;

function parseServiceAccountCredentials(value: string): GoogleAuthCredentials {
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    if (!isServiceAccountCredentials(parsed)) {
      throw new Error('invalid service account');
    }
    return parsed;
  } catch {
    throw new ValidationError('Mobile store billing configuration is invalid');
  }
}

function isServiceAccountCredentials(value: unknown): value is GoogleAuthCredentials {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.client_email === 'string' &&
    record.client_email.length > 0 &&
    typeof record.private_key === 'string' &&
    record.private_key.length > 0
  );
}

function isProductTypeMismatchError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const response = (error as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null) {
    return false;
  }
  const status = (response as { status?: unknown }).status;
  return status === 400 || status === 404;
}
