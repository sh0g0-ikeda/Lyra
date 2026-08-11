# Mobile subscription plan change design

## Purpose and scope

- Make a completed subscription change visible without briefly reverting the UI to the old action state.
- Keep the current entitlement separate from a plan that the store will apply at the next renewal.
- Support Apple deferred downgrades and Google Play subscription replacement without trusting client-side state for credits.
- Do not change Stripe checkout behavior or grant credits from an unverified device response.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` section 7: the server is authoritative for credits and billing state.
- Section 10: the mobile client uses native store billing and must present the persisted server state.
- `docs/mobile_completion_gap_spec.md` MOB-BILL requirements: native purchases are verified by the backend before entitlements are applied.

## State contract

The current plan remains the entitlement that is usable now. A store-signed renewal preference is stored separately as:

- scheduled product id;
- scheduled plan code;
- scheduled effective time.

For an Apple Premium to Standard downgrade, Premium remains current until the existing period ends. The UI shows Standard as scheduled for that date and prevents the same change from being submitted again. A later Standard renewal transaction is the only event that changes the current plan and monthly allowance.

The mobile client also reads StoreKit active-subscription renewal information after connecting and after a purchase request returns. This closes the notification propagation gap for display only. It never changes credits or the server entitlement.

StoreKit renewal information is advisory only while the server-authoritative current entitlement is paid. If support or sandbox reset has already returned the account to `free`, stale StoreKit transaction history must not keep a scheduled plan notice visible or disable that plan's purchase button. A real paid entitlement continues to show its verified native downgrade schedule.

For Google Play, a plan change includes the active purchase token and an explicit replacement mode. Upgrades use prorated charging and downgrades are deferred. The backend continues to verify the resulting Play purchase token before changing any entitlement.

## Layers and interfaces

- Infrastructure: decode Apple's signed `autoRenewProductId` and notification subtype.
- Domain/service: validate the renewal product against the allowlisted catalog and calculate scheduled state without changing current entitlement.
- Repository/migration: persist scheduled product, plan, and effective time on `mobile_store_purchases`.
- Billing API: return current period, store, and scheduled plan information with the personal balance.
- Mobile adapter: refresh native active-subscription state, supply Google replacement parameters, and clear the busy state even when a deferred change creates no new transaction.
- Mobile UI: show current and scheduled plans distinctly and disable duplicate changes.

## Security and consistency

- Product ids are resolved only through the server catalog.
- Apple renewal data is accepted only after JWS verification.
- Native renewal information is display-only and is restricted to product ids in the fetched catalog.
- Current plan and monthly credits change only after server verification inside the existing purchase transaction and idempotency boundaries.
- Stale notifications cannot overwrite a newer current or scheduled state.

## Test plan

- Decode an Apple downgrade notification, including subtype and renewal product.
- Preserve Premium entitlement and credits while scheduling Standard, then switch only on a later Standard renewal transaction.
- Clear a fulfilled or cancelled schedule and reject unknown renewal products.
- Persist and return scheduled fields through repository and billing API contracts.
- Refresh StoreKit renewal state on connect and after a deferred request; show the scheduled plan immediately and avoid a stuck spinner.
- Ignore a stale native scheduled plan when the server-authoritative current plan is `free`, while preserving the schedule for a paid current plan.
- Supply Google Play replacement token/mode for upgrades and downgrades.
- Run focused backend/mobile tests first, then backend build, mobile lint/typecheck, migration checks, and release gates.

## Terra delegation

- A read-only iOS flow audit identified the missing scheduled-plan contract and refresh lag.
- A separate read-only Android audit checks replacement-token/mode semantics and backend coexistence behavior.
- Integration, security decisions, implementation, and final verification remain with the primary agent.
