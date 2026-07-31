import { describe, expect, it } from 'vitest';
import { StripeAccountSubscriptionCancellation } from '../../../../src/infrastructure/stripe/StripeAccountSubscriptionCancellation.js';

class FakeSubscriptions {
  public readonly calls: Array<{
    id: string;
    options: { idempotencyKey?: string };
  }> = [];
  public error: unknown = null;

  public async cancel(
    id: string,
    _params: Record<string, never>,
    options: { idempotencyKey?: string },
  ): Promise<void> {
    this.calls.push({ id, options });
    if (this.error !== null) {
      throw this.error;
    }
  }
}

describe('StripeAccountSubscriptionCancellation', () => {
  it('subscription単位のstable idempotency keyで即時解約する', async () => {
    const subscriptions = new FakeSubscriptions();
    const adapter = new StripeAccountSubscriptionCancellation({ subscriptions });

    await adapter.cancelPersonalSubscription('sub_personal_1');
    await adapter.cancelPersonalSubscription('sub_personal_1');

    expect(subscriptions.calls).toHaveLength(2);
    expect(subscriptions.calls[0]?.id).toBe('sub_personal_1');
    expect(subscriptions.calls[0]?.options.idempotencyKey).toBe(
      subscriptions.calls[1]?.options.idempotencyKey,
    );
  });

  it('providerで既に消えているsubscriptionは冪等成功にする', async () => {
    const subscriptions = new FakeSubscriptions();
    subscriptions.error = { code: 'resource_missing' };
    const adapter = new StripeAccountSubscriptionCancellation({ subscriptions });

    await expect(
      adapter.cancelPersonalSubscription('sub_personal_1'),
    ).resolves.toBeUndefined();
  });
});
