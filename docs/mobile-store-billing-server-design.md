# Mobile Store Billing Server Design

Date: 2026-07-25

## Purpose and scope

Implement the server contract required by `MOB-BILL-003` for personal Lyra
accounts purchasing subscriptions and credit packs through Apple StoreKit or
Google Play Billing. This work adds only backend-owned files and migrations. It
does not change `apps/mobile/**` or `src/app.ts`; Sol owns dependency wiring and
route mounting after this contract is reviewed.

Out of scope: store-console configuration, mobile Billing SDK integration,
Stripe behavior, organization billing, and any production credential operation.

## Specification basis

- `docs/mobile_completion_gap_spec.md`, `MOB-BILL-003`
- `docs/Lyra_Unified_Spec_v4.md`, sections 3, 4, 5, 7, 8, and 10

The current specification calls for StoreKit on iOS and Google Play Billing on
Android, server-side product mapping and verification, restore support, store
notification handling, personal-credit-only grants, and idempotent handling of
purchase, renewal, refund, revocation, and duplicate delivery.

## Affected layers and interfaces

- Domain: normalized store, purchase state, verified purchase, and product
  mapping types. Client price, product metadata, and state are never inputs to
  a grant decision.
- Infrastructure: Apple JWS verification uses Apple's official
  `@apple/app-store-server-library`; Google purchase verification uses the
  Google Play Developer API; Pub/Sub push OIDC JWTs are verified with Google's
  official auth client.
- Repository: a store purchase table keyed by a keyed digest of the original
  Apple transaction identifier or Google purchase token, a store event ledger,
  and a unique credit-ledger store-event key.
- Service: verifies provider evidence, checks personal-account binding, applies
  state transitions, refreshes the effective personal plan, and grants or
  reverses credits under one transaction.
- Route: authenticated Apple/Google verification and restore endpoints, plus
  public provider webhook route factories for App Store Notifications V2 and
  authenticated Google Pub/Sub push delivery.
- Ops: explicit production configuration validation and product allowlists.

Proposed mount points for Sol:

```
POST /api/mobile-purchases/apple/verify
POST /api/mobile-purchases/google/verify
POST /api/mobile-purchases/restore
POST /api/webhooks/mobile-purchases/apple
POST /api/webhooks/mobile-purchases/google
```

## Persistence and idempotency

Migration `029_add_mobile_store_purchase_ledger.sql` adds:

1. `mobile_store_purchases`, unique on `(store, external_purchase_key)`. The
   key is an HMAC digest, so a Google purchase token is never persisted raw.
2. `mobile_store_purchase_events`, unique on `(store, event_key)` and on the
   semantic `(store, transaction_key, operation)` when a transaction exists.
3. `credit_ledger.mobile_store_event_key`, unique when present. Credit grants
   and reversals use a deterministic store+transaction operation key as a
   second idempotency barrier in the existing credit ledger.

The service locks the user and purchase rows inside the repository transaction.
It records an event before mutating credits, and all credit mutations reuse the
existing balance-row lock and credit-ledger semantics. Subscription grants
replace the monthly allowance, while credit pack grants add only purchased
credits. A refund or revocation reverses only the unspent portion of that
specific credited pack and records any unrecoverable amount without taking
unrelated credits.

## Security controls

- No `organization_id` is accepted or used. All records have a non-null
  personal `user_id` and no organization credit path is available.
- Apple account binding must match the authenticated Lyra user UUID. Google
  binding must match a keyed, deterministic obfuscated account identifier.
- Unknown products, mismatched account bindings, unverified signatures, and
  unverifiable tokens fail with stable generic errors. Raw tokens, JWS values,
  provider error payloads, prices, and credentials are neither stored nor sent
  to clients.
- Apple sandbox and production JWS verification use distinct verifier
  environments. Google test purchases are rejected in production unless an
  explicitly configured non-production/test policy permits them.
- Google Pub/Sub webhooks require a verified OIDC token with the configured
  audience and service-account email. Apple notifications are accepted only
  after official JWS verification.

## State and grant rules

Normalized states are `pending`, `active`, `cancelled`, `expired`, `refunded`,
`revoked`, and `failed`. Provider notification state can advance a purchase;
older observations cannot overwrite a newer terminal state. A cancelled
subscription remains entitled until its provider-supplied expiry. Only an
`active` credit pack grants purchased credits. `refunded` and `revoked` credit
packs produce one idempotent reversal attempt. Subscription renewals have
transaction/order-specific grant keys, so each paid period may refresh the
monthly bucket once but duplicate delivery cannot accumulate it.

## Test plan

TDD tests are added before implementation for:

1. product allowlist mapping and state transitions;
2. service idempotency, ownership, pending/cancel/refund/revocation/renewal,
   personal-only credit behavior, and duplicate notifications;
