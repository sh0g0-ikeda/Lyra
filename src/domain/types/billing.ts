import type {
  CreditPackageCode,
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
  userId: string;
  stripeSubscriptionId: string;
  planCode: SubscriptionPlanCode;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

interface PaymentRecordBase {
  userId: string;
  kind: PaymentRecordKind;
  amountJpy: number;
  status: PaymentRecordStatus;
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
