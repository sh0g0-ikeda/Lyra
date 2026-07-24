import {
  parsePushNavigationData,
  pushNavigationSelection,
  type PushNavigationData
} from '@/domain/pushNotificationPolicy';

export interface PushNavigationDependencies {
  getJob(
    jobId: string,
    organizationId: string | null
  ): Promise<{ id: string }>;
  updateSelection(
    selection: ReturnType<typeof pushNavigationSelection>
  ): Promise<boolean>;
  navigate(target: PushNavigationData['target_tab']): boolean;
}

export async function handlePushNavigation(
  rawData: unknown,
  dependencies: PushNavigationDependencies
): Promise<boolean> {
  const data = parsePushNavigationData(rawData);
  if (data === null) {
    return false;
  }
  try {
    const job = await dependencies.getJob(
      data.job_id,
      data.organization_id ?? null
    );
    if (job.id !== data.job_id) {
      return false;
    }
    const selectionChanged = await dependencies.updateSelection(
      pushNavigationSelection(data)
    );
    if (!selectionChanged) {
      return false;
    }
    return dependencies.navigate(data.target_tab);
  } catch {
    return false;
  }
}