3. route validation, authentication boundary, restore, and safe responses;
4. Apple/Google/PubSub adapters using mocked official clients;
5. migration constraints and production configuration validation.

Focused Vitest suites and `npm run build` are required after implementation.

## Required environment and wiring

`MOBILE_STORE_BILLING_ENABLED=false` is the default. Set it to `true` only
after all of the following values are supplied from a secret manager. None of
these values belong in a committed `.env` file.

```
MOBILE_STORE_IDENTIFIER_HASH_SECRET=<at least 32 random characters>

APPLE_STORE_BUNDLE_ID=<iOS bundle id>
APPLE_STORE_APP_APPLE_ID=<numeric App Store app id>
APPLE_STORE_ROOT_CERTIFICATES_BASE64_JSON=<base64(JSON array of base64 DER Apple root certificates)>
APPLE_STORE_ALLOW_SANDBOX=false
APPLE_STORE_PRODUCT_STANDARD_MONTHLY=<App Store product id>
APPLE_STORE_PRODUCT_PREMIUM_MONTHLY=<App Store product id>
APPLE_STORE_PRODUCT_CREDITS_200=<App Store product id>
APPLE_STORE_PRODUCT_CREDITS_1000=<App Store product id>
APPLE_STORE_PRODUCT_CREDITS_3000=<App Store product id>

GOOGLE_PLAY_PACKAGE_NAME=<Android package name>
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64=<base64(service account JSON)>
GOOGLE_PLAY_PUBSUB_AUDIENCE=<exact HTTPS Google Pub/Sub push endpoint URL>
GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL=<Pub/Sub push OIDC service account email>
GOOGLE_PLAY_ALLOW_TEST_PURCHASES=false
GOOGLE_PLAY_PRODUCT_STANDARD_MONTHLY=<Google Play product id>
GOOGLE_PLAY_PRODUCT_PREMIUM_MONTHLY=<Google Play product id>
GOOGLE_PLAY_PRODUCT_CREDITS_200=<Google Play product id>
GOOGLE_PLAY_PRODUCT_CREDITS_1000=<Google Play product id>
GOOGLE_PLAY_PRODUCT_CREDITS_3000=<Google Play product id>
```

Production runtime validation fails when mobile billing is enabled without the
required values, when catalog identifiers repeat within a store, or when Apple
sandbox / Google test purchases are enabled. The Google service account needs
Android Publisher API access for the configured package. Configure the Google
Pub/Sub push subscription to use OIDC with the exact audience and service
account email above. Configure App Store Server Notifications V2 to POST its
native JSON body (`signedPayload`) to the Apple webhook endpoint.

Sol must instantiate the backend-owned factory and mount the otherwise
unmounted route factories in `src/app.ts`:

```ts
const mobileStoreBilling = createMobileStoreBillingIntegration(
  env,
  db,
  process.env.NODE_ENV === 'production' || env.APP_ENV === 'production',
);

if (mobileStoreBilling !== null) {
  app.route('/api/mobile-purchases', createMobilePurchaseRoutes({
    authMiddleware,
    rateLimitMiddleware,
    mobileStorePurchaseService: mobileStoreBilling.mobileStorePurchaseService,
  }));
  app.route('/api/webhooks/mobile-purchases', createMobilePurchaseWebhookRoutes({
    rateLimitMiddleware: webhookRateLimitMiddleware,
    mobileStorePurchaseService: mobileStoreBilling.mobileStorePurchaseService,
    googlePubSubPushVerifier: mobileStoreBilling.googlePubSubPushVerifier,
  }));
}
```

Before calling a mobile billing SDK, the authenticated app calls
`GET /api/mobile-purchases/binding`. iOS passes `apple_app_account_token` as
StoreKit `appAccountToken`; Android passes `google_obfuscated_account_id` as
the Billing Flow obfuscated account id. The app submits only a StoreKit signed
transaction or a Google purchase token afterward. It must not submit product
IDs, prices, amounts, workspace IDs, or claimed states.

The service does not claim any App Store Connect, Google Play Console, sandbox,
or tester verification evidence. Provider clients are unit-tested through
mocked official SDK interfaces; real sandbox/live testing remains a release
gate after the above console configuration and route mount are complete.

## Sol/Terra delegation

`multi_agent_v1.spawn_agent` is not available in this session. The Terra
packet is handled locally: inspect existing billing/credit contracts, keep the
write set disjoint from page and account-deletion work, and have Sol perform
the final contract and security review.

## Git baseline deviation

The worktree is already dirty with parallel page, account, and mobile work.
No branch switch, pull, reset, or edit to those paths is performed. This change
uses only new billing files, migration 026, non-conflicting billing/credit/env
contracts, and focused tests.
