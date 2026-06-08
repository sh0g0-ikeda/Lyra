# Lyra

## Local development

### 1. Start Postgres

```powershell
bun run db:up
```

Default local DB:

- host: `127.0.0.1`
- port: `5432`
- db: `lyra`
- user: `postgres`
- password: `postgres`

### 2. Run migrations

```powershell
bun run migrate
```

- Local API startup applies pending SQL migrations by default.
- Production should set `AUTO_RUN_MIGRATIONS=false` and run `bun run migrate` as a one-off deploy task before starting API tasks.

### 3. Minimal backend `.env`

Create `./.env`:

```env
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/lyra
DATABASE_POOL_MAX=10
DATABASE_SSL_MODE=disable
DEV_AUTH_BYPASS=true
DEV_AUTH_BYPASS_EMAIL=dev@local.lyra
SUPABASE_JWT_SECRET=replace-me
LLM_PAGE_PROMPT_COMPILER_ENABLED=false
LLM_ENTITY_REFERENCE_PROMPT_COMPILER_ENABLED=false
LLM_PAGE_GENERATION_PLANNER_ENABLED=false
GENERATION_USER_ACTIVE_JOB_LIMIT=2
GENERATION_GLOBAL_ACTIVE_JOB_LIMIT=10
GENERATION_ENABLED=false
```

`SUPABASE_JWT_SECRET` is still required for non-bypass local flows and dev token generation.
The three `LLM_*_ENABLED` flags default to `false`; keep them disabled for lower-cost generation that uses deterministic prompts, and enable them only when you explicitly want extra LLM prompt rewriting or planning.
`GENERATION_USER_ACTIVE_JOB_LIMIT` and `GENERATION_GLOBAL_ACTIVE_JOB_LIMIT` cap active page/entity generation jobs before queueing provider work.
`SQS_GENERATION_VISIBILITY_TIMEOUT_SECONDS` must match the deployed generation queue visibility timeout; keep it at least `OPENAI_TIMEOUT_MS / 1000 + 120` so long image calls are not retried or deleted while still running.
Set `GENERATION_ENABLED=false` as a kill switch when provider quota, billing, or abuse-control incidents require stopping new generation jobs.

To run image generation locally, enable generation only after configuring a runnable worker path:

```env
GENERATION_ENABLED=true
OPENAI_API_KEY=replace-me
LOCAL_FILE_STORAGE_DIR=.localdata/assets
LOCAL_ASSET_BASE_URL=http://127.0.0.1:3000/local-assets
```

Without either local asset storage or `SQS_QUEUE_URL_GENERATION`, generation requests fail immediately instead of creating jobs that stay queued forever.

### Production database

AWS production must provide an explicit non-local PostgreSQL URL:

```env
DATABASE_URL=postgres://lyra:replace-me@lyra-db.example.ap-northeast-1.rds.amazonaws.com:5432/lyra
DATABASE_POOL_MAX=10
DATABASE_SSL_MODE=require
```

`NODE_ENV=production` rejects missing database URLs and local hosts such as `localhost`,
`127.0.0.1`, and `::1`. Production database connections require
`DATABASE_SSL_MODE=require`; `DATABASE_POOL_MAX` is capped at 10 per API/worker
process to avoid exhausting RDS connections during scale-out.

Production public URLs such as `IMAGES_CDN_BASE_URL`, Stripe return URLs, and
`CORS_ALLOWED_ORIGINS` must use HTTPS and non-local hosts. Localhost and plain HTTP
settings are rejected during API startup.
External service URLs such as `OPENAI_BASE_URL`, `SQS_QUEUE_URL_GENERATION`,
`COGNITO_ISSUER`, and `COGNITO_JWKS_URI` are checked the same way.
Required production settings also reject obvious placeholder values such as
`replace-me`, `replace_me`, `placeholder`, and `changeme`.
Paid production also requires a Stripe live secret key (`sk_live_...`) and a
webhook signing secret (`whsec_...`); test keys are rejected at API startup.
Stripe price settings must be actual `price_...` IDs, not product IDs or plan labels.

### Production auth

Local defaults use Supabase-compatible HS256 dev tokens. AWS production requires Cognito:

```env
AUTH_PROVIDER=cognito
AWS_REGION=ap-northeast-1
COGNITO_USER_POOL_ID=ap-northeast-1_replace_me
COGNITO_CLIENT_ID=replace-me
COGNITO_TOKEN_USE=id
```

When `AUTH_PROVIDER=cognito`, the API verifies the Cognito JWKS signature, issuer, `token_use`, expiration, and configured groups before provisioning the user. With the recommended `COGNITO_TOKEN_USE=id`, the API also verifies the ID token audience against `COGNITO_CLIENT_ID` and reads the user email from the ID token. If you intentionally use `COGNITO_TOKEN_USE=access`, set `COGNITO_REQUIRED_SCOPES=lyra/api`; access-token mode verifies `client_id` and required scopes, but your token must provide an email claim or provisioning will fail.

The web app can use Cognito Hosted UI with Authorization Code + PKCE. Configure the frontend with:

