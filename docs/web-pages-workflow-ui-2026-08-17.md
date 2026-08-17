# Web Pages workflow UI - 2026-08-17

## Purpose and scope

Reorder the Web Pages workspace so the visible workflow matches the way a page is
actually produced:

1. create the page skeleton;
2. apply the episode story to the panels;
3. select a page and edit page, panel, character-assignment, and dialogue inputs;
4. generate and inspect the completed page image;
5. export the finished pages.

This change is limited to Web rendering, interaction labels, and the Web tutorial.
It does not change routes, API payloads, generation jobs, save-before-generate
behavior, authorization, billing, credits, or persistence.

The 24-page episode limit remains the shared authoritative boundary described in
`docs/story-page-limit-24-2026-08-17.md` and ships in the same release.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` sections 2, 6, and 10.
- `docs/Lyra_StoryAI_SubSpec.md` sections 3 and 5.
- Existing Web page generation must continue to use the current saved inputs and
  existing readiness checks before a job is accepted.

## Affected layers

- Web: `apps/web/src/App.tsx`, `apps/web/src/index.css`, and Web E2E tests.
- Documentation: this design note and the in-app bilingual tutorial copy.
- Backend, Route, Service, Repository, Domain, Infrastructure, Worker, Mobile,
  migrations, and external API contracts: unchanged by this UI change.

## UI and interaction contract

The Pages workspace renders in this semantic and keyboard-navigation order:

1. Page planning controls: Generate/Regenerate page plan and Apply story plan,
   together with their existing blockers, confirmation, and job progress.
2. Page art direction.
3. Page list.
4. Story sources.
5. Panel layout and panel editing, including entity assignments and dialogue.
6. Page generation controls and the completed image.
7. Export.

The Page planning section is removed from Story, so there is one canonical location
for both actions. Their current handlers and disabled conditions are reused unchanged.

Each generated page card has two separate controls rather than nested buttons:

- a page-selection control;
- an explicit Enlarge image control that opens the existing authenticated image in
  the existing lightbox without changing the selected page.

Pages without a generated image do not expose the enlarge action. Existing image
double-click behavior may remain as a secondary compatibility gesture, but tutorial
and visible copy describe the explicit button.

## Security and data safety

- Authenticated image export remains the only source of page image bytes.
- The object URL already created by `AuthenticatedImage` is reused for the lightbox;
  no public URL or new download request is introduced.
- Existing personal/organization scoping is unchanged.
- Existing save-before-generate, readiness blockers, duplicate-job prevention,
  overwrite confirmation, job tracking, and credit behavior are preserved.
- No LLM output, SQL, secret, upload, or billing code changes.

## TDD and verification

Add or update Web E2E coverage before implementation to prove:

- Page planning is absent from Story and appears before the page list in Pages.
- The editing cluster precedes the page-generation/result section in DOM order.
- Every generated page exposes an accessible enlarge button, an ungenerated page
  does not, and enlargement opens the existing lightbox without changing selection.
- The bilingual tutorial names Pages as the location of page planning, states the
  1-24 page boundary, and explains edit/save -> generate -> inspect -> export order.
- Narrow viewport rendering has no horizontal overflow.

Verification commands:

```powershell
npm run web:lint
npm run web:build
npm run web:e2e
npm test
npm run build
```

Release only after the current branch's existing 24-page Backend/Mobile/Web checks,
database invariant checks, worker/API rollout gates, Web authenticated smoke, and
post-deploy queue/log/health checks succeed.

## Terra delegation

- Terra performs read-only audits of current Pages DOM/handlers, tutorial copy, and
  release state.
- Sol owns the design, TDD integration, code changes, final review, and production
  deployment decisions.
