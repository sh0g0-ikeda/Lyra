# Lyra Web Console

`apps/web` is the in-repo frontend for Lyra.

## Environment

Copy `.env.example` to `.env` when you need local overrides.

Available variables:

- `VITE_API_PROXY_TARGET`
- `VITE_API_BASE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Local development

Run the backend API on `http://localhost:3000`.

Then start the web app:

```bash
npm run web:dev
```

Open `http://localhost:5173`.

You can authenticate with:

1. Supabase magic link, if `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set
2. Manual bearer token pasted into the login screen

## Verification

```bash
npm run web:build
npm run web:lint
npm run web:e2e
```

`web:e2e` runs Playwright smoke tests with mocked API responses.
