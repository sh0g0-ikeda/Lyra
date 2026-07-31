import { Buffer } from 'node:buffer';
import { GoogleAuth, type JWTInput } from 'google-auth-library';
import { z } from 'zod';
import { ValidationError } from '../../domain/errors/index.js';
import type {
  StorePurchaseState,
  VerifiedStorePurchase,
} from '../../domain/storePurchase.js';
import type {
  GooglePlayPurchaseVerifierPort,
  GoogleProviderCompletionInput,
} from '../../services/billing/MobileStorePurchaseService.js';

export interface GooglePlayDeveloperApiPort {
  getSubscriptionPurchase(purchaseToken: string): Promise<unknown>;
  getOneTimeProductPurchase(purchaseToken: string): Promise<unknown>;
  acknowledgeSubscription(purchaseToken: string, productId: string): Promise<void>;
  consumeProduct(purchaseToken: string, productId: string): Promise<void>;
}

export interface GooglePlayDeveloperClientConfig {
  packageName: string;
  serviceAccountJsonBase64: string;
  timeoutMs: number;
}

export class GooglePlayDeveloperClient implements GooglePlayPurchaseVerifierPort {
  public constructor(
    private readonly api: GooglePlayDeveloperApiPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public static fromServiceAccount(
    config: GooglePlayDeveloperClientConfig,
  ): GooglePlayDeveloperClient {
    const credentials = parseServiceAccountCredentials(config.serviceAccountJsonBase64);
    const auth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    const baseUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
      config.packageName,
    )}`;

    return new GooglePlayDeveloperClient({
      getSubscriptionPurchase: async (purchaseToken) =>
        requestData(
          auth,
          `${baseUrl}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
          'GET',
          config.timeoutMs,
        ),
      getOneTimeProductPurchase: async (purchaseToken) =>
        requestData(
          auth,
          `${baseUrl}/purchases/productsv2/tokens/${encodeURIComponent(purchaseToken)}`,
          'GET',
          config.timeoutMs,
        ),
      acknowledgeSubscription: async (purchaseToken, productId) => {
        await requestData(
          auth,
          `${baseUrl}/purchases/subscriptions/${encodeURIComponent(
            productId,
          )}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
          'POST',
          config.timeoutMs,
        );
      },
      consumeProduct: async (purchaseToken, productId) => {
        await requestData(
          auth,
          `${baseUrl}/purchases/products/${encodeURIComponent(
            productId,
          )}/tokens/${encodeURIComponent(purchaseToken)}:consume`,
          'POST',
          config.timeoutMs,
        );
      },
    });
  }

  public async verifyPurchase(input: {
    purchaseToken: string;
  }): Promise<VerifiedStorePurchase> {
    try {
      const subscription = await this.api.getSubscriptionPurchase(input.purchaseToken);
      return parseSubscriptionPurchase(subscription, input.purchaseToken, this.clock());
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw new ValidationError('Store purchase could not be verified');
      }
    }

    try {
      const oneTime = await this.api.getOneTimeProductPurchase(input.purchaseToken);
      return parseOneTimePurchase(oneTime, input.purchaseToken, this.clock());
    } catch {
      throw new ValidationError('Store purchase could not be verified');
    }
  }

  public async completePurchase(input: GoogleProviderCompletionInput): Promise<void> {
    try {
      if (input.completion === 'acknowledge') {
        await this.api.acknowledgeSubscription(input.purchaseToken, input.productId);
      } else if (input.completion === 'consume') {
        await this.api.consumeProduct(input.purchaseToken, input.productId);
      }
    } catch {
      throw new ValidationError('Store purchase completion could not be confirmed');
    }
  }
}

const subscriptionPurchaseSchema = z.object({
  subscriptionState: z.string().min(1),
  latestOrderId: z.string().min(1).nullish(),
  linkedPurchaseToken: z.string().min(1).nullish(),
  acknowledgementState: z.string().min(1).nullish(),
  lineItems: z
    .array(
      z.object({
        productId: z.string().min(1),
        latestSuccessfulOrderId: z.string().min(1).nullish(),
        expiryTime: z.string().min(1).nullish(),
        autoRenewingPlan: z
          .object({
            autoRenewEnabled: z.boolean().optional(),
          })
          .nullish(),
      }),
    )
    .length(1),
  externalAccountIdentifiers: z
    .object({
      obfuscatedExternalAccountId: z.string().min(1).optional(),
    })
    .nullish(),
  testPurchase: z.unknown().nullish(),
});

const oneTimePurchaseSchema = z.object({
  purchaseStateContext: z.object({ purchaseState: z.string().min(1) }),
  acknowledgementState: z.string().min(1).nullish(),
  purchaseCompletionTime: z.string().min(1).nullish(),
  orderId: z.string().min(1).nullish(),
  productLineItem: z
    .array(
      z.object({
        productId: z.string().min(1),
        productOfferDetails: z
          .object({
            quantity: z.number().int().positive().optional(),
            consumptionState: z.string().min(1).nullish(),
          })
          .nullish(),
      }),
    )
    .length(1),
  obfuscatedExternalAccountId: z.string().min(1).nullish(),
  testPurchaseContext: z.unknown().nullish(),
});

function parseSubscriptionPurchase(
  value: unknown,
  purchaseToken: string,
  observedAt: Date,
): VerifiedStorePurchase {
  const parsed = subscriptionPurchaseSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Store purchase could not be verified');
  }
  const item = parsed.data.lineItems[0];
  const state = googleSubscriptionState(parsed.data.subscriptionState);

  return {
    store: 'google',
    environment: parsed.data.testPurchase == null ? 'production' : 'sandbox',
    productId: item.productId,
    externalPurchaseId: purchaseToken,
    linkedExternalPurchaseId: parsed.data.linkedPurchaseToken ?? null,
    transactionId:
      item.latestSuccessfulOrderId ?? parsed.data.latestOrderId ?? purchaseToken,
    eventId: null,
    state,
    observedAt,
    expiresAt: parseGoogleTimestamp(item.expiryTime ?? undefined),
    autoRenewEnabled: item.autoRenewingPlan?.autoRenewEnabled ?? null,
    accountBinding:
      parsed.data.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    isTestPurchase: parsed.data.testPurchase != null,
    providerEventType: 'google.play.subscription',
    providerCompletion:
      state === 'active' &&
      parsed.data.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'
        ? 'acknowledge'
        : 'none',
  };
}

function parseOneTimePurchase(
  value: unknown,
  purchaseToken: string,
  fallbackObservedAt: Date,
): VerifiedStorePurchase {
  const parsed = oneTimePurchaseSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Store purchase could not be verified');
  }
  const item = parsed.data.productLineItem[0];
  if ((item.productOfferDetails?.quantity ?? 1) !== 1) {
    throw new ValidationError('Store purchase could not be verified');
  }
  const state = googleOneTimeState(parsed.data.purchaseStateContext.purchaseState);
  const observedAt =
    parseGoogleTimestamp(parsed.data.purchaseCompletionTime ?? undefined) ??
    fallbackObservedAt;

  return {
    store: 'google',
    environment: parsed.data.testPurchaseContext == null ? 'production' : 'sandbox',
    productId: item.productId,
    externalPurchaseId: purchaseToken,
    linkedExternalPurchaseId: null,
    transactionId: parsed.data.orderId ?? purchaseToken,
    eventId: null,
    state,
    observedAt,
    expiresAt: null,
    autoRenewEnabled: null,
    accountBinding: parsed.data.obfuscatedExternalAccountId ?? null,
    isTestPurchase: parsed.data.testPurchaseContext != null,
    providerEventType: 'google.play.one_time',
    providerCompletion:
      state === 'active' &&
      item.productOfferDetails?.consumptionState !== 'CONSUMPTION_STATE_CONSUMED'
        ? 'consume'
        : 'none',
  };
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
    case 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED':
      return 'cancelled';
    case 'SUBSCRIPTION_STATE_EXPIRED':
      return 'expired';
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

function parseServiceAccountCredentials(value: string): JWTInput {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
    if (!isServiceAccountCredentials(parsed)) {
      throw new Error('invalid service account');
    }
    return parsed;
  } catch {
    throw new ValidationError('Mobile store billing configuration is invalid');
  }
}

function isServiceAccountCredentials(value: unknown): value is JWTInput {
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

async function requestData(
  auth: GoogleAuth,
  url: string,
  method: 'GET' | 'POST',
  timeoutMs: number,
): Promise<unknown> {
  const response = await auth.request<unknown>({
    url,
    method,
    timeout: timeoutMs,
    data: method === 'POST' ? {} : undefined,
  });
  return response.data;
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as {
    code?: unknown;
    response?: { status?: unknown };
  };
  return candidate.code === 404 || candidate.response?.status === 404;
}
