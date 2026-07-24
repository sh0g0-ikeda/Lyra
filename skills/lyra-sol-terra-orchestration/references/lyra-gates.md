# Lyra Gates

Use these gates before and during implementation.

## Required context

- `AGENTS.md`
- `docs/Lyra_Unified_Spec_v4.md`
- `docs/Lyra_StoryAI_SubSpec.md` when StoryAI, story collaboration, page skeletons, or autofill are involved
- Relevant migrations, routes, services, repositories, domain types, and tests for the target surface

The current unified spec is an implementation contract index. If it has no historical phase label, cite the closest section, such as authentication, persistence, generation jobs, credits, safety, availability, or verification.

## Architecture gate

- Routes handle HTTP, auth, validation, and response mapping.
- Services own business workflows and transaction boundaries.
- Repositories own parameterized PostgreSQL access.
- Domain owns types, constants, schemas, and domain errors.
- Infrastructure owns external providers.
- Workers own asynchronous job execution.
- Browser and mobile apps consume API contracts and user-facing errors.

Do not move provider calls, credit arithmetic, or persistence details into routes.

## Security gate

- Protected routes require authentication and resource authorization.
- Data lookups must be scoped by personal ownership or active organization membership.
- Request bodies must use bounded Zod schemas.
- SQL must use parameter binding.
- Uploaded image keys must not interpolate user input.
- LLM structured output must be schema-validated before persistence.
- Credits must be deducted transactionally with row locking and ledger records.
- Failed chargeable jobs must refund idempotently.
- Raw provider errors, stack traces, credentials, and connection strings must not reach users.
- External calls need bounded timeouts and retry only retryable failures.

## Testing gate

Use Japanese test names when adding tests, following the repository convention.

For code changes, write or update tests before implementation and observe the expected failure unless the task is documentation-only or a genuinely non-testable wiring change; record the reason for that exception.

Minimum useful checks by surface:

- Domain or pure service logic: targeted Vitest file.
- Repository or migration behavior: repository tests plus migration/invariant checks when applicable.
- Route behavior: route unit tests covering auth, validation, not-found, and ownership.
- Worker/generation behavior: worker service tests, generation job tests, refund/recovery cases when touched.
- Web UI behavior: web lint/build and Playwright smoke when user-visible browser workflows changed.
- Mobile UI behavior: relevant app checks if package scripts exist; otherwise document the gap.

Broaden to `npm test` when shared behavior or cross-module contracts changed.

## Git and PR gate

- Default start: `git checkout main`, `git pull origin main`, `git checkout -b {type}/{scope}`.
- If the worktree has user changes, do not switch, pull, reset, or checkout across them. Branch from the current safe HEAD only when that avoids disruption, and record the deviation.
- Keep commits logical and scoped. Do not include unrelated dirty files.
- Before committing, run `git status --short` and inspect the diff for only intended paths.
- For implementation tasks, push the branch and open a PR. Use the AGENTS.md PR template and cite the spec section.
- Skip commit, push, or PR only when the active user instruction explicitly requests local-only/no-commit/no-push work or credentials/tooling make it impossible; record the exception.

## Release verification gate

Task-local checks are enough for local exploration or docs-only work. PR-ready or release work must satisfy the unified spec verification contract:

- Vitest and Bun test entrypoints
- PostgreSQL migration and deployment-invariant checks
- Backend TypeScript build
- Frontend lint and production build
- Playwright auth and authenticated-console smoke tests
- Production runtime configuration, migration task, readiness, worker rollout health, queue inspection, and post-deploy log review when deploying
