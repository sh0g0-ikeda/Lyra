# Mobile bottom tab Safe Area design (2026-08-17)

## Purpose and scope

Keep the Story, Characters, Pages, Account, and Guide bottom-tab controls above
the Android system navigation bar and the iOS home indicator. This change is
limited to the shared Mobile tab navigator and its UI contract test. It does not
change screen content, authentication, API requests, persistence, billing, or
generation jobs.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` section 2: the bottom tabs expose the primary
  authenticated manga-production flows.
- Section 3: this is a Mobile presentation-layer responsibility; no backend
  layer changes are required.
- Section 10: the relevant Mobile tests, typecheck, lint, export, and release
  build must pass before distribution.

## Current failure and design

`MainTabs` currently supplies a fixed `paddingBottom: 9`. React Navigation
normally applies `insets.bottom` to its tab bar, but the application style is
merged afterward and replaces that safe-area padding. On Android edge-to-edge
devices, tab labels and touch targets can therefore enter the gesture or
three-button navigation area.

`MainTabs` will read `useSafeAreaInsets().bottom` and make the tab bar dimensions
explicit:

- height: the existing 72-point visual control area plus the bottom inset;
- bottom padding: the existing 9-point spacing plus the bottom inset;
- top padding, width cap, colors, labels, icons, and dirty-editor guard remain
  unchanged.

An explicit height keeps React Navigation's reported tab-bar height consistent
with the rendered height. The same calculation works when the inset is zero,
with Android gesture navigation or three-button navigation, and with the iOS
home indicator. Android edge-to-edge remains enabled; deprecated system-bar
configuration and a new navigation-bar dependency are out of scope.

## Interfaces, security, and state

Input is the device-provided safe-area bottom inset. Output is tab-bar layout
only. No data is persisted and no external API is called. Authentication,
authorization, tenant scope, secrets, uploads, credits, and destructive actions
are unaffected. Existing unsaved-edit navigation interception remains intact.

## TDD and verification

Before implementation, `MainTabsDirtyGuard.test.tsx` will assert the rendered
tab-bar height and bottom padding for zero, gesture-navigation, three-button,
and iOS-style insets. The current fixed style must fail those non-zero cases.

After implementation:

1. Run the focused MainTabs test.
2. Run Mobile typecheck and lint.
3. Run the Mobile test suite and Android export.
4. Review the scoped diff and run `git diff --check`.
5. Build a new installable APK and verify version, build number, commit, and
   artifact type.

Physical-device acceptance is that all five icons, labels, and touch targets
remain fully above the Android system navigation controls in both gesture and
three-button modes. Automated tests validate the layout contract but cannot
emulate every OEM's system bar rendering.

## Terra delegation

Three read-only Terra audits cover the tab implementation, Android edge-to-edge
configuration, and test contract. Sol owns the design, TDD edit, integration,
release decision, and APK build.
