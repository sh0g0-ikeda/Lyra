# Mobile Native Store Billing Design

Date: 2026-07-25

## Scope and basis

This boundary implements the Mobile-side portion of `MOB-BILL-003` with the
Expo-native `expo-iap` package. Its package source documents StoreKit 2 on iOS,
Google Play Billing on Android, event-based purchase completion, and the rule
that `finishTransaction` follows server verification. It does not grant credits,
map products, or make billing decisions on the device.

The design follows `docs/Lyra_Unified_Spec_v4.md` sections 4, 7, 8, and 10,
`docs/mobile_completion_gap_spec.md` MOB-BILL-003, and
`docs/mobile-store-billing-server-design.md`.

## Boundary

`createNativeStoreBillingAdapter` accepts only:

- a public product catalog: store IDs, product kinds, labels and descriptions;
- an `expo-iap` SDK adapter;
- authenticated backend callbacks.

The adapter never accepts prices, claimed credit amounts, workspace IDs, receipt
logs, or a client-side entitlement decision. It obtains the account binding before
each purchase, places it in the StoreKit app-account token / Play obfuscated
account ID fields, and sends the StoreKit signed transaction or Play purchase
token only to its injected backend callback.

`MobileStoreBillingPanel` is a reusable Japanese/English UI. It receives an
already-created adapter and has no knowledge of `LyraMobileApiClient` or any
screen. Its optional `onVerified(serverState)` callback lets Sol invalidate or
replace account balance/plan queries only after server confirmation. This keeps
Account ownership and shared API schema work separate.

## Completion ordering

1. Connect and fetch product metadata from the native store.
2. Start a purchase with a server-issued account binding.
3. Wait for `purchaseUpdatedListener`; the request return value is never used as
   proof of purchase.
4. For a completed purchase, submit proof to the backend and require a returned
   server balance plus entitlement.
5. Only after that confirmation call `finishTransaction`, consuming credit packs
   and acknowledging subscriptions/non-consumables according to `expo-iap`.
6. If verification or finish fails, do not report success. Replay is safe because
   the backend ledger is idempotent and the adapter only remembers completed
   transaction IDs for its live process.

Restore invokes the native restore action, gathers available transactions, sends
the two bounded proof arrays to the backend restore callback, requires the same
server state, then finishes the known returned transactions.

## Sol integration contract

Sol creates `createNativeStoreBillingAdapter` with public catalog IDs from build
configuration or the selected screen props and `createExpoIapSdk()`. The injected
callbacks must perform these authenticated calls:

```ts
getAccountBinding(): Promise<{
  appleAppAccountToken: string;
  googleObfuscatedAccountId: string;
  subscriptionPurchaseAllowed: boolean;
}>;
verifyApplePurchase({ signedTransaction, environment }): Promise<{
  balance: { monthlyCredits: number; purchasedCredits: number };
  entitlement: { plan: 'free' | 'standard' | 'premium' };
}>;
verifyGooglePurchase({ purchaseToken }): Promise<same server state>;
restorePurchases({ appleSignedTransactions, googlePurchaseTokens }): Promise<same server state>;
```

The verify callbacks call the corresponding `/api/mobile-purchases/apple/verify`
or `/api/mobile-purchases/google/verify` route, then read the authoritative
personal balance and entitlement/plan before returning. Restore calls
`/api/mobile-purchases/restore` and then does the same refresh. This enrichment is
required because the current verification route response itself does not contain a
balance or plan. All callbacks must keep raw proof values out of logs and state.

`expo-iap` is registered as an Expo config plugin. No product IDs, prices,
provider API keys, App Store Connect keys, Google service account values, or other
secrets belong in `app.json` or Mobile public configuration.

## Release risks outside this boundary

EAS builds need a native rebuild after adding the config plugin. App Store Connect
and Google Play Console must configure exactly the public catalog IDs, sandbox/
test testers, subscription offers, and real-device purchase/restore tests. The
backend route must be mounted and its provider credentials must pass the existing
runtime validation before the panel is enabled in a release build.
