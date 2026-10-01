# Production billing compatibility reconciliation

Compared deployed-source reference `2debe8c3c22633ed077e7b189ddcfa8b209a00dc`
with the main-based candidate. This document records local code/test changes,
not a live billing-configuration change or proof of the installed store binary.

## Preserved behavior and stronger candidate safeguards

- Google RTDN accepts `subscriptionNotification.subscriptionId` but obtains the
  authoritative product/entitlement from the Google API. Authenticated malformed
  messages are acknowledged only after a durable, idempotent failure record. No
  raw notification, purchase token or transaction identifier is written to the log.
- Multi-line subscriptions support deferred replacement: the current active line
  retains entitlement until renewal; the future product is a scheduled plan.
  After renewal the unique active line is selected. Ambiguous simultaneous plans
  fail closed instead of granting an arbitrary product.
- A verified same-token subscription product change may update subscription plan
  fields. It cannot change a consumable into a subscription or transfer ownership.
  Existing purchase locks, account binding, provider completion, historical refund,
  event/transaction idempotency and account-deletion protections are retained.
- Scheduled product/plan/effective date round-trip through storage, purchase results
  and balance summaries. Current and scheduled plans are distinct. Migration045
  adds nullable fields idempotently; production already has these fields under its
  own041 identity, which the production-lineage bridge preserves.
- Apple transaction verification treats the client environment as a hint, trying
  only server-enabled official verifier environments. A production-hinted valid
  TestFlight receipt can verify in an enabled Sandbox environment; an unverified
  client hint never enables Sandbox.
- Verified Apple grace-period access uses the signed renewal grace deadline.
  `DID_FAIL_TO_RENEW` alone is not evidence of indefinite entitlement. Explicit
  expiry/revocation/refund still wins. This preserves legitimate grace access
  without copying an unconditional active-until-notification assumption.
- Existing production review configuration is supported without enabling it:
  Apple Sandbox remains controlled by its existing flag. Production Google test
  purchases require the existing explicit flag, a valid bounded UUID allowlist
  (maximum20) and future expiry within14days at startup. The service also checks
  expiry on every test event. Ineligible test receipts are skipped during restore
  and durably ignored on authenticated RTDN, while verified real purchases remain
  unaffected. No tester list, flag, expiry or store setting was changed.
- Credit tariffs match deployed source: standard50/month, premium175/month;
  credit packs10/50/150. No price or credit allowance was invented or changed.

## Local evidence

TDD first reproduced four Apple/Google verifier regressions, three RTDN/scheduled
service regressions, and three review-configuration differences. Focused billing
suites then passed. Disposable PostgreSQL18 tests verified scheduled-field SQL
round-trip, current→scheduled→renewed plan behavior, two concurrent same-token
renewal requests producing one credit grant, malformed RTDN idempotency, and no
post-deletion credit/plan resurrection. PostgreSQL16 and final aggregate results
are recorded separately with the exact commit when the full port stabilizes.

No actual purchase, restore, refund, acknowledgement, consumption, Google/Apple
API call, store upload, configuration change or production migration occurred.

## Remaining acceptance

Real store sandbox/reviewer behavior and the currently installed Android binary
still need explicit evidence. Store license testers can see test purchase sheets
without the app being globally hardcoded to fake billing. Source and ECS config
alone do not identify the current installed package/version or tester account.

Before release, verify environment/allowlist/expiry configuration without exposing
secrets, actual signed TestFlight receipt fallback, deferred downgrade and renewal,
restore containing mixed eligible/ineligible receipts, transient provider-completion
retries, refunds on historical subscription periods, and billing grace expiry.
Do not toggle reviewer/test settings merely because their existence is suspected.

Primary contract references:
- [Google subscription deferred replacement](https://developer.android.com/google/play/billing/subscriptions?hl=en)
- [Google subscriptionsv2 resource](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2?hl=en)
- [Apple notification types and grace expiry](https://developer.apple.com/documentation/AppStoreServerNotifications/notificationType)
- [Apple verified grace-period expiration](https://developer.apple.com/documentation/StoreKit/Product/SubscriptionInfo/RenewalInfo/gracePeriodExpirationDate)
