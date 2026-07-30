export type PushNotificationTerminalStatus = 'completed' | 'failed';

export interface PushNotificationOutboxEnqueueResult {
  outboxId: string;
  terminalStatus: PushNotificationTerminalStatus;
  created: boolean;
  deliveryCount: number;
}
