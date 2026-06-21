import type { QueryResultRow } from 'pg';
import type {
  ActiveSubscriptionRecord,
  BillingUserProfile,
  PaymentRecordInput,
  SubscriptionRecord,
} from '../domain/types/billing.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

interface BillingUserProfileRow extends QueryResultRow {
  id: string;
  email: string;
  stripe_customer_id: string | null;
  plan_code: string;
}

interface StripeCustomerIdRow extends QueryResultRow {
  stripe_customer_id: string | null;
}

interface SubscriptionRow extends QueryResultRow {
  user_id: string;
  stripe_subscription_id: string;
  plan_code: string;
  status: string;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
}

export interface BillingRepository {
  transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T>;
  findBillingUserProfile(userId: string, client?: DatabaseClient): Promise<BillingUserProfile | null>;
  findBillingUserProfileByStripeCustomerId(
    stripeCustomerId: string,
    client?: DatabaseClient,
  ): Promise<BillingUserProfile | null>;
  setStripeCustomerId(userId: string, stripeCustomerId: string, client?: DatabaseClient): Promise<string | null>;
  updateUserPlanCode(userId: string, planCode: string, client: DatabaseClient): Promise<boolean>;
  findLatestActiveSubscriptionForUser(
    userId: string,
    client?: DatabaseClient,
  ): Promise<ActiveSubscriptionRecord | null>;
  findHighestActiveSubscriptionPlanForUserExcluding(
    userId: string,
    excludedStripeSubscriptionId: string,
    client: DatabaseClient,
  ): Promise<BillingUserProfile['planCode'] | null>;
  hasStripeEventProcessed(stripeEventId: string, client?: DatabaseClient): Promise<boolean>;
  markStripeEventProcessed(stripeEventId: string, eventType: string, client: DatabaseClient): Promise<boolean>;
  upsertSubscription(record: SubscriptionRecord, client: DatabaseClient): Promise<void>;
  markSubscriptionDeleted(stripeSubscriptionId: string, client: DatabaseClient): Promise<void>;
  insertPaymentRecord(record: PaymentRecordInput, client: DatabaseClient): Promise<boolean>;
}

