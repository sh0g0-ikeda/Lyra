import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { PostgresCreditRepository } from '../../../src/repositories/CreditRepository.js';

class QueryCapturingClient implements DatabaseClient {
  public readonly queries: string[] = [];
  public readonly valuesList: Array<readonly unknown[] | undefined> = [];

  public async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    this.queries.push(text);
    this.valuesList.push(values);

    if (text.includes('SELECT user_id, monthly_credits')) {
      return {
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [
          {
            user_id: 'user-1',
            monthly_credits: 0,
            purchased_credits: 12,
            monthly_expires_at: null,
          },
        ] as unknown as T[],
      };
    }

    if (text.includes('COALESCE(SUM(amount), 0)')) {
      return {
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [{ amount: '15' }] as unknown as T[],
      };
    }

    if (text.includes('SUM(monthly_delta)')) {
      return {
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [
          {
            monthly_delta: '-7',
            purchased_delta: '-3',
            entry_count: '2',
            complete_entry_count: '2',
          },
        ] as unknown as T[],
      };
    }

    return {
      command: 'INSERT',
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [],
    };
  }
}

class PassthroughTransactionRunner implements TransactionRunner {
  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(new QueryCapturingClient());
  }
}

describe('PostgresCreditRepository', () => {
  it('残高行がない初回操作でもFOR UPDATE前にゼロ残高行を用意する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresCreditRepository(client, new PassthroughTransactionRunner());

    const balance = await repository.getBalanceForUpdate('user-1', client);

    expect(client.queries).toHaveLength(2);
    expect(client.queries[0]).toContain('INSERT INTO credit_balances');
    expect(client.queries[0]).toContain('ON CONFLICT (user_id) DO NOTHING');
    expect(client.queries[1]).toContain('FOR UPDATE');
    expect(client.valuesList).toEqual([['user-1'], ['user-1']]);
    expect(balance).toMatchObject({
      userId: 'user-1',
      monthlyCredits: 0,
      purchasedCredits: 12,
      monthlyExpiresAt: null,
    });
  });

  it('指定ユーザーと種別で台帳の存在を確認する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresCreditRepository(client, new PassthroughTransactionRunner());

    const exists = await repository.hasLedgerEntry('user-1', 'signup_bonus', client);

    expect(exists).toBe(true);
    expect(client.queries[0]).toContain('FROM credit_ledger');
    expect(client.queries[0]).toContain('user_id = $1');
    expect(client.queries[0]).toContain('type = $2');
    expect(client.valuesList[0]).toEqual(['user-1', 'signup_bonus']);
  });

  it('指定ユーザー・種別・jobIdで台帳件数を確認する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresCreditRepository(client, new PassthroughTransactionRunner());

    const count = await repository.countJobLedgerEntries('user-1', 'refund', 'job-1', client);

    expect(count).toBe(0);
    expect(client.queries[0]).toContain('FROM credit_ledger');
    expect(client.queries[0]).toContain('user_id = $1');
    expect(client.queries[0]).toContain('type = $2');
    expect(client.queries[0]).toContain('job_id = $3');
    expect(client.valuesList[0]).toEqual(['user-1', 'refund', 'job-1']);
  });

  it('指定ユーザー・種別・jobIdで台帳金額合計を確認する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresCreditRepository(client, new PassthroughTransactionRunner());

    const amount = await repository.sumJobLedgerAmount('user-1', 'consume', 'job-1', client);

    expect(amount).toBe(15);
    expect(client.queries[0]).toContain('FROM credit_ledger');
    expect(client.queries[0]).toContain('COALESCE(SUM(amount), 0)');
    expect(client.queries[0]).toContain('user_id = $1');
    expect(client.queries[0]).toContain('type = $2');
    expect(client.queries[0]).toContain('job_id = $3');
    expect(client.valuesList[0]).toEqual(['user-1', 'consume', 'job-1']);
  });

  it('指定ユーザー・種別・jobIdで台帳bucket delta合計を確認する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresCreditRepository(client, new PassthroughTransactionRunner());

    const summary = await repository.sumJobLedgerBucketDeltas('user-1', 'consume', 'job-1', client);

    expect(summary).toEqual({
      monthlyDelta: -7,
      purchasedDelta: -3,
      entryCount: 2,
      completeEntryCount: 2,
    });
    expect(client.queries[0]).toContain('FROM credit_ledger');
    expect(client.queries[0]).toContain('SUM(monthly_delta)');
    expect(client.queries[0]).toContain('SUM(purchased_delta)');
    expect(client.valuesList[0]).toEqual(['user-1', 'consume', 'job-1']);
  });

  it('台帳作成時にbucket deltaも保存する', async () => {
    const client = new QueryCapturingClient();
    const repository = new PostgresCreditRepository(client, new PassthroughTransactionRunner());

    await repository.insertLedger(
      {
        userId: 'user-1',
        type: 'refund',
        amount: 10,
        monthlyDelta: 4,
        purchasedDelta: 6,
        monthlyAfter: 12,
        purchasedAfter: 20,
        description: 'refund',
        jobId: 'job-1',
      },
      client,
    );

    expect(client.queries[0]).toContain('monthly_delta');
    expect(client.queries[0]).toContain('purchased_delta');
    expect(client.valuesList[0]).toEqual([
      'user-1',
      'refund',
      10,
      4,
      6,
      12,
      20,
      'refund',
      null,
      null,
      'job-1',
    ]);
  });
});
