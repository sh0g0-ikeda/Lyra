import type { PushPlatform } from '../../domain/pushToken.js';
import type { PushNavigationPayload } from '../../domain/pushNotification.js';

export interface NativePushMessage {
  platform: PushPlatform;
  deviceToken: string;
  title: string;
  body: string;
  data: PushNavigationPayload;
}

export type NativePushSendResult =
  | { outcome: 'sent' }
  | { outcome: 'invalid_token' };

export interface NativePushProviderPort {
  send(message: NativePushMessage): Promise<NativePushSendResult>;
}

export class PushProviderError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;

  public constructor(code: string, retryable: boolean) {
    super(code);
    this.name = 'PushProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}
