# Story page limit: 24 pages

## Purpose and scope

Lower Lyra's shared episode/page-skeleton limit from 32 pages to 24 pages. The
same boundary applies to episode `estimated_pages`, page-skeleton structured
output, skeleton persistence validation, and whole-episode story autofill.

This change does not alter prompts, OpenAI retry/timeout behavior, generation
job lifecycle, credit handling, or the atomic episode-plan persistence path.
It does not automatically delete or truncate existing episodes that already
contain 25-32 pages. A user must explicitly reduce `estimated_pages` and
regenerate the skeleton before replacing those pages.

## Spec basis

- Unified Spec section 6: generation-job coordination and complete-episode
  story-to-page planning.
- Unified Spec section 8: bounded request and structured-output validation.
- Story AI Sub-Spec sections 3, 5, and 8: shared skeleton-page bound,
  story-to-page coverage, and boundary verification.

## Affected layers and interfaces

- Domain: `STORY_AI_LIMITS.maxSkeletonPages` becomes 24.
- Route validation: create/update episode `estimated_pages` accepts 1-24.
- Story services and OpenAI schemas: existing shared-constant checks reject a
  25th page before generation or persistence.
- Web and Mobile: the estimated-page input and its local validation use 24.
- Documentation/tests: hard boundary assertions use 24 accepted / 25 rejected.

There is no API shape, database schema, migration, authentication,
authorization, tenancy, billing, or secret change.

## Compatibility and safety

- Existing 25-32-page records are preserved; there is no destructive migration.
- They remain readable and their individual page data is not silently changed.
- Operations governed by the new global boundary reject them until the user
  explicitly reduces the estimate and regenerates the skeleton.
- Server validation remains authoritative even if an older client still shows
  the former 32-page limit.

## Test and verification plan

1. Add RED boundary tests proving 24 is accepted and 25 is rejected.
2. Verify episode story-autofill does not create or enqueue a job for 25 pages.
3. Verify skeleton/OpenAI structured schemas derive their maximum from the
   shared constant.
4. Verify Web and Mobile expose 24 as their input boundary.
5. Run targeted tests, backend build, Web lint/build, Mobile tests/typecheck/
   lint, and `git diff --check`.

## Delegation

Terra performs bounded read-only impact review and may validate disjoint Web or
Mobile tests. Sol owns the design, shared constant, integration, final review,
and release judgment.
