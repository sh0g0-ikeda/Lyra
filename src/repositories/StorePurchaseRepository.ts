import type { QueryResultRow } from 'pg';
import type {
  ConsumerPaidPlanCode,
  CreditPackageCode,
} from '../domain/constants/billing.js';
import type {
  StorePurchaseEnvironment,
  StorePurchaseKind,
  StorePurchaseState,
  StorePurchaseStore,
} from '../domain/storePurchase.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

export interface StorePurchaseRecord {
  id: string;
  userId: string;
  store: StorePurchaseStore;
  environment: StorePurchaseEnvironment;
  externalPurchaseKey: string;
  productId: string;
  kind: StorePurchaseKind;
  planCode: ConsumerPaidPlanCode | null;
  creditPackageCode: CreditPackageCode | null;
  state: StorePurchaseState;
  transactionKey: string | null;
  expiresAt: Date | null;
  autoRenewEnabled: boolean | null;
  scheduledProductId: string | null;
  scheduledPlanCode: ConsumerPaidPlanCode | null;
  scheduledEffectiveAt: Date | null;
  grantedCredits: number;
  reversedCredits: number;
  lastObservedAt: Date;
}

export interface StorePurchaseUserRecord {
  id: string;
  planCode: string;
}

export interface CreateStorePurchaseInput {
  userId: string;
  store: StorePurchaseStore;
  environment: StorePurchaseEnvironment;
  externalPurchaseKey: string;
  productId: string;
  kind: StorePurchaseKind;
  planCode: ConsumerPaidPlanCode | null;
  creditPackageCode: CreditPackageCode | null;
  state: StorePurchaseState;
  transactionKey: string | null;
  expiresAt: Date | null;
  autoRenewEnabled: boolean | null;
  scheduledProductId: string | null;
  scheduledPlanCode: ConsumerPaidPlanCode | null;
  scheduledEffectiveAt: Date | null;
  lastObservedAt: Date;
}

export interface UpdateStorePurchaseInput {
  productId: string;
  kind: StorePurchaseKind;
  planCode: ConsumerPaidPlanCode | null;
  creditPackageCode: CreditPackageCode | null;
  state: StorePurchaseState;
  transactionKey: string | null;
  expiresAt: Date | null;
  autoRenewEnabled: boolean | null;
  scheduledProductId: string | null;
  scheduledPlanCode: ConsumerPaidPlanCode | null;
  scheduledEffectiveAt: Date | null;
  lastObservedAt: Date;
}

export interface StorePurchaseEventInput {
  purchaseId: string | null;
  store: StorePurchaseStore;
  eventKey: string;
  transactionKey: string | null;
  operation: 'observe' | 'grant' | 'reverse';
  providerEventType: string;
  state: StorePurchaseState;
  occurredAt: Date;
}

export interface StorePurchaseRepository {
  transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T>;
  lockPurchaseKey(store: StorePurchaseStore, externalPurchaseKey: string, client: DatabaseClient): Promise<void>;
  findUserForUpdate(userId: string, client: DatabaseClient): Promise<StorePurchaseUserRecord | null>;
  findPurchaseForUpdate(
    store: StorePurchaseStore,
    externalPurchaseKey: string,
    client: DatabaseClient,
  ): Promise<StorePurchaseRecord | null>;
  createPurchase(input: CreateStorePurchaseInput, client: DatabaseClient): Promise<StorePurchaseRecord>;
  updatePurchase(
    purchaseId: string,
    input: UpdateStorePurchaseInput,
    client: DatabaseClient,
  ): Promise<StorePurchaseRecord>;
  recordEventIfNew(input: StorePurchaseEventInput, client: DatabaseClient): Promise<boolean>;
  addGrantedCredits(purchaseId: string, amount: number, client: DatabaseClient): Promise<void>;
  addReversedCredits(purchaseId: string, amount: number, client: DatabaseClient): Promise<void>;
  hasActiveStripeConsumerSubscription(userId: string, client: DatabaseClient): Promise<boolean>;
  resolvePersonalPlan(userId: string, client: DatabaseClient): Promise<ConsumerPaidPlanCode | null>;
  updatePersonalPlan(userId: string, planCode: ConsumerPaidPlanCode | 'free', client: DatabaseClient): Promise<void>;
}

