import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccountDeletionIdentityKey } from '../../src/domain/accountDeletion.js';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import {
  assertAuthSubjectCanProvision,
  retireUnownedAuthSubject,
} from '../../src/repositories/RetiredAuthSubjectRepository.js';
import { TransactionalUserProvisioningService } from '../../src/services/auth/TransactionalUserProvisioningService.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';

const describePostgres = process.env.APP_ENV === 'test' && process.env.DATABASE_URL
  ? describe
  : describe.skip;
const IDENTITY_SECRET = 'retired-auth-subject-test-secret-32-bytes';

describe('retired authentication subject configuration compatibility', () => {
  const noQueryClient: DatabaseClient = {
    query: async () => {
      throw new Error('SQL must not run');
    },
  };

  it('identity secret未設定のprovision guardは既存環境向けにSQLなしでno-opになる', async () => {
    await expect(assertAuthSubjectCanProvision(
      noQueryClient,
      'legacy-subject',
    )).resolves.toBeUndefined();
  });

  it('identity secret未設定のretireはSQL前に設定エラーで閉じる', async () => {
    await expect(retireUnownedAuthSubject(
      noQueryClient,
      'source-subject',
      randomUUID(),
    )).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
  });

  it('legacy schemaではidentity secret設定済みでも051 tableを参照せず既存userを返す', async () => {
    const database = new LegacyProvisioningDatabase();
    const service = new TransactionalUserProvisioningService(
      database,
      IDENTITY_SECRET,
      'legacy_2debe_v1',
    );

    await expect(service.provisionFromSupabaseClaims({
      sub: 'legacy-subject',
      email: 'legacy@example.invalid',
    })).resolves.toMatchObject({
      isNewUser: false,
      user: { id: '11111111-1111-4111-8111-111111111111' },
    });
    expect(database.queries.join('\n')).not.toContain('retired_auth_subjects');
  });

  it('canonical/expanded schemaはattested capability未指定なら051 tableを参照しない', async () => {
    for (const schemaProfile of ['canonical', 'production44_expanded_pg18_v1'] as const) {
      const database = new LegacyProvisioningDatabase();
      const service = new TransactionalUserProvisioningService(
        database,
        IDENTITY_SECRET,
        schemaProfile,
      );

      await expect(service.provisionFromSupabaseClaims({
        sub: 'legacy-subject',
        email: 'legacy@example.invalid',
      })).resolves.toMatchObject({ isNewUser: false });
      expect(database.queries.join('\n')).not.toContain('retired_auth_subjects');
    }
  });

  it.each([
    ['canonical', true],
    ['production44_expanded_pg18_v1', true],
  ] as const)(
    '%s schemaはretirement fencing=%sでretired subjectをprovision前に拒否する',
    async (schemaProfile, retirementFencing) => {
      const database = new FencedProvisioningDatabase();
      const service = new TransactionalUserProvisioningService(
        database,
        IDENTITY_SECRET,
        schemaProfile,
        retirementFencing,
      );

      await expect(service.provisionFromSupabaseClaims({
        sub: 'retired-subject',
        email: 'retired@example.invalid',
      })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      expect(database.queries[0]).toContain('pg_advisory_xact_lock');
      expect(database.queries[1]).toContain('retired_auth_subjects');
      expect(database.queries.join('\n')).not.toContain('FROM users');
    },
  );
});

// Design contract (Spec section 4): source-subject retirement and ordinary
// provisioning serialize on the same transaction advisory lock. Retirement is
// permanent only for an unowned subject, while the destination user and credits
// remain unchanged and account-deletion identity tombstones always win.
describePostgres('retired authentication subject fence', () => {
  let admin: Pool;
  let pool: Pool;
  let database: DatabaseClient & TransactionRunner;
  const schema = `retired_auth_subjects_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
      max: 12,
    });
    database = testDatabase(pool);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database));
  }, 120_000);

  afterAll(async () => {
    if (pool !== undefined) await pool.end();
    if (admin !== undefined) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  it('source subjectが削除済みを含むusersに存在する場合はretireを拒否する', async () => {
    const destinationUserId = await insertUser(pool, `destination-${randomUUID()}`);
    const sourceSubject = `source-${randomUUID()}`;
    const sourceUserId = await insertUser(pool, sourceSubject);
    await pool.query(
      `UPDATE users
       SET account_deletion_started_at = NOW(), account_deleted_at = NOW()
       WHERE id = $1`,
      [sourceUserId],
    );

    await expect(database.transaction((client) => retireUnownedAuthSubject(
      client,
      sourceSubject,
      destinationUserId,
      IDENTITY_SECRET,
    ))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await countRetiredSubjects(pool, sourceSubject)).toBe(0);
  });

  it('source subjectに退会tombstoneがある場合はretireを拒否する', async () => {
    const destinationUserId = await insertUser(pool, `destination-${randomUUID()}`);
    const tombstoneUserId = await insertUser(pool, `deleted-native-${randomUUID()}`);
    const sourceSubject = `source-${randomUUID()}`;
    await pool.query(
      `INSERT INTO account_deletion_requests(user_id, identity_id, identity_key, status, completed_at)
       VALUES($1, $2, $3, 'completed', NOW())`,
      [
        tombstoneUserId,
        'anonymized-identity',
        createAccountDeletionIdentityKey(IDENTITY_SECRET, sourceSubject),
      ],
    );

    await expect(database.transaction((client) => retireUnownedAuthSubject(
      client,
      sourceSubject,
      destinationUserId,
      IDENTITY_SECRET,
    ))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await countRetiredSubjects(pool, sourceSubject)).toBe(0);
  });

  it('同じdestinationへの再実行だけを許し別destinationへの付け替えを拒否する', async () => {
    const destinationUserId = await insertUser(pool, `destination-${randomUUID()}`);
    const otherDestinationUserId = await insertUser(pool, `destination-${randomUUID()}`);
    const sourceSubject = `source-${randomUUID()}`;

    await database.transaction((client) => retireUnownedAuthSubject(
      client,
      sourceSubject,
      destinationUserId,
      IDENTITY_SECRET,
    ));
    await expect(database.transaction((client) => retireUnownedAuthSubject(
      client,
      sourceSubject,
      destinationUserId,
      IDENTITY_SECRET,
    ))).resolves.toBeUndefined();
    await expect(database.transaction((client) => retireUnownedAuthSubject(
      client,
      sourceSubject,
      otherDestinationUserId,
      IDENTITY_SECRET,
    ))).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('retire済みsubjectのprovisionを開始時に拒否しdestination userとcreditsを変更しない', async () => {
    const destinationSubject = `destination-${randomUUID()}`;
    const destinationUserId = await insertUser(pool, destinationSubject);
    const sourceSubject = `source-${randomUUID()}`;
    await pool.query(
      `INSERT INTO credit_balances(user_id, monthly_credits, purchased_credits)
       VALUES($1, 17, 29)`,
      [destinationUserId],
    );
    await database.transaction((client) => retireUnownedAuthSubject(
      client,
      sourceSubject,
      destinationUserId,
      IDENTITY_SECRET,
    ));

    const service = new TransactionalUserProvisioningService(
      database,
      IDENTITY_SECRET,
      'canonical',
      true,
    );
    await expect(service.provisionFromSupabaseClaims({
      sub: sourceSubject,
      email: `${sourceSubject}@example.invalid`,
    })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    expect((await pool.query(
      'SELECT supabase_id, email FROM users WHERE id = $1',
      [destinationUserId],
    )).rows[0]).toEqual({
      supabase_id: destinationSubject,
      email: `${destinationSubject}@example.invalid`,
    });
    expect((await pool.query(
      'SELECT monthly_credits, purchased_credits FROM credit_balances WHERE user_id = $1',
      [destinationUserId],
    )).rows[0]).toEqual({ monthly_credits: 17, purchased_credits: 29 });
    expect((await pool.query(
      'SELECT 1 FROM users WHERE supabase_id = $1',
      [sourceSubject],
    )).rowCount).toBe(0);
  });

  it('retire先行ではprovisionがadvisory lockを待ちfence確定後に拒否される', async () => {
    const destinationUserId = await insertUser(pool, `destination-${randomUUID()}`);
    const sourceSubject = `source-${randomUUID()}`;
    const retirementLocked = deferred<void>();
    const releaseRetirement = deferred<void>();
    const retiringDatabase = await PinnedDatabase.connect(pool, async (sql) => {
      if (sql.includes('pg_advisory_xact_lock')) {
        retirementLocked.resolve();
        await releaseRetirement.promise;
      }
    });
    const provisioningDatabase = await PinnedDatabase.connect(pool);
    try {
      const retirement = settling(retiringDatabase.transaction((client) => retireUnownedAuthSubject(
        client,
        sourceSubject,
        destinationUserId,
        IDENTITY_SECRET,
      )));
      await waitForSignal(retirementLocked.promise, 'retirement lock');
      const provisioning = settling(new TransactionalUserProvisioningService(
        provisioningDatabase,
        IDENTITY_SECRET,
        'canonical',
        true,
      ).provisionFromSupabaseClaims({
        sub: sourceSubject,
        email: `${sourceSubject}@example.invalid`,
      }));
      await waitForBlockedQuery(pool, provisioningDatabase.pid);
      releaseRetirement.resolve();

      expect(await retirement).toEqual({ status: 'fulfilled', value: undefined });
      expect(await provisioning).toMatchObject({
        status: 'rejected',
        reason: { code: 'UNAUTHORIZED' },
      });
    } finally {
      releaseRetirement.resolve();
      await retiringDatabase.close();
      await provisioningDatabase.close();
    }
  });

  it('provision先行ではretireがadvisory lockを待ち作成済みsource userを見て拒否する', async () => {
    const destinationUserId = await insertUser(pool, `destination-${randomUUID()}`);
    const sourceSubject = `source-${randomUUID()}`;
    const provisioningLocked = deferred<void>();
    const releaseProvisioning = deferred<void>();
    const provisioningDatabase = await PinnedDatabase.connect(pool, async (sql) => {
      if (sql.includes('pg_advisory_xact_lock')) {
        provisioningLocked.resolve();
        await releaseProvisioning.promise;
      }
    });
    const retiringDatabase = await PinnedDatabase.connect(pool);
    try {
      const provisioning = settling(new TransactionalUserProvisioningService(
        provisioningDatabase,
        IDENTITY_SECRET,
        'canonical',
        true,
      ).provisionFromSupabaseClaims({
        sub: sourceSubject,
        email: `${sourceSubject}@example.invalid`,
      }));
      await waitForSignal(provisioningLocked.promise, 'provisioning lock');
      const retirement = settling(retiringDatabase.transaction((client) => retireUnownedAuthSubject(
        client,
        sourceSubject,
        destinationUserId,
        IDENTITY_SECRET,
      )));
      await waitForBlockedQuery(pool, retiringDatabase.pid);
      releaseProvisioning.resolve();

      expect(await provisioning).toMatchObject({ status: 'fulfilled' });
      expect(await retirement).toMatchObject({
        status: 'rejected',
        reason: { code: 'CONFLICT' },
      });
      expect((await pool.query(
        'SELECT 1 FROM users WHERE supabase_id = $1',
        [sourceSubject],
      )).rowCount).toBe(1);
    } finally {
      releaseProvisioning.resolve();
      await provisioningDatabase.close();
      await retiringDatabase.close();
    }
  });

  it('destinationの退会開始後もsource fenceを保持する', async () => {
    const destinationUserId = await insertUser(pool, `destination-${randomUUID()}`);
    const sourceSubject = `source-${randomUUID()}`;
    await database.transaction((client) => retireUnownedAuthSubject(
      client,
      sourceSubject,
      destinationUserId,
      IDENTITY_SECRET,
    ));

    await pool.query(
      'UPDATE users SET account_deletion_started_at = NOW() WHERE id = $1',
      [destinationUserId],
    );

    await expect(database.transaction((client) => assertAuthSubjectCanProvision(
      client,
      sourceSubject,
      IDENTITY_SECRET,
    ))).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await countRetiredSubjects(pool, sourceSubject)).toBe(1);
  });
});

class PinnedDatabase implements DatabaseClient, TransactionRunner {
  private constructor(
    private readonly client: PoolClient,
    public readonly pid: number,
    private readonly onQuery?: (sql: string) => Promise<void>,
  ) {}

  public static async connect(
    pool: Pool,
    onQuery?: (sql: string) => Promise<void>,
  ): Promise<PinnedDatabase> {
    const client = await pool.connect();
    const pid = (await client.query<{ pid: number }>(
      'SELECT pg_backend_pid() AS pid',
    )).rows[0]?.pid;
    if (pid === undefined) throw new Error('Missing backend pid');
    return new PinnedDatabase(client, pid, onQuery);
  }

  public async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ) {
    return this.client.query<Row>(text, values === undefined ? undefined : [...values]);
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    await this.client.query('BEGIN');
    try {
      const result = await work({
        query: async <Row extends QueryResultRow = QueryResultRow>(
          text: string,
          values?: readonly unknown[],
        ) => {
          const queryResult = await this.client.query<Row>(
            text,
            values === undefined ? undefined : [...values],
          );
          await this.onQuery?.(text);
          return queryResult;
        },
      });
      await this.client.query('COMMIT');
      return result;
    } catch (error: unknown) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }

  public async close(): Promise<void> {
    this.client.release();
  }
}

class LegacyProvisioningDatabase implements DatabaseClient, TransactionRunner {
  public readonly queries: string[] = [];

  public async query<Row extends QueryResultRow = QueryResultRow>(text: string) {
    this.queries.push(text);
    if (text.includes('retired_auth_subjects')) {
      throw new Error('Legacy schema must not query migration 051 tables');
    }
    const rows = text.includes('FROM users')
      ? [{
          id: '11111111-1111-4111-8111-111111111111',
          supabase_id: 'legacy-subject',
          email: 'legacy@example.invalid',
          display_name: null,
          plan_code: 'free',
        }] as unknown as Row[]
      : [];
    return {
      command: 'SELECT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows,
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

class FencedProvisioningDatabase implements DatabaseClient, TransactionRunner {
  public readonly queries: string[] = [];

  public async query<Row extends QueryResultRow = QueryResultRow>(text: string) {
    this.queries.push(text);
    const rows = text.includes('retired_auth_subjects')
      ? [{ destination_user_id: '11111111-1111-4111-8111-111111111111' }] as unknown as Row[]
      : [];
    return {
      command: 'SELECT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows,
    };
  }

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(this);
  }
}

function testDatabase(pool: Pool): DatabaseClient & TransactionRunner {
  return {
    query: async <Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ) => pool.query<Row>(text, values === undefined ? undefined : [...values]),
    transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work({
          query: async <Row extends QueryResultRow = QueryResultRow>(
            text: string,
            values?: readonly unknown[],
          ) => client.query<Row>(text, values === undefined ? undefined : [...values]),
        });
        await client.query('COMMIT');
        return result;
      } catch (error: unknown) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function insertUser(pool: Pool, subject: string): Promise<string> {
  const userId = randomUUID();
  await pool.query(
    'INSERT INTO users(id, supabase_id, email) VALUES($1, $2, $3)',
    [userId, subject, `${subject}@example.invalid`],
  );
  return userId;
}

async function countRetiredSubjects(pool: Pool, subject: string): Promise<number> {
  const subjectKey = createAccountDeletionIdentityKey(IDENTITY_SECRET, subject);
  return (await pool.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM retired_auth_subjects WHERE subject_key = $1',
    [subjectKey],
  )).rows[0]?.count ?? 0;
}

async function waitForBlockedQuery(pool: Pool, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const blocked = (await pool.query<{ blocked: boolean }>(
      'SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked',
      [pid],
    )).rows[0]?.blocked;
    if (blocked === true) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Backend ${pid} did not become blocked`);
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value?: T | PromiseLike<T>) => void;
} {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve as (value?: T | PromiseLike<T>) => void;
  });
  return { promise, resolve };
}

async function waitForSignal(signal: Promise<void>, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      signal,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 2_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function settling<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  return promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason: unknown) => ({ status: 'rejected', reason }),
  );
}
