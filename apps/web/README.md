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
- `VITE_COGNITO_API_TOKEN_USE`

If `VITE_API_BASE_URL` points to a different origin than the web app, set the
backend `CORS_ALLOWED_ORIGINS` to the web origin. Production must use explicit
origins; wildcard CORS is rejected by the API runtime guard.

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

For paid production, use Cognito Hosted UI and run `bun run web:build:deploy` for the release
build. That command sets `LYRA_STRICT_WEB_PRODUCTION_CONFIG=true`, so the build fails if Hosted UI
is missing, Supabase hosted auth is configured, dev auth bypass is enabled, or public URLs are
unsafe. If Cognito is configured, `VITE_COGNITO_SCOPES` must be explicit. For the current
ID-token based API flow, use the minimal `openid email` scopes. The recommended
API token mode is `VITE_COGNITO_API_TOKEN_USE=id`, matching backend `COGNITO_TOKEN_USE=id`, because
the API can verify the ID token audience and read the user email without an extra userinfo call. If
you switch both sides to `access`, include the API scope in `VITE_COGNITO_SCOPES` and set
`COGNITO_REQUIRED_SCOPES` on the backend. `VITE_DEV_AUTH_BYPASS=true` is local-only and is not
allowed in production builds.

Do not configure Cognito and Supabase Hosted Auth together in a paid production build. The build
guard rejects that combination because it can show a login option whose token the API will not
accept.

## Verification

```bash
bun run web:build
bun run web:build:deploy
bun run web:lint
bun run web:e2e
```

`web:e2e` runs Playwright smoke tests with mocked API responses.
