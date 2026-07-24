import { createNavigationContainerRef } from '@react-navigation/native';

import type { MobileTabParamList } from '@/navigation/tabs';

export const navigationRef =
  createNavigationContainerRef<MobileTabParamList>();
