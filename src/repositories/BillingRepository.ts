import type { QueryResultRow } from 'pg';
import type {
  ActiveSubscriptionRecord,
  BillingUserProfile,
  OrganizationSubscriptionSummary,
  PaymentRecord,
  PaymentRecordInput,
  PersonalSubscriptionSummary,
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
  user_id: string | null;
  organization_id: string | null;
  stripe_subscription_id: string;
  plan_code: string;
  status: string;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
}

interface PersonalSubscriptionSummaryRow extends QueryResultRow {
  plan_code: string;
  status: string;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  store: 'apple' | 'google' | null;
  scheduled_plan_code: 'standard' | 'premium' | null;
  scheduled_plan_effective_at: Date | null;
}

interface PaymentRecordRow extends QueryResultRow {
  id: string;
  user_id: string | null;
  organization_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_invoice_id: string | null;
  kind: PaymentRecord['kind'];
  amount_jpy: number;
  status: PaymentRecord['status'];
  invoice_url: string | null;
  created_at: Date;
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
  findLatestSubscriptionSummaryForUser(
    userId: string,
    client?: DatabaseClient,
  ): Promise<PersonalSubscriptionSummary | null>;
  findLatestSubscriptionForOrganization(
    organizationId: string,
    client?: DatabaseClient,
  ): Promise<OrganizationSubscriptionSummary | null>;
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
  listPaymentRecordsByOrganizationId(
    organizationId: string,
    limit: number,
    client?: DatabaseClient,
  ): Promise<PaymentRecord[]>;
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
        organization_id,
        stripe_subscription_id,
        plan_code,
        status,
        current_period_start,
        current_period_end,
        cancel_at_period_end
      FROM subscriptions
      WHERE user_id = $1
        AND organization_id IS NULL
        AND status IN ('active', 'trialing')
      ORDER BY
        CASE plan_code
          WHEN 'enterprise_c' THEN 5
          WHEN 'enterprise_b' THEN 4
          WHEN 'enterprise_a' THEN 3
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

  public async findLatestSubscriptionSummaryForUser(
    userId: string,
    client: DatabaseClient = this.client,
  ): Promise<PersonalSubscriptionSummary | null> {
    const result = await client.query<PersonalSubscriptionSummaryRow>(
      `
      WITH personal_subscription_candidates AS (
        SELECT
          plan_code,
          status,
          current_period_end,
          cancel_at_period_end,
          NULL::text AS store,
          NULL::text AS scheduled_plan_code,
          NULL::timestamptz AS scheduled_plan_effective_at,
          updated_at,
          2 AS provider_priority
        FROM subscriptions
        WHERE user_id = $1
          AND organization_id IS NULL
          AND status IN ('active', 'trialing')

        UNION ALL

        SELECT
          plan_code,
          CASE WHEN state = 'active' THEN 'active' ELSE 'canceled' END AS status,
          expires_at AS current_period_end,
          state = 'cancelled' OR auto_renew_enabled = FALSE AS cancel_at_period_end,
          store,
          scheduled_plan_code,
          scheduled_effective_at AS scheduled_plan_effective_at,
          updated_at,
          1 AS provider_priority
        FROM mobile_store_purchases
        WHERE user_id = $1
          AND kind = 'subscription'
          AND plan_code IN ('standard', 'premium')
          AND (
            state = 'active'
            OR (state = 'cancelled' AND expires_at IS NOT NULL AND expires_at > NOW())
          )
      )
      SELECT
        plan_code,
        status,
        current_period_end,
        cancel_at_period_end,
        store,
        scheduled_plan_code,
        scheduled_plan_effective_at
      FROM personal_subscription_candidates
      ORDER BY
        provider_priority DESC,
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

    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }

    return {
      planCode: row.plan_code as PersonalSubscriptionSummary['planCode'],
      status: row.status as PersonalSubscriptionSummary['status'],
      currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: row.cancel_at_period_end,
      store: row.store,
      scheduledPlanCode: row.scheduled_plan_code,
      scheduledPlanEffectiveAt: row.scheduled_plan_effective_at,
    };
  }

  public async findLatestSubscriptionForOrganization(
    organizationId: string,
    client: DatabaseClient = this.client,
  ): Promise<OrganizationSubscriptionSummary | null> {
    const result = await client.query<SubscriptionRow>(
      `
      SELECT
        user_id,
        organization_id,
        stripe_subscription_id,
        plan_code,
        status,
        current_period_start,
        current_period_end,
        cancel_at_period_end
      FROM subscriptions
      WHERE organization_id = $1
      ORDER BY
        CASE status
          WHEN 'active' THEN 3
          WHEN 'trialing' THEN 2
          WHEN 'past_due' THEN 1
          ELSE 0
        END DESC,
        current_period_end DESC NULLS LAST,
        updated_at DESC
      LIMIT 1
      `,
      [organizationId],
    );

    const row = result.rows[0];
    if (row === undefined || row.organization_id === null) {
      return null;
    }

    return {
      organizationId: row.organization_id,
      planCode: row.plan_code as OrganizationSubscriptionSummary['planCode'],
      status: row.status as OrganizationSubscriptionSummary['status'],
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: row.cancel_at_period_end,
    };
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
        AND organization_id IS NULL
        AND stripe_subscription_id <> $2
        AND status IN ('active', 'trialing')
      ORDER BY
        CASE plan_code
          WHEN 'enterprise_c' THEN 5
          WHEN 'enterprise_b' THEN 4
          WHEN 'enterprise_a' THEN 3
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
        organization_id,
        stripe_subscription_id,
        plan_code,
        status,
        current_period_start,
        current_period_end,
        cancel_at_period_end
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (stripe_subscription_id)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        organization_id = EXCLUDED.organization_id,
        plan_code = EXCLUDED.plan_code,
        status = EXCLUDED.status,
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        updated_at = NOW()
      `,
      [
        record.userId,
        record.organizationId,
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
        organization_id,
        stripe_checkout_session_id,
        stripe_invoice_id,
        invoice_url,
        kind,
        amount_jpy,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT DO NOTHING
      `,
      [
        record.userId,
        record.organizationId,
        record.stripeCheckoutSessionId,
        record.stripeInvoiceId,
        record.invoiceUrl ?? null,
        record.kind,
        record.amountJpy,
        record.status,
      ],
    );

    return result.rowCount === 1;
  }

  public async listPaymentRecordsByOrganizationId(
    organizationId: string,
    limit: number,
    client: DatabaseClient = this.client,
  ): Promise<PaymentRecord[]> {
    const result = await client.query<PaymentRecordRow>(
      `
      SELECT
        id,
        user_id,
        organization_id,
        stripe_checkout_session_id,
        stripe_invoice_id,
        invoice_url,
        kind,
        amount_jpy,
        status,
        created_at
      FROM payment_records
      WHERE organization_id = $1
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [organizationId, limit],
    );

    return result.rows.map(mapPaymentRecordRow);
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
    organizationId: row.organization_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    planCode: row.plan_code as ActiveSubscriptionRecord['planCode'],
    status: row.status as ActiveSubscriptionRecord['status'],
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
  };
}

function mapPaymentRecordRow(row: PaymentRecordRow): PaymentRecord {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    stripeInvoiceId: row.stripe_invoice_id,
    invoiceUrl: row.invoice_url,
    kind: row.kind,
    amountJpy: Number(row.amount_jpy),
    status: row.status,
    createdAt: row.created_at,
  };
}
