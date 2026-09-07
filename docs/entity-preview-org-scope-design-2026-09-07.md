# Entity candidate preview organization query repair

## Purpose and scope

Allow the authenticated entity reference-candidate image GET endpoint to accept the
already-validated optional `organization_id` query parameter. The current route
validates and authorizes that parameter before passing the whole query object to a
strict candidate-image schema, which rejects it as an unknown field and returns 422.

This change is limited to the route schema and its tests. It does not change storage,
tokens, entity ownership, organization membership, migrations, or mobile behavior.

## Contract and security

Unified Spec sections 4, 5, and 8 require authentication, active organization
membership before organization-scoped access, and bounded request validation. The
route will continue to parse `organization_id` with `parseOptionalOrganizationId`,
then require `view_work` membership before candidate-token parsing or image export.
The candidate query remains strict: only `candidate_token`, legacy `s3_key`, and the
bounded UUID `organization_id` are accepted. Candidate tokens remain bound to the
authenticated user and path entity ID; no `source_s3_key` fallback is added.

## Test plan

Add route tests that first demonstrate the organization-scoped candidate request
returns 422, then verify the repair returns 200 while preserving: non-member 403,
invalid organization ID 422, unknown query parameter 422, personal candidate export,
and candidate-token entity binding rejection. Run the focused route test, full
backend Vitest suite, and backend TypeScript build.

## Delegation

Sol assigned this bounded route/test implementation to Terra. Sol retains final
review, deployment, and all production decisions.
