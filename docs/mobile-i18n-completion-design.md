# Mobile i18n Completion Design

## Purpose and scope

Complete the `6.11 i18n` contract in
`docs/mobile_completion_gap_spec.md` without changing server content or the
selected generation language. All Mobile labels, placeholders, errors,
tutorial text, statuses, and template names must come from a typed catalog.
User-authored content remains an interpolation value and is never used as a
translation key.

This slice does not translate Backend-owned story, entity, page, or job
content. It also does not change API payload language semantics.

## Specification basis

- `docs/mobile_completion_gap_spec.md` section `6.11 i18n`
- `docs/Lyra_Unified_Spec_v4.md` Mobile client and verification contracts
- `AGENTS.md` sections 2, 7, and 8

## Affected layers and interfaces

- Mobile: typed message catalog and every UI call site currently using
  `pickText(language, ja, en)`.
- Tests/CI: source-level guard against reintroducing bilingual literals and
  catalog parity checks.
- Inputs: `UiLanguage`, a stable catalog key, and bounded interpolation values.
- Output: a localized UI string. Server-provided content passes through
  unchanged.
- Persistence and external APIs: none.

## Security and correctness

- Translation keys are compile-time catalog keys, not user data.
- Interpolation replaces only declared `{name}` placeholders and stringifies
  values; it does not evaluate markup or code.
- Japanese source stays UTF-8 and remains covered by the mojibake gate.
- Existing generation requests continue to pass the selected `ja` or `en`
  value to the Backend.

## Test plan

1. Add a source contract test and confirm it fails while `pickText` calls
   remain.
2. Move static bilingual pairs into the catalog mechanically.
3. Convert variable messages to catalog templates with named parameters.
4. Verify catalog key parity, unknown/missing interpolation handling, and the
   source-level prohibition.
5. Run all Mobile tests, typecheck, lint, mojibake scan, and both Expo exports.

## Delegation

Sol owns the catalog architecture, mechanical migration, dynamic interpolation
review, and final verification because all call sites share one type contract.
Terra continues the already delegated processing-job cancellation and API
contract audits in disjoint Backend/read-only scopes.
