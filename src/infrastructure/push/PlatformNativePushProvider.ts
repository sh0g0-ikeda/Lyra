import type {
  NativePushMessage,
  NativePushProviderPort,
  NativePushSendResult,
} from '../../services/notification/NativePushProvider.js';

export class PlatformNativePushProvider implements NativePushProviderPort {
  public constructor(
    private readonly apns: NativePushProviderPort,
    private readonly fcm: NativePushProviderPort,
  ) {}

  public async send(message: NativePushMessage): Promise<NativePushSendResult> {
    return message.platform === 'ios'
      ? this.apns.send(message)
      : this.fcm.send(message);
  }
}
