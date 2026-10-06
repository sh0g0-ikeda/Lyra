import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createGooglePlayObfuscatedAccountId,
  createStoreIdentifierKey,
  createStoreProductCatalog,
  type VerifiedStorePurchase,
} from '../../src/domain/storePurchase.js';
import type { DatabaseClient, TransactionRunner } from '../../src/lib/db.js';
import { runPendingMigrations } from '../../src/lib/migrations.js';
import { PostgresCreditRepository } from '../../src/repositories/CreditRepository.js';
import { PostgresStorePurchaseRepository } from '../../src/repositories/StorePurchaseRepository.js';
import { MobileStorePurchaseService } from '../../src/services/billing/MobileStorePurchaseService.js';
import { checkDeploymentDataInvariants } from '../../scripts/checkDeploymentDataInvariants.js';
import { withPostgresTestMigrationLock } from './postgresTestMigrationLock.js';
import { throwingRejectionOf } from './asyncPostgresAssertions.js';

const databaseDescribe = process.env.APP_ENV === 'test' && process.env.DATABASE_URL
  ? describe : describe.skip;
const secret = 'synthetic-migrated-billing-audit-key-only-for-tests';
const now = new Date();
const expiresAt = new Date(now.getTime() + 30 * 86_400_000);
const fixtures = new Map<string, Fixture>();
interface Fixture {
  userId: string;
  token: string;
  currentOrder: string;
  oldOrder: string;
  purchaseId: string;
}

