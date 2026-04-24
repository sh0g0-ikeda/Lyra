import type { CreditPackageCode, SubscriptionPlanCode } from '../constants/billing.js';

export type PaymentRecordKind = 'subscription' | 'credit_purchase';
export type PaymentRecordStatus = 'paid' | 'failed';

export interface BillingUserProfile {
  userId: string;
  email: string;
  stripeCustomerId: string | null;
  planCode: SubscriptionPlanCode;
}

export interface SubscriptionRecord {
  userId: string;
  stripeSubscriptionId: string;
  planCode: SubscriptionPlanCode;
  status: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface PaymentRecordInput {
  userId: string;
  stripeCheckoutSessionId: string | null;
  stripeInvoiceId: string | null;
  kind: PaymentRecordKind;
  amountJpy: number;
  status: PaymentRecordStatus;
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
