import { createHash } from 'node:crypto';
import { ConfigurationError, ValidationError } from '../../../domain/errors/index.js';
import type { LegacyAccountSubscriptionCancellationPort } from '../../../legacy/account/LegacyAccountDeletionServiceAdapter.js';
import type {
  LegacyAccountDeletionExternalCallContext,
  LegacyAccountDeletionExternalEffectState,
} from '../../../legacy/account/LegacyAccountDeletionTypes.js';

interface LegacyStripeClient {
  subscriptions: {
    cancel(
      subscriptionId: string,
      params: Record<string, never>,
      options: { idempotencyKey: string; timeout: number; maxNetworkRetries: number },
    ): Promise<unknown>;
    retrieve(
      subscriptionId: string,
      options: { timeout: number; maxNetworkRetries: number },
    ): Promise<{ status?: string }>;
  };
}

/**
 * Legacy profile provider boundary: it only makes bounded provider calls and
 * reports certainty through the legacy port; it does not enable runtime wiring.
 */
export class LegacyStripeAccountSubscriptionCancellation
implements LegacyAccountSubscriptionCancellationPort {
  private readonly timeoutMs: number;

  public constructor(
    private readonly client: LegacyStripeClient,
    options: { timeoutMs?: number } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) {
      throw new ConfigurationError('Legacy Stripe account cancellation timeout is invalid');
    }
  }

  public async cancelPersonalSubscription(
    subscriptionId: string,
    context: LegacyAccountDeletionExternalCallContext,
  ): Promise<void> {
    const normalizedSubscriptionId = normalizeSubscriptionId(subscriptionId);
    const timeout = this.timeoutFor(context);
    try {
      await this.client.subscriptions.cancel(normalizedSubscriptionId, {}, {
        idempotencyKey: `lyra-account-delete-${createHash('sha256')
          .update(normalizedSubscriptionId, 'utf8')
          .digest('hex')}`,
        timeout,
        maxNetworkRetries: 0,
      });
    } catch (error: unknown) {
      if (isMissingStripeResource(error)) return;
      throw new ConfigurationError('Legacy Stripe account subscription cancellation failed');
    }
  }

  public async reconcilePersonalSubscriptionCancellation(
    subscriptionId: string,
    context: LegacyAccountDeletionExternalCallContext,
  ): Promise<LegacyAccountDeletionExternalEffectState> {
    const normalizedSubscriptionId = normalizeSubscriptionId(subscriptionId);
    let timeout: number;
    try {
      timeout = this.timeoutFor(context);
    } catch {
      return 'unknown';
    }
    try {
      const subscription = await this.client.subscriptions.retrieve(normalizedSubscriptionId, {
        timeout,
        maxNetworkRetries: 0,
      });
      return subscription.status === 'canceled' ? 'applied' : 'unknown';
    } catch (error: unknown) {
      return isMissingStripeResource(error) ? 'applied' : 'unknown';
    }
  }

  private timeoutFor(context: LegacyAccountDeletionExternalCallContext): number {
    const remainingMs = context.deadlineAt - Date.now();
    if (context.signal.aborted || !Number.isFinite(remainingMs) || remainingMs <= 0) {
      throw new ConfigurationError('Legacy Stripe account cancellation deadline expired');
    }
    return Math.max(1, Math.min(this.timeoutMs, Math.floor(remainingMs)));
  }
}

function normalizeSubscriptionId(subscriptionId: string): string {
  const normalized = subscriptionId.trim();
  if (normalized.length === 0 || normalized.length > 255) {
    throw new ValidationError('Legacy Stripe subscription id is invalid');
  }
  return normalized;
}

function isMissingStripeResource(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && error.code === 'resource_missing';
}
