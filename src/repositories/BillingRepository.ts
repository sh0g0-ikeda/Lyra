import type { QueryResultRow } from 'pg';
import type {
  ActiveSubscriptionRecord,
  BillingUserProfile,
  OrganizationSubscriptionSummary,
  PaymentRecord,
  PaymentRecordInput,
  CreditGrantBucket,
  StripePaymentAdjustmentObjectInput,
  StripePaymentRecovery,
  SubscriptionRecord,
} from '../domain/types/billing.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

interface BillingUserProfileRow extends QueryResultRow {
  id: string;
  email: string;
  stripe_customer_id: string | null;
  plan_code: string;
  account_deletion_started_at: Date | null;
  account_deleted_at: Date | null;
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
  granted_credits: number | null;
  credit_bucket: CreditGrantBucket | null;
  grant_expires_at: Date | null;
  created_at: Date;
}

interface StripePaymentRecoveryRow extends QueryResultRow {
  id: string;
  payment_record_id: string;
  user_id: string | null;
  organization_id: string | null;
  kind: PaymentRecord['kind'];
  amount_jpy: number;
  stripe_payment_intent_id: string;
  stripe_charge_id: string | null;
  currency: 'jpy';
  credit_bucket: CreditGrantBucket;
  granted_credits: number;
  grant_expires_at: Date | null;
  observed_refunded_amount_jpy: number;
  lost_dispute_amount_jpy: string;
  target_reversal_credits: number;
  reversed_credits: number;
  unrecovered_credits: number;
  has_pending_refund: boolean;
  has_open_dispute: boolean;
}

export interface StripePaymentRecoverySource {
  paymentRecordId: string;
  userId: string | null;
  organizationId: string | null;
  kind: PaymentRecord['kind'];
  amountJpy: number;
  grantedCredits: number | null;
  creditBucket: CreditGrantBucket | null;
  grantExpiresAt: Date | null;
}

export interface BillingRecoveryRepository {
  createStripePaymentRecoveryForCheckout(
    input: {
      stripeCheckoutSessionId: string;
      stripePaymentIntentId: string;
      currency: 'jpy';
      grantedCredits: number;
      grantExpiresAt: Date | null;
    },
    client: DatabaseClient,
  ): Promise<void>;
  findStripePaymentRecoverySource(
    externalId: { type: 'checkout'; id: string } | { type: 'invoice'; id: string },
    client: DatabaseClient,
    forUpdate?: boolean,
  ): Promise<StripePaymentRecoverySource | null>;
  lockPersonalStripeRecoveryUser(
    userId: string,
    client: DatabaseClient,
  ): Promise<boolean>;
  createStripePaymentRecoveryForPaymentRecord(
    input: {
      paymentRecordId: string;
      stripePaymentIntentId: string;
      currency: 'jpy';
      creditBucket: CreditGrantBucket;
      grantedCredits: number;
      grantExpiresAt: Date | null;
    },
    client: DatabaseClient,
  ): Promise<boolean>;
  upsertUnresolvedStripePaymentAdjustment(
    input: Omit<StripePaymentAdjustmentObjectInput, 'recoveryId'> & {
      paymentRecordId: string;
      stripePaymentIntentId: string;
      stripeChargeId: string;
      observedRefundedAmountJpy: number;
    },
    client: DatabaseClient,
  ): Promise<boolean>;
  resolveUnresolvedStripePaymentAdjustments(paymentRecordId: string, client: DatabaseClient): Promise<void>;
  findStripePaymentRecoveryForUpdate(
    stripePaymentIntentId: string,
    client: DatabaseClient,
  ): Promise<StripePaymentRecovery | null>;
  findStripePaymentRecovery(
    stripePaymentIntentId: string,
    client: DatabaseClient,
  ): Promise<StripePaymentRecovery | null>;
  bindStripeChargeToRecovery(recoveryId: string, stripeChargeId: string, client: DatabaseClient): Promise<boolean>;
  upsertStripePaymentAdjustmentObject(
    input: StripePaymentAdjustmentObjectInput,
    client: DatabaseClient,
  ): Promise<boolean>;
  updateStripePaymentRecoveryTotals(
    recoveryId: string,
    input: {
      observedRefundedAmountJpy: number;
      targetReversalCredits: number;
      reversedCredits: number;
      unrecoveredCredits: number;
    },
    client: DatabaseClient,
  ): Promise<void>;
}

