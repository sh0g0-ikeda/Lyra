import {
  buildGenerationJobNotificationContent,
  type PushNotificationDelivery,
} from '../../domain/pushNotification.js';
import type { PushTokenCipherPort } from './PushTokenCipherPort.js';
import {
  PushProviderError,
  type NativePushProviderPort,
} from './NativePushProvider.js';

const DEFAULT_BATCH_SIZE = 50;
const BASE_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

export interface PushNotificationOutboxRepositoryPort {
  claimPending(limit: number): Promise<PushNotificationDelivery[]>;
  markSent(deliveryId: string, leaseToken: string): Promise<boolean>;
  markRetry(
    deliveryId: string,
    leaseToken: string,
    errorCode: string,
    availableAt: Date,
  ): Promise<boolean>;
  markDead(deliveryId: string, leaseToken: string, errorCode: string): Promise<boolean>;
  deletePushToken(pushTokenId: string): Promise<void>;
}

export interface PushNotificationDispatchResult {
  claimed: number;
  sent: number;
  retried: number;
  dead: number;
  stale: number;
}

interface PushNotificationDeliveryOptions {
  now?: () => Date;
  batchSize?: number;
}

export class PushNotificationDeliveryService {
  private readonly now: () => Date;
  private readonly batchSize: number;

  public constructor(
    private readonly repository: PushNotificationOutboxRepositoryPort,
    private readonly cipher: Pick<PushTokenCipherPort, 'decrypt'>,
    private readonly provider: NativePushProviderPort,
    options: PushNotificationDeliveryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  public async dispatchPending(): Promise<PushNotificationDispatchResult> {
    const deliveries = await this.repository.claimPending(this.batchSize);
    const result: PushNotificationDispatchResult = {
      claimed: deliveries.length,
      sent: 0,
      retried: 0,
      dead: 0,
      stale: 0,
    };

    for (const delivery of deliveries) {
      const outcome = await this.dispatchOne(delivery);
      result[outcome] += 1;
    }

    return result;
  }

  private async dispatchOne(
    delivery: PushNotificationDelivery,
  ): Promise<'sent' | 'retried' | 'dead' | 'stale'> {
    let deviceToken: string;
    try {
      deviceToken = await this.cipher.decrypt({
        ciphertext: delivery.tokenCiphertext,
        keyId: delivery.encryptionKeyId,
      });
    } catch {
      return await this.repository.markDead(
        delivery.deliveryId,
        delivery.leaseToken,
        'token_decryption_failed',
      ) ? 'dead' : 'stale';
    }

    const content = buildGenerationJobNotificationContent(
      delivery.locale,
      delivery.jobStatus,
    );

    try {
      const providerResult = await this.provider.send({
        platform: delivery.platform,
        deviceToken,
        title: content.title,
        body: content.body,
        data: delivery.navigation,
      });
      if (providerResult.outcome === 'invalid_token') {
        const markedDead = await this.repository.markDead(
          delivery.deliveryId,
          delivery.leaseToken,
          'invalid_token',
        );
        if (!markedDead) {
          return 'stale';
        }
        await this.repository.deletePushToken(delivery.pushTokenId);
        return 'dead';
      }
      return await this.repository.markSent(
        delivery.deliveryId,
        delivery.leaseToken,
      ) ? 'sent' : 'stale';
    } catch (error) {
      if (error instanceof PushProviderError && !error.retryable) {
        return await this.repository.markDead(
          delivery.deliveryId,
          delivery.leaseToken,
          error.code,
        ) ? 'dead' : 'stale';
      }
      const errorCode =
        error instanceof PushProviderError ? error.code : 'provider_transport_error';
      return await this.repository.markRetry(
        delivery.deliveryId,
        delivery.leaseToken,
        errorCode,
        new Date(this.now().getTime() + retryDelayMs(delivery.attemptCount)),
      ) ? 'retried' : 'stale';
    }
  }
}

function retryDelayMs(attemptCount: number): number {
  const boundedAttempt = Math.max(1, Math.min(16, Math.floor(attemptCount)));
  return Math.min(
    MAX_RETRY_DELAY_MS,
    BASE_RETRY_DELAY_MS * (2 ** (boundedAttempt - 1)),
  );
}
