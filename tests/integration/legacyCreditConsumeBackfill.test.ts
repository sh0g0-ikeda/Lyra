import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const shouldRunPostgresTest = process.env.APP_ENV === 'test' && databaseUrl !== undefined;
const describePostgres = shouldRunPostgresTest ? describe : describe.skip;

describePostgres('legacy credit consume backfill', () => {
  it('検証済みの個人・法人行だけを補完し残高を変えず再実行できる', async () => {
    if (databaseUrl === undefined) {
      throw new Error('DATABASE_URL is required for the PostgreSQL migration test');
    }

    const client = new Client({ connectionString: databaseUrl });
    const migrationSql = await readFile(
      join(process.cwd(), 'migrations', '026_backfill_legacy_credit_consume_job_links.sql'),
      'utf8',
    );

    await client.connect();
    await client.query('BEGIN');

    try {
      const schemaName = `credit_backfill_${Date.now()}`;
      await client.query(`CREATE SCHEMA ${schemaName}`);
      await client.query(`SET LOCAL search_path TO ${schemaName}`);
      await createMinimalBillingTables(client);

      const personalUserId = '10000000-0000-4000-8000-000000000001';
      const organizationId = '20000000-0000-4000-8000-000000000001';
      const jobOwnerId = '30000000-0000-4000-8000-000000000001';
      const organizationActorId = '30000000-0000-4000-8000-000000000002';
      const mismatchedUserId = '40000000-0000-4000-8000-000000000001';

      await client.query(
        `INSERT INTO credit_balances (user_id, balance) VALUES ($1, 500)`,
        [personalUserId],
      );
      await client.query(
        `INSERT INTO organization_credit_balances
          (organization_id, monthly_balance, purchased_balance)
         VALUES ($1, 100, 900)`,
        [organizationId],
      );

      await insertJobAndLedgerRows(client, {
        ledgerId: '7a5ac356-bcdc-4437-ae12-90719721edb9',
        jobId: 'e05c62bc-0200-4f9c-93bc-adf3a8a781f2',
        jobUserId: personalUserId,
        consumeUserId: personalUserId,
        refundUserId: personalUserId,
        organizationId: null,
      });
      await insertJobAndLedgerRows(client, {
        ledgerId: '97acbae3-6b00-4aaa-8c56-63cdc179b1fd',
        jobId: '09bdaeb9-41fd-4240-b790-1460df745b58',
        jobUserId: personalUserId,
        consumeUserId: mismatchedUserId,
        refundUserId: mismatchedUserId,
        organizationId: null,
      });
      await insertJobAndLedgerRows(client, {
        ledgerId: '7127ef27-c145-4846-81df-3ca619ace9fa',
        jobId: '822cd296-1bb8-4caa-9ead-a21c81399b14',
        jobUserId: jobOwnerId,
        consumeUserId: organizationActorId,
        refundUserId: organizationActorId,
        organizationId,
      });

      const firstRun = await client.query(migrationSql);
      expect(firstRun.rowCount).toBe(2);

      const ledgerResult = await client.query<{ id: string; job_id: string | null }>(
        `SELECT id, job_id FROM credit_ledger WHERE type = 'consume' ORDER BY id`,
      );
      expect(ledgerResult.rows).toEqual(
        expect.arrayContaining([
          {
            id: '7a5ac356-bcdc-4437-ae12-90719721edb9',
            job_id: 'e05c62bc-0200-4f9c-93bc-adf3a8a781f2',
          },
          {
            id: '97acbae3-6b00-4aaa-8c56-63cdc179b1fd',
            job_id: null,
          },
          {
            id: '7127ef27-c145-4846-81df-3ca619ace9fa',
            job_id: '822cd296-1bb8-4caa-9ead-a21c81399b14',
          },
        ]),
      );

      const personalBalance = await client.query<{ balance: number }>(
        `SELECT balance FROM credit_balances WHERE user_id = $1`,
        [personalUserId],
      );
      expect(personalBalance.rows[0]?.balance).toBe(500);

      const organizationBalance = await client.query<{
        monthly_balance: number;
        purchased_balance: number;
      }>(
        `SELECT monthly_balance, purchased_balance
         FROM organization_credit_balances
         WHERE organization_id = $1`,
        [organizationId],
      );
      expect(organizationBalance.rows[0]).toEqual({
        monthly_balance: 100,
        purchased_balance: 900,
      });

      const secondRun = await client.query(migrationSql);
      expect(secondRun.rowCount).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});

async function createMinimalBillingTables(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE generation_jobs (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL,
      organization_id UUID,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      credit_cost INTEGER NOT NULL
    );

    CREATE TABLE credit_ledger (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL,
      organization_id UUID,
      job_id UUID,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL
    );

    CREATE TABLE credit_balances (
      user_id UUID PRIMARY KEY,
      balance INTEGER NOT NULL
    );

    CREATE TABLE organization_credit_balances (
      organization_id UUID PRIMARY KEY,
      monthly_balance INTEGER NOT NULL,
      purchased_balance INTEGER NOT NULL
    );
  `);
}

async function insertJobAndLedgerRows(
  client: Client,
  input: {
    ledgerId: string;
    jobId: string;
    jobUserId: string;
    consumeUserId: string;
    refundUserId: string;
    organizationId: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO generation_jobs
      (id, user_id, organization_id, job_type, status, credit_cost)
     VALUES ($1, $2, $3, 'page_generate', 'failed', 3)`,
    [input.jobId, input.jobUserId, input.organizationId],
  );
  await client.query(
    `INSERT INTO credit_ledger
      (id, user_id, organization_id, job_id, type, amount)
     VALUES ($1, $2, $3, NULL, 'consume', -3)`,
    [input.ledgerId, input.consumeUserId, input.organizationId],
  );
  await client.query(
    `INSERT INTO credit_ledger
      (id, user_id, organization_id, job_id, type, amount)
     VALUES (gen_random_uuid(), $1, $2, $3, 'refund', 3)`,
    [input.refundUserId, input.organizationId, input.jobId],
  );
}
