# Mobile Store Legal Links Design

## Purpose and scope

Add functional, localized Terms of Use and Privacy Policy links to the mobile in-app purchase panel so users and App Review can open the applicable legal documents before purchasing or subscribing. Also include the Apple Standard EULA URL in both App Store description localizations so App Store Connect metadata satisfies the subscription review requirement.

This change is limited to the Mobile purchase UI, App Store description metadata, and their tests. It does not change products, pricing, StoreKit or Google Play purchase flows, server verification, entitlements, credits, or persistence.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` section 3: Mobile owns its user-facing provider flow.
- Section 8: external destinations and user-facing failures must remain bounded and must not expose provider details.
- Section 10: the changed Mobile surface requires targeted tests, type checking, lint, and platform export checks before release.

## Interface and affected layers

- Layer: `apps/mobile` and its release metadata only.
- Input: the saved UI language (`ja` or `en`) and a user tap.
- Output: the operating system opens a fixed HTTPS URL in the external browser.
- Terms destination: Apple Standard EULA on iOS; Lyra Terms on Android and other platforms.
- Privacy destination: Lyra Privacy Policy.
- App Store metadata: Japanese and English descriptions include the exact Apple Standard EULA HTTPS URL.
- Failure: opening failure remains local to the panel and is shown with a stable localized message.
- Persistence, API, database, external billing provider calls, and jobs: unchanged.

## Security and review controls

- URLs are compile-time allowlisted constants; no user input is accepted.
- Only HTTPS destinations are used.
- No purchase token, receipt, account identifier, raw provider error, or secret is included in either URL.
- Links remain available independently of StoreKit/Play Billing connection state and purchase availability.
- Each control uses the accessibility `link` role and a localized accessible label.

## Test plan

1. Add a failing component test that expects both legal links, their accessible roles, and the exact allowlisted URLs.
2. Add a failing component test that expects a localized safe message when the operating system cannot open a link.
3. Implement the minimum Mobile UI and translation changes.
4. Run the targeted component test, Mobile typecheck, lint, mojibake check, and iOS/Android export checks.
5. Add a metadata contract test that prevents either App Store localization from omitting the Apple Standard EULA URL.

## Terra delegation

Terra performs a read-only review of existing Mobile link and test conventions and reports accessibility or App Review risks. Sol owns the design, implementation, integration, and final verification.
