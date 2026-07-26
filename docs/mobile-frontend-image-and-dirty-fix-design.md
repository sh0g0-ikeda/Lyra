# Mobile frontend image and dirty-state repair

## Purpose and scope

Repair the reported Mobile behavior without changing Backend contracts:

1. A successful save or discard must allow navigation without another
   unsaved-changes prompt.
2. Page and character images must retry an alternate existing delivery URL
   when the preferred URL cannot be loaded.
3. Selecting a page and enlarging its image must be separate, explicit
   actions.
4. Character continuity-state controls must remain hidden until the product
   is ready to expose them.

The change does not modify routes, services, repositories, migrations,
credits, generation jobs, or production infrastructure. Existing persisted
entity-state IDs remain part of panel payloads and are not cleared.

## Specification basis

- `docs/Lyra_Unified_Spec_v4.md` sections 2, 5, 8, and 10:
  manga production flow, protected image delivery, safe output, and release
  verification.
- `docs/mobile_completion_gap_spec.md`:
  `MOB-ENTITY-004`, `MOB-PAGE-001`, and `MOB-PAGE-006`.
- `docs/mobile_frontend_design.md` sections 10.3, 10.4, 16, and 26:
  confirmed character references, page selection, image enlargement, and
  unsaved-change handling.

## Affected layer and interfaces

Only `apps/mobile` is affected.

- Dirty-state provider: removes only the exact registration snapshot whose
  save or discard completed. A newer registration created by an edit during
  an asynchronous save remains protected.
- Image source builders: produce ordered candidates from existing response
  metadata and existing authenticated endpoints.
- Image component: retries each distinct source once and reports total
  failure only after all candidates fail.
- Pages UI: thumbnail cards select pages; a separate maximize button opens
  the selected image preview.
- Character and panel UI: continuity-state controls are not rendered. The
  underlying API types and existing assignment values remain intact.

## Security

- Authenticated fallback requests retain the current bearer token and
  organization query scope.
- Cache identities continue to include user session, organization, resource,
  revision, and image variant.
- Signed CDN URLs are tried without forwarding bearer tokens.
- No image URL, token, or provider error is logged or shown.
- Hiding state controls must not overwrite an existing `state_id`.

## Test plan

Tests are added before implementation and must initially fail for the reported
behavior:

1. Dirty provider does not prompt twice after successful save or discard.
2. Resilient image advances from CDN to authenticated fallback and reports
   failure only after exhausting candidates.
3. Page image source candidates preserve auth and organization scope.
4. Page thumbnail remains selectable when image loading fails.
5. Page enlargement uses a separate explicit control.
6. Character and page continuity-state controls are not rendered.

Verification:

```text
npm run --cwd apps/mobile test -- <focused test files>
npm run mobile:contracts
npm run mobile:typecheck
npm run mobile:lint
npm run mobile:test
npm run mobile:check-mojibake
```

## Sol/Terra delegation

Terra performed a read-only investigation of the five reported symptoms.
Sol owns the design, test-first implementation, integration review, and final
verification. Terra did not edit files or make Backend or production changes.

## Review resolution

The post-implementation review identified stale retry state and an untested
concurrent-save case. The implementation was revised so image candidate
identity includes URI, authentication headers, and cache key. A refreshed
token or signed URL therefore clears an exhausted state and retries from the
first candidate. Deferred foreground and background save tests also prove
that revision B remains dirty when revision A finishes saving.

No Backend permission was changed. A `view_work` user falls back to the
authenticated thumbnail if both the signed full image and the export-only
route are unavailable. This guarantees a visible page with current contracts;
guaranteeing original resolution during a CDN outage would require a separate
Backend authorization decision and is intentionally outside this frontend
repair.
