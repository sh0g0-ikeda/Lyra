import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Separate fixture client avoids changing ordinary authenticated-console smoke.
export default defineConfig({
  ...base,
  testMatch: 'x-login.spec.ts',
  testIgnore: [],
  use: { ...base.use, baseURL: 'http://127.0.0.1:4187' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4187',
    port: 4187,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VITE_DEV_AUTH_BYPASS: 'false',
      VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '',
      VITE_COGNITO_DOMAIN: 'https://lyra-x-fixture.auth.ap-northeast-1.amazoncognito.com',
      VITE_COGNITO_CLIENT_ID: 'xfixtureclient1234567890',
      VITE_COGNITO_REDIRECT_URI: 'http://127.0.0.1:4187/auth/callback',
      VITE_COGNITO_LOGOUT_URI: 'http://127.0.0.1:4187/',
    },
  },
});
