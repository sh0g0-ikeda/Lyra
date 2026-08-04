# Mobile OAuth callback scheme fix

## Purpose and scope

Return a successful Cognito authorization to the installed Lyra mobile app on
iOS and Android. This change is limited to the mobile OAuth callback and logout
URLs. It does not change API endpoints, Cognito token exchange, persisted data,
generation jobs, credits, or any mobile screen layout.

## Evidence and design

The production build used `https://app.lyra-editor.com/auth/mobile/callback`.
The deployed Apple association path currently resolves to the web application's
HTML fallback, so iOS opens the browser web UI instead of returning the OAuth
result to the native app. The mobile binaries already register the
`lyra-mobile` URL scheme and Cognito accepts that callback URI. Production now
uses `lyra-mobile://auth/callback` and `lyra-mobile://auth/logout` directly.

The authorization code, state validation, PKCE verifier, token endpoint,
authenticated API origin, and Cognito domain remain unchanged.

## Specification and security basis

This follows the authentication boundary in `Lyra_Unified_Spec_v4.md` section
4 and the release verification requirement in section 10. The custom scheme is
an app-routing boundary only; it does not weaken TLS requirements for the API or
Cognito, and PKCE remains required for the code exchange.

## Verification plan

1. A configuration test must reject the old HTTPS production callback and
   accept the two fixed production app-scheme URIs.
2. Run the mobile test suite, TypeScript type check, lint, and the Expo config
   evaluation.
3. Build and submit new Android and iOS production artifacts. On an iPhone,
   complete Cognito sign-in once and verify the result returns to the mobile
   home screen without showing the browser web UI or a failure banner.

## Delegation

No delegation: this is a small, coupled configuration and regression-test
change, so splitting ownership would increase release risk.
