import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresStorePurchaseRepository } from '../../../src/repositories/StorePurchaseRepository.js';

describe('PostgresStorePurchaseRepository', () => {
  it('serializes concurrent claims for the same keyed external purchase before lookup', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStorePurchaseRepository(new PassthroughTransactionRunner());

    await repository.lockPurchaseKey('google', 'keyed-purchase-token', client);

    expect(client.queries[0]).toContain('pg_advisory_xact_lock');
    expect(client.valuesList[0]).toEqual(['google:keyed-purchase-token']);
  });

  it('locks a keyed store purchase before applying a state transition', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStorePurchaseRepository(new PassthroughTransactionRunner());

    const purchase = await repository.findPurchaseForUpdate('apple', 'keyed-purchase-id', client);

    expect(purchase).toMatchObject({
      userId: '11111111-1111-4111-8111-111111111111',
      externalPurchaseKey: 'keyed-purchase-id',
      state: 'active',
    });
    expect(client.queries[0]).toContain('FROM mobile_store_purchases');
    expect(client.queries[0]).toContain('FOR UPDATE');
    expect(client.valuesList[0]).toEqual(['apple', 'keyed-purchase-id']);
  });

  it('uses database conflict barriers for provider event and transaction operation duplicates', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStorePurchaseRepository(new PassthroughTransactionRunner());

    const recorded = await repository.recordEventIfNew(
      {
        purchaseId: 'purchase-1',
        store: 'google',
        eventKey: 'keyed-message-id',
        transactionKey: 'keyed-order-id',
        operation: 'grant',
        providerEventType: 'google.subscription.2',
        state: 'active',
        occurredAt: new Date('2026-07-25T00:00:00.000Z'),
      },
      client,
    );

    expect(recorded).toBe(true);
    expect(client.queries[0]).toContain('INSERT INTO mobile_store_purchase_events');
    expect(client.queries[0]).toContain('ON CONFLICT DO NOTHING');
    expect(client.valuesList[0]).toEqual([
      'purchase-1',
      'google',
      'keyed-message-id',
      'keyed-order-id',
      'grant',
      'google.subscription.2',
      'active',
      new Date('2026-07-25T00:00:00.000Z'),
    ]);
  });

  it('does not overwrite enterprise user plan code while refreshing a personal store entitlement', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStorePurchaseRepository(new PassthroughTransactionRunner());

    await repository.updatePersonalPlan('user-1', 'premium', client);

    expect(client.queries[0]).toContain("WHEN plan_code IN ('free', 'standard', 'premium') THEN $2");
    expect(client.valuesList[0]).toEqual(['user-1', 'premium']);
  });
});

class QueryCapturingClient implements DatabaseClient {
  public readonly queries: string[] = [];
  public readonly valuesList: Array<readonly unknown[] | undefined> = [];

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.valuesList.push(values);
    if (text.includes('SELECT') && text.includes('mobile_store_purchases')) {
      return result([
        {
          id: 'purchase-1',
          user_id: '11111111-1111-4111-8111-111111111111',
          store: 'apple',
          environment: 'sandbox',
          external_purchase_key: 'keyed-purchase-id',
          product_id: 'jp.lyra.credits.200',
          kind: 'credit_pack',
          plan_code: null,
          credit_package_code: 'credits_200',
          state: 'active',
          transaction_key: 'keyed-transaction-id',
          expires_at: null,
          auto_renew_enabled: null,
          granted_credits: 10,
          reversed_credits: 0,
          last_observed_at: new Date('2026-07-25T00:00:00.000Z'),
        },
      ] as unknown as T[]);
    }
    if (text.includes('RETURNING id')) {
      return result([{ id: 'event-1' }] as unknown as T[]);
    }
    return result([] as T[]);
  }
}

class PassthroughTransactionRunner implements TransactionRunner {
  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(new QueryCapturingClient());
  }
}

function result<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}
