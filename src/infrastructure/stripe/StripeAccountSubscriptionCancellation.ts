import { createHash } from 'node:crypto';
import Stripe from 'stripe';
import { ValidationError } from '../../domain/errors/index.js';
import type { AccountSubscriptionCancellationPort } from '../../services/account/AccountDeletionService.js';

interface StripeSubscriptionsClient {
  subscriptions: {
    cancel(
      subscriptionId: string,
      params: Record<string, never>,
      options: { idempotencyKey: string },
    ): Promise<unknown>;
  };
}

export class StripeAccountSubscriptionCancellation
implements AccountSubscriptionCancellationPort {
  public constructor(private readonly client: StripeSubscriptionsClient) {}

  public async cancelPersonalSubscription(
    subscriptionId: string,
  ): Promise<void> {
    const normalized = subscriptionId.trim();
    if (normalized.length === 0 || normalized.length > 255) {
      throw new ValidationError('Stripe subscription id is invalid');
    }

    try {
      await this.client.subscriptions.cancel(
        normalized,
        {},
        {
          idempotencyKey: `lyra-account-delete-${createHash('sha256')
            .update(normalized, 'utf8')
            .digest('hex')}`,
        },
      );
    } catch (error) {
      if (!isMissingStripeResource(error)) {
        throw error;
      }
    }
  }
}

export function createStripeAccountSubscriptionCancellation(
  secretKey: string,
): StripeAccountSubscriptionCancellation {
  return new StripeAccountSubscriptionCancellation(
    new Stripe(secretKey, {
      maxNetworkRetries: 2,
      timeout: 30_000,
    }),
  );
}

function isMissingStripeResource(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'resource_missing'
  );
}
