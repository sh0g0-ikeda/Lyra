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

export interface OrganizationSubscriptionSummary {
  organizationId: string;
  planCode: SubscriptionPlanCode;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * Personal subscription fields that are safe to return to an authenticated
 * account. Provider identifiers stay inside repository/service internals.
 */
export interface PersonalSubscriptionSummary {
  planCode: SubscriptionPlanCode;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  store: 'apple' | 'google' | null;
  scheduledPlanCode: ConsumerPaidPlanCode | null;
  scheduledPlanEffectiveAt: Date | null;
}

interface PaymentRecordBase {
  userId: string | null;
  organizationId: string | null;
  kind: PaymentRecordKind;
  amountJpy: number;
  status: PaymentRecordStatus;
  invoiceUrl?: string | null;
}

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
