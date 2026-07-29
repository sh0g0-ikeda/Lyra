import { QueryClient } from '@tanstack/react-query';

import {
  apiRetryDelay,
  shouldRetryApiQuery
} from '@/lib/requestPolicy';

export const createMobileQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetryApiQuery,
        retryDelay: apiRetryDelay,
        staleTime: 15_000
      },
      mutations: {
        networkMode: 'always',
        retry: false
      }
    }
  });
