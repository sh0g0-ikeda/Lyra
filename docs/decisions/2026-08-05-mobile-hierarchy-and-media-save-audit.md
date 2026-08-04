# Mobile hierarchy and media-save audit — 2026-08-05

## Goal and scope

Make the iOS and Android mobile clients behave consistently in the two flows
that were observed on physical devices:

1. Opening a work/chapter/episode action menu and renaming it must show the
   editor immediately, above the hierarchy selector and above the software
   keyboard.
2. Image saving must use the supported Expo Media Library API for every
   individual-image save action, including character reference images, and
   provide a stable, action-oriented failure result without confusing a save
   failure with a download interruption.
3. A missing or temporarily unavailable job lookup must not be rendered as a
   failed job-history card. A real persisted job whose status is `failed` must
   remain visible with its existing retry and error UI.

This change does not alter story, page, image, job, or billing data contracts.
It does not remove the individual image-save action.

## Spec basis

- `Lyra_Unified_Spec_v4.md` sections 2.1 and 2.2: the product outputs image
  assets and users must be able to use them.
- Sections 3.1 and 3.2: this is limited to the Mobile client and its existing
  API/media-library boundary.
- Section 4.2 and 5.1: export remains authenticated and must not expose
  storage paths or credentials.
- Section 8: expected failures must be represented by stable user-facing
  messages rather than raw provider errors.

## Design

`StoryHierarchySheet` currently opens a full-screen native modal and then
opens native modals for its action menu and title editor.  On iOS, a nested
native modal may appear behind the full-screen modal.  The title editor also
uses a bottom-aligned backdrop without a keyboard-avoiding container.

The title editor will instead be rendered as an in-sheet overlay inside the
one existing hierarchy modal.  Its backdrop will be top-aligned and wrapped by
`KeyboardAvoidingView`, preserving safe-area padding.  The action menu will be
closed before opening this overlay.  This avoids nested-modal z-order behavior
while preserving the existing hierarchy selection and mutation interfaces.

The page-image preview will also be presented as a single full-screen native
modal so it is above the selector that launched it. Character reference and
candidate save actions will reuse the authenticated photo-library helper rather
than the document/share helper. This keeps PDF/document export separate while
making each labelled image-save action save to the device photo library.

`JobStatusCard` will treat a query error with no supplied job as an absent card
and keep its normal background retry policy. It will not convert a network or
missing-job lookup into a user-visible failure card; only a job record returned
by the API may show a failed status.

The hierarchy navigator will receive the existing work-query loading state, so
opening it before the work query settles displays an explicit loading state
instead of an empty hierarchy.  It will not refetch merely because a selector
opens, avoiding duplicate work requests and rate-limit pressure.

The media save path will be reviewed against the current Expo Media Library
API.  Tests will keep direct-image saving and file/PDF exporting separate from
the shared authenticated image transfer.

## Layers and interfaces

- Mobile UI: `StoryHierarchySheet`, `ImagePreviewModal`, `PageThumbnailPicker`,
  `CharactersScreen`, `JobStatusCard`, and their existing component tests.
- Mobile media boundary: the existing `download.ts` helper and unit tests.
- No Route, Service, Repository, Domain, Worker, migration, external API, or
  persisted payload changes.

## Security

The change retains the current authenticated fetch for protected images and
only writes returned bytes to the device's photo library after permission is
granted.  No URLs, S3 keys, tokens, or credentials are displayed.

## Test plan

1. Add a failing component test that asserts title editing is rendered in the
   hierarchy modal rather than as a second native modal, with an editor
   keyboard-avoidance container.
2. Add a failing component test for the hierarchy loading state when the work
   query has not settled.
3. Run focused mobile tests, typecheck, lint, and production builds after the
   implementation.
4. Verify the EAS/TestFlight build number before asking for physical-device
   confirmation; do not describe a source-only fix as released.

## Delegation decision

No further parallel edit is assigned.  The relevant changes share one modal
tree and need one integration owner; a prior read-only trace was used to
identify the nested-modal and loading-state boundaries.
