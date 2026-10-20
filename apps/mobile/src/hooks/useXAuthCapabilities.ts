import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { isAuthConfigured } from '@/lib/config';
import { fetchXAuthCapabilities, type XAuthCapabilities } from '@/lib/xAuth';

export function useXAuthCapabilities(): UseQueryResult<XAuthCapabilities, Error> {
  return useQuery({
    queryKey: ['x-auth-capabilities'],
    enabled: isAuthConfigured(),
    queryFn: () => fetchXAuthCapabilities(),
    retry: false,
    staleTime: 60_000
  });
}
