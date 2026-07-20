import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  workers: 2,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
  },
  webServer: {
    command: 'bun run dev -- --host 127.0.0.1 --port 4173',
    env: {
      VITE_DEV_AUTH_BYPASS: 'false',
      VITE_SUPABASE_ANON_KEY: '',
      VITE_SUPABASE_URL: '',
    },
    port: 4173,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
