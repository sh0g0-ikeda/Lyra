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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
