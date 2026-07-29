import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const shouldRunPostgresTest =
  process.env.APP_ENV === 'test' && databaseUrl !== undefined;
const describePostgres = shouldRunPostgresTest ? describe : describe.skip;

describePostgres('push notification cancelled guard migration', () => {
  it('cancelledからfailedへの遷移では通知せず通常完了は一度だけ通知する', async () => {
    if (databaseUrl === undefined) {
      throw new Error('DATABASE_URL is required for the PostgreSQL migration test');
    }

    const client = new Client({ connectionString: databaseUrl });
    const outboxSql = await readFile(
      join(
        process.cwd(),
        'migrations',
        '034_add_mobile_push_notification_outbox.sql',
      ),
      'utf8',
    );
    const repairSql = await readFile(
      join(
        process.cwd(),
        'migrations',
        '036_fix_push_notification_cancelled_guard.sql',
      ),
      'utf8',
    );

    await client.connect();
    await client.query('BEGIN');

    try {
      const schemaName = `push_cancelled_guard_${Date.now()}`;
      await client.query(`CREATE SCHEMA ${schemaName}`);
      await client.query(`SET LOCAL search_path TO ${schemaName}`);
      await createMinimalPushTables(client);
      await client.query(outboxSql);
      await client.query(repairSql);

      const userId = '10000000-0000-4000-8000-000000000001';
      const tokenId = '20000000-0000-4000-8000-000000000001';
      const cancelledJobId = '30000000-0000-4000-8000-000000000001';
      const completedJobId = '30000000-0000-4000-8000-000000000002';

      await client.query(`INSERT INTO users (id) VALUES ($1)`, [userId]);
      await client.query(
        `INSERT INTO mobile_push_tokens (id, user_id) VALUES ($1, $2)`,
        [tokenId, userId],
      );
      await client.query(
        `INSERT INTO generation_jobs (id, user_id, status)
         VALUES ($1, $2, 'cancelled'), ($3, $2, 'processing')`,
        [cancelledJobId, userId, completedJobId],
      );

      await client.query(
        `UPDATE generation_jobs SET status = 'failed' WHERE id = $1`,
        [cancelledJobId],
      );
      await client.query(
        `UPDATE generation_jobs SET status = 'completed' WHERE id = $1`,
        [completedJobId],
      );
      await client.query(
        `UPDATE generation_jobs SET status = 'completed' WHERE id = $1`,
        [completedJobId],
      );

      const outbox = await client.query<{
        generation_job_id: string;
        terminal_status: string;
      }>(
        `SELECT generation_job_id, terminal_status
         FROM mobile_push_notification_outbox
         ORDER BY generation_job_id`,
      );
      expect(outbox.rows).toEqual([
        {
          generation_job_id: completedJobId,
          terminal_status: 'completed',
        },
      ]);

      const deliveries = await client.query<{ count: string }>(
        `SELECT COUNT(*)::TEXT AS count
         FROM mobile_push_notification_deliveries`,
      );
      expect(deliveries.rows[0]?.count).toBe('1');
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});

async function createMinimalPushTables(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE users (
      id UUID PRIMARY KEY
    );

    CREATE TABLE generation_jobs (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id),
      status TEXT NOT NULL
    );

    CREATE TABLE mobile_push_tokens (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id)
    );
  `);
}
