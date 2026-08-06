# Mobile store billing UI policy - 2026-08-06

## Purpose and scope

The iOS and Android applications must never expose a Stripe Checkout, Stripe
customer portal, external invoice URL, or an organization purchase action.
Personal digital purchases remain native StoreKit or Google Play Billing flows.
The platform subscription-management pages remain available for cancellation and
management of an already purchased native subscription.

This change is mobile UI and API-inventory scope only. It does not remove
Stripe-backed web or organization billing APIs, alter price/credit calculations,
or enable production mobile-store billing.

## Spec basis

This follows the Unified Spec section 7, Credits and billing: mobile digital
goods use the platform store and credit authority remains server-side. The
mobile route inventory already classifies personal Stripe checkout and customer
portal routes as web-only. Organization Stripe routes must receive the same
mobile-hidden treatment because a native mobile UI currently exposes them.

## Design

- Remove the organization billing section from `OrganizationManagementPanel`.
  In particular, do not fetch/render its billing and invoice data, create
  checkout/portal mutations, or accept an external-billing URL callback.
- Keep organization workspace, member, invitation, usage, and audit controls.
- Keep the personal `MobileStoreBillingPanel`, which uses the platform-specific
  native adapter and server verification, and the platform subscription
  management URL used by `PersonalBillingSummary`.
- Mark the organization Stripe checkout, portal, and invoice routes as
  mobile-hidden in the generated mobile route inventory. The web routes remain
  unchanged.

## Security and error handling

No native UI will receive, retain, or open a Stripe URL after this change.
Authorization and Stripe API routes remain server-owned and are not widened.
The native store adapter still validates provider purchase evidence with the
server before updating entitlements or finishing a consumable transaction.

## Test plan

First add a failing `OrganizationManagementPanel` test proving that an owner
cannot see any billing section, checkout, portal, or invoice action. Then remove
the UI and run the focused test, the mobile billing tests, TypeScript, lint,
contract inventory check, mojibake check, and platform exports.

## Delegation

Terra performed a read-only audit of the mobile billing paths. Sol owns the
policy decision, implementation, production-state assessment, and final review.
