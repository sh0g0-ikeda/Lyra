import type {
  OrganizationBillingSummaryRecord,
  OrganizationInvoiceRecord,
  OrganizationSubscriptionStatus
} from '@/domain/types';

export type BillingHandoffIntent =
  | {
      kind: 'subscription';
      targetPlanCode: string;
    }
  | {
      kind: 'credits';
    }
  | {
      kind: 'portal';
    };

export type BillingHandoffPhase =
  | 'idle'
  | 'waiting_for_return'
  | 'confirming'
  | 'confirmed'
  | 'unconfirmed';

export interface BillingAuthoritativeSnapshot {
  cancelAtPeriodEnd: boolean | null;
  currentPeriodEnd: string | null;
  paidCreditInvoiceIds: string[];
  paidSubscriptionInvoiceIds: string[];
  planCode: string;
  purchasedCredits: number;
  subscriptionStatus: OrganizationSubscriptionStatus | null;
  totalCredits: number;
}

export const billingConfirmationBackoffMs = [500, 1_000, 2_000, 4_000, 8_000] as const;

export const createBillingAuthoritativeSnapshot = (
  billing: OrganizationBillingSummaryRecord,
  invoices: readonly OrganizationInvoiceRecord[]
): BillingAuthoritativeSnapshot => ({
  cancelAtPeriodEnd: billing.subscription?.cancel_at_period_end ?? null,
  currentPeriodEnd: billing.subscription?.current_period_end ?? null,
  paidCreditInvoiceIds: invoices
    .filter((invoice) => invoice.kind === 'credit_purchase' && invoice.status === 'paid')
    .map((invoice) => invoice.id)
    .sort(),
  paidSubscriptionInvoiceIds: invoices
    .filter((invoice) => invoice.kind === 'subscription' && invoice.status === 'paid')
    .map((invoice) => invoice.id)
    .sort(),
  planCode:
    billing.subscription?.plan_code ??
    billing.workspace.organization.plan_key,
  purchasedCredits: billing.workspace.balance?.purchased_credits ?? 0,
  subscriptionStatus: billing.subscription?.status ?? null,
  totalCredits: billing.workspace.balance?.total_credits ?? 0
});

const hasNewId = (beforeIds: readonly string[], afterIds: readonly string[]): boolean => {
  const before = new Set(beforeIds);
  return afterIds.some((id) => !before.has(id));
};

const subscriptionFingerprint = (snapshot: BillingAuthoritativeSnapshot): string =>
  JSON.stringify({
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    paidSubscriptionInvoiceIds: snapshot.paidSubscriptionInvoiceIds,
    planCode: snapshot.planCode,
    subscriptionStatus: snapshot.subscriptionStatus
  });

export const billingSnapshotChanged = (
  before: BillingAuthoritativeSnapshot,
  after: BillingAuthoritativeSnapshot,
  intent: BillingHandoffIntent
): boolean => {
  if (intent.kind === 'credits') {
    return (
      after.purchasedCredits > before.purchasedCredits ||
      hasNewId(before.paidCreditInvoiceIds, after.paidCreditInvoiceIds)
    );
  }

  if (intent.kind === 'subscription') {
    const activeTarget =
      after.planCode === intent.targetPlanCode &&
      (after.subscriptionStatus === 'active' || after.subscriptionStatus === 'trialing');
    return activeTarget && subscriptionFingerprint(after) !== subscriptionFingerprint(before);
  }

  return subscriptionFingerprint(after) !== subscriptionFingerprint(before);
};

interface PollBillingConfirmationInput {
  before: BillingAuthoritativeSnapshot;
  fetchSnapshot: () => Promise<BillingAuthoritativeSnapshot>;
  intent: BillingHandoffIntent;
  sleep?: (delayMs: number) => Promise<void>;
}

export type BillingConfirmationResult =
  | {
      attempts: number;
      snapshot: BillingAuthoritativeSnapshot;
      status: 'confirmed';
    }
  | {
      attempts: number;
      snapshot: BillingAuthoritativeSnapshot;
      status: 'unconfirmed';
    };

const defaultSleep = async (delayMs: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
};

export const pollBillingConfirmation = async ({
  before,
  fetchSnapshot,
  intent,
  sleep = defaultSleep
}: PollBillingConfirmationInput): Promise<BillingConfirmationResult> => {
  let lastSnapshot = before;
  const attempts = billingConfirmationBackoffMs.length + 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      lastSnapshot = await fetchSnapshot();
      if (billingSnapshotChanged(before, lastSnapshot, intent)) {
        return {
          attempts: attempt + 1,
          snapshot: lastSnapshot,
          status: 'confirmed'
        };
      }
    } catch {
      // A transient refresh failure is retried only within this finite polling window.
    }

    const delayMs = billingConfirmationBackoffMs[attempt];
    if (delayMs !== undefined) {
      await sleep(delayMs);
    }
  }

  return {
    attempts,
    snapshot: lastSnapshot,
    status: 'unconfirmed'
  };
};