```env
VITE_COGNITO_DOMAIN=https://your-domain.auth.ap-northeast-1.amazoncognito.com
VITE_COGNITO_CLIENT_ID=replace-me
VITE_COGNITO_REDIRECT_URI=https://app.example.com
VITE_COGNITO_LOGOUT_URI=https://app.example.com
VITE_COGNITO_SCOPES=openid email profile
VITE_COGNITO_API_TOKEN_USE=id
```

In the production browser runtime, Hosted UI configuration is required and manual bearer token authentication is
disabled. When Cognito is configured, `VITE_COGNITO_SCOPES` is required. Keep
`VITE_COGNITO_API_TOKEN_USE` in sync with backend `COGNITO_TOKEN_USE`; the default and recommended
setting is `id`. If you switch both sides to `access`, include the API scope in
`VITE_COGNITO_SCOPES` and set `COGNITO_REQUIRED_SCOPES` on the backend.
For paid production, configure Cognito Hosted UI in the web build. Supabase hosted auth settings are
rejected in production because the API production guard requires Cognito tokens.

`VITE_DEV_AUTH_BYPASS=true` is for local development only. Production web builds force file-based
dev bypass off, and explicit production bypass is rejected.

`bun run web:build` is a compile check and can run on a developer machine that still has local auth
settings in `apps/web/.env`. Deployment jobs should use the stricter release gate with production
Cognito environment variables:

```powershell
bun run web:build:deploy
```

That command sets `LYRA_STRICT_WEB_PRODUCTION_CONFIG=true` and fails the build if Cognito Hosted UI
is missing or Supabase hosted auth settings are present.

### Production billing

Production startup requires the full Stripe billing configuration so a paid
deployment cannot silently run without checkout or webhook handling:

```env
STRIPE_SECRET_KEY=replace_with_stripe_secret_key
STRIPE_WEBHOOK_SECRET=replace_with_stripe_webhook_secret
STRIPE_PRICE_STANDARD_MONTHLY=price_replace_me
STRIPE_PRICE_PREMIUM_MONTHLY=price_replace_me
STRIPE_PRICE_CREDITS_200=price_replace_me
STRIPE_PRICE_CREDITS_1000=price_replace_me
STRIPE_PRICE_CREDITS_3000=price_replace_me
STRIPE_CHECKOUT_SUCCESS_URL=https://app.example.com/billing/success
STRIPE_CHECKOUT_CANCEL_URL=https://app.example.com/billing/cancel
STRIPE_PORTAL_RETURN_URL=https://app.example.com/billing
```

If any of these are missing in `NODE_ENV=production`, the API fails fast before
accepting traffic.

### 4. Minimal frontend `apps/web/.env`

```env
VITE_DEV_AUTH_BYPASS=true
VITE_DEV_AUTH_BYPASS_EMAIL=dev@local.lyra
VITE_API_PROXY_TARGET=http://localhost:3000
```

### 5. Start API and frontend

```powershell
bun run dev
bun run web:dev
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
Deployment jobs that publish the web app should additionally run `bun run web:build:deploy` with the
production Cognito environment present.

### Admin credit refund

Manual support refunds should go through the credit service so `credit_balances` and
`credit_ledger` stay consistent.

```powershell
bun run admin:refund-credits -- --user-id <uuid> --amount 3 --reason "support refund"
```

- Default mode is dry-run and changes nothing.
- Add `--apply` only after confirming the printed target user and amount.
- Optional `--job-id <uuid>` links the refund to a generation job.

### Image storage pruning

Temporary and unconfirmed generated images should be pruned from S3 regularly:

```powershell
bun run admin:prune-images -- --older-than-hours 24 --protect-recent-candidate-hours 48 --max-scanned 5000
```

- Default mode is dry-run and lists delete candidates only.
- Add `--apply` to delete candidates.
- The script accepts `tmp/` and `session/` prefixes by default.
- `--max-scanned` caps S3 object listing work separately from `--max-deletes`; increase it only
  when the dry-run result reports `scanTruncated: true` and you intentionally want to scan more.
- To prune unreferenced durable assets, pass both `--prefix saved/` and
  `--include-saved-unreferenced`. Keep the first run as dry-run and review the candidates before
  adding `--apply`.
- Current page images, confirmed entity references, recent entity preview candidates, and recent
  uploaded source images are protected from deletion.

For AWS cost control, pair this with S3 lifecycle rules:

- `tmp/`: expire after 1 day.
- `session/`: transition to cheaper storage after a short window, then expire after the support
  window you decide to keep.
- `saved/`: keep durable, encrypted, and private behind CloudFront; use lifecycle transitions only
  after confirming product requirements.

### Generation job retention

Generation jobs keep prompt metadata and provider results for support debugging. Completed and
failed jobs receive an `expires_at` timestamp when they are created and should be pruned regularly:

```powershell
bun run admin:prune-jobs -- --max-deletes 500
```

- Default mode is dry-run and lists expired terminal jobs only.
- Add `--apply` to delete candidates.
- The script deletes only `completed` and `failed` jobs whose `expires_at` is in the past.
- `queued` and `processing` jobs are intentionally not deleted here; stale active jobs are handled by
  the generation recovery flow.
