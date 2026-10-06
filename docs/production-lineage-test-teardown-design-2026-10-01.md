# Production lineage integration-test teardown budget

## Purpose and design

The release verification gate in `Lyra_Unified_Spec_v4.md` §10 requires both
Vitest and native Bun to pass. The production-lineage bridge cases intentionally
retain an isolated, fully migrated schema per case until the suite finishes.
Currently 26 schemas are dropped sequentially after all fixture pools close.
This is test-fixture maintenance, not production migration work.

GitHub CI run `36904280774`, job `110510795438`, completed every assertion under
Bun 1.4.2, then exceeded its default 5-second `afterAll` budget. Give only this
suite's cleanup hook an explicit, bounded 60-second budget. Keep sequential pool
closure, sequential schema drops and error propagation unchanged. Do not relax
migration locks, per-test timeouts, bridge assertions or production behavior.

## Resource-leak investigation

The test transaction adapter releases checked-out connections in `finally`;
the test advisory-lock helper also releases its client. Temporary instrumentation
on disposable PostgreSQL 18.3 with native Bun 1.3.10 observed:

- 26 fixture clients, all idle; zero pool waiters
- One admin client, idle; zero admin waiters
- Fixture pool closure: 3.35 ms
- All 26 sequential schema drops and admin closure: 1.25 seconds total

No checked-out-client leak was observed. The local fast run does not reproduce
GitHub's slower DDL timing; the exact GitHub runner still needs its rerun. Remove
the diagnostic instrumentation from the committed test.

## Safety and verification

Only a test hook timeout changes. It remains finite, and errors still fail the
suite. The fixtures use synthetic data in disposable local databases; no live
provider or production database is used. Verify both entrypoints and query the
disposable database after each run for remaining lineage schemas and sessions.

Final-code verification completed locally:

| PostgreSQL | Entrypoint | Result | Remaining lineage schemas / other client sessions |
| --- | --- | --- | --- |
| 18.3 | native Bun 1.4.2 (`744846f84`) | 26 passed, 0 failed; 201 assertions | 0 / 0 |
| 18.3 | Vitest 4.1.5 | 26 passed, 0 failed | 0 / 0 |
| 16.14 | native Bun 1.4.2 (`744846f84`) | 26 passed, 0 failed; 201 assertions | 0 / 0 |
| 16.14 | Vitest 4.1.5 | 26 passed, 0 failed | 0 / 0 |

Commands: `bun test tests/integration/productionLineageBridge.test.ts` and
`vitest run tests/integration/productionLineageBridge.test.ts`, each with
`APP_ENV=test` and `DATABASE_URL` pointing at a fresh disposable local database.
A separate database client checked `pg_namespace` for the fixture name pattern
and `pg_stat_activity` for other client backends after each test process exited.
A source comparison confirmed all 26 test bodies and assertions are unchanged.
`git diff --check` passed. These are focused checks; the complete release gate
must still pass on the published candidate commit.
