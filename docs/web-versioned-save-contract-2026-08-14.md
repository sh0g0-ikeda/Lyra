# Web versioned save contract remediation

## Purpose and scope

Browser saves currently omit the optimistic-concurrency token required by the
update APIs. This change restores the Web contract for work, chapter, episode,
and entity updates. Page settings remain on their existing strict non-versioned
schema. This does not loosen backend validation, retry stale writes automatically,
or alter persistence and ownership rules.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` section 2: browser editing remains a supported
  Lyra workflow.
- Section 3: HTTP payload construction belongs in the Web client/API adapter;
  validation, ownership, and persistence remain in Route/Service/Repository.
- Section 10: validate the closest unit contract and the Web lint/build gates.

## Affected layers and interface

- Web API adapter: every versioned update accepts an explicit
  `expectedUpdatedAt` option and serializes it as `expected_updated_at`.
- Web screens: callers provide the `updated_at` value from the record currently
  being edited, alongside the optional organization scope.
- Page settings continue to send only fields accepted by
  `updatePageSettingsBodySchema`; the separate atomic save-and-generate endpoint
  retains its own revision contract.
- Backend, database, billing, mobile, and external APIs are unchanged.

Inputs are the existing bounded update fields plus a non-empty revision string.
Successful outputs remain the updated API records. A stale revision continues
to return the existing 409 conflict and requires the user to reload; it is not
silently retried or overwritten.

## Security and data integrity

Authentication, ownership, and organization scoping remain server-enforced.
The required revision is preserved so concurrent browser sessions cannot
silently overwrite newer data. No credentials, storage paths, billing state, or
credit logic are involved.

## Test plan

1. Add a failing API contract test proving all four versioned update methods include
   the supplied revision in their JSON request and retain organization scoping.
2. Assert that page settings remain schema-valid and do not gain an unsupported
   revision field.
3. Change the API adapter and all Web call sites; TypeScript compilation must
   reject any call that still uses the old positional organization argument.
4. Run the targeted Vitest test, Web lint, Web production build, and diff check.
5. Preserve the existing 409 user-facing conflict behavior and do not add an
   unsafe automatic retry.

## Orchestration

Sol owns design, implementation, integration, and verification. Terra performed
the read-only route-to-repository audit and identified the affected Web call
sites; it did not edit files.
