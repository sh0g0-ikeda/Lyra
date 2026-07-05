import type { EmailDeliveryPort, SendEmailInput, SendEmailResult } from './EmailDeliveryPort.js';

export class DisabledEmailDeliveryService implements EmailDeliveryPort {
  public async send(_input: SendEmailInput): Promise<SendEmailResult> {
    return {
      provider: 'disabled',
      messageId: null,
    };
  }
}
