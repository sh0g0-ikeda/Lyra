import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { assertSafeWebRuntimeConfig } from './src/lib/webRuntimeGuards';

export default defineConfig(({ mode }) => {
  const loadedEnv = loadEnv(mode, process.cwd(), '');
  const fileDevBypass = loadedEnv.VITE_DEV_AUTH_BYPASS;
  const explicitDevBypass = process.env.VITE_DEV_AUTH_BYPASS;
  if (mode === 'production' && explicitDevBypass === undefined && fileDevBypass === 'true') {
    process.env.VITE_DEV_AUTH_BYPASS = 'false';
    loadedEnv.VITE_DEV_AUTH_BYPASS = 'false';
  }
  const env = { ...process.env, ...loadedEnv, MODE: mode, PROD: mode === 'production' } as NodeJS.ProcessEnv & {
    MODE: string;
    PROD: boolean;
    VITE_API_PROXY_TARGET?: string;
  };
  assertSafeWebRuntimeConfig(env);
  const proxyTarget = env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