export class PostgresBillingRepository implements BillingRepository {
  public constructor(
    private readonly client: DatabaseClient,
    private readonly transactionRunner: TransactionRunner,
  ) {}

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return this.transactionRunner.transaction(work);
  }

  public async findBillingUserProfile(
    userId: string,
    client: DatabaseClient = this.client,
  ): Promise<BillingUserProfile | null> {
    const result = await client.query<BillingUserProfileRow>(
      `
      SELECT id, email, stripe_customer_id, plan_code
      FROM users
      WHERE id = $1
      `,
      [userId],
    );

    return result.rows[0] === undefined ? null : mapBillingUserProfileRow(result.rows[0]);
  }

  public async findBillingUserProfileByStripeCustomerId(
    stripeCustomerId: string,
    client: DatabaseClient = this.client,
  ): Promise<BillingUserProfile | null> {
    const result = await client.query<BillingUserProfileRow>(
      `
      SELECT id, email, stripe_customer_id, plan_code
      FROM users
      WHERE stripe_customer_id = $1
      `,
      [stripeCustomerId],
    );

    return result.rows[0] === undefined ? null : mapBillingUserProfileRow(result.rows[0]);
  }

  public async setStripeCustomerId(
    userId: string,
    stripeCustomerId: string,
    client: DatabaseClient = this.client,
  ): Promise<string | null> {
    const result = await client.query<StripeCustomerIdRow>(
      `
      UPDATE users
      SET stripe_customer_id = COALESCE(stripe_customer_id, $2),
          updated_at = NOW()
      WHERE id = $1
      RETURNING stripe_customer_id
      `,
      [userId, stripeCustomerId],
    );

    return result.rows[0]?.stripe_customer_id ?? null;
  }

  public async updateUserPlanCode(userId: string, planCode: string, client: DatabaseClient): Promise<boolean> {
    const result = await client.query(
      `
      UPDATE users
      SET plan_code = $2,
          updated_at = NOW()
      WHERE id = $1
      `,
      [userId, planCode],
    );

    return result.rowCount === 1;
  }

  public async findLatestActiveSubscriptionForUser(
    userId: string,
    client: DatabaseClient = this.client,
  ): Promise<ActiveSubscriptionRecord | null> {
    const result = await client.query<SubscriptionRow>(
      `
      SELECT
        user_id,
        stripe_subscription_id,
        plan_code,
        status,
        current_period_start,
        current_period_end,
        cancel_at_period_end
      FROM subscriptions
      WHERE user_id = $1
        AND status IN ('active', 'trialing')
      ORDER BY
        CASE plan_code
          WHEN 'premium' THEN 2
          WHEN 'standard' THEN 1
          ELSE 0
        END DESC,
        current_period_end DESC NULLS LAST,
        updated_at DESC
      LIMIT 1
      `,
      [userId],
    );

    return result.rows[0] === undefined ? null : mapSubscriptionRow(result.rows[0]);
  }

  public async findHighestActiveSubscriptionPlanForUserExcluding(
    userId: string,
    excludedStripeSubscriptionId: string,
    client: DatabaseClient,
  ): Promise<BillingUserProfile['planCode'] | null> {
    const result = await client.query<{ plan_code: string }>(
      `
      SELECT plan_code
      FROM subscriptions
      WHERE user_id = $1
        AND stripe_subscription_id <> $2
        AND status IN ('active', 'trialing')
      ORDER BY
        CASE plan_code
          WHEN 'premium' THEN 2
          WHEN 'standard' THEN 1
          ELSE 0
        END DESC,
        current_period_end DESC NULLS LAST,
        updated_at DESC
      LIMIT 1
      `,
      [userId, excludedStripeSubscriptionId],
    );

    return (result.rows[0]?.plan_code as BillingUserProfile['planCode'] | undefined) ?? null;
  }

  public async hasStripeEventProcessed(
    stripeEventId: string,
    client: DatabaseClient = this.client,
  ): Promise<boolean> {
    const result = await client.query(
      `
      SELECT 1
      FROM processed_stripe_events
      WHERE stripe_event_id = $1
      LIMIT 1
      `,
      [stripeEventId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async markStripeEventProcessed(
    stripeEventId: string,
    eventType: string,
    client: DatabaseClient,
  ): Promise<boolean> {
    const result = await client.query(
      `
      INSERT INTO processed_stripe_events (stripe_event_id, event_type)
      VALUES ($1, $2)
      ON CONFLICT (stripe_event_id) DO NOTHING
      `,
      [stripeEventId, eventType],
    );

    return result.rowCount === 1;
  }

  public async upsertSubscription(record: SubscriptionRecord, client: DatabaseClient): Promise<void> {
    await client.query(
      `
      INSERT INTO subscriptions (
        user_id,
        stripe_subscription_id,
        plan_code,
        status,
        current_period_start,
        current_period_end,
        cancel_at_period_end
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (stripe_subscription_id)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        plan_code = EXCLUDED.plan_code,
        status = EXCLUDED.status,
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        updated_at = NOW()
      `,
      [
        record.userId,
        record.stripeSubscriptionId,
        record.planCode,
        record.status,
        record.currentPeriodStart,
        record.currentPeriodEnd,
        record.cancelAtPeriodEnd,
      ],
    );
  }

  public async markSubscriptionDeleted(stripeSubscriptionId: string, client: DatabaseClient): Promise<void> {
    await client.query(
      `
      UPDATE subscriptions
      SET status = 'canceled',
          cancel_at_period_end = FALSE,
          updated_at = NOW()
      WHERE stripe_subscription_id = $1
      `,
      [stripeSubscriptionId],
    );
  }

  public async insertPaymentRecord(record: PaymentRecordInput, client: DatabaseClient): Promise<boolean> {
    const result = await client.query(
      `
      INSERT INTO payment_records (
        user_id,
        stripe_checkout_session_id,
        stripe_invoice_id,
        kind,
        amount_jpy,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT DO NOTHING
      `,
      [
        record.userId,
        record.stripeCheckoutSessionId,
        record.stripeInvoiceId,
        record.kind,
        record.amountJpy,
        record.status,
      ],
    );

    return result.rowCount === 1;
  }
}

function mapBillingUserProfileRow(row: BillingUserProfileRow): BillingUserProfile {
  return {
    userId: row.id,
    email: row.email,
    stripeCustomerId: row.stripe_customer_id,
    planCode: row.plan_code as BillingUserProfile['planCode'],
  };
}

function mapSubscriptionRow(row: SubscriptionRow): ActiveSubscriptionRecord {
  return {
    userId: row.user_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    planCode: row.plan_code as ActiveSubscriptionRecord['planCode'],
    status: row.status as ActiveSubscriptionRecord['status'],
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
  };
}
