import { QueryClient } from '@tanstack/react-query';
import {
  mobileQueryRetryDelay,
  shouldRetryMobileQuery,
} from './queryPolicy';

export function createMobileQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetryMobileQuery,
        retryDelay: mobileQueryRetryDelay,
        staleTime: 30_000,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
