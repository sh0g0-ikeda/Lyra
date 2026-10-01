import { processGooglePopupReturn } from './lib/googleAuthPopup';
import { getCognitoAuthConfig } from './lib/cognitoAuth';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import App from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { ApiError } from './lib/api';
import { assertSafeWebRuntimeConfig } from './lib/webRuntimeGuards';

assertSafeWebRuntimeConfig(import.meta.env);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status === 429) {
          return failureCount < 4;
        }
        return failureCount < 1;
      },
      retryDelay: (attemptIndex, error) => {
        if (error instanceof ApiError && error.status === 429) {
          return error.retryAfterMs ?? Math.min(8_000 * 2 ** attemptIndex, 30_000);
        }
        return Math.min(1_000 * 2 ** attemptIndex, 8_000);
      },
      refetchOnWindowFocus: false,
    },
  },
});

async function startApp(): Promise<void> {
  if (await processGooglePopupReturn(window,getCognitoAuthConfig(import.meta.env,window.location.origin))) return;
  createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);

}
void startApp().catch(() => {
  // Never route a failed dedicated callback through normal Cognito exchange.
  const root = document.getElementById('root') ?? document.body;
  root.textContent = 'Lyra could not finish checking sign-in. Return to your original tab and check the request, or reload Lyra to try again. / ログイン確認を完了できませんでした。元のタブでリクエストを確認するか、Lyraを再読み込みしてください。';
});
