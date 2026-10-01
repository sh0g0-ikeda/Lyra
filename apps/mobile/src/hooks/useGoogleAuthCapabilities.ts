import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { GoogleAuthCapabilities } from '@/domain/googleAuth';
import { isAuthConfigured } from '@/lib/config';
import { useAppState } from '@/state/appState';

export function useGoogleAuthCapabilities(): UseQueryResult<GoogleAuthCapabilities, Error> {
  const { api } = useAppState();
  return useQuery({
    queryKey: ['auth-capabilities'],
    enabled: isAuthConfigured(),
    queryFn: () => api.getGoogleAuthCapabilities(),
    retry: false,
    staleTime: 60_000
  });
}
