# Android closed-test purchase readiness

Date: 2026-08-08

## Purpose and scope

Bring the Android release candidate to the point where a selected Google Play
closed tester can install the current AAB and start a purchase. This change is
limited to the native Google Play subscription request, a controlled License
Tester acceptance policy, release validation, and the resulting AAB.

It does not change product IDs, prices, credit amounts, database schema,
Stripe billing, Apple purchase behavior, or public API request contracts.

## Spec basis

- Unified Spec section 7: a store purchase grants credits only after verified,
  transactional, idempotent server processing.
- Unified Spec section 8: provider input is bounded and credentials or raw
  provider errors are not exposed.
- Unified Spec sections 9 and 10: the deployed API remains healthy and the
  mobile/backend release gates pass before distribution.

## Affected layers and interfaces

- Mobile: retain the eligible Google Play subscription offer token returned by
  `expo-iap` and send it only in the Android subscription request.
- Service/Infrastructure: production License Tester purchases remain denied by
  default. A test purchase is accepted only when Google identifies it as a test
  purchase, the authenticated Lyra user is in the server-side allowlist, the
  configured test window has not expired, and the verified obfuscated account
  binding matches that user.
- Ops: the allowlist and expiry are runtime secrets. They are never embedded in
  the AAB or written to logs. The temporary acceptance flag is disabled again
  after purchase verification.

## Security controls

- Ordinary production purchases do not use the tester exception.
- Production cannot enable Google test purchases without both a non-empty UUID
  allowlist and a bounded future expiry.
- Direct verification and restore require the authenticated user to be
  allowlisted. RTDN accepts a test notification only when its verified account
  binding maps to an allowlisted user.
- Existing product allowlisting, account binding, row locking, ledger
  idempotency, and verify-before-finish behavior remain unchanged.

## Test and release plan

1. Add failing mobile tests for Android subscription offer-token forwarding and
   missing-token unavailability.
2. Add failing backend tests for production tester-policy validation and
   allowlisted versus unapproved test purchases.
3. Implement only the behavior required by those tests.
4. Run targeted mobile/backend tests, full mobile checks, backend build and
   repository release gates proportionate to billing changes.
5. Commit, push, and open a PR before building.
6. Deploy the bounded tester policy without printing secret values, verify
   health/readiness and logs, then build the committed Android production AAB.
7. Upload to the Alpha closed-test track and verify the served version. If Play
   Console app permissions block automation, stop without weakening access and
   report the exact remaining console action.

## Terra delegation

Terra performed a read-only Android release-candidate audit. Sol owns the design,
implementation, tests, production configuration, build, submission, and final
security review.
