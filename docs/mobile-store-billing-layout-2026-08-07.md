# Mobile Store Billing layout repair (2026-08-07)

## Purpose and scope

Prevent native iOS purchase product cards from narrowing Japanese product text to
single-character lines when a disabled purchase button has a long reason message.
The change is limited to the mobile `MobileStoreBillingPanel` presentation and
its component regression test. It does not alter StoreKit requests, product IDs,
purchase verification, backend billing, credits, or account state.

## Spec basis and affected layer

The closest current contract is Unified Spec v4 sections 3 (mobile client as an
API consumer) and 7 (only verified store purchases can grant billing state). This
is an `apps/mobile` presentation-only change; the existing native-store adapter
and server verification boundary remain unchanged.

## Design

Each product card uses a vertical layout: product title, description, and price
occupy the full card width first; the purchase button occupies a separate full
width row below. This removes the competing horizontal width constraints that
caused Japanese text to wrap one character per line. The disabled state and its
accessible reason remain intact.

## Security and interface impact

There is no new input, persistence, network request, credential, authorization,
or billing grant path. The button still delegates to the same adapter only when
the current disabled-state rules permit it.

## Test and release plan

Add a component regression assertion for the vertical product-card layout,
observe it fail against the existing horizontal layout, then implement the
minimal style change. Run the targeted mobile test, typecheck, lint, and the
mobile production export before creating a new iOS EAS Store build. The working
tree already contained unrelated documentation/script changes and untracked
assets, so this work continues on the current tracked branch without switching
or staging those paths. Terra performs a read-only layout review; Sol owns the
design, code change, integration, release decision, and final verification.
