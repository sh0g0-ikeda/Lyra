import type { QueryResultRow } from 'pg';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';

export type StripeRecoveryBackfillProviderType = 'refund' | 'dispute';
export type StripeRecoveryBackfillProviderStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'open'
  | 'won'
  | 'lost';

export interface StripeRecoveryBackfillCandidate {
  unresolvedAdjustmentId: string;
  paymentRecordId: string;
  stripePaymentIntentId: string;
  stripeChargeId: string;
  providerType: StripeRecoveryBackfillProviderType;
  providerStatus: StripeRecoveryBackfillProviderStatus;
  adjustmentAmountJpy: number;
  observedRefundedAmountJpy: number;
  resolvedAt: Date | null;
  userId: string | null;
  organizationId: string | null;
  paymentKind: string;
  paymentStatus: string;
  paymentAmountJpy: number;
  stripeInvoiceId: string | null;
  grantedCredits: number | null;
  creditBucket: string | null;
  grantExpiresAt: Date | null;
}

export interface StripeRecoveryIdentity {
  paymentRecordId: string;
  stripePaymentIntentId: string;
  stripeChargeId: string | null;
  currency: string;
  creditBucket: string;
  grantedCredits: number;
  grantExpiresAt: Date | null;
}

export interface StripeRecoveryBackfillRepository {
  transaction<T>(
    readOnly: boolean,
    work: (client: DatabaseClient) => Promise<T>,
  ): Promise<T>;
  findCandidate(
    unresolvedAdjustmentId: string,
    client: DatabaseClient,
    forUpdate: boolean,
  ): Promise<StripeRecoveryBackfillCandidate | null>;
  findConflictingRecoveries(
    paymentRecordId: string,
    stripePaymentIntentId: string,
    stripeChargeId: string,
    client: DatabaseClient,
    forUpdate: boolean,
  ): Promise<StripeRecoveryIdentity[]>;
  updatePaymentGrantMetadata(
    paymentRecordId: string,
    grantedCredits: number,
    grantExpiresAt: Date,
    client: DatabaseClient,
  ): Promise<boolean>;
  insertPaymentRecovery(
    input: {
      paymentRecordId: string;
      stripePaymentIntentId: string;
      stripeChargeId: string;
      creditBucket: 'monthly';
      grantedCredits: number;
      grantExpiresAt: Date;
    },
    client: DatabaseClient,
  ): Promise<boolean>;
}

interface CandidateRow extends QueryResultRow {
  unresolved_adjustment_id: string;
  payment_record_id: string;
  stripe_payment_intent_id: string;
  stripe_charge_id: string;
  provider_type: StripeRecoveryBackfillProviderType;
  provider_status: StripeRecoveryBackfillProviderStatus;
  adjustment_amount_jpy: number;
  observed_refunded_amount_jpy: number;
  resolved_at: Date | null;
  user_id: string | null;
  organization_id: string | null;
  payment_kind: string;
  payment_status: string;
  payment_amount_jpy: number;
  stripe_invoice_id: string | null;
  granted_credits: number | null;
  credit_bucket: string | null;
  grant_expires_at: Date | null;
}

interface RecoveryRow extends QueryResultRow {
  payment_record_id: string;
  stripe_payment_intent_id: string;
  stripe_charge_id: string | null;
  currency: string;
  credit_bucket: string;
  granted_credits: number;
  grant_expires_at: Date | null;
}

export class PostgresStripeRecoveryBackfillRepository implements StripeRecoveryBackfillRepository {
  public constructor(private readonly transactionRunner: TransactionRunner) {}

  public async transaction<T>(
    readOnly: boolean,
    work: (client: DatabaseClient) => Promise<T>,
  ): Promise<T> {
    return this.transactionRunner.transaction(async client => {
      if (readOnly) {
        await client.query('SET TRANSACTION READ ONLY');
      }
      return work(client);
    });
  }

