import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient } from '../../../src/lib/db.js';
import { PostgresBillingRepository } from '../../../src/repositories/BillingRepository.js';

class QueryCapturingClient implements DatabaseClient {
  public queries: string[] = [];
  public values: Array<readonly unknown[] | undefined> = [];
  public rowCount = 1;
  public rows: QueryResultRow[] = [];

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.values.push(values);

    return {
      command: 'SELECT',
      rowCount: this.rowCount,
      oid: 0,
      fields: [],
      rows: this.rows as T[],
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

describe('PostgresBillingRepository', () => {
  it('billing user profile を取得する', async () => {
    const client = new QueryCapturingClient();
    client.rows = [
      {
        id: 'user-1',
        email: 'user@example.com',
        stripe_customer_id: 'cus_123',
        plan_code: 'standard',
      },
    ];
    const repository = new PostgresBillingRepository(client, client);

    const result = await repository.findBillingUserProfile('user-1');

    expect(client.queries[0]).toContain('FROM users');
    expect(client.values[0]).toEqual(['user-1']);
    expect(result).toEqual({
      userId: 'user-1',
      email: 'user@example.com',
      stripeCustomerId: 'cus_123',
      planCode: 'standard',
    });
  });

  it('processed event は ON CONFLICT DO NOTHING で冪等化する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresBillingRepository(client, client);

    const result = await repository.markStripeEventProcessed('evt_1', 'invoice.paid', client);

    expect(result).toBe(true);
    expect(client.queries[0]).toContain('processed_stripe_events');
    expect(client.queries[0]).toContain('ON CONFLICT');
    expect(client.values[0]).toEqual(['evt_1', 'invoice.paid']);
  });

  it('subscription を upsert する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresBillingRepository(client, client);

    await repository.upsertSubscription(
      {
        userId: 'user-1',
        stripeSubscriptionId: 'sub_123',
        planCode: 'premium',
        status: 'active',
        currentPeriodStart: new Date('2026-04-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-05-01T00:00:00.000Z'),
        cancelAtPeriodEnd: false,
      },
      client,
    );

    expect(client.queries[0]).toContain('INSERT INTO subscriptions');
    expect(client.queries[0]).toContain('ON CONFLICT (stripe_subscription_id)');
    expect(client.values[0]).toEqual([
      'user-1',
      'sub_123',
      'premium',
      'active',
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-05-01T00:00:00.000Z'),
      false,
    ]);
  });

  it('payment record を保存する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresBillingRepository(client, client);

    const inserted = await repository.insertPaymentRecord(
      {
        userId: 'user-1',
        stripeCheckoutSessionId: 'cs_123',
        stripeInvoiceId: null,
        kind: 'credit_purchase',
        amountJpy: 2000,
        status: 'paid',
      },
      client,
    );

    expect(inserted).toBe(true);
    expect(client.queries[0]).toContain('INSERT INTO payment_records');
    expect(client.queries[0]).toContain('ON CONFLICT DO NOTHING');
    expect(client.values[0]).toEqual(['user-1', 'cs_123', null, 'credit_purchase', 2000, 'paid']);
  });

  it('重複 payment record は false を返す', async () => {
    const client = new QueryCapturingClient();
    client.rowCount = 0;
    const repository = new PostgresBillingRepository(client, client);

    const inserted = await repository.insertPaymentRecord(
      {
        userId: 'user-1',
        stripeCheckoutSessionId: 'cs_123',
        stripeInvoiceId: null,
        kind: 'credit_purchase',
        amountJpy: 2000,
        status: 'paid',
      },
      client,
    );

    expect(inserted).toBe(false);
  });
});
