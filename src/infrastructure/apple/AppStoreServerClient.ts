import { Environment, SignedDataVerifier } from '@apple/app-store-server-library';
import { ValidationError } from '../../domain/errors/index.js';
import type {
  StorePurchaseEnvironment,
  StorePurchaseState,
  VerifiedStorePurchase,
} from '../../domain/storePurchase.js';
import type { AppleStorePurchaseVerifierPort } from '../../services/billing/MobileStorePurchaseService.js';

export interface AppleStoreServerClientConfig {
  bundleId: string;
  appAppleId: number;
  rootCertificates: Buffer[];
  allowSandbox: boolean;
  allowProduction: boolean;
  timeoutMs: number;
}

export interface AppleDecodedTransaction {
  originalTransactionId?: string;
  transactionId?: string;
  productId?: string;
  appAccountToken?: string;
  signedDate?: number;
  purchaseDate?: number;
  expiresDate?: number;
  revocationDate?: number;
  revocationType?: string;
}

export interface AppleDecodedRenewal {
  autoRenewStatus?: number;
}

export interface AppleDecodedNotification {
  notificationType?: string;
  notificationUUID?: string;
  signedDate?: number;
  data?: {
    environment?: string;
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
  };
}

export interface AppleSignedDataVerifierPort {
  verifyAndDecodeTransaction(signedTransaction: string): Promise<AppleDecodedTransaction>;
  verifyAndDecodeNotification(signedPayload: string): Promise<AppleDecodedNotification>;
  verifyAndDecodeRenewalInfo(signedRenewal: string): Promise<AppleDecodedRenewal>;
}

export interface AppleSignedDataVerifierFactory {
  create(environment: StorePurchaseEnvironment): AppleSignedDataVerifierPort;
}

export class AppStoreServerClient implements AppleStorePurchaseVerifierPort {
  public constructor(
    private readonly config: AppleStoreServerClientConfig,
    private readonly verifierFactory: AppleSignedDataVerifierFactory =
      new OfficialAppleSignedDataVerifierFactory(config),
  ) {}

  public async verifyTransaction(input: {
    signedTransaction: string;
    environment: StorePurchaseEnvironment;
  }): Promise<VerifiedStorePurchase> {
    this.assertEnvironmentEnabled(input.environment);
    try {
      const transaction = await withTimeout(
        this.verifierFactory
          .create(input.environment)
          .verifyAndDecodeTransaction(input.signedTransaction),
        this.config.timeoutMs,
      );
      return toVerifiedPurchase({
        transaction,
        environment: input.environment,
        notificationType: null,
        notificationId: null,
        renewal: null,
      });
    } catch (error) {
      throw toSafeVerificationError(error);
    }
  }

  public async verifyNotification(
    signedPayload: string,
  ): Promise<VerifiedStorePurchase | null> {
    let lastError: unknown = null;
    for (const environment of this.enabledEnvironments()) {
      try {
        const verifier = this.verifierFactory.create(environment);
        const notification = await withTimeout(
          verifier.verifyAndDecodeNotification(signedPayload),
          this.config.timeoutMs,
        );
        if (toStoreEnvironment(notification.data?.environment) !== environment) {
          continue;
        }

        const signedTransaction = notification.data?.signedTransactionInfo;
        if (signedTransaction === undefined || signedTransaction.length === 0) {
          return null;
        }
        const transaction = await withTimeout(
          verifier.verifyAndDecodeTransaction(signedTransaction),
          this.config.timeoutMs,
        );
        const renewal =
          notification.data?.signedRenewalInfo === undefined
            ? null
            : await withTimeout(
                verifier.verifyAndDecodeRenewalInfo(notification.data.signedRenewalInfo),
                this.config.timeoutMs,
              );

        return toVerifiedPurchase({
          transaction,
          environment,
          notificationType: notification.notificationType ?? null,
          notificationId: notification.notificationUUID ?? null,
          notificationSignedAt: notification.signedDate,
          renewal,
        });
      } catch (error) {
        lastError = error;
      }
    }

    throw toSafeVerificationError(lastError);
  }

  private enabledEnvironments(): StorePurchaseEnvironment[] {
    const environments: StorePurchaseEnvironment[] = [];
    if (this.config.allowSandbox) {
      environments.push('sandbox');
    }
    if (this.config.allowProduction) {
      environments.push('production');
    }
    if (environments.length === 0) {
      throw new ValidationError('Store purchase could not be verified');
    }
    return environments;
  }

