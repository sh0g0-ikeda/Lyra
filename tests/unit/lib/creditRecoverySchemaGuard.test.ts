import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { assertCreditRecoverySchema } from '../../../src/lib/creditRecoverySchemaGuard.js';
import { STRIPE_RECOVERY_SCHEMA } from '../../../src/lib/stripeRecoverySchemaDescriptor.js';

function database(receipt = true, tamper?: 'columns' | 'constraints' | 'indexes'): TransactionRunner {
  const query: DatabaseClient['query'] = async <R extends QueryResultRow>(sql: string): Promise<QueryResult<R>> => {
    let rows: unknown[];
    if (sql === 'SET TRANSACTION READ ONLY') rows = [];
    else if (sql.includes('FROM schema_migrations')) rows = receipt ? [{ filename: '049_add_stripe_credit_recovery.sql' }] : [];
    else {
      const part = sql.includes('FROM information_schema.columns') ? 'columns' : sql.includes('FROM pg_constraint') ? 'constraints' : 'indexes';
      rows = structuredClone([...STRIPE_RECOVERY_SCHEMA[part]]);
      if (tamper === part) rows.pop();
    }
    return { rows: rows as R[], rowCount: rows.length, command: 'SELECT', fields: [], oid: 0 };
  };
  return { transaction: async work => work({ query }) };
}

describe('返金回収schemaの起動条件', () => {
  it('049未適用の場合に起動前に拒否する', async () => {
    await expect(assertCreditRecoverySchema(database(false))).rejects.toThrow('049');
  });
  it.each(['columns', 'constraints', 'indexes'] as const)('%sが欠落した場合にreceiptだけでは起動しない', async part => {
    await expect(assertCreditRecoverySchema(database(true, part))).rejects.toThrow('049');
  });
  it('049の完全な構造の場合に起動できる', async () => {
    await expect(assertCreditRecoverySchema(database())).resolves.toBeUndefined();
  });
});
