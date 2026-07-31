# Mobile store billing backend design

Date: 2026-07-31

## Purpose and scope

Implement the server-owned portion of `PR-C` and `BILL-600` / `BILL-630` for
personal Apple StoreKit and Google Play purchases. The backend verifies provider
evidence, maps only allowlisted product IDs, binds the purchase to the
authenticated Lyra user, and applies purchase, event, credit, and entitlement
changes atomically.

This change does not configure App Store Connect, Play Console, AWS secrets,
store prices, tester accounts, or the native billing SDK. It does not enable
mobile billing in any environment. `MOBILE_STORE_BILLING_ENABLED` remains false
unless an operator explicitly supplies every required value.

## Specification basis

- `docs/Lyra_Unified_Spec_v4.md`, sections 7, 8, and 9
- `docs/mobile-release-task-list-2026-07-30.md`, `PR-C`, `BILL-600`,
  `BILL-610`, `BILL-620`, and `BILL-630`
- Apple official
  [`SignedDataVerifier`](https://github.com/apple/app-store-server-library-node)
  and App Store Server Notifications V2
- Google official
  [`purchases.subscriptionsv2.get`](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get),
  `purchases.productsv2.getproductpurchasev2`, authenticated Pub/Sub push, and
  RTDN guidance

## Current-state findings

- Migration 029 already supplies personal-only purchase and event rows plus
  three independent uniqueness barriers: purchase key, semantic provider event,
  and credit-ledger event key.
- Existing Web billing is Stripe-owned. Its routes, checkout, portal, webhook,
  subscription rows, and Stripe event idempotency must remain unchanged while
  mobile billing is disabled.
- PR #67 contains a useful unmerged prototype, but its branch also rewrites
  current shared contracts and dependencies. Only reviewed billing concepts are
  reimplemented against current `main`; the commit is not cherry-picked.
- A Google RTDN is only a change signal. Except for a bounded voided-purchase
  message, the backend re-queries Google before changing entitlement.

## Affected layers

- Domain: normalized store purchase evidence, product catalog, keyed
  identifiers, and monotonic state transitions.
- Infrastructure: Apple JWS verification using Apple's official library;
  Google Android Publisher requests and Pub/Sub OIDC verification using
  Google's official authentication library.
- Repository: parameterized access to migration 029, user/purchase row locking,
  event insertion, effective-plan resolution, and credit-ledger keys.
- Service: verification, ownership, idempotent grant/reversal, restore, RTDN,
  Apple notification, Google acknowledgement/consumption, and unified
  subscription summary.
- Route: authenticated catalog/binding/verify/restore endpoints and verified
  public provider webhook endpoints.
- Runtime: dependency wiring and route mounting only when the explicit feature
  flag and complete configuration are present.
- Shared contract: additive response schemas and endpoint inventory entries.

## Interfaces

Authenticated routes:

```text
GET  /api/mobile-purchases/catalog/:store
GET  /api/mobile-purchases/binding
POST /api/mobile-purchases/apple/verify
POST /api/mobile-purchases/google/verify
POST /api/mobile-purchases/restore
```

Provider routes:

```text
POST /api/webhooks/mobile-purchases/apple
POST /api/webhooks/mobile-purchases/google
```

The client submits only bounded StoreKit signed transactions or Google purchase
tokens. It never submits prices, credit amounts, plan claims, user IDs, or
organization IDs. The catalog returns configured product IDs and logical kinds,
not prices; native clients must display prices returned by the stores.

## Transaction and idempotency rules

1. Provider evidence is verified before a database transaction.
2. Raw JWS, purchase tokens, transaction IDs, and provider payloads stay only in
   request memory. HMAC-SHA256 base64url keys are persisted.
3. The transaction locks the user and logical purchase key, then verifies
   ownership and product mapping.
4. A semantic event row is inserted before credit mutation.
5. Purchase state, event, credit balance, credit ledger, and `users.plan_code`
   change in the same transaction.
6. Active subscription periods grant the plan's monthly allowance once per
   provider transaction. Active credit packs add their fixed purchased-credit
   amount once.
7. Pending and cancelled observations do not grant. A cancelled subscription
   remains entitled only until its verified expiration.
8. Refund/revocation removes only the still-unspent portion attributable to the
   purchase. It never makes unrelated personal credits negative and never
   touches organization credits. Unrecoverable spent credits remain recorded as
   granted but not reversed; this is the conservative policy until a debt or
   account-restriction product policy is approved.
9. A verified Google purchase is acknowledged after the transaction commits;
   consumable credit packs are consumed. A retry repeats provider completion but
   cannot repeat the ledger mutation.
10. An active Stripe consumer subscription blocks a new store subscription both
    in account binding and again under the purchase transaction.

## Security controls

- All client routes require authentication and existing rate limits.
- Store purchase writes accept no organization scope.
- Apple verification validates the certificate chain, bundle ID, environment,
  and production App Apple ID through the official verifier.
- Google verification uses the Android Publisher OAuth scope, exact package
  name, server-side product response, and deterministic obfuscated account ID.
- Google Pub/Sub requires a signed OIDC token with the exact audience, service
  account email, verified email, and Google issuer.
- Unknown products, invalid bindings, test evidence disallowed by the runtime,
  malformed payloads, and provider failures return stable generic errors.
- Provider calls have bounded timeouts. Raw evidence, credentials, and provider
  error bodies are not logged or returned.
- Production startup rejects sandbox/test flags and incomplete or duplicate
  catalog configuration.

## Compatibility and rollout

- With the flag false, no provider client is constructed and no mobile purchase
  or webhook route is mounted.
- `/api/billing/balance` retains its existing wire format. When enabled, its
  existing subscription fields may be sourced from a verified store
  subscription if no Stripe summary exists.
- Existing Stripe route/service/repository behavior and organization billing are
  not changed.
- External console setup, real credentials, sandbox purchases, production
  secrets, and final enablement remain explicit human/operations gates.

## TDD and verification

Tests are added before implementation for domain/config validation, repository
locking and SQL boundaries, service ownership/state/idempotency/reversal,
Apple/Google/PubSub adapters, bounded routes, disabled/enabled app wiring, shared
contracts, and Stripe/Web compatibility. The expected first run fails because
the new modules and schemas do not yet exist.

After focused tests, run backend Vitest and Bun suites, TypeScript build,
contract/inventory checks, fresh migrations and invariants, Web lint/build/E2E,
Mobile type/lint/test/exports, dependency audit, and production container/runtime
imports.

## Sol/Terra handling

The higher-level session policy does not permit spawning subagents. The Terra
packet is therefore a local checklist: inspect the existing Stripe and credit
transaction boundaries, keep all changes default-off, and have Sol perform the
security, compatibility, and final integration review.
