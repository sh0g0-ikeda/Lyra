import type { CurrentSessionRecord } from '@/domain/types';

/** Existing production notifications are available only when the current server
 * actually mounts registration. Unknown/off capabilities never prompt permission. */
export function canRegisterPushNotifications(session: CurrentSessionRecord | undefined): boolean {
  return session?.capabilities?.push_notifications === true;
}
