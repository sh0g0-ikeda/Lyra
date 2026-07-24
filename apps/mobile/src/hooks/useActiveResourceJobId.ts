import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';

import type { GenerationJobType } from '@/domain/types';
import type { LyraMobileApiClient } from '@/lib/api';
import { activeResourceJobQueryKey } from '@/lib/queryKeys';

type JobResourceParam = 'entity_id' | 'episode_id' | 'page_id';

interface UseActiveResourceJobIdInput {
  api: LyraMobileApiClient;
  jobTypes: readonly GenerationJobType[];
  organizationId: string | null;
  resourceId: string | null;
  resourceParam: JobResourceParam;
  sessionKey: string;
}

const ACTIVE_JOB_STATUSES = ['queued', 'processing'] as const;

export function useActiveResourceJobId({
  api,
  jobTypes,
  organizationId,
  resourceId,
  resourceParam,
  sessionKey,
}: UseActiveResourceJobIdInput): string | null {
  const jobTypeKey = jobTypes.join(',');
  const enabled = resourceId !== null;
  const activeJobQuery = useQuery({
    enabled,
    queryKey: activeResourceJobQueryKey(
      sessionKey,
      organizationId,
      resourceParam,
      resourceId,
      jobTypeKey,
    ),
    queryFn: async (): Promise<string | null> => {
      if (resourceId === null) {
        return null;
      }
      const response = await api.listJobs({
        jobTypes,
        limit: 100,
        organizationId,
        statuses: ACTIVE_JOB_STATUSES,
      });
      return (
        response.jobs.find(
          (job) => job.params[resourceParam] === resourceId,
        )?.id ?? null
      );
    },
    staleTime: 0,
  });
  const refetch = activeJobQuery.refetch;

  useFocusEffect(
    useCallback(() => {
      if (enabled) {
        void refetch();
      }
    }, [enabled, refetch]),
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refetch();
      }
    });
    return () => subscription.remove();
  }, [enabled, refetch]);

  return activeJobQuery.data ?? null;
}
