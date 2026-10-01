# Image provenance and delivery boundaries

F15 applies to saved output, independently of the next generation request. Legacy
images with absent/null model metadata keep the GPT-compatible path. Explicit
unknown, malformed, or conflicting model/provider metadata fails closed. The known
`hy4-preview` identifier is recognized only for historical Web-only delivery; it
remains disabled for generation and has no configured tariff or model substitute.

## Additive storage and contracts

Existing page image JSON, entity reference JSON, state descriptors, job results,
and episode export snapshots carry optional `image_model`, `provider_model_id`,
and `provider`. Adapters supply truthful output provenance; no model is inferred
for old/mock/local results. Public image descriptors add optional `mobile_access`
(`available`, `web_only`, `unavailable`). Copy/finalization readers preserve fields.
No migration, bulk rewrite, provider activation, or price/quality change is needed.

Common API serializers omit restricted signed URLs and candidate tokens. Every
byte-delivery service checks its authorized source and provenance before loading.
Base reference candidate routes additionally resolve the completed generation job
from the server-owned candidate key and verify exact candidate/entity/user/org
membership. State candidates cannot be read or confirmed via the base-image path.
Uploaded sources and existing legacy confirmed references remain compatible.

## Authorized Web delivery

Dedicated `/api/web/...` image, job, and export endpoints require the client ID
extracted from an already verified Cognito ID-token `aud` or access-token
`client_id`, plus the server's `WEB_IMAGE_DELIVERY_COGNITO_CLIENT_IDS` allowlist.
The allowlist is empty by default. Supabase, development bypass, missing client IDs,
and client-provided platform headers cannot grant access. Existing owner/org
membership/capability checks still run. Unknown output models remain blocked even
on authorized Web endpoints.

`/me.capabilities.web_image_delivery` describes this authenticated capability.
The Web page image client selects the dedicated endpoint only for known Web-only
metadata and an explicit true capability. Missing capability blocks that image;
legacy/GPT delivery and page editing retain their existing behavior.

Mobile source builders, page preview/result/download/export actions, and asset/state
views suppress restricted images. The page notice uses the requested Japanese text:
「このページはアプリでは表示できません。一部のコンテンツはウェブ版Lyraでのみ利用できます」
Editing metadata and explicitly quoting a new supported GPT generation remain
available; the previous generated page image is never implicitly attached.

## Export and read compatibility

Episode export admission checks provenance under the existing page graph lock and
persists it in the existing snapshot JSON. Workers check the current authorized
page key/access class before and after loading source bytes, and refuse unsupported
models. Status/download signing rechecks the immutable artifact snapshot, so an
artifact created through Web cannot be downloaded through the common Mobile route.
Shared page confirmation rejects restricted images before loading/copying them.

The production read routes are restored incrementally: page detail, all 19 layout
templates, entity reference-generation availability, organization candidate-image
query support, and WebP thumbnails. Thumbnail ownership/provenance is checked
before conditional 304 handling; its revision hashes owner/org/page/key/image
revision/provenance/render settings. Responses use `image/webp`, private max-age 300,
ETag, and Vary Authorization. No generation, cancellation, state-lock, or editorial
implementation was replaced wholesale.

## Verification and activation limits

Tests cover legacy/GPT/Hy4/unknown classifications; signed client audience vs forged
headers; scoped page/candidate bytes; state-candidate laundering; conditional
thumbnail caching; Web endpoint choice; and export metadata preservation. Disposable
PostgreSQL 16 and 18 tests cover actual page JSON and export snapshot persistence,
transactional Mobile rejection, authorized Web admission, and changed-source checks.

Hy4 generation remains off. The Web client allowlist has not been configured or
expanded. No cloud/browser/device visual QA or live paid generation was performed.
Future provider activation still requires independently verified image capabilities,
pricing, reference support, and production storage/CDN behavior. The separate
production reading-flow/layout-guide reconciliation is not replaced by this work.

## Historical image compatibility

The exact persisted-reference model `gpt-image-1` remains display/save/export compatible. Evidence: the committed `f89ac1d` `PageGenerationInputImageBuilder.test.ts` state reference fixture and `StoryRepository.test.ts` persisted `reference_image.image_model` fixture. This expands output reading only; generation remains the quoted `gpt-image-2` configuration. An isolated `gpt-image-1-mini` HTTP transport mock is not evidence of a persisted-output contract and does not grant compatibility. Unknown identifiers and conflicting provider metadata remain blocked.