export interface BillingRepository {
  transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T>;
  findBillingUserProfile(
    userId: string,
    client?: DatabaseClient,
    forUpdate?: boolean,
  ): Promise<BillingUserProfile | null>;
  findBillingUserProfileByStripeCustomerId(
    stripeCustomerId: string,
    client?: DatabaseClient,
    forUpdate?: boolean,
  ): Promise<BillingUserProfile | null>;
  setStripeCustomerId(userId: string, stripeCustomerId: string, client?: DatabaseClient): Promise<string | null>;
  updateUserPlanCode(userId: string, planCode: string, client: DatabaseClient): Promise<boolean>;
  findLatestActiveSubscriptionForUser(
    userId: string,
    client?: DatabaseClient,
  ): Promise<ActiveSubscriptionRecord | null>;
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
    forUpdate = false,
  ): Promise<BillingUserProfile | null> {
    const result = await client.query<BillingUserProfileRow>(
      `
      SELECT
        id,
        email,
        stripe_customer_id,
        plan_code,
        account_deletion_started_at,
        account_deleted_at
      FROM users
      WHERE id = $1
      ${forUpdate ? 'FOR UPDATE' : ''}
      `,
      [userId],
    );

    return result.rows[0] === undefined ? null : mapBillingUserProfileRow(result.rows[0]);
  }

  public async findBillingUserProfileByStripeCustomerId(
    stripeCustomerId: string,
    client: DatabaseClient = this.client,
    forUpdate = false,
  ): Promise<BillingUserProfile | null> {
    const result = await client.query<BillingUserProfileRow>(
      `
      SELECT
        id,
        email,
        stripe_customer_id,
        plan_code,
        account_deletion_started_at,
        account_deleted_at
      FROM users
      WHERE stripe_customer_id = $1
      ${forUpdate ? 'FOR UPDATE' : ''}
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
        AND account_deletion_started_at IS NULL
        AND account_deleted_at IS NULL
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
        AND account_deletion_started_at IS NULL
        AND account_deleted_at IS NULL
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
        status,
        granted_credits,
        credit_bucket,
        grant_expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        record.grantedCredits ?? null,
        record.creditBucket ?? null,
        record.grantExpiresAt ?? null,
      ],
    );

    return result.rowCount === 1;
  }

  public async createStripePaymentRecoveryForCheckout(
    input: {
      stripeCheckoutSessionId: string;
      stripePaymentIntentId: string;
      currency: 'jpy';
      grantedCredits: number;
      grantExpiresAt: Date | null;
    },
    client: DatabaseClient,
  ): Promise<void> {
    const source = await this.findStripePaymentRecoverySource(
      { type: 'checkout', id: input.stripeCheckoutSessionId },
      client,
    );
    if (source === null) return;
    await this.createStripePaymentRecoveryForPaymentRecord(
      {
        paymentRecordId: source.paymentRecordId,
        stripePaymentIntentId: input.stripePaymentIntentId,
        currency: input.currency,
        creditBucket: 'purchased',
        grantedCredits: input.grantedCredits,
        grantExpiresAt: input.grantExpiresAt,
      },
      client,
    );
  }

  public async findStripePaymentRecoverySource(
    externalId: { type: 'checkout'; id: string } | { type: 'invoice'; id: string },
    client: DatabaseClient,
    forUpdate = true,
  ): Promise<StripePaymentRecoverySource | null> {
    const externalColumn = externalId.type === 'checkout' ? 'stripe_checkout_session_id' : 'stripe_invoice_id';
    const result = await client.query<PaymentRecordRow>(
      `
      SELECT id, user_id, organization_id, stripe_checkout_session_id, stripe_invoice_id,
             invoice_url, kind, amount_jpy, status, granted_credits, credit_bucket,
             grant_expires_at, created_at
      FROM payment_records
      WHERE ${externalColumn} = $1
        AND status = 'paid'
      ${forUpdate ? 'FOR UPDATE' : ''}
      `,
      [externalId.id],
    );
    if (result.rows.length !== 1) return null;
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      paymentRecordId: row.id,
      userId: row.user_id,
      organizationId: row.organization_id,
      kind: row.kind,
      amountJpy: Number(row.amount_jpy),
      grantedCredits: row.granted_credits === null ? null : Number(row.granted_credits),
      creditBucket: row.credit_bucket,
      grantExpiresAt: row.grant_expires_at,
    };
  }

  public async lockPersonalStripeRecoveryUser(
    userId: string,
    client: DatabaseClient,
  ): Promise<boolean> {
    const result = await client.query(
      `
      SELECT id
      FROM users
      WHERE id = $1
      FOR UPDATE
      `,
      [userId],
    );
    return result.rowCount === 1;
  }

  public async createStripePaymentRecoveryForPaymentRecord(
    input: {
      paymentRecordId: string;
      stripePaymentIntentId: string;
      currency: 'jpy';
      creditBucket: CreditGrantBucket;
      grantedCredits: number;
      grantExpiresAt: Date | null;
    },
    client: DatabaseClient,
  ): Promise<boolean> {
    const result = await client.query(
      `
      INSERT INTO stripe_payment_recoveries (
        payment_record_id,
        stripe_payment_intent_id,
        currency,
        credit_bucket,
        granted_credits,
        grant_expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (payment_record_id) DO NOTHING
      RETURNING id
      `,
      [
        input.paymentRecordId,
        input.stripePaymentIntentId,
        input.currency,
        input.creditBucket,
        input.grantedCredits,
        input.grantExpiresAt,
      ],
    );
    if (result.rowCount === 1) return true;
    const existing = await this.findStripePaymentRecoveryForUpdate(input.stripePaymentIntentId, client);
    return existing?.paymentRecordId === input.paymentRecordId;
  }

  public async upsertUnresolvedStripePaymentAdjustment(
    input: Omit<StripePaymentAdjustmentObjectInput, 'recoveryId'> & {
      paymentRecordId: string;
      stripePaymentIntentId: string;
      stripeChargeId: string;
      observedRefundedAmountJpy: number;
    },
    client: DatabaseClient,
  ): Promise<boolean> {
    const result = await client.query(
      `
      INSERT INTO stripe_unresolved_payment_adjustments (
        payment_record_id, stripe_payment_intent_id, stripe_charge_id,
        provider_type, provider_object_id, status, amount_jpy,
        observed_refunded_amount_jpy, last_stripe_event_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (provider_type, provider_object_id)
      DO UPDATE SET
        status = CASE
          WHEN stripe_unresolved_payment_adjustments.status IN ('succeeded', 'failed', 'won', 'lost')
            THEN stripe_unresolved_payment_adjustments.status
          ELSE EXCLUDED.status
        END,
        amount_jpy = EXCLUDED.amount_jpy,
        observed_refunded_amount_jpy = GREATEST(
          stripe_unresolved_payment_adjustments.observed_refunded_amount_jpy,
          EXCLUDED.observed_refunded_amount_jpy
        ),
        last_stripe_event_id = EXCLUDED.last_stripe_event_id,
        updated_at = NOW()
      WHERE stripe_unresolved_payment_adjustments.payment_record_id = EXCLUDED.payment_record_id
        AND stripe_unresolved_payment_adjustments.stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id
        AND stripe_unresolved_payment_adjustments.stripe_charge_id = EXCLUDED.stripe_charge_id
        AND stripe_unresolved_payment_adjustments.resolved_at IS NULL
      RETURNING id
      `,
      [input.paymentRecordId, input.stripePaymentIntentId, input.stripeChargeId,
        input.providerType, input.providerObjectId, input.status, input.amountJpy,
        input.observedRefundedAmountJpy, input.stripeEventId],
    );
    return result.rowCount === 1;
  }

  public async resolveUnresolvedStripePaymentAdjustments(
    paymentRecordId: string,
    client: DatabaseClient,
  ): Promise<void> {
    await client.query(
      `UPDATE stripe_unresolved_payment_adjustments
       SET resolved_at = NOW(), updated_at = NOW()
       WHERE payment_record_id = $1 AND resolved_at IS NULL`,
      [paymentRecordId],
    );
  }

  public async findStripePaymentRecoveryForUpdate(
    stripePaymentIntentId: string,
    client: DatabaseClient,
  ): Promise<StripePaymentRecovery | null> {
    return this.findStripePaymentRecoveryInternal(stripePaymentIntentId, client, true);
  }

  public async findStripePaymentRecovery(
    stripePaymentIntentId: string,
    client: DatabaseClient,
  ): Promise<StripePaymentRecovery | null> {
    return this.findStripePaymentRecoveryInternal(stripePaymentIntentId, client, false);
  }

  private async findStripePaymentRecoveryInternal(
    stripePaymentIntentId: string,
    client: DatabaseClient,
    forUpdate: boolean,
  ): Promise<StripePaymentRecovery | null> {
    const result = await client.query<StripePaymentRecoveryRow>(
      `
      SELECT
        recovery.id,
        recovery.payment_record_id,
        payment.user_id,
        payment.organization_id,
        payment.kind,
        payment.amount_jpy,
        recovery.stripe_payment_intent_id,
        recovery.stripe_charge_id,
        recovery.currency,
        recovery.credit_bucket,
        recovery.granted_credits,
        recovery.grant_expires_at,
        recovery.observed_refunded_amount_jpy,
        recovery.target_reversal_credits,
        recovery.reversed_credits,
        recovery.unrecovered_credits,
        COALESCE((
          SELECT SUM(adjustment.amount_jpy)
          FROM stripe_payment_adjustment_objects adjustment
          WHERE adjustment.recovery_id = recovery.id
            AND adjustment.provider_type = 'dispute'
            AND adjustment.status = 'lost'
        ), 0)::text AS lost_dispute_amount_jpy,
        EXISTS (
          SELECT 1 FROM stripe_payment_adjustment_objects adjustment
          WHERE adjustment.recovery_id = recovery.id
            AND adjustment.provider_type = 'refund'
            AND adjustment.status = 'pending'
        ) AS has_pending_refund,
        EXISTS (
          SELECT 1 FROM stripe_payment_adjustment_objects adjustment
          WHERE adjustment.recovery_id = recovery.id
            AND adjustment.provider_type = 'dispute'
            AND adjustment.status = 'open'
        ) AS has_open_dispute
      FROM stripe_payment_recoveries recovery
      INNER JOIN payment_records payment ON payment.id = recovery.payment_record_id
      WHERE recovery.stripe_payment_intent_id = $1
      ${forUpdate ? 'FOR UPDATE OF recovery' : ''}
      `,
      [stripePaymentIntentId],
    );
    return result.rows[0] === undefined ? null : mapStripePaymentRecoveryRow(result.rows[0]);
  }

  public async bindStripeChargeToRecovery(
    recoveryId: string,
    stripeChargeId: string,
    client: DatabaseClient,
  ): Promise<boolean> {
    const result = await client.query(
      `
      UPDATE stripe_payment_recoveries
      SET stripe_charge_id = COALESCE(stripe_charge_id, $2),
          updated_at = NOW()
      WHERE id = $1
        AND (stripe_charge_id IS NULL OR stripe_charge_id = $2)
      `,
      [recoveryId, stripeChargeId],
    );
    return result.rowCount === 1;
  }

  public async upsertStripePaymentAdjustmentObject(
    input: StripePaymentAdjustmentObjectInput,
    client: DatabaseClient,
  ): Promise<boolean> {
    const result = await client.query(
      `
      INSERT INTO stripe_payment_adjustment_objects (
        recovery_id,
        provider_type,
        provider_object_id,
        amount_jpy,
        status,
        last_stripe_event_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (provider_type, provider_object_id)
      DO UPDATE SET
        amount_jpy = EXCLUDED.amount_jpy,
        status = CASE
          WHEN stripe_payment_adjustment_objects.status IN ('succeeded', 'failed', 'won', 'lost')
            THEN stripe_payment_adjustment_objects.status
          ELSE EXCLUDED.status
        END,
        last_stripe_event_id = EXCLUDED.last_stripe_event_id,
        updated_at = NOW()
      WHERE stripe_payment_adjustment_objects.recovery_id = EXCLUDED.recovery_id
      RETURNING id
      `,
      [
        input.recoveryId,
        input.providerType,
        input.providerObjectId,
        input.amountJpy,
        input.status,
        input.stripeEventId,
      ],
    );
    return result.rowCount === 1;
  }

  public async updateStripePaymentRecoveryTotals(
    recoveryId: string,
    input: {
      observedRefundedAmountJpy: number;
      targetReversalCredits: number;
      reversedCredits: number;
      unrecoveredCredits: number;
    },
    client: DatabaseClient,
  ): Promise<void> {
    await client.query(
      `
      UPDATE stripe_payment_recoveries
      SET observed_refunded_amount_jpy = GREATEST(observed_refunded_amount_jpy, $2),
          target_reversal_credits = GREATEST(target_reversal_credits, $3),
          reversed_credits = $4,
          unrecovered_credits = $5,
          updated_at = NOW()
      WHERE id = $1
      `,
      [
        recoveryId,
        input.observedRefundedAmountJpy,
        input.targetReversalCredits,
        input.reversedCredits,
        input.unrecoveredCredits,
      ],
    );
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
        granted_credits,
        credit_bucket,
        grant_expires_at,
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
    ...(
      row.account_deletion_started_at == null
      && row.account_deleted_at == null
        ? {}
        : { accountDeleted: true }
    ),
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
    grantedCredits: row.granted_credits,
    creditBucket: row.credit_bucket,
    grantExpiresAt: row.grant_expires_at,
    kind: row.kind,
    amountJpy: Number(row.amount_jpy),
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapStripePaymentRecoveryRow(row: StripePaymentRecoveryRow): StripePaymentRecovery {
  return {
    id: row.id,
    paymentRecordId: row.payment_record_id,
    userId: row.user_id,
    organizationId: row.organization_id,
    paymentKind: row.kind,
    amountJpy: Number(row.amount_jpy),
    stripePaymentIntentId: row.stripe_payment_intent_id,
    stripeChargeId: row.stripe_charge_id,
    currency: row.currency,
    creditBucket: row.credit_bucket,
    grantedCredits: Number(row.granted_credits),
    grantExpiresAt: row.grant_expires_at,
    observedRefundedAmountJpy: Number(row.observed_refunded_amount_jpy),
    lostDisputeAmountJpy: Number(row.lost_dispute_amount_jpy),
    targetReversalCredits: Number(row.target_reversal_credits),
    reversedCredits: Number(row.reversed_credits),
    unrecoveredCredits: Number(row.unrecovered_credits),
    hasPendingRefund: row.has_pending_refund,
    hasOpenDispute: row.has_open_dispute,
  };
}
