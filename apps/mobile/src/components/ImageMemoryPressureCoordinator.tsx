import { useEffect } from 'react';
import { AppState } from 'react-native';

import { clearAuthenticatedImageMemoryCache } from '@/lib/authenticatedImageCache';

export function ImageMemoryPressureCoordinator(): null {
  useEffect(() => {
    const subscription = AppState.addEventListener('memoryWarning', () => {
      void clearAuthenticatedImageMemoryCache();
    });
    return () => subscription.remove();
  }, []);

  return null;
}
