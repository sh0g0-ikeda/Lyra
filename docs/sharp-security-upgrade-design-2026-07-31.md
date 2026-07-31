# Sharp security upgrade design

## Purpose and scope

Upgrade the existing backend `sharp` dependency from `0.34.5` to `0.35.3`
before adding episode-export image decoding. The installed version is reported
by `npm audit --omit=dev` as affected by high-severity inherited libvips
advisories fixed in Sharp 0.35.

This change does not add episode export, alter image keys, change HTTP
contracts, or change the inputs/options used by the current preview renderer
and page-balloon composer.

## Spec basis

- `docs/Lyra_Unified_Spec_v4.md` section 8: uploaded and provider-produced
  image input must be bounded and processed safely.
- Section 10: backend, database, Web, and browser gates are required before
  integration.

## Impact and compatibility

Current production use is limited to:

- local preview page rendering;
- local entity-reference preview rendering;
- page balloon composition.

Sharp 0.35.3 requires Node 20.9 or newer. CI uses Node 22 and the Web build
uses Node 24. Backend production uses the pinned Bun image, so Bun import and a
production Docker build are explicit gates.

The 0.35 breaking changes do not intentionally affect the current PNG output,
SVG input, metadata, composite, or `toBuffer` calls. Existing unit tests and
visual metadata checks remain the behavioral contract.

## Security and rollout

- No `npm audit fix --force` is used.
- Only Sharp and its lockfile-resolved platform packages may change.
- Hono audit findings are not bundled into this PR because they require
  separate runtime and routing analysis.
- The exact production container must install and import Sharp successfully.
- The episode-export branch remains unmerged until this prerequisite is green.

## TDD and verification

A dependency contract test is added first and must fail on `0.34.5`. The
implementation then updates `package.json`, `package-lock.json`, and `bun.lock`
to `0.35.3`.

Verification:

- focused dependency, local renderer, and balloon composer tests;
- Bun import and PNG smoke;
- full Vitest and Bun suites;
- backend build;
- fresh migrations and invariants;
- Web lint/build/E2E;
- Mobile contract/type/lint/test/Expo/Android/iOS gates;
- production Docker image build and runtime Sharp import;
- production dependency audit readback.

## Sol / Terra split

No sub-agent is used because the active collaboration policy does not authorize
delegation in this turn. Sol owns the dependency boundary, compatibility
decision, and final integration review.
