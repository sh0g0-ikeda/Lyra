# Mobile feedback visual refresh - 2026-08-14

## Purpose and scope

This design responds to tester feedback that the mobile interface feels too small,
the launch/authentication artwork is clipped, and the app icon exposes an inset
black square. The authentication entry implementation is now approved. This
change covers the in-app launch transition and signed-out authentication screen;
launcher icon replacement and whole-app density changes remain follow-up work.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` section 2: the mobile entry point must make the
  authenticated manga-production workflow understandable before sign-in.
- `docs/Lyra_Unified_Spec_v4.md` section 10: a later implementation must pass the
  Mobile verification gates before release.

## Affected layer

- Mobile presentation only: launch artwork, authentication screen hierarchy,
  typography, and touch targets. Launcher icon replacement is follow-up work.
- No Route, Service, Repository, Domain, Infrastructure, Worker, API, billing,
  credit, authentication-provider, or persistence contract changes.

## Proposed visual contract

- Reference canvas: iPhone portrait, 390 x 844 points.
- Horizontal safe margin: 20 points.
- Main content width: 350 points maximum on the reference canvas.
- Brand mark: 128 x 128 points, `contain`, never cropped.
- Page title: 28 points / 34-point line height.
- Supporting copy: 16 points / 24-point line height.
- Feature rows: minimum 52 points high; label at least 16 points.
- Primary action: minimum 58 points high; 18-point bold label.
- Secondary/legal actions: minimum 44-point touch target; visible text at least
  14 points.
- Small-height devices use vertical scrolling instead of reducing type or
  clipping the brand mark.
- The launcher icon uses a full-bleed square background with no inset rectangle;
  the Lyra constellation occupies roughly 76-80 percent of the canvas and is
  kept clear of the platform mask safe boundary.

## Whole-app readability follow-up

The feedback should not be handled by scaling every dense editor indiscriminately.
The default readable density should use 24-point screen titles, 18-point section
titles, 16-point body text, 14-point captions, 56-point primary actions, and
48-point secondary controls with at least 44-point touch targets. Bottom navigation
should use 24-point icons and 12-13-point labels. Long professional forms should
group related fields into collapsible sections so the larger controls do not make
the workflow harder to scan. A later optional compact-density setting may preserve
the current high-density presentation for experienced users, but the default stays
readable.

## Interaction contract

1. Native launch screen shows only the centered Lyra mark on the dark canvas and
   keeps the complete 176-point mark visible with `contain`. It remains visible
   for no more than about 900 ms after the app is ready, then fades for 180 ms.
2. Once JavaScript and saved session state are ready, an authenticated user moves
   directly into the app; a signed-out user sees the authentication introduction.
3. The authentication screen explains the three core steps: create a story,
   prepare characters, and generate pages.
4. Tapping `ログイン / 新規登録` opens the existing Cognito managed login in the
   current app language. The button shows a progress state and rejects duplicate
   taps while the browser flow is opening.
5. Returning with a valid session enters the app. Cancellation returns to the
   same screen without losing state; a failure appears as an inline notice above
   the primary action.
6. Terms, privacy, and support remain separate 44-point link targets and continue
   opening the existing HTTPS pages.

## Security and data handling

The proposed screen does not collect credentials itself. Authentication continues
through Cognito managed login, legal destinations remain HTTPS URLs, and no new
analytics, permissions, identifiers, or stored fields are introduced.

## Verification plan for this implementation

- Add failing UI contract tests for unclipped `contain` artwork, minimum typography,
  minimum touch targets, localized copy, and small-height scrolling.
- Run Mobile tests, typecheck, lint, contract checks, mojibake checks, and iOS and
  Android exports.
- Visually inspect iPhone small/standard/large sizes plus iPad portrait/landscape,
  when simulator or device access is available.

## Delegation

Terra performs a read-only audit of the current authentication layout and bundled
image geometry, then reviews the bounded implementation. Sol owns the tests,
implementation, integration decision, and final verification.

## TDD sequence

The approved runtime change starts with failing contracts for the brand asset,
localized entry copy, `contain` rendering, large primary action, and screen content
style support. Implementation follows only after the red result is confirmed.
