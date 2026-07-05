export interface SendEmailInput {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  tags?: Record<string, string>;
}

export interface SendEmailResult {
  provider: 'ses' | 'disabled';
  messageId: string | null;
}

export interface EmailDeliveryPort {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
