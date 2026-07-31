# Entity reference direct upload design

## Purpose and scope

Add a Mobile-safe direct S3 upload path for entity reference import without
changing the existing base64 `POST /api/entities/import-image` request or its
response. This slice enables only:

- an authenticated presign endpoint,
- single-use upload-token finalization through the existing import endpoint,
- S3 metadata/content verification,
- reuse of the existing analysis and credit/refund workflow.

It does not change applied migration 031, confirmed-reference persistence,
entity generation jobs, Web upload behavior, billing, or account deletion.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` sections 3, 4, and 5: Route / Service /
  Repository / Infrastructure boundaries and personal or active-organization
  scoping.
- Section 7: existing entity import credit consumption and idempotent
  compensation behavior remain authoritative.
- Section 8: bounded MIME/size validation, server-owned object keys, hash-only
  single-use upload records, safe provider errors, and external-call timeouts.
- Section 10: focused tests followed by the full release verification gate.

## Interface and behavior

`POST /api/uploads/entity-reference/presign` accepts:

```json
{
  "mime_type": "image/png",
  "size_bytes": 12345,
  "entity_id": "optional-existing-entity-uuid"
}
```

The organization remains the optional `organization_id` query scope used by
the existing API. The response is `201`, `Cache-Control: no-store`, and contains
only an HTTPS PUT URL, the one-time opaque upload token, expiry, and exact
required upload headers. It never returns the S3 key.

`POST /api/entities/import-image` continues to accept the current base64 body.
It additionally accepts the mutually exclusive token form:

```json
{
  "upload_token": "opaque-token",
  "entity_type": "character",
  "entity_id": "optional-same-entity-uuid"
}
```

Both forms keep the existing response schema and reference-candidate-token
generation. The token form does not send the uploaded bytes from the API to S3
again; S3 performs one internal conditional copy to a server-only key after
verification.

## Layer impact

- Domain: shared upload limits, MIME helpers, token length, timeout/retry
  constants, and image signature checks.
- Repository: reuse the already-integrated migration 031 repository without
  changing its interface or SQL.
- Infrastructure: presigned PUT, bounded S3 HEAD/GET verification, and an
  ETag-conditional internal copy.
- Service: create/inspect/consume upload authorization and delegate chargeable
  analysis to `EntityReferenceService`.
- Route: authenticated, bounded request parsing, organization `generate`
  authorization, stable response mapping.
- App/API contract: optional dependency wiring when S3 image storage exists and
  strict response parsing.

No worker, generation job, existing table, Web UI, or billing layer changes.

## Security and failure ordering

1. Validate MIME (`image/jpeg`, `image/png`, `image/webp`) and `1..5 MiB`.
2. Authorize the personal/organization scope and optional entity ownership.
3. Generate a server-owned `tmp/{userId}/entities/imports/{uuid}.{ext}` key.
4. Persist only SHA-256 of a 32-byte random token, bound to user, optional
   organization/entity, MIME, declared size, purpose, key, and five-minute
   expiry.
5. Sign exact MIME, size, and AES256 server-side encryption.
6. On finalization, look up only by hash plus authenticated scope; never accept
   a client S3 key.
7. HEAD validates exact type, size, and ETag. GET uses a byte range capped by
   the approved size and validates returned total object size, type, ETag, byte
   length, and PNG/JPEG/WebP magic bytes. This closes the HEAD-to-GET
   replacement memory-amplification gap.
8. Copy the verified object inside S3 to a new server-only temporary key with
   `CopySourceIfMatch` bound to that ETag. The client PUT URL can never mutate
   the stabilized key used by later generation or confirmation. A replacement
   between GET and copy fails closed.
9. Atomically consume the token only after S3 verification and stabilization,
   and before credit
   consumption or analysis. Concurrent/replayed requests therefore cannot
   analyze or charge twice.
10. The existing import workflow consumes personal or organization credits and
   refunds on storage/analyzer failure. The direct path reuses that workflow,
   except it reuses the verified S3 object rather than uploading it again.

S3 not-found returns a generic validation error. Retry is limited to bounded
timeouts, throttling, and S3 5xx failures. Raw tokens, object keys, provider
errors, stack traces, and credentials are not logged or returned.

## Residual rollout boundary

The feature flag remains off until bucket IAM, CORS, and temporary-object
lifecycle configuration are read back from the target environment. A successful
analysis whose HTTP response is lost cannot currently replay its outcome because
migration 031 stores authorization state, not the generated analysis result.
Mobile must treat finalization as an uncertain non-automatic-retry stage. A
future result-idempotency record can remove that UX limitation without weakening
single-use or credit safety.

## TDD and verification

Tests are added before implementation and must first fail because the direct
upload modules/contracts are absent. Focused coverage includes:

- server-owned key and hash-only token persistence;
- personal, organization, and entity scope;
- invalid MIME/size/token and HTTPS response contract;
- missing/mismatched/replaced S3 objects and magic bytes;
- bounded Range GET, timeout, and retry classification;
- atomic single-use, replay, expiry, and concurrent finalization;
- no credit/analyzer call before verification and consume;
- existing base64 route compatibility and existing credit/refund behavior;
- app wiring with and without configured S3 storage.

After focused green tests: Vitest and Bun entrypoints, backend build, fresh
migrations and invariants, Web lint/build/Playwright smoke, Mobile contract,
typecheck/lint/test, Expo checks, and Android/iOS static exports.

## Sol / Terra task split

Sol owns this design, TDD boundary, security decisions, implementation
integration, and final verification. Terra performs a read-only comparison of
PR #67 with current main, limited to the upload-related files, and reports
contracts and risks. Terra does not edit or make integration decisions.