databaseDescribe('migrated production store replay and refund safety', () => {
  let admin: Pool;
  let pool: Pool;
  let database: DatabaseClient & TransactionRunner;
  const schema = `billing_replay_${randomUUID().replaceAll('-', '')}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
      max: 8,
    });
    database = adapter(pool);
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, {
      migrationsDir: join(process.cwd(), 'tests/fixtures/production-lineage-2debe'),
    }));
    for (const name of ['refund', 'linked', 'deleted', 'binding']) {
      fixtures.set(name, await seedProductionPurchase(name, name === 'refund'));
    }
    const before = await pool.query('SELECT to_jsonb(p) AS row FROM mobile_store_purchases p ORDER BY id');
    await withPostgresTestMigrationLock(admin, () => runPendingMigrations(database, {
      allowProductionLineageBridge: true,
      accountDeletionIdentityHashSecret: secret,
    }));
    expect((await pool.query('SELECT to_jsonb(p) AS row FROM mobile_store_purchases p ORDER BY id')).rows)
      .toEqual(before.rows);
    expect((await checkDeploymentDataInvariants(database)).violations).toEqual([]);
  }, 120_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  }, 60_000);

  async function seedProductionPurchase(name: string, renewed: boolean): Promise<Fixture> {
    const userId = randomUUID();
    const token = `synthetic-${name}-token-${userId}`;
    const oldOrder = `old-${userId}`;
    const currentOrder = renewed ? `renewal-${userId}` : oldOrder;
    await pool.query("INSERT INTO users(id,supabase_id,email,plan_code) VALUES($1,$2,$3,'standard')",
      [userId, `subject-${userId}`, `${userId}@example.invalid`]);
    await pool.query('INSERT INTO credit_balances(user_id,monthly_credits,purchased_credits,monthly_expires_at) VALUES($1,50,7,$2)',
      [userId, expiresAt]);
    await pool.query(`INSERT INTO credit_ledger(user_id,type,amount,monthly_delta,purchased_delta,monthly_after,purchased_after)
      VALUES($1,'signup_bonus',7,0,7,0,7)`, [userId]);
    const purchase = await pool.query<{ id: string }>(`INSERT INTO mobile_store_purchases(
      user_id,store,environment,external_purchase_key,product_id,kind,plan_code,state,
      transaction_key,expires_at,auto_renew_enabled,granted_credits,last_observed_at,
      scheduled_product_id,scheduled_plan_code,scheduled_effective_at)
      VALUES($1,'google','production',$2,'standard','subscription','standard','active',
        $3,$4,true,$5,$6,'premium','premium',$4) RETURNING id`,
    [userId, key('external-purchase', token), key('transaction', currentOrder), expiresAt,
      renewed ? 100 : 50, now]);
    const purchaseId = purchase.rows[0].id;
    for (const [index, order] of (renewed ? [oldOrder, currentOrder] : [oldOrder]).entries()) {
      const transactionKey = key('transaction', order);
      await pool.query(`INSERT INTO mobile_store_purchase_events(
        purchase_id,store,event_key,transaction_key,operation,provider_event_type,state,occurred_at)
        VALUES($1,'google',$2,$3,'grant','google.play.subscription','active',$4)`,
      [purchaseId, key('event', `seed-${order}`), transactionKey, now]);
      await pool.query(`INSERT INTO credit_ledger(user_id,type,amount,monthly_delta,purchased_delta,
        monthly_after,purchased_after,mobile_store_event_key)
        VALUES($1,'monthly_grant',50,$2,0,50,7,$3)`,
      [userId, index === 0 ? 50 : 0, key('credit-grant', transactionKey)]);
    }
    return { userId, token, oldOrder, currentOrder, purchaseId };
  }

  function serviceFor(fixture: Fixture, replacement = false, bindingUserId = fixture.userId) {
    const verified: VerifiedStorePurchase = {
      store: 'google', environment: 'production',
      productId: replacement ? 'premium' : 'standard',
      externalPurchaseId: replacement ? `replacement-${fixture.token}` : fixture.token,
      linkedExternalPurchaseId: replacement ? fixture.token : null,
      transactionId: replacement ? `replacement-${fixture.currentOrder}` : fixture.currentOrder,
      eventId: null, state: 'active', observedAt: new Date(now.getTime() + 1_000),
      expiresAt, autoRenewEnabled: true, renewalProductId: replacement ? null : 'premium',
      accountBinding: createGooglePlayObfuscatedAccountId(secret, bindingUserId),
      isTestPurchase: false, providerEventType: 'google.play.subscription', providerCompletion: 'acknowledge',
    };
    const completions: string[] = [];
    const service = new MobileStorePurchaseService({
      storePurchaseRepository: new PostgresStorePurchaseRepository(database, database),
      creditRepository: new PostgresCreditRepository(database, database),
      productCatalog: createStoreProductCatalog([
        { store: 'google', productId: 'standard', kind: 'subscription', planCode: 'standard' },
        { store: 'google', productId: 'premium', kind: 'subscription', planCode: 'premium' },
      ]),
      appleVerifier: { verifyTransaction: async () => { throw new Error('unused'); }, verifyNotification: async () => null },
      googleVerifier: {
        verifyPurchase: async () => verified,
        completePurchase: async input => { completions.push(input.purchaseToken); },
      },
      identifierSecret: secret, allowAppleSandbox: false, allowGoogleTestPurchases: false,
      googlePackageName: 'jp.lyra.test', clock: () => now,
    });
    return { service, completions, verified };
  }

  it('移行済み購入のrestoreと過去注文refund再送で現creditを変更しない', async () => {
    const fixture = fixtures.get('refund')!;
    const { service } = serviceFor(fixture);
    const restored = await service.restorePurchases({
      userId: fixture.userId, appleSignedTransactions: [], googlePurchaseTokens: [fixture.token],
    });
    expect(restored[0]).toMatchObject({ isDuplicate: true, creditsChanged: 0, scheduledPlanCode: 'premium' });
    const notification = rtdn(`void-${fixture.userId}`, {
      voidedPurchaseNotification: { purchaseToken: fixture.token, orderId: fixture.oldOrder, productType: 1, refundType: 1 },
    });
    await service.handleGoogleRtdn(notification);
    await service.handleGoogleRtdn(notification);
    await service.handleGoogleRtdn({ ...notification, messageId: `void-redelivered-${fixture.userId}` });
    expect(await balance(fixture.userId)).toEqual({ monthly_credits: 50, purchased_credits: 7 });
    expect((await pool.query('SELECT state,reversed_credits,transaction_key FROM mobile_store_purchases WHERE id=$1', [fixture.purchaseId])).rows[0])
      .toEqual({ state: 'active', reversed_credits: 0, transaction_key: key('transaction', fixture.currentOrder) });
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM mobile_store_purchase_events WHERE purchase_id=$1 AND operation='reverse'", [fixture.purchaseId])).rows[0].n).toBe(1);
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM credit_ledger WHERE user_id=$1 AND type='purchase_reversal'", [fixture.userId])).rows[0].n).toBe(0);
  });

  it('移行済みlinked tokenの並行RTDNとrestoreで新planを一度だけ付与する', async () => {
    const fixture = fixtures.get('linked')!;
    const { service, completions, verified } = serviceFor(fixture, true);
    const notification = rtdn(`replace-${fixture.userId}`, {
      subscriptionNotification: { notificationType: 4, purchaseToken: verified.externalPurchaseId, subscriptionId: 'premium' },
    });
    await Promise.all([service.handleGoogleRtdn(notification), service.handleGoogleRtdn(notification)]);
    expect(await balance(fixture.userId)).toEqual({ monthly_credits: 175, purchased_credits: 7 });
    expect((await pool.query('SELECT plan_code FROM users WHERE id=$1', [fixture.userId])).rows[0].plan_code).toBe('premium');
    const restored = await service.restorePurchases({
      userId: fixture.userId, appleSignedTransactions: [], googlePurchaseTokens: [verified.externalPurchaseId],
    });
    expect(restored[0]).toMatchObject({ isDuplicate: true, creditsChanged: 0 });
    expect(await balance(fixture.userId)).toEqual({ monthly_credits: 175, purchased_credits: 7 });
    expect((await pool.query('SELECT state FROM mobile_store_purchases WHERE id=$1', [fixture.purchaseId])).rows[0].state).toBe('expired');
    expect((await pool.query('SELECT plan_code FROM users WHERE id=$1', [fixture.userId])).rows[0].plan_code).toBe('premium');
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM credit_ledger WHERE user_id=$1 AND type='monthly_grant'", [fixture.userId])).rows[0].n).toBe(2);
    expect(completions).toHaveLength(3);
  });

  it('移行済みlinked tokenのbinding不一致では購入とcreditを変更しない', async () => {
    const fixture = fixtures.get('binding')!;
    const { service, completions, verified } = serviceFor(fixture, true, randomUUID());
    expect(await throwingRejectionOf(service.handleGoogleRtdn(rtdn(`bad-binding-${fixture.userId}`, {
      subscriptionNotification: { notificationType: 4, purchaseToken: verified.externalPurchaseId },
    })))).toThrow('Store purchase account binding does not match');
    expect(await balance(fixture.userId)).toEqual({ monthly_credits: 50, purchased_credits: 7 });
    expect((await pool.query('SELECT state FROM mobile_store_purchases WHERE user_id=$1', [fixture.userId])).rows).toEqual([{ state: 'active' }]);
    expect(completions).toHaveLength(0);
  });

  it('削除済みaccountの移行済みlinked tokenからbalanceとplanを再作成しない', async () => {
    const fixture = fixtures.get('deleted')!;
    await pool.query("UPDATE users SET account_deletion_started_at=NOW(),account_deleted_at=NOW(),plan_code='free' WHERE id=$1", [fixture.userId]);
    await pool.query('DELETE FROM credit_balances WHERE user_id=$1', [fixture.userId]);
    const { service, verified } = serviceFor(fixture, true);
    const notification = rtdn(`deleted-${fixture.userId}`, {
      subscriptionNotification: { notificationType: 4, purchaseToken: verified.externalPurchaseId },
    });
    await service.handleGoogleRtdn(notification);
    await service.handleGoogleRtdn(notification);
    expect(await balance(fixture.userId)).toBeUndefined();
    expect((await pool.query('SELECT plan_code FROM users WHERE id=$1', [fixture.userId])).rows[0].plan_code).toBe('free');
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM credit_ledger WHERE user_id=$1 AND type='monthly_grant'", [fixture.userId])).rows[0].n).toBe(1);
  });

  async function balance(userId: string) {
    return (await pool.query('SELECT monthly_credits,purchased_credits FROM credit_balances WHERE user_id=$1', [userId])).rows[0];
  }
});

function key(namespace: string, value: string): string {
  return createStoreIdentifierKey(secret, `google:${namespace}`, value);
}

function rtdn(messageId: string, payload: Record<string, unknown>) {
  return {
    messageId, publishTime: new Date(now.getTime() + 2_000),
    data: Buffer.from(JSON.stringify({ packageName: 'jp.lyra.test', ...payload })).toString('base64'),
  };
}

function adapter(pool: Pool): DatabaseClient & TransactionRunner {
  return {
    query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => pool.query<Row>(text, values),
    transaction: async <T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> => {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        const result = await work({ query: async <Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => connection.query<Row>(text, values) });
        await connection.query('COMMIT');
        return result;
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}
