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
});
