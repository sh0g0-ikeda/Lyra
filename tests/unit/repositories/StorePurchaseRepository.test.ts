import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresStorePurchaseRepository } from '../../../src/repositories/StorePurchaseRepository.js';

describe('PostgresStorePurchaseRepository', () => {
  it('同じkeyed purchaseの並行claimを検索前に直列化する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStorePurchaseRepository(new PassthroughTransactionRunner());

    await repository.lockPurchaseKey('google', 'keyed-purchase-token', client);

    expect(client.queries[0]).toContain('pg_advisory_xact_lock');
    expect(client.valuesList[0]).toEqual(['google:keyed-purchase-token']);
  });

  it('purchase状態変更前に対象行をFOR UPDATEでlockする', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStorePurchaseRepository(new PassthroughTransactionRunner());

    const purchase = await repository.findPurchaseForUpdate(
      'apple',
      'keyed-purchase-id',
      client,
    );

    expect(purchase).toMatchObject({
      userId: '11111111-1111-4111-8111-111111111111',
      externalPurchaseKey: 'keyed-purchase-id',
      state: 'active',
    });
    expect(client.queries[0]).toContain('FROM mobile_store_purchases');
    expect(client.queries[0]).toContain('FOR UPDATE');
    expect(client.valuesList[0]).toEqual(['apple', 'keyed-purchase-id']);
  });

  it('account deletion開始済みuserはstore entitlementを変更不可として返す', async () => {
    const client = new QueryCapturingClient();
    client.accountDeletionStarted = true;
    const repository = new PostgresStorePurchaseRepository(
      new PassthroughTransactionRunner(),
    );

    const user = await repository.findUserForUpdate('user-1', client);

    expect(client.queries[0]).toContain('account_deletion_started_at');
    expect(client.queries[0]).toContain('FOR UPDATE');
    expect(user).toEqual({
      id: 'user-1',
      planCode: 'free',
      accountDeleted: true,
    });
  });

  it('provider eventとtransaction operationをDB conflict barrierで冪等化する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStorePurchaseRepository(new PassthroughTransactionRunner());
    const occurredAt = new Date('2026-07-31T00:00:00.000Z');

    const recorded = await repository.recordEventIfNew(
      {
        purchaseId: 'purchase-1',
        store: 'google',
        eventKey: 'keyed-message-id',
        transactionKey: 'keyed-order-id',
        operation: 'grant',
        providerEventType: 'google.subscription.2',
        state: 'active',
        occurredAt,
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
      occurredAt,
    ]);
  });

  it('store entitlement更新でenterprise planを上書きしない', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStorePurchaseRepository(new PassthroughTransactionRunner());

    await repository.updatePersonalPlan('user-1', 'premium', client);

    expect(client.queries[0]).toContain(
      "WHEN plan_code IN ('free', 'standard', 'premium') THEN $2",
    );
    expect(client.valuesList[0]).toEqual(['user-1', 'premium']);
  });

  it('有効期限内のcancelledを含む検証済みstore購読だけをsummaryへ返す', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresStorePurchaseRepository(new PassthroughTransactionRunner());

    await repository.findLatestStoreSubscriptionForUser('user-1', client);

    expect(client.queries[0]).toContain("kind = 'subscription'");
    expect(client.queries[0]).toContain("state = 'active'");
    expect(client.queries[0]).toContain("state = 'cancelled'");
    expect(client.queries[0]).toContain('expires_at > NOW()');
    expect(client.valuesList[0]).toEqual(['user-1']);
  });
});

class QueryCapturingClient implements DatabaseClient {
  public readonly queries: string[] = [];
  public readonly valuesList: Array<readonly unknown[] | undefined> = [];
  public accountDeletionStarted = false;

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.valuesList.push(values);
    if (text.includes('FROM users')) {
      return result([
        {
          id: 'user-1',
          plan_code: 'free',
          account_deletion_started_at: this.accountDeletionStarted
            ? new Date('2026-07-31T00:00:00.000Z')
            : null,
          account_deleted_at: null,
        },
      ] as unknown as T[]);
    }
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
          last_observed_at: new Date('2026-07-31T00:00:00.000Z'),
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
