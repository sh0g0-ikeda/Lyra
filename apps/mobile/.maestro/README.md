# Lyra Mobile Maestro E2E

`e2e-manifest.json` is the authoritative E2E-01 through E2E-18 inventory.
Each flow is executed separately by `scripts/runMaestroStaging.mjs`, which
validates platform, scenario-specific environment variables, Maestro CLI, and
JUnit/screenshot output before it can report success.

Runbooks, fixture requirements, and Audit D evidence handling are in
`docs/mobile-maestro-e2e-operations.md`. Never add credentials, tokens,
invitation links, private content, or evidence files to this directory.