  public async findCandidate(
    unresolvedAdjustmentId: string,
    client: DatabaseClient,
    forUpdate: boolean,
  ): Promise<StripeRecoveryBackfillCandidate | null> {
    let lockedPaymentRecordId: string | undefined;
    if (forUpdate) {
      const unresolved = await client.query<{ payment_record_id: string }>(
        `SELECT payment_record_id
         FROM stripe_unresolved_payment_adjustments
         WHERE id = $1::uuid`,
        [unresolvedAdjustmentId],
      );
      lockedPaymentRecordId = unresolved.rows[0]?.payment_record_id;
      if (lockedPaymentRecordId === undefined) return null;
      const lockedPayment = await client.query(
        'SELECT id FROM payment_records WHERE id = $1::uuid FOR UPDATE',
        [lockedPaymentRecordId],
      );
      if (lockedPayment.rowCount !== 1) return null;
    }
    const result = await client.query<CandidateRow>(
      `
      SELECT
        unresolved.id AS unresolved_adjustment_id,
        unresolved.payment_record_id,
        unresolved.stripe_payment_intent_id,
        unresolved.stripe_charge_id,
        unresolved.provider_type,
        unresolved.status AS provider_status,
        unresolved.amount_jpy AS adjustment_amount_jpy,
        unresolved.observed_refunded_amount_jpy,
        unresolved.resolved_at,
        payment.user_id,
        payment.organization_id,
        payment.kind AS payment_kind,
        payment.status AS payment_status,
        payment.amount_jpy AS payment_amount_jpy,
        payment.stripe_invoice_id,
        payment.granted_credits,
        payment.credit_bucket,
        payment.grant_expires_at
      FROM stripe_unresolved_payment_adjustments unresolved
      INNER JOIN payment_records payment ON payment.id = unresolved.payment_record_id
      WHERE unresolved.id = $1::uuid
        ${lockedPaymentRecordId === undefined ? '' : 'AND unresolved.payment_record_id = $2::uuid'}
      ${forUpdate ? 'FOR UPDATE OF unresolved' : ''}
      `,
      lockedPaymentRecordId === undefined
        ? [unresolvedAdjustmentId]
        : [unresolvedAdjustmentId, lockedPaymentRecordId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      unresolvedAdjustmentId: row.unresolved_adjustment_id,
      paymentRecordId: row.payment_record_id,
      stripePaymentIntentId: row.stripe_payment_intent_id,
      stripeChargeId: row.stripe_charge_id,
      providerType: row.provider_type,
      providerStatus: row.provider_status,
      adjustmentAmountJpy: Number(row.adjustment_amount_jpy),
      observedRefundedAmountJpy: Number(row.observed_refunded_amount_jpy),
      resolvedAt: row.resolved_at,
      userId: row.user_id,
      organizationId: row.organization_id,
      paymentKind: row.payment_kind,
      paymentStatus: row.payment_status,
      paymentAmountJpy: Number(row.payment_amount_jpy),
      stripeInvoiceId: row.stripe_invoice_id,
      grantedCredits: row.granted_credits === null ? null : Number(row.granted_credits),
      creditBucket: row.credit_bucket,
      grantExpiresAt: row.grant_expires_at,
    };
  }

  public async findConflictingRecoveries(
    paymentRecordId: string,
    stripePaymentIntentId: string,
    stripeChargeId: string,
    client: DatabaseClient,
    forUpdate: boolean,
  ): Promise<StripeRecoveryIdentity[]> {
    const result = await client.query<RecoveryRow>(
      `
      SELECT payment_record_id, stripe_payment_intent_id, stripe_charge_id,
             currency, credit_bucket, granted_credits, grant_expires_at
      FROM stripe_payment_recoveries
      WHERE payment_record_id = $1::uuid
         OR stripe_payment_intent_id = $2
         OR stripe_charge_id = $3
      ${forUpdate ? 'FOR UPDATE' : ''}
      `,
      [paymentRecordId, stripePaymentIntentId, stripeChargeId],
    );
    return result.rows.map(row => ({
      paymentRecordId: row.payment_record_id,
      stripePaymentIntentId: row.stripe_payment_intent_id,
      stripeChargeId: row.stripe_charge_id,
      currency: row.currency,
      creditBucket: row.credit_bucket,
      grantedCredits: Number(row.granted_credits),
      grantExpiresAt: row.grant_expires_at,
    }));
  }

  public async updatePaymentGrantMetadata(
    paymentRecordId: string,
    grantedCredits: number,
    grantExpiresAt: Date,
    client: DatabaseClient,
  ): Promise<boolean> {
    const result = await client.query(
      `
      UPDATE payment_records
      SET granted_credits = $2,
          credit_bucket = 'monthly',
          grant_expires_at = $3
      WHERE id = $1::uuid
        AND kind = 'subscription'
        AND status = 'paid'
        AND (
          (granted_credits IS NULL AND credit_bucket IS NULL AND grant_expires_at IS NULL)
          OR (granted_credits = $2 AND credit_bucket = 'monthly' AND grant_expires_at = $3)
        )
      RETURNING id
      `,
      [paymentRecordId, grantedCredits, grantExpiresAt],
    );
    return result.rowCount === 1;
  }

  public async insertPaymentRecovery(
    input: {
      paymentRecordId: string;
      stripePaymentIntentId: string;
      stripeChargeId: string;
      creditBucket: 'monthly';
      grantedCredits: number;
      grantExpiresAt: Date;
    },
    client: DatabaseClient,
  ): Promise<boolean> {
    const result = await client.query(
      `
      INSERT INTO stripe_payment_recoveries (
        payment_record_id, stripe_payment_intent_id, stripe_charge_id,
        currency, credit_bucket, granted_credits, grant_expires_at
      ) VALUES ($1::uuid, $2, $3, 'jpy', $4, $5, $6)
      ON CONFLICT DO NOTHING
      RETURNING id
      `,
      [
        input.paymentRecordId,
        input.stripePaymentIntentId,
        input.stripeChargeId,
        input.creditBucket,
        input.grantedCredits,
        input.grantExpiresAt,
      ],
    );
    return result.rowCount === 1;
  }
}
