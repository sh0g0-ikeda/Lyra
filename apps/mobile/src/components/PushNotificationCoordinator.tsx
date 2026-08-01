import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';

import { navigationRef } from '@/navigation/navigationRef';
import { handlePushNavigation } from '@/lib/pushNavigation';
import { registerPushNotifications } from '@/lib/pushNotifications';
import { useAppState } from '@/state/appState';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

export function PushNotificationCoordinator(): null {
  const { api, language, updateSelection } = useAppState();
  const processedResponseIds = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    let removeTokenListener: (() => void) | null = null;

    void registerPushNotifications(api, language)
      .then((registration) => {
        if (!active) {
          registration?.removeTokenListener();
          return;
        }
        removeTokenListener = registration?.removeTokenListener ?? null;
      })
      .catch(() => undefined);

    const processResponse = async (
      response: Notifications.NotificationResponse
    ): Promise<void> => {
      const responseId = response.notification.request.identifier;
      if (processedResponseIds.current.has(responseId)) {
        return;
      }
      const navigated = await handlePushNavigation(
        response.notification.request.content.data,
        {
          getJob: (jobId, organizationId) =>
            api.getJob(jobId, organizationId),
          updateSelection,
          navigate: (target) => {
            if (!navigationRef.isReady()) {
              return false;
            }
            navigationRef.navigate(target);
            return true;
          }
        }
      );
      if (navigated) {
        processedResponseIds.current.add(responseId);
        await Notifications.clearLastNotificationResponseAsync();
      }
    };

    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        void processResponse(response);
      });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (active && response !== null) {
        void processResponse(response);
      }
    });

    return () => {
      active = false;
      removeTokenListener?.();
      responseSubscription.remove();
    };
  }, [api, language, updateSelection]);

  return null;
}