interface StorePurchaseRow extends QueryResultRow {
  id: string;
  user_id: string;
  store: StorePurchaseStore;
  environment: StorePurchaseEnvironment;
  external_purchase_key: string;
  product_id: string;
  kind: StorePurchaseKind;
  plan_code: ConsumerPaidPlanCode | null;
  credit_package_code: CreditPackageCode | null;
  state: StorePurchaseState;
  transaction_key: string | null;
  expires_at: Date | null;
  auto_renew_enabled: boolean | null;
  scheduled_product_id: string | null;
  scheduled_plan_code: ConsumerPaidPlanCode | null;
  scheduled_effective_at: Date | null;
  granted_credits: number;
  reversed_credits: number;
  last_observed_at: Date;
}

export class PostgresStorePurchaseRepository implements StorePurchaseRepository {
  public constructor(private readonly transactionRunner: TransactionRunner) {}

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return this.transactionRunner.transaction(work);
  }

  public async lockPurchaseKey(
    store: StorePurchaseStore,
    externalPurchaseKey: string,
    client: DatabaseClient,
  ): Promise<void> {
    await client.query(
      `
      SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
      `,
      [`${store}:${externalPurchaseKey}`],
    );
  }

  public async findUserForUpdate(userId: string, client: DatabaseClient): Promise<StorePurchaseUserRecord | null> {
    const result = await client.query<StorePurchaseUserRecord & QueryResultRow>(
      `
      SELECT id, plan_code AS "planCode"
      FROM users
      WHERE id = $1
      FOR UPDATE
      `,
      [userId],
    );
    const row = result.rows[0];

    return row === undefined ? null : { id: row.id, planCode: row.planCode };
  }

  public async findPurchaseForUpdate(
    store: StorePurchaseStore,
    externalPurchaseKey: string,
    client: DatabaseClient,
  ): Promise<StorePurchaseRecord | null> {
    const result = await client.query<StorePurchaseRow>(
      `${storePurchaseSelectSql}
      WHERE store = $1
        AND external_purchase_key = $2
      FOR UPDATE`,
      [store, externalPurchaseKey],
    );

    return result.rows[0] === undefined ? null : mapStorePurchaseRow(result.rows[0]);
  }

  public async createPurchase(input: CreateStorePurchaseInput, client: DatabaseClient): Promise<StorePurchaseRecord> {
    const result = await client.query<StorePurchaseRow>(
      `
      INSERT INTO mobile_store_purchases (
        user_id,
        store,
        environment,
        external_purchase_key,
        product_id,
        kind,
        plan_code,
        credit_package_code,
        state,
        transaction_key,
        expires_at,
        auto_renew_enabled,
        scheduled_product_id,
        scheduled_plan_code,
        scheduled_effective_at,
        last_observed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING ${storePurchaseFields}
      `,
      [
        input.userId,
        input.store,
        input.environment,
        input.externalPurchaseKey,
        input.productId,
        input.kind,
        input.planCode,
        input.creditPackageCode,
        input.state,
        input.transactionKey,
        input.expiresAt,
        input.autoRenewEnabled,
        input.scheduledProductId,
        input.scheduledPlanCode,
        input.scheduledEffectiveAt,
        input.lastObservedAt,
      ],
    );

    return mapStorePurchaseRow(requireStorePurchaseRow(result.rows[0]));
  }

  public async updatePurchase(
    purchaseId: string,
    input: UpdateStorePurchaseInput,
    client: DatabaseClient,
  ): Promise<StorePurchaseRecord> {
    const result = await client.query<StorePurchaseRow>(
      `
      UPDATE mobile_store_purchases
      SET state = $2,
          transaction_key = COALESCE($3, transaction_key),
          expires_at = $4,
          auto_renew_enabled = $5,
          last_observed_at = $6,
          product_id = $7,
          kind = $8,
          plan_code = $9,
          credit_package_code = $10,
          scheduled_product_id = $11,
          scheduled_plan_code = $12,
          scheduled_effective_at = $13,
          updated_at = NOW()
      WHERE id = $1
      RETURNING ${storePurchaseFields}
      `,
      [
        purchaseId,
        input.state,
        input.transactionKey,
        input.expiresAt,
        input.autoRenewEnabled,
        input.lastObservedAt,
        input.productId,
        input.kind,
        input.planCode,
        input.creditPackageCode,
        input.scheduledProductId,
        input.scheduledPlanCode,
        input.scheduledEffectiveAt,
      ],
    );

    return mapStorePurchaseRow(requireStorePurchaseRow(result.rows[0]));
  }

  public async recordEventIfNew(input: StorePurchaseEventInput, client: DatabaseClient): Promise<boolean> {
    const result = await client.query(
      `
      INSERT INTO mobile_store_purchase_events (
        purchase_id,
        store,
        event_key,
        transaction_key,
        operation,
        provider_event_type,
        state,
        occurred_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT DO NOTHING
      RETURNING id
      `,
      [
        input.purchaseId,
        input.store,
        input.eventKey,
        input.transactionKey,
        input.operation,
        input.providerEventType,
        input.state,
        input.occurredAt,
      ],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async addGrantedCredits(purchaseId: string, amount: number, client: DatabaseClient): Promise<void> {
    await client.query(
      `
      UPDATE mobile_store_purchases
      SET granted_credits = granted_credits + $2,
          updated_at = NOW()
      WHERE id = $1
      `,
      [purchaseId, amount],
    );
  }

  public async addReversedCredits(purchaseId: string, amount: number, client: DatabaseClient): Promise<void> {
    await client.query(
      `
      UPDATE mobile_store_purchases
      SET reversed_credits = reversed_credits + $2,
          updated_at = NOW()
      WHERE id = $1
      `,
      [purchaseId, amount],
    );
  }

  public async hasActiveStripeConsumerSubscription(userId: string, client: DatabaseClient): Promise<boolean> {
    const result = await client.query(
      `
      SELECT 1
      FROM subscriptions
      WHERE user_id = $1
        AND plan_code IN ('standard', 'premium')
        AND status IN ('active', 'trialing')
      LIMIT 1
      `,
      [userId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async resolvePersonalPlan(
    userId: string,
    client: DatabaseClient,
  ): Promise<ConsumerPaidPlanCode | null> {
    const result = await client.query<{ plan_code: ConsumerPaidPlanCode }>(
      `
      WITH stripe_candidates AS (
        SELECT plan_code
        FROM subscriptions
        WHERE user_id = $1
          AND plan_code IN ('standard', 'premium')
          AND status IN ('active', 'trialing')
      ),
      personal_candidates AS (
        SELECT plan_code
        FROM stripe_candidates
        UNION ALL
        SELECT plan_code
        FROM mobile_store_purchases
        WHERE user_id = $1
          AND kind = 'subscription'
          AND plan_code IN ('standard', 'premium')
          AND (
            state = 'active'
            OR (state = 'cancelled' AND expires_at IS NOT NULL AND expires_at > NOW())
          )
      )
      SELECT plan_code
      FROM personal_candidates
      WHERE NOT EXISTS (SELECT 1 FROM stripe_candidates)
         OR plan_code IN (SELECT plan_code FROM stripe_candidates)
      ORDER BY CASE plan_code WHEN 'premium' THEN 2 WHEN 'standard' THEN 1 ELSE 0 END DESC
      LIMIT 1
      `,
      [userId],
    );

    return result.rows[0]?.plan_code ?? null;
  }

  public async updatePersonalPlan(
    userId: string,
    planCode: ConsumerPaidPlanCode | 'free',
    client: DatabaseClient,
  ): Promise<void> {
    await client.query(
      `
      UPDATE users
      SET plan_code = CASE
            WHEN plan_code IN ('free', 'standard', 'premium') THEN $2
            ELSE plan_code
          END,
          updated_at = NOW()
      WHERE id = $1
      `,
      [userId, planCode],
    );
  }
}

const storePurchaseFields = `
  id,
  user_id,
  store,
  environment,
  external_purchase_key,
  product_id,
  kind,
  plan_code,
  credit_package_code,
  state,
  transaction_key,
  expires_at,
  auto_renew_enabled,
  scheduled_product_id,
  scheduled_plan_code,
  scheduled_effective_at,
  granted_credits,
  reversed_credits,
  last_observed_at
`;

const storePurchaseSelectSql = `
  SELECT ${storePurchaseFields}
  FROM mobile_store_purchases
`;

function requireStorePurchaseRow(row: StorePurchaseRow | undefined): StorePurchaseRow {
  if (row === undefined) {
    throw new Error('Mobile store purchase write did not return a row');
  }

  return row;
}

function mapStorePurchaseRow(row: StorePurchaseRow): StorePurchaseRecord {
  return {
    id: row.id,
    userId: row.user_id,
    store: row.store,
    environment: row.environment,
    externalPurchaseKey: row.external_purchase_key,
    productId: row.product_id,
    kind: row.kind,
    planCode: row.plan_code,
    creditPackageCode: row.credit_package_code,
    state: row.state,
    transactionKey: row.transaction_key,
    expiresAt: row.expires_at,
    autoRenewEnabled: row.auto_renew_enabled,
    scheduledProductId: row.scheduled_product_id,
    scheduledPlanCode: row.scheduled_plan_code,
    scheduledEffectiveAt: row.scheduled_effective_at,
    grantedCredits: row.granted_credits,
    reversedCredits: row.reversed_credits,
    lastObservedAt: row.last_observed_at,
  };
}
