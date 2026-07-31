import { useEffect } from 'react';
import { focusManager } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';

export function MobileQueryFocusBridge(): null {
  useEffect(() => {
    const updateFocus = (state: AppStateStatus): void => {
      focusManager.setFocused(state === 'active');
    };
    updateFocus(AppState.currentState);
    const subscription = AppState.addEventListener('change', updateFocus);
    return () => subscription.remove();
  }, []);

  return null;
}
