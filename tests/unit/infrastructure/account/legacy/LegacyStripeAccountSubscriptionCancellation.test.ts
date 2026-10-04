import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LegacyStripeAccountSubscriptionCancellation } from '../../../../../src/infrastructure/account/legacy/LegacyStripeAccountSubscriptionCancellation.js';

class FakeSubscriptions {
  public readonly cancelCalls: Array<{ id: string; options: { idempotencyKey: string; timeout: number; maxNetworkRetries: number } }> = [];
  public readonly retrieveCalls: Array<{ id: string; options: { timeout: number; maxNetworkRetries: number } }> = [];
  public cancelError: unknown = null;
  public retrieveError: unknown = null;
  public retrieveResult: { status: string } = { status: 'active' };

  public async cancel(id: string, _params: Record<string, never>, options: { idempotencyKey: string; timeout: number; maxNetworkRetries: number }): Promise<void> {
    this.cancelCalls.push({ id, options });
    if (this.cancelError !== null) throw this.cancelError;
  }

  public async retrieve(id: string, options: { timeout: number; maxNetworkRetries: number }): Promise<{ status: string }> {
    this.retrieveCalls.push({ id, options });
    if (this.retrieveError !== null) throw this.retrieveError;
    return this.retrieveResult;
  }
}

describe('LegacyStripeAccountSubscriptionCancellation', () => {
  it('正規化したsubscription IDのstable key、retry 0、残り期限以下timeoutで解約する', async () => {
    const subscriptions = new FakeSubscriptions();
    const adapter = new LegacyStripeAccountSubscriptionCancellation({ subscriptions }, { timeoutMs: 10_000 });
    await adapter.cancelPersonalSubscription(' sub_legacy_1 ', context(Date.now() + 40));

    expect(subscriptions.cancelCalls).toEqual([{
      id: 'sub_legacy_1',
      options: {
        idempotencyKey: `lyra-account-delete-${createHash('sha256').update('sub_legacy_1', 'utf8').digest('hex')}`,
        timeout: expect.any(Number),
        maxNetworkRetries: 0,
      },
    }]);
    expect(subscriptions.cancelCalls[0]?.options.timeout).toBeLessThanOrEqual(40);
  });

  it('abort済みまたは期限切れではStripeを呼ばない', async () => {
    const subscriptions = new FakeSubscriptions();
    const adapter = new LegacyStripeAccountSubscriptionCancellation({ subscriptions });
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.cancelPersonalSubscription('sub_legacy_1', { signal: controller.signal, deadlineAt: Date.now() + 100 })).rejects.toThrow('Legacy Stripe');
    expect(await adapter.reconcilePersonalSubscriptionCancellation('sub_legacy_1', context(Date.now() - 1))).toBe('unknown');
    expect(subscriptions.cancelCalls).toEqual([]);
    expect(subscriptions.retrieveCalls).toEqual([]);
  });

  it('canceled又はresource_missingだけを照合済みにしprovider詳細を漏らさない', async () => {
    const subscriptions = new FakeSubscriptions();
    const adapter = new LegacyStripeAccountSubscriptionCancellation({ subscriptions });
    subscriptions.retrieveResult = { status: 'canceled' };
    expect(await adapter.reconcilePersonalSubscriptionCancellation('sub_legacy_1', context())).toBe('applied');
    subscriptions.retrieveResult = { status: 'active' };
    expect(await adapter.reconcilePersonalSubscriptionCancellation('sub_sensitive_42', context())).toBe('unknown');
    subscriptions.retrieveError = { code: 'resource_missing', message: 'raw sub_sensitive_42' };
    expect(await adapter.reconcilePersonalSubscriptionCancellation('sub_sensitive_42', context())).toBe('applied');
    subscriptions.retrieveError = { message: 'raw provider timeout sub_sensitive_42' };
    expect(await adapter.reconcilePersonalSubscriptionCancellation('sub_sensitive_42', context())).toBe('unknown');
    subscriptions.cancelError = { message: 'provider raw sub_sensitive_42' };
    const failure = await adapter.cancelPersonalSubscription('sub_sensitive_42', context()).catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: 'Legacy Stripe account subscription cancellation failed' });
    expect(failure).not.toMatchObject({ message: expect.stringContaining('sub_sensitive_42') });
  });
});

function context(deadlineAt = Date.now() + 1_000): { signal: AbortSignal; deadlineAt: number } {
  return { signal: new AbortController().signal, deadlineAt };
}
