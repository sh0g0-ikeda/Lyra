# Apple subscription plan-change recovery design

## Purpose and scope

Allow a provider-verified mobile subscription to move between the configured
Standard and Premium products when Apple keeps the same original transaction
identifier for the subscription group. The change is limited to the mobile
store purchase service and repository. It does not change prices, product
catalog configuration, receipt trust, account binding, or one-time credit-pack
rules.

## Evidence and Spec basis

- `docs/Lyra_Unified_Spec_v4.md` section 7 requires transactional credit and
  ledger updates and provider-verified billing events.
- `AppStoreServerClient` maps Apple's verified `originalTransactionId` to the
  external purchase identity. A Standard-to-Premium change therefore resolves
  to the existing purchase row.
- Production logs on 2026-08-11 show the post-purchase Apple verification route
  returning `422 VALIDATION_ERROR` after StoreKit completed the plan change.
- `MobileStorePurchaseService` currently requires the stored and incoming
  product and plan to be identical, so the verified Premium transaction is
  rejected before persistence.

## Contract

1. Product identity remains exact for credit packs and across different product
   kinds.
2. A product change is accepted only when the existing row and the configured,
   provider-verified incoming product are both subscriptions.
3. A newer accepted subscription event updates `product_id`, `plan_code`, and
   the nullable credit-package field in the same transaction as state, event,
   entitlement, and credit processing.
4. An older event never changes the current product or plan.
5. The transaction/event uniqueness constraints remain the idempotency barrier.
6. The monthly credit service continues to replace the monthly allowance. An
   upgrade therefore changes the monthly bucket from 50 to 175; it does not add
   175 on top of the remaining 50. Purchased credits are unchanged.

## Security and failure behavior

- Apple signature verification, environment policy, catalog lookup, account
  binding, user ownership, keyed identifiers, and row/advisory locks remain
  mandatory before a plan change.
- Raw receipts, transaction identifiers, and provider errors are not logged or
  persisted.
- Unknown products and credit-pack substitutions continue to return the generic
  verification error without granting credits.

## Test-first verification

- Reproduce Standard active -> Premium active with the same external purchase
  identity and a newer transaction; expect Premium entitlement and a 175 monthly
  allowance exactly once.
- Replay the Premium transaction; expect no additional ledger entry.
- Replay an older Standard transaction after the upgrade; expect Premium to
  remain current.
- Submit a different credit-pack product with the same external identity; expect
  rejection and no grant.
- Verify repository SQL updates product identity with bound parameters.

## Orchestration and worktree protection

Sol owns the design, integration, production verification, and release. Terra is
assigned a read-only audit of the service/repository/credit behavior. Existing
unrelated dirty documentation, script, handoff, app configuration, and store
asset paths are excluded from staging and commits.
