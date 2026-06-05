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
```

`SUPABASE_JWT_SECRET` is still required for non-bypass local flows and dev token generation.
The three `LLM_*_ENABLED` flags default to `false`; keep them disabled for lower-cost generation that uses deterministic prompts, and enable them only when you explicitly want extra LLM prompt rewriting or planning.

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
