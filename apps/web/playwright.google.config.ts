import { defineConfig } from '@playwright/test';
// Local mocked auth verification only. These identifiers are fixtures, never an IdP configuration.
export default defineConfig({
 testDir:'./e2e-google',testMatch:'googleAuth.spec.ts',workers:1,timeout:30_000,
 use:{baseURL:'http://127.0.0.1:4174',headless:true,launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}},
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4174',port:4174,reuseExistingServer:false,
 env:{VITE_DEV_AUTH_BYPASS:'false',VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_API_BASE_URL:'',VITE_COGNITO_DOMAIN:'https://cognito.fixture.invalid',VITE_COGNITO_CLIENT_ID:'fixture-client',VITE_COGNITO_REDIRECT_URI:'http://127.0.0.1:4174/',VITE_COGNITO_API_TOKEN_USE:'id'}},
});
