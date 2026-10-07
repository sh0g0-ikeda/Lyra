import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseClient, TransactionRunner } from '../../../src/lib/db.js';
import { assertCreditRecoverySchema } from '../../../src/lib/creditRecoverySchemaGuard.js';
import { STRIPE_RECOVERY_SCHEMA } from '../../../src/lib/stripeRecoverySchemaDescriptor.js';

type Tamper =
  | 'column-nullability'
  | 'non-not-null-constraint'
  | 'not-null-constraint'
  | 'not-null-validation'
  | 'index';

function database({
  receipt = true,
  serverVersion = '180003',
  tamper,
}: {
  receipt?: boolean;
  serverVersion?: string;
  tamper?: Tamper;
} = {}): TransactionRunner {
  const query: DatabaseClient['query'] = async <R extends QueryResultRow>(sql: string): Promise<QueryResult<R>> => {
    let rows: unknown[];
    if (sql === 'SET TRANSACTION READ ONLY') rows = [];
    else if (sql.includes("current_setting('server_version_num')")) rows = [{ serverVersionNum: serverVersion }];
    else if (sql.includes('FROM schema_migrations')) rows = receipt ? [{ filename: '049_add_stripe_credit_recovery.sql' }] : [];
    else {
      const part = sql.includes('FROM information_schema.columns') ? 'columns' : sql.includes('FROM pg_constraint') ? 'constraints' : 'indexes';
      rows = structuredClone([...STRIPE_RECOVERY_SCHEMA[part]]);
      if (part === 'constraints' && Number(serverVersion) < 180000) {
        rows = (rows as Array<{ type: string }>).filter(row => row.type !== 'n');
      }
      if (tamper === 'column-nullability' && part === 'columns') {
        const required = (rows as Array<{ nullable: boolean }>).find(row => row.nullable === false);
        if (required !== undefined) required.nullable = true;
      }
      if (tamper === 'non-not-null-constraint' && part === 'constraints') {
        const index = (rows as Array<{ type: string }>).findIndex(row => row.type !== 'n');
        rows.splice(index, 1);
      }
      if (tamper === 'not-null-constraint' && part === 'constraints') {
        const index = (rows as Array<{ type: string }>).findIndex(row => row.type === 'n');
        rows.splice(index, 1);
      }
      if (tamper === 'not-null-validation' && part === 'constraints') {
        const required = (rows as Array<{ type: string; validated: boolean }>).find(row => row.type === 'n');
        if (required !== undefined) required.validated = false;
      }
      if (tamper === 'index' && part === 'indexes') rows.pop();
    }
    return { rows: rows as R[], rowCount: rows.length, command: 'SELECT', fields: [], oid: 0 };
  };
  return { transaction: async work => work({ query }) };
}

describe('返金回収schemaの起動条件', () => {
  it('049未適用の場合に起動前に拒否する', async () => {
    await expect(assertCreditRecoverySchema(database({ receipt: false }))).rejects.toThrow('049');
  });
  it.each(['150014', 'invalid'] as const)('非対応または不正なserver version %sでは起動しない', async serverVersion => {
    await expect(assertCreditRecoverySchema(database({ serverVersion }))).rejects.toThrow('049');
  });
  it.each(['160010', '170006'] as const)('PostgreSQL %sでは列のnullable検証でNOT NULLを保証して起動できる', async serverVersion => {
    await expect(assertCreditRecoverySchema(database({ serverVersion }))).resolves.toBeUndefined();
  });
  it('PostgreSQL 16でもrequired columnがnullableなら起動しない', async () => {
    await expect(assertCreditRecoverySchema(database({ serverVersion: '160010', tamper: 'column-nullability' }))).rejects.toThrow('049');
  });
  it('通常のcheckや外部キー制約が欠落した場合に起動しない', async () => {
    await expect(assertCreditRecoverySchema(database({ serverVersion: '160010', tamper: 'non-not-null-constraint' }))).rejects.toThrow('049');
  });
  it.each(['not-null-constraint', 'not-null-validation'] as const)('PostgreSQL 18で%sが不正なら起動しない', async tamper => {
    await expect(assertCreditRecoverySchema(database({ tamper }))).rejects.toThrow('049');
  });
  it('必須indexが欠落した場合に起動しない', async () => {
    await expect(assertCreditRecoverySchema(database({ tamper: 'index' }))).rejects.toThrow('049');
  });
  it('PostgreSQL 18で049の完全な構造の場合に起動できる', async () => {
    await expect(assertCreditRecoverySchema(database())).resolves.toBeUndefined();
  });
});
