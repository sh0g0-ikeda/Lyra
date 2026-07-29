# Entity Reference Presigned Upload Design

## Purpose and scope

Implements `MOB-API-006` from `docs/mobile_completion_gap_spec.md` for entity
reference imports. The change adds a presigned S3 PUT flow and a one-time,
short-lived server token. The backend wiring and Mobile client are included;
the existing Web-compatible base64 import flow remains available.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` sections 3, 4, 5, and 8: route/service/
  repository boundaries, authenticated personal or active-organization scope,
  opaque storage keys, bounded image input, and safe external API handling.
- `MOB-API-006`: Mobile uploads JPEG, PNG, or WebP directly to a short-lived
  PUT URL and finalizes analysis with an opaque upload token.

## Contract

`POST /api/uploads/entity-reference/presign` accepts only MIME type, byte
size, and an optional existing entity ID. The organization ID remains a query
scope, matching existing Lyra routes. The service creates a server-owned key
under `tmp/{user}/entities/imports/`; no filename or client path participates
in the key. It stores only a SHA-256 token hash with its user, organization,
optional entity, purpose, MIME, size, key, and expiry. The successful response
contains the temporary PUT URL, opaque token, and the exact required PUT
headers (`Content-Type` and `x-amz-server-side-encryption`), never the S3 key.

`POST /api/entities/import-image` keeps accepting its existing base64 body.
Its new token form consumes the database token with a single conditional UPDATE,
then requires the same user/organization scope and optional entity ownership
again. It performs HeadObject and GetObject checks for the exact generated key,
size, and MIME, then validates PNG/JPEG/WebP magic bytes before calling the
existing import-analysis workflow. Only S3 reads are retried, with a bounded
timeout. PUT operations are never retried by the server.

## Security decisions

- Allowed types are exactly `image/jpeg`, `image/png`, and `image/webp`; size
  is 1 byte through 5 MiB at both entry points.
- Tokens are random opaque values; logs and error responses never include the
  token, S3 key, or provider exception text.
- Expired, replayed, cross-user, cross-organization, absent, MIME-mismatched,
  size-mismatched, and magic-byte-mismatched uploads all fail before analysis
  or credit consumption.
- The temporary `tmp/` prefix is intentionally compatible with the existing
  image pruning policy. Production S3 must additionally have a lifecycle rule
  that expires `tmp/` objects (including incomplete multipart uploads) after
  at most 24 hours. The checked-in template is
  `ops/security/s3-temporary-uploads-lifecycle-rule.example.json`; production
  still requires applying and verifying that bucket configuration.

## Layers and wiring

New Domain, Repository, Service, Infrastructure, and Route modules own the
backend flow. `EntityReferenceService` receives a narrow
`importUploadedImage` extension so the existing credit/refund/analysis behavior
is reused without writing the same image a second time. `src/app.ts` wires the
token repository, S3 storage, upload service, presign route, and token finalize
path when the image bucket is configured.

Mobile parses the presign response at the API boundary, uploads the selected
file as binary data with the exact signed headers, exposes byte progress and
cancel, and sends the opaque upload token to the existing import route only
after a successful 2xx PUT. A retryable PUT or presign failure keeps only the
local file URI and metadata and requests a fresh presign on retry. A failure
after finalize has started is not automatically retried because the server may
already have completed chargeable analysis.

The S3 bucket CORS policy must permit PUT from the Mobile clients with
`Content-Type` and `x-amz-server-side-encryption` headers.

## Tests and verification

Tests are added first for presign validation, personal/organization scope,
cross-user use, replay, expiry, MIME/size mismatch, missing object, image magic
bytes, repository conditional consumption, and safe S3 read retries. Mobile
tests cover runtime response parsing, organization scope, progress, cancellation,
retry classification, and the invariant that finalize never starts before a
successful PUT. Verification runs focused Vitest files, Mobile
typecheck/lint/mojibake checks, the migration invariant test, and backend build.
