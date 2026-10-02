# Job response compatibility repair

Spec: Lyra_Unified_Spec_v4 §§4, 6, 8, 10, 11. No persistence migration is needed.

## Design before implementation

Production Mobile at 2debe8c accepts exactly four job types. The route must default to that contract while allowing new clients to explicitly request `job_contract=v2`. Absent/v1 means the four legacy types; v2 adds `entity_import_analysis`. Unknown versions and unsupported type filters fail validation. History passes the negotiated types to the existing owner/organization-scoped repository query before LIMIT and cursor generation. This avoids dropping rows after pagination or preventing upgraded clients from seeing imports.

Detail and cancel use the same negotiation. After normal authorization, an import job addressed without v2 is not found; cancellation must validate before mutating. The new Mobile and Web API clients send v2 on list (Mobile only), detail and cancel requests. Hiding remains a bodyless action. `/web/jobs/:id` retains its verified Web-client access requirement in addition to the version gate.

Active-resource repository queries explicitly select page/entity/story/skeleton generation types, and push delivery and navigation explicitly allow only those four types. Neither path can introduce import-analysis jobs into old clients. This change does not expand push eligibility.

The normal page completion repository writes image provenance at `job.result` root. The job serializer currently omits that root provenance and returns safe nested `generated_image` metadata when present in older/persisted shapes. Its nested output already includes public provenance, so the strict canonical nested schema must allow the same bounded public fields. Regenerate the Mobile contract from the canonical schema. Do not allow image locations, opaque storage keys, candidate tokens, provider internals or arbitrary unknown fields. Keep legacy/no-metadata and normal flat-worker responses valid.

## Verification

Freeze the actual 2debe8c Mobile job-schema excerpt and its exact helper definitions, recording the source SHA-256. Exercise HTTP history, detail and cancel for old and v2 clients, type filters and cursors, unknown versions, and authorization. Verify page provenance through canonical, generated Mobile and frozen legacy schemas for nested, flat, absent, Web-only, conflicting and unknown models; all private image locations must remain redacted. Re-run existing response-contract, route, repository and client tests, contract generation check and TypeScript build.

## Export compatibility extension (design before implementation)

The same production Mobile artifact requires a flat export status DTO with persisted episode ID, format and filename. Restore that default and reserve `export_contract=v2` for the current nested progress/error DTO; new Mobile requests v2 explicitly. Service status carries existing persisted public metadata, without exposing storage or lease fields. A completed legacy response obtains its optional `download_url` only through the existing scoped `createDownload` path, only if status says the artifact is ready. That path rechecks expiry, exact artifact key, and every snapshot image's audience policy before signing. URL generation failure due to unavailable/expired artifact omits the URL; access failures remain closed. Web endpoints continue requiring verified Web-client identity. Blank/whitespace filenames reach the existing safe default normalization, with length/type checks retained.

## Verified results

- Before fixes: 15/22 new job tests and 17/19 new export tests failed against the unchanged candidate implementation.
- After fixes: 105 focused backend HTTP/contract/service/Web-client/inventory tests passed; 41 Mobile job/export API tests passed.
- PostgreSQL 18: all four job reporting tests passed, including real HTTP history across two cursor pages with an import job and another user's job present.
- Backend TypeScript build, Mobile typecheck, Web production build and Web lint passed. Contract generation and API inventory are current.
- No provider call, production access, deployment or store operation was used.

Frozen schemas are in `tests/fixtures/production-mobile-2debe8c/`, copied verbatim from the production Mobile source at `2debe8c:apps/mobile/src/domain/apiSchemas.ts`. Headers record the complete source SHA-256; only the relevant original declarations and their exact helper dependencies are included.

## Combined audit checkpoint

The combined billing, job/export and organization compatibility changes pass 2,587 tests across 345 files on PostgreSQL 18 (Vitest) and PostgreSQL 16 with production Bun 1.3.14. Mobile passes 927 tests across 183 files plus typecheck, lint and generated-contract checks. Backend build, Web lint/build and the 150-route API inventory pass. The Web client test runs against the real module in both supported runners. Browser smoke and platform exports are rechecked by CI for the published revision; local Chromium cannot run in this workspace. These totals do not replace provider, production-data, Web app-client isolation or physical-device acceptance.
