// Unified Spec §6 / mobile page-design workflow: skeleton completion is the
// only transition that permits story autofill. This stays pure so the App can
// own intent claims, API calls, and singleflight without hidden side effects.
export interface PageDesignIntent {
  scope: string;
  episodeId: string;
  skeletonJobId: string;
}

export type PageDesignSkeletonJob = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
};

export function pageDesignNextAction(
  intent: PageDesignIntent,
  currentScope: string,
  job: PageDesignSkeletonJob | undefined,
  jobUnavailable: boolean,
): 'wait' | 'autofill' | 'stop' {
  if (intent.scope !== currentScope || jobUnavailable) return 'stop';
  if (job === undefined || job.id !== intent.skeletonJobId) return 'wait';
  if (job.status === 'completed') return 'autofill';
  if (job.status === 'failed' || job.status === 'cancelled') return 'stop';
  return 'wait';
}
