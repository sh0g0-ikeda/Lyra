# Lyra

## Local development

### 1. Start Postgres

```powershell
npm run db:up
```

Default local DB:

- host: `127.0.0.1`
- port: `5432`
- db: `lyra`
- user: `postgres`
- password: `postgres`

### 2. Run migrations

```powershell
npm run migrate
```

- The API also applies pending SQL migrations on startup.
- Running `npm run migrate` manually is still useful before first boot or when verifying DB state.

### 3. Minimal backend `.env`

Create `./.env`:

```env
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/lyra
DEV_AUTH_BYPASS=true
DEV_AUTH_BYPASS_EMAIL=dev@local.lyra
SUPABASE_JWT_SECRET=replace-me
LLM_PAGE_PROMPT_COMPILER_ENABLED=false
LLM_ENTITY_REFERENCE_PROMPT_COMPILER_ENABLED=false
LLM_PAGE_GENERATION_PLANNER_ENABLED=false
GENERATION_USER_ACTIVE_JOB_LIMIT=2
GENERATION_GLOBAL_ACTIVE_JOB_LIMIT=100
GENERATION_ENABLED=true
```

`SUPABASE_JWT_SECRET` is still required for non-bypass local flows and dev token generation.
The three `LLM_*_ENABLED` flags default to `false`; keep them disabled for lower-cost generation that uses deterministic prompts, and enable them only when you explicitly want extra LLM prompt rewriting or planning.
`GENERATION_USER_ACTIVE_JOB_LIMIT` and `GENERATION_GLOBAL_ACTIVE_JOB_LIMIT` cap active page/entity generation jobs before queueing provider work.
Set `GENERATION_ENABLED=false` as a kill switch when provider quota, billing, or abuse-control incidents require stopping new generation jobs.

### Production auth

Local defaults use Supabase-compatible HS256 dev tokens. AWS production should use Cognito:

```env
AUTH_PROVIDER=cognito
AWS_REGION=ap-northeast-1
COGNITO_USER_POOL_ID=ap-northeast-1_replace_me
COGNITO_CLIENT_ID=replace-me
COGNITO_TOKEN_USE=access
COGNITO_REQUIRED_SCOPES=lyra/api
```

When `AUTH_PROVIDER=cognito`, the API verifies the Cognito JWKS signature, issuer, `client_id`, `token_use`, expiration, required scopes, and configured groups before provisioning the user.

### 4. Minimal frontend `apps/web/.env`

```env
VITE_DEV_AUTH_BYPASS=true
VITE_DEV_AUTH_BYPASS_EMAIL=dev@local.lyra
VITE_API_PROXY_TARGET=http://localhost:3000
```

### 5. Start API and frontend

```powershell
npm run dev
npm run web:dev
```

Frontend:

- `http://127.0.0.1:5173/`

When `VITE_DEV_AUTH_BYPASS=true`, the login screen is skipped for local UI checks.

## Testing

### Unit and integration tests

```powershell
bun run test
```

- Runs the repository Vitest suite.
- This is the primary command for backend unit/integration checks.

### Bun test runner

```powershell
bun test
```

- Limited to `./tests` via `bunfig.toml`.
- Does not include `apps/web/e2e` or generated files under `dist/tests`.

### Frontend E2E

```powershell
bun run web:e2e
```

- Runs Playwright tests from `apps/web/e2e`.

## Production Operations

### CI gates

GitHub Actions runs the same checks expected before deployment:

```powershell
bun run test
bun test
npm run build
npm --prefix apps/web run lint
npm --prefix apps/web run build
```

`apps/web/e2e` is intentionally separate because it needs a running app and browser runtime.

### Admin credit refund

Manual support refunds should go through the credit service so `credit_balances` and
`credit_ledger` stay consistent.

```powershell
npm run admin:refund-credits -- --user-id <uuid> --amount 3 --reason "support refund"
```

- Default mode is dry-run and changes nothing.
- Add `--apply` only after confirming the printed target user and amount.
- Optional `--job-id <uuid>` links the refund to a generation job.

### Image storage pruning

Temporary and unconfirmed generated images should be pruned from S3 regularly:

```powershell
npm run admin:prune-images -- --older-than-hours 24 --protect-recent-candidate-hours 48
```

- Default mode is dry-run and lists delete candidates only.
- Add `--apply` to delete candidates.
- The script only accepts `tmp/` and `session/` prefixes. It refuses `saved/` so confirmed
  references and final page assets are not deleted by this tool.
- Current page images, confirmed entity references, recent entity preview candidates, and recent
  uploaded source images are protected from deletion.

For AWS cost control, pair this with S3 lifecycle rules:

- `tmp/`: expire after 1 day.
- `session/`: transition to cheaper storage after a short window, then expire after the support
  window you decide to keep.
- `saved/`: keep durable, encrypted, and private behind CloudFront; use lifecycle transitions only
  after confirming product requirements.
