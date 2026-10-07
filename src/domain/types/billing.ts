import type {
  CreditPackageCode,
  ConsumerPaidPlanCode,
  PaidPlanCode,
  SubscriptionPlanCode,
  SubscriptionStatus,
} from '../constants/billing.js';

export type PaymentRecordKind = 'subscription' | 'credit_purchase';
export type PaymentRecordStatus = 'paid' | 'failed';

export interface BillingUserProfile {
  userId: string;
  email: string;
  stripeCustomerId: string | null;
  planCode: SubscriptionPlanCode;
  accountDeleted?: boolean;
}

export interface SubscriptionRecord {
  userId: string | null;
  organizationId: string | null;
  stripeSubscriptionId: string;
  planCode: SubscriptionPlanCode;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface ActiveSubscriptionRecord extends SubscriptionRecord {}

export interface PersonalSubscriptionSummary {
  store?: 'apple' | 'google' | null;
  scheduledPlanCode?: ConsumerPaidPlanCode | null;
  scheduledPlanEffectiveAt?: Date | null;
  planCode: SubscriptionPlanCode;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface OrganizationSubscriptionSummary {
  organizationId: string;
  planCode: SubscriptionPlanCode;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

interface PaymentRecordBase {
  userId: string | null;
  organizationId: string | null;
  kind: PaymentRecordKind;
  amountJpy: number;
  status: PaymentRecordStatus;
  invoiceUrl?: string | null;
  grantedCredits?: number | null;
  creditBucket?: CreditGrantBucket | null;
  grantExpiresAt?: Date | null;
}

export type CreditGrantBucket = 'monthly' | 'purchased';

export type PaymentRecordInput =
  | (PaymentRecordBase & {
      stripeCheckoutSessionId: string;
      stripeInvoiceId: null;
    })
  | (PaymentRecordBase & {
      stripeCheckoutSessionId: null;
      stripeInvoiceId: string;
    });

export interface PaymentRecord extends PaymentRecordBase {
  id: string;
  stripeCheckoutSessionId: string | null;
  stripeInvoiceId: string | null;
  createdAt: Date;
}

export type StripePaymentAdjustmentProviderType = 'refund' | 'dispute';
export type StripePaymentAdjustmentStatus = 'pending' | 'succeeded' | 'failed' | 'open' | 'won' | 'lost';

export interface StripePaymentRecovery {
  id: string;
  paymentRecordId: string;
  userId: string | null;
  organizationId: string | null;
  paymentKind: PaymentRecordKind;
  amountJpy: number;
  stripePaymentIntentId: string;
  stripeChargeId: string | null;
  currency: 'jpy';
  creditBucket: CreditGrantBucket;
  grantedCredits: number;
  grantExpiresAt: Date | null;
  observedRefundedAmountJpy: number;
  lostDisputeAmountJpy: number;
  targetReversalCredits: number;
  reversedCredits: number;
  unrecoveredCredits: number;
  hasPendingRefund: boolean;
  hasOpenDispute: boolean;
}

export interface StripePaymentAdjustmentObjectInput {
  recoveryId: string;
  providerType: StripePaymentAdjustmentProviderType;
  providerObjectId: string;
  amountJpy: number;
  status: StripePaymentAdjustmentStatus;
  stripeEventId: string;
}

export interface PaidGenerationRecoveryStatus {
  paidGenerationBlocked: boolean;
  recoveryCreditsDue: number;
}

export interface SubscriptionCheckoutResult {
  sessionId: string;
  url: string;
}

export interface CreditCheckoutResult {
  sessionId: string;
  url: string;
  packageCode: CreditPackageCode;
}

export interface CustomerPortalResult {
  url: string;
}

export interface SubscriptionPlanCatalogEntry {
  planCode: PaidPlanCode;
  displayNameJa: string;
  displayNameEn: string;
  monthlyCredits: number;
  amountJpy: number;
  minimumContractMonths: number;
  trialDays: number;
  isEnterprise: boolean;
  configured: boolean;
}
