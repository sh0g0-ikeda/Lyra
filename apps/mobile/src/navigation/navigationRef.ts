import { createNavigationContainerRef } from '@react-navigation/native';

import type { PushNavigationData } from '@/domain/pushNotificationPolicy';
import { creationRouteParams } from '@/navigation/creationRoute';
import type { MobileTabParamList } from '@/navigation/tabs';

export const navigationRef =
  createNavigationContainerRef<MobileTabParamList>();

// Keep the server's existing push payload contract while Pages now lives within
// manga creation. Other existing account/asset destinations retain their routes.
export function navigateToLegacyTarget(target: PushNavigationData['target_tab']): boolean {
  if (!navigationRef.isReady()) return false;
  if (target === 'Pages' || target === 'Story') {
    navigationRef.navigate('Story', creationRouteParams(target === 'Pages' ? 'pages' : 'story'));
  } else {
    navigationRef.navigate(target);
  }
  return true;
}
