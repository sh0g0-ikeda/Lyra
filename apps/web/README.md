# Lyra Web Console

`apps/web` is the in-repo frontend for Lyra.

## Environment

Copy `.env.example` to `.env` when you need local overrides.

Available variables:

- `VITE_API_PROXY_TARGET`
- `VITE_API_BASE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_COGNITO_DOMAIN`
- `VITE_COGNITO_CLIENT_ID`
- `VITE_COGNITO_REDIRECT_URI`
- `VITE_COGNITO_LOGOUT_URI`
- `VITE_COGNITO_SCOPES`
- `VITE_REQUIRE_HOSTED_AUTH`

## Local development

Run the backend API on `http://localhost:3000`.

Then start the web app:

```bash
bun run web:dev
```

Open `http://localhost:5173`.

You can authenticate with:

1. Cognito Hosted UI, if `VITE_COGNITO_DOMAIN` and `VITE_COGNITO_CLIENT_ID` are set
2. Supabase magic link, if `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set
3. Manual bearer token pasted into the login screen

For paid production, prefer Cognito Hosted UI and set `VITE_REQUIRE_HOSTED_AUTH=true` during the
deploy build. If Cognito is configured, `VITE_COGNITO_SCOPES` must be explicit and include the API
scope required by `COGNITO_REQUIRED_SCOPES` on the backend. `VITE_DEV_AUTH_BYPASS=true` is
local-only and is not allowed in production builds.

## Verification

```bash
bun run web:build
bun run web:lint
bun run web:e2e
```

`web:e2e` runs Playwright smoke tests with mocked API responses.