  private assertEnvironmentEnabled(environment: StorePurchaseEnvironment): void {
    if (
      (environment === 'sandbox' && !this.config.allowSandbox) ||
      (environment === 'production' && !this.config.allowProduction)
    ) {
      throw new ValidationError('Store purchase could not be verified');
    }
  }
}

class OfficialAppleSignedDataVerifierFactory implements AppleSignedDataVerifierFactory {
  public constructor(private readonly config: AppleStoreServerClientConfig) {}

  public create(environment: StorePurchaseEnvironment): AppleSignedDataVerifierPort {
    const officialEnvironment =
      environment === 'sandbox' ? Environment.SANDBOX : Environment.PRODUCTION;
    return new SignedDataVerifier(
      this.config.rootCertificates,
      true,
      officialEnvironment,
      this.config.bundleId,
      environment === 'production' ? this.config.appAppleId : undefined,
    );
  }
}

function toVerifiedPurchase(input: {
  transaction: AppleDecodedTransaction;
  environment: StorePurchaseEnvironment;
  notificationType: string | null;
  notificationId: string | null;
  notificationSignedAt?: number;
  renewal: AppleDecodedRenewal | null;
}): VerifiedStorePurchase {
  const originalTransactionId = requireNonEmptyString(input.transaction.originalTransactionId);
  const transactionId = requireNonEmptyString(input.transaction.transactionId);
  const productId = requireNonEmptyString(input.transaction.productId);
  const observedAt = dateFromUnixMilliseconds(
    input.notificationSignedAt ??
      input.transaction.signedDate ??
      input.transaction.purchaseDate,
  );
  const expiresAt = nullableDateFromUnixMilliseconds(input.transaction.expiresDate);

  return {
    store: 'apple',
    environment: input.environment,
    productId,
    externalPurchaseId: originalTransactionId,
    linkedExternalPurchaseId: null,
    transactionId,
    eventId: input.notificationId,
    state: applePurchaseState({
      transaction: input.transaction,
      notificationType: input.notificationType,
      renewal: input.renewal,
      observedAt,
      expiresAt,
    }),
    observedAt,
    expiresAt,
    autoRenewEnabled:
      input.renewal === null ? null : input.renewal.autoRenewStatus === 1,
    accountBinding: input.transaction.appAccountToken ?? null,
    isTestPurchase: input.environment === 'sandbox',
    providerEventType:
      input.notificationType === null
        ? 'apple.transaction'
        : `apple.${input.notificationType}`,
    providerCompletion: 'none',
  };
}

function applePurchaseState(input: {
  transaction: AppleDecodedTransaction;
  notificationType: string | null;
  renewal: AppleDecodedRenewal | null;
  observedAt: Date;
  expiresAt: Date | null;
}): StorePurchaseState {
  if (
    input.notificationType === 'REVOKE' ||
    input.transaction.revocationType === 'FAMILY_REVOKE'
  ) {
    return 'revoked';
  }
  if (input.notificationType === 'REFUND' || input.transaction.revocationDate !== undefined) {
    return 'refunded';
  }
  if (
    input.notificationType === 'EXPIRED' ||
    input.notificationType === 'GRACE_PERIOD_EXPIRED'
  ) {
    return 'expired';
  }
  if (
    input.expiresAt !== null &&
    input.expiresAt.getTime() <= input.observedAt.getTime()
  ) {
    return 'expired';
  }
  if (input.notificationType === 'DID_CHANGE_RENEWAL_STATUS') {
    return input.renewal?.autoRenewStatus === 0 ? 'cancelled' : 'active';
  }
  return 'active';
}

function toStoreEnvironment(value: string | undefined): StorePurchaseEnvironment | null {
  if (value === 'Sandbox') {
    return 'sandbox';
  }
  if (value === 'Production') {
    return 'production';
  }
  return null;
}

function requireNonEmptyString(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new ValidationError('Store purchase could not be verified');
  }
  return value;
}

function dateFromUnixMilliseconds(value: number | undefined): Date {
  if (value === undefined) {
    throw new ValidationError('Store purchase could not be verified');
  }
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) {
    throw new ValidationError('Store purchase could not be verified');
  }
  return result;
}

function nullableDateFromUnixMilliseconds(value: number | undefined): Date | null {
  return value === undefined ? null : dateFromUnixMilliseconds(value);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('provider timeout')), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function toSafeVerificationError(error: unknown): ValidationError {
  if (error instanceof ValidationError) {
    return error;
  }
  return new ValidationError('Store purchase could not be verified');
}
