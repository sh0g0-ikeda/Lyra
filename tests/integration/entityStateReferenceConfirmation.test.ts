import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { computeStateReferenceFingerprint } from '../../src/domain/state/StateReferenceFingerprint.js';
import type { ConfirmEntityStateReferenceInput } from '../../src/domain/types/entityStateReference.js';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresAccountDeletionRepository } from '../../src/repositories/AccountDeletionRepository.js';
import { PostgresEntityStateReferenceRepository } from '../../src/repositories/EntityStateReferenceRepository.js';
import { PostgresImageStorageReferenceRepository } from '../../src/repositories/ImageStorageReferenceRepository.js';
import { AccountDeletionService } from '../../src/services/account/AccountDeletionService.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';
import { rejectionOf, throwingRejectionOf } from './asyncPostgresAssertions.js';

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.APP_ENV === 'test' && databaseUrl !== undefined ? describe : describe.skip;

// Design: a committed copy intent must precede S3, and the users deletion gate
// must cover final validation, copy and descriptor commit. Barriers below force
// each dangerous interleaving instead of relying on scheduler timing.
describePostgres('entity state reference confirmation admission', () => {
  let admin: Pool;
  let pool: Pool;
  let database: TestDatabase;
  let schema: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl });
    schema = `state_confirm_${process.pid}_${Date.now()}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: databaseUrl, max: 8, options: `-c search_path=${schema},public` });
    database = new TestDatabase(pool);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database));
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin !== undefined) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });

  it.each(['connection_lost', 'request_rejected'])('%s後の遅延remote copyは退会と再copyをblockしmetadataを保持する', async (fault) => {
    const input = await seed(pool);
    const objects = new Set<string>();
    const remoteAccepted = deferred();
    const releaseRemote = deferred();
    const remoteFinished = deferred();
    const rejectRequest = deferred();
    const broken = await pool.connect();
    const disconnected = deferred();
    broken.on('error', () => { disconnected.resolve(); });
    const pid = (await broken.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    let transactions = 0;
    const faultDatabase: DatabaseClient & TransactionRunner = {
      query: database.query.bind(database),
      transaction: (work) => {
        transactions += 1;
        return transactions === 2 ? new TestDatabase(pool, broken).transaction(work) : database.transaction(work);
      },
    };
    const remote = (async () => {
      await releaseRemote.promise;
      objects.add(input.descriptor.s3Key);
      remoteFinished.resolve();
    })();
    const confirming = new PostgresEntityStateReferenceRepository(faultDatabase).confirmReference(input, async () => {
      remoteAccepted.resolve();
      if (fault === 'request_rejected') {
        await rejectRequest.promise;
        throw new Error('response lost while remote copy remains outstanding');
      }
      await remoteFinished.promise;
    }).then(() => null, (error: unknown) => error);
    try {
      await remoteAccepted.promise;
      if (fault === 'connection_lost') {
        await admin.query('SELECT pg_terminate_backend($1)', [pid]);
        await disconnected.promise;
      } else {
        rejectRequest.resolve();
        await confirming;
      }
      const deletion = new AccountDeletionService(
        new PostgresAccountDeletionRepository(database, database),
        { cancelPersonalSubscription: async () => {} },
        { disableIdentity: async () => {}, deleteIdentity: async () => {} },
        { deleteExactObject: async (key) => { objects.delete(key); } },
        'state-confirmation-local-test-secret-only',
      );
      const deletionResult = await deletion.requestDeletion({
        userId: input.userId, identityId: `state-confirm-${input.userId}`, confirmation: 'DELETE',
        acknowledgePersonalSubscriptions: true, acknowledgeStoreBilling: true, acknowledgePersonalAssets: true,
      });
      // The old implementation completes deletion here, then the delayed write
      // recreates an untracked saved object. No AWS/network behavior is mocked
      // into a safety assumption: local settlement and remote write are separate.
      expect(deletionResult.status).toBe('blocked');
      const replay = vi.fn(async () => {});
      expect(await rejectionOf(new PostgresEntityStateReferenceRepository(database).confirmReference(input, replay))).toMatchObject({ code: 'CONFLICT' });
      expect(replay).not.toHaveBeenCalled();
      expect(await intents(pool, input.jobId)).toBeDefined();
      releaseRemote.resolve();
      await remote;
      await confirming;
      expect(objects.has(input.descriptor.s3Key)).toBe(true);
      expect(await intents(pool, input.jobId)).toBeDefined();
      if (fault === 'request_rejected') {
        // Even an arbitrarily old intent and an observed object do not prove
        // this request has stopped writing. A fresh confirm must not clear it.
        await pool.query(`UPDATE generation_jobs SET created_at = '1900-01-01', completed_at = '1900-01-02',
          expires_at = '1900-01-03' WHERE id = $1`, [input.jobId]);
        expect(await rejectionOf(new PostgresEntityStateReferenceRepository(database).confirmReference(input, replay))).toMatchObject({ code: 'CONFLICT' });
        expect(replay).not.toHaveBeenCalled();
        expect((await new PostgresAccountDeletionRepository(database, database).getFlight(input.userId))
          .activePersonalGenerationJobCount).toBeGreaterThan(0);
      } else {
        // Only the original successful response settles the original attempt.
        // Its positive evidence survives the broken descriptor transaction.
        expect((await new PostgresAccountDeletionRepository(database, database).getFlight(input.userId))
          .activePersonalGenerationJobCount).toBe(0);
        expect((await deletion.requestDeletion({
          userId: input.userId, identityId: `state-confirm-${input.userId}`, confirmation: 'DELETE',
          acknowledgePersonalSubscriptions: true, acknowledgeStoreBilling: true, acknowledgePersonalAssets: true,
        })).status).toBe('completed');
        expect(objects.has(input.descriptor.s3Key)).toBe(false);
      }
    } finally {
      rejectRequest.resolve();
      releaseRemote.resolve();
      await Promise.allSettled([remote, confirming]);
      broken.release(true);
    }
  });

  it('成功response後のdescriptorとsettlement両方のDB保存に失敗すると再copyせずblockする', async () => {
    const input = await seed(pool);
    let transactions = 0;
    const failing: DatabaseClient & TransactionRunner = {
      query: database.query.bind(database),
      transaction: async (work) => {
        transactions += 1;
        if (transactions === 3) throw new Error('settlement database unavailable');
        return database.transaction(async (client) => {
          const value = await work(client);
          if (transactions === 2) throw new Error('descriptor commit failed');
          return value;
        });
      },
    };
    const copy = vi.fn(async () => {});
    expect(await throwingRejectionOf(new PostgresEntityStateReferenceRepository(failing).confirmReference(input, copy))).toThrow('descriptor commit failed');
    expect(copy).toHaveBeenCalledOnce();
    const retry = vi.fn(async () => {});
    expect(await rejectionOf(new PostgresEntityStateReferenceRepository(database).confirmReference(input, retry))).toMatchObject({ code: 'CONFLICT' });
    expect(retry).not.toHaveBeenCalled();
    expect(await intents(pool, input.jobId)).toEqual([copyIntent(input, 'unresolved')]);
    expect((await claimDeletion(database, input.userId)).kind).toBe('blocked');
  });

  it.each([false, true])('admission応答喪失は自身の未送信attemptだけ回復する (DB unavailable: %s)', async (unavailable) => {
    const input = await seed(pool);
    let transactions = 0;
    const uncertain: DatabaseClient & TransactionRunner = {
      query: database.query.bind(database),
      transaction: async (work) => {
        transactions += 1;
        if (transactions > 1 && unavailable) throw new Error('settlement unavailable');
        const result = await database.transaction(work);
        if (transactions === 1) throw new Error('admission acknowledgement lost');
        return result;
      },
    };
    const copy = vi.fn(async () => {});
    expect(await throwingRejectionOf(new PostgresEntityStateReferenceRepository(uncertain).confirmReference(input, copy))).toThrow('admission acknowledgement lost');
    expect(copy).not.toHaveBeenCalled();
    if (unavailable) {
      expect(await rejectionOf(new PostgresEntityStateReferenceRepository(database).confirmReference(input, copy))).toMatchObject({ code: 'CONFLICT' });
      expect(await intents(pool, input.jobId)).toEqual([copyIntent(input, 'unresolved')]);
      expect((await claimDeletion(database, input.userId)).kind).toBe('blocked');
    } else {
      expect(await intents(pool, input.jobId)).toEqual([copyIntent(input, 'not_dispatched')]);
      await new PostgresEntityStateReferenceRepository(database).confirmReference(input, copy);
      expect(copy).toHaveBeenCalledOnce();
      expect(await intents(pool, input.jobId)).toEqual([
        copyIntent(input, 'not_dispatched'), copyIntent(input, 'succeeded'),
      ]);
    }
  });

  it('既存descriptorが一致してもlegacy intentを成功と見なさず退会も再copyもblockする', async () => {
    const input = await seed(pool);
    const legacy = { s3_key: input.descriptor.s3Key, entity_id: input.entityId, state_id: input.stateId,
      ref_id: input.descriptor.refId };
    await pool.query(`UPDATE generation_jobs SET result = jsonb_set(result, '{state_reference_copies}', $2::jsonb)
      WHERE id = $1`, [input.jobId, JSON.stringify([legacy])]);
    await pool.query(`UPDATE entity_states SET reference_image = $2::jsonb WHERE id = $1`,
      [input.stateId, JSON.stringify({ ...legacy, storage_owner_user_id: input.userId,
        base_ref_id: input.descriptor.baseRefId, image_model: input.descriptor.imageModel,
        created_at: input.descriptor.createdAt, input_fingerprint: input.descriptor.inputFingerprint })]);
    const copy = vi.fn(async () => {});
    expect(await rejectionOf(new PostgresEntityStateReferenceRepository(database).confirmReference(input, copy))).toMatchObject({ code: 'CONFLICT' });
    expect(copy).not.toHaveBeenCalled();
    expect((await claimDeletion(database, input.userId)).kind).toBe('blocked');
    expect(await intents(pool, input.jobId)).toEqual([legacy]);
  });

  it('退会claim済みでも未確定attemptが残ると削除checkpoint後のfinalizeをblockする', async () => {
    const input = await seed(pool);
    const claim = await claimDeletion(database, input.userId);
    if (claim.kind !== 'claimed') throw new Error('Expected initial deletion claim');
    const unresolved = { s3_key: input.descriptor.s3Key, entity_id: input.entityId, state_id: input.stateId,
      ref_id: input.descriptor.refId, attempt_id: randomUUID(), state: 'unresolved' };
    await pool.query(`UPDATE generation_jobs SET result = jsonb_set(result, '{state_reference_copies}', $2::jsonb)
      WHERE id = $1`, [input.jobId, JSON.stringify([unresolved])]);
    const deletion = new PostgresAccountDeletionRepository(database, database);
    for (const key of (await deletion.getFlight(input.userId)).personalAssetKeys) {
      await deletion.markAssetDeleted(input.userId, claim.request.processingToken, key);
    }
    expect((await deletion.finalizePersonalData(input.userId, claim.request.processingToken)).kind).toBe('blocked');
    expect(await intents(pool, input.jobId)).toEqual([unresolved]);
    expect((await pool.query('SELECT id FROM entity_states WHERE id = $1', [input.stateId])).rowCount).toBe(1);
  });

  it('pre-copy再検証が失敗しても別attemptの未確定fenceを解除しない', async () => {
    const input = await seed(pool);
    const otherAttemptId = randomUUID();
    let ownAttemptId: unknown;
    let transactions = 0;
    const interleaved: DatabaseClient & TransactionRunner = {
      query: database.query.bind(database),
      transaction: async (work) => {
        transactions += 1;
        if (transactions === 2) {
          const history = (await pool.query(`SELECT result->'state_reference_copies' AS history
            FROM generation_jobs WHERE id = $1`, [input.jobId])).rows[0]!.history as Record<string, unknown>[];
          ownAttemptId = history[0]!.attempt_id;
          await pool.query(`UPDATE generation_jobs SET result = jsonb_set(result, '{state_reference_copies}', $2::jsonb)
            WHERE id = $1`, [input.jobId, JSON.stringify([...history, { ...history[0], attempt_id: otherAttemptId }])]);
        }
        return database.transaction(work);
      },
    };
    const copy = vi.fn(async () => {});
    expect(await rejectionOf(new PostgresEntityStateReferenceRepository(interleaved).confirmReference(input, copy))).toMatchObject({ code: 'CONFLICT' });
    expect(copy).not.toHaveBeenCalled();
    expect(await intents(pool, input.jobId)).toEqual([
      { ...copyIntent(input, 'not_dispatched'), attempt_id: ownAttemptId },
      { ...copyIntent(input, 'unresolved'), attempt_id: otherAttemptId },
    ]);
    expect((await claimDeletion(database, input.userId)).kind).toBe('blocked');
  });

  it('退会開始済みならcopyもintentも作らない', async () => {
    const input = await seed(pool);
    await claimDeletion(database, input.userId);
    const copy = vi.fn(async () => {});
    expect(await rejectionOf(new PostgresEntityStateReferenceRepository(database).confirmReference(input, copy))).toMatchObject({ code: 'CONFLICT' });
    expect(copy).not.toHaveBeenCalled();
    expect(await intents(pool, input.jobId)).toBeUndefined();
  });

  it('copy中の退会claimはusersロックで待ち、commit後のsaved画像を回収する', async () => {
    const input = await seed(pool);
    const entered = deferred();
    const release = deferred();
    const confirming = new PostgresEntityStateReferenceRepository(database).confirmReference(input, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const deletingConnection = await pool.connect();
    const pid = (await deletingConnection.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    const deletionDatabase = new TestDatabase(pool, deletingConnection);
    const deleting = claimDeletion(deletionDatabase, input.userId);
    try {
      await waitForBlockedQuery(pool, pid);
      expect(await intents(pool, input.jobId)).toEqual([copyIntent(input, 'unresolved')]);
    } finally {
      release.resolve();
    }
    await confirming;
    expect((await deleting).kind).toBe('claimed');
    deletingConnection.release();
    expect((await new PostgresAccountDeletionRepository(database, database).getFlight(input.userId)).personalAssetKeys)
      .toContain(input.descriptor.s3Key);
    const replayCopy = vi.fn(async () => {});
    expect(await rejectionOf(new PostgresEntityStateReferenceRepository(database).confirmReference(input, replayCopy))).toMatchObject({ code: 'CONFLICT' });
    expect(replayCopy).not.toHaveBeenCalled();
  });

  it('intent確定後の退会claimはcopy完了までblockedになる', async () => {
    const input = await seed(pool);
    let transactions = 0;
    const interleaved: DatabaseClient & TransactionRunner = {
      query: database.query.bind(database),
      transaction: async (work) => {
        transactions += 1;
        if (transactions === 2) expect((await claimDeletion(database, input.userId)).kind).toBe('blocked');
        return database.transaction(work);
      },
    };
    const copy = vi.fn(async () => {});
    expect(await (new PostgresEntityStateReferenceRepository(interleaved).confirmReference(input, copy))).toMatchObject({ referenceImage: input.descriptor });
    expect(copy).toHaveBeenCalledOnce();
    expect((await new PostgresAccountDeletionRepository(database, database).getFlight(input.userId))
      .activePersonalGenerationJobCount).toBe(0);
  });

  it.each(['copy', 'commit', 'commit_ack'])('%s失敗後もintentを失わず、再試行と再confirmで重複copyしない', async (failure) => {
    const input = await seed(pool);
    let transactions = 0;
    const failing: DatabaseClient & TransactionRunner = {
      query: database.query.bind(database),
      transaction: async (work) => {
        transactions += 1;
        const result = await database.transaction(async (client) => {
          const value = await work(client);
          if (failure === 'commit' && transactions === 2) throw new Error('commit failed');
          return value;
        });
        if (failure === 'commit_ack' && transactions === 2) throw new Error('commit acknowledgement failed');
        return result;
      },
    };
    const copy = vi.fn(async () => {
      if (failure === 'copy') throw new Error('copy failed after remote success');
    });
    expect(await throwingRejectionOf(new PostgresEntityStateReferenceRepository(failing).confirmReference(input, copy))).toThrow('failed');
    expect(copy).toHaveBeenCalledOnce();
    expect(await intents(pool, input.jobId)).toEqual([copyIntent(input, failure === 'copy' ? 'unresolved' : 'succeeded')]);
    const persisted = (await pool.query('SELECT reference_image FROM entity_states WHERE id = $1', [input.stateId]))
      .rows[0]?.reference_image;
    if (failure === 'commit_ack') expect(persisted?.s3_key).toBe(input.descriptor.s3Key);
    else expect(persisted).toBeNull();
    const protectedKeys = await new PostgresImageStorageReferenceRepository(database)
      .findProtectedImageS3Keys({ protectRecentCandidateHours: 1 });
    expect(protectedKeys.has(input.descriptor.s3Key)).toBe(true);
    expect((await new PostgresAccountDeletionRepository(database, database).getFlight(input.userId)).personalAssetKeys)
      .toContain(input.descriptor.s3Key);
    const retryCopy = vi.fn(async () => {});
    const repository = new PostgresEntityStateReferenceRepository(database);
    if (failure === 'copy') {
      expect(await rejectionOf(repository.confirmReference(input, retryCopy))).toMatchObject({ code: 'CONFLICT' });
      expect(await intents(pool, input.jobId)).toEqual([copyIntent(input, 'unresolved')]);
    } else {
      const confirmed = await repository.confirmReference(input, retryCopy);
      expect(await repository.confirmReference(input, retryCopy)).toEqual(confirmed);
      expect(await intents(pool, input.jobId)).toEqual([copyIntent(input)]);
    }
    expect(retryCopy).not.toHaveBeenCalled();
  });

  it('intent確定後のstate変更を二段目で再検証しcopyしない', async () => {
    const input = await seed(pool);
    let transactions = 0;
    const interleaved: DatabaseClient & TransactionRunner = {
      query: database.query.bind(database),
      transaction: async (work) => {
        transactions += 1;
        if (transactions === 2) {
          await pool.query(`UPDATE entity_states SET description = 'Different scar' WHERE id = $1`, [input.stateId]);
        }
        return database.transaction(work);
      },
    };
    const copy = vi.fn(async () => {});
    expect(await rejectionOf(new PostgresEntityStateReferenceRepository(interleaved).confirmReference(input, copy))).toMatchObject({ code: 'CONFLICT' });
    expect(copy).not.toHaveBeenCalled();
    expect(await intents(pool, input.jobId)).toEqual([copyIntent(input, 'not_dispatched')]);
    expect((await new PostgresAccountDeletionRepository(database, database).getFlight(input.userId))
      .activePersonalGenerationJobCount).toBe(0);
  });

  it('同時に別候補をconfirmすると敗者はsaved画像をcopyしない', async () => {
    const input = await seed(pool);
    const competitor = {
      ...input,
      candidateS3Key: input.candidateS3Key.replace('-1.png', '-2.png'),
      descriptor: { ...input.descriptor, refId: `${input.jobId}-2`, s3Key: input.descriptor.s3Key.replace('-1.png', '-2.png') },
    };
    await pool.query(`UPDATE generation_jobs SET result = jsonb_set(result, '{candidates}',
      result->'candidates' || $2::jsonb) WHERE id = $1`,
    [input.jobId, JSON.stringify([{ ref_id: competitor.descriptor.refId, s3_key: competitor.candidateS3Key }])]);
    const entered = deferred();
    const release = deferred();
    const repository = new PostgresEntityStateReferenceRepository(database);
    const winning = repository.confirmReference(input, async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    const losingCopy = vi.fn(async () => {});
    const losingConnection = await pool.connect();
    const pid = (await losingConnection.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    const losingRepository = new PostgresEntityStateReferenceRepository(new TestDatabase(pool, losingConnection));
    // Attach a rejection handler without invoking a promise matcher yet: Bun's
    // matcher waits immediately, which would prevent release of the winner.
    const losing = losingRepository.confirmReference(competitor, losingCopy).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );
    try {
      // Prove the loser actually reaches and blocks on admission before release.
      await waitForBlockedQuery(pool, pid);
      release.resolve();
      await winning;
      expect(await losing).toMatchObject({ status: 'rejected', error: { code: 'CONFLICT' } });
      expect(losingCopy).not.toHaveBeenCalled();
      expect(await intents(pool, input.jobId)).toEqual([copyIntent(input)]);
    } finally {
      release.resolve();
      await Promise.allSettled([winning, losing]);
      losingConnection.release();
    }
  });
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForBlockedQuery(pool: Pool, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query<{ blocked: boolean }>('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid]);
    if (result.rows[0]?.blocked) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Deletion did not block on confirmation admission');
}

async function claimDeletion(database: DatabaseClient & TransactionRunner, userId: string) {
  return new PostgresAccountDeletionRepository(database, database).claimRequest({
    userId, identityId: `state-confirm-${userId}`, identityKey: `${userId.replaceAll('-', '')}${'x'.repeat(11)}`, processingToken: randomUUID(),
    acknowledgePersonalSubscriptions: true, acknowledgeStoreBilling: true, acknowledgePersonalAssets: true,
  });
}

function copyIntent(input: ConfirmEntityStateReferenceInput, state = 'succeeded') {
  return { s3_key: input.descriptor.s3Key, entity_id: input.entityId, state_id: input.stateId, ref_id: input.descriptor.refId,
    attempt_id: expect.any(String), state };
}

async function intents(pool: Pool, jobId: string) {
  return (await pool.query(`SELECT result->'state_reference_copies' AS intents FROM generation_jobs WHERE id = $1`, [jobId]))
    .rows[0]?.intents ?? undefined;
}

async function seed(pool: Pool): Promise<ConfirmEntityStateReferenceInput> {
  const userId = randomUUID();
  const workId = randomUUID();
  const entityId = randomUUID();
  const stateId = randomUUID();
  const jobId = randomUUID();
  await pool.query(`INSERT INTO users (id, supabase_id, email) VALUES ($1, $2, $3)`,
    [userId, `state-confirm-${userId}`, `${userId}@example.invalid`]);
  await pool.query(`INSERT INTO works (id, user_id, title) VALUES ($1, $2, 'State confirmation')`, [workId, userId]);
  await pool.query(`INSERT INTO entities (id, work_id, user_id, name) VALUES ($1, $2, $3, 'Character')`, [entityId, workId, userId]);
  await pool.query(`INSERT INTO reference_sets (entity_id, primary_ref_id, reference_images, status)
    VALUES ($1, 'base-ref', $2::jsonb, 'ready')`,
  [entityId, JSON.stringify([{ ref_id: 'base-ref', s3_key: `saved/${userId}/entities/${entityId}/base.png` }])]);
  await pool.query(`INSERT INTO entity_states (id, entity_id, name, description, created_at, updated_at)
    VALUES ($1, $2, 'injured', 'A cheek scar', '2026-09-30T00:00:00Z', '2026-09-30T00:00:00Z')`, [stateId, entityId]);
  const input: ConfirmEntityStateReferenceInput = {
    userId, organizationId: null, entityId, stateId, jobId,
    candidateS3Key: `session/${userId}/entities/${entityId}/${jobId}-1.png`,
    expectedStateRevision: '2026-09-30T00:00:00.000Z',
    descriptor: { refId: `${jobId}-1`, s3Key: `saved/${userId}/entities/${entityId}/states/${stateId}/${jobId}-1.png`,
      storageOwnerUserId: userId, imageModel: 'gpt-image-2', baseRefId: 'base-ref', createdAt: '2026-09-30T00:00:01.000Z',
      inputFingerprint: computeStateReferenceFingerprint({ entityId, stateId, name: 'injured', description: 'A cheek scar', baseRefId: 'base-ref' }) },
  };
  await pool.query(`INSERT INTO generation_jobs (id, user_id, job_type, status, credit_cost, params, result, completed_at)
    VALUES ($1, $2, 'entity_generate', 'completed', 1, $3::jsonb, $4::jsonb, '2026-09-30T00:00:01Z')`,
  [jobId, userId, JSON.stringify({ target: 'entity_state', entity_id: entityId, entity_state_id: stateId,
    base_primary_ref_id: 'base-ref', state_revision: input.expectedStateRevision,
    state_input_fingerprint: input.descriptor.inputFingerprint, image_model: 'gpt-image-2' }),
  JSON.stringify({ candidates: [{ ref_id: input.descriptor.refId, s3_key: input.candidateS3Key }] })]);
  return input;
}

class TestDatabase implements DatabaseClient, TransactionRunner {
  public constructor(private readonly pool: Pool, private readonly pinned?: PoolClient) {}
  public query<T extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values === undefined ? undefined : [...values]);
  }
  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = this.pinned ?? await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work({ query: <R extends QueryResultRow>(text: string, values?: readonly unknown[]) =>
        client.query<R>(text, values === undefined ? undefined : [...values]) });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      if (this.pinned === undefined) client.release();
    }
  }
}
