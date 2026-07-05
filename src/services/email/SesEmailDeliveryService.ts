import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { EmailDeliveryPort, SendEmailInput, SendEmailResult } from './EmailDeliveryPort.js';

export interface SesEmailDeliveryServiceConfig {
  region: string;
  fromEmail: string;
  configurationSet?: string;
}

export class SesEmailDeliveryService implements EmailDeliveryPort {
  private readonly client: SESv2Client;

  public constructor(private readonly config: SesEmailDeliveryServiceConfig) {
    this.client = new SESv2Client({ region: config.region });
  }

  public async send(input: SendEmailInput): Promise<SendEmailResult> {
    const response = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.config.fromEmail,
        Destination: {
          ToAddresses: [input.to],
        },
        ConfigurationSetName: this.config.configurationSet,
        EmailTags: Object.entries(input.tags ?? {}).map(([Name, Value]) => ({
          Name: sanitizeTagName(Name),
          Value: sanitizeTagValue(Value),
        })),
        Content: {
          Simple: {
            Subject: {
              Data: input.subject,
              Charset: 'UTF-8',
            },
            Body: {
              Text: {
                Data: input.textBody,
                Charset: 'UTF-8',
              },
              Html: {
                Data: input.htmlBody,
                Charset: 'UTF-8',
              },
            },
          },
        },
      }),
    );

    return {
      provider: 'ses',
      messageId: response.MessageId ?? null,
    };
  }
}

function sanitizeTagName(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);
}

function sanitizeTagValue(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_@.+:/=-]/g, '_').slice(0, 256);
}
