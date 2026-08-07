# Mobile Store Billing diagnostics (2026-08-07)

## Purpose and scope

Determine why a StoreKit TestFlight session returns no configured Lyra products
without logging purchase proofs or requiring a blind native rebuild. The change is
limited to the mobile native-store catalog lookup and a read-only diagnostic block
in the existing billing panel. It does not grant credits, finish transactions,
change product identifiers, or alter backend verification.

## Spec basis and affected layer

The closest contract is Unified Spec v4 sections 3, 7, 8, and 10: the mobile app
consumes native-store metadata, while only server-verified transactions may change
billing state. The affected layer is `apps/mobile`; no Route, Service, Repository,
database, Worker, or web contract changes.

## Interface and behavior

The native-store adapter records bounded, public diagnostics for the current
connection: storefront country code, requested product IDs, returned product IDs,
and stable error codes. Credit and subscription lookups run sequentially so their
results cannot overwrite or race through a shared native request boundary. When
any configured product is unavailable or StoreKit reports an error, the billing
panel displays the diagnostic values for a screenshot.

## Security

Diagnostics stay on the device and contain only public product IDs, a storefront
country code, stable error codes, and connection status. Receipt data, signed
transactions, account identifiers, credentials, raw provider messages, and stack
traces are excluded. Diagnostics never affect purchase authorization or credit
settlement.

## Test and release plan

Add adapter tests for storefront/result capture and sequential query ordering, plus
a component test for safe diagnostic rendering. Observe the tests fail before the
implementation, then run targeted Vitest, mobile typecheck, lint, mojibake check,
and iOS/Android Expo exports. Publish the JavaScript change to the production EAS
Update channel, build an Android `production-apk`, and build/submit iOS production.
Do not create an Android AAB. Existing unrelated dirty files remain untouched.

Terra delegation is omitted because this is a tightly coupled adapter/component
change whose test and implementation edits share the same small file set.
