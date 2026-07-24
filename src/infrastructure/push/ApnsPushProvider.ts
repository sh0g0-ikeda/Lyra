import { connect, constants, type ClientHttp2Stream } from 'node:http2';
import { importPKCS8, SignJWT } from 'jose';

import type { PushNavigationPayload } from '../../domain/pushNotification.js';
import {
  PushProviderError,
  type NativePushMessage,
  type NativePushProviderPort,
  type NativePushSendResult,
} from '../../services/notification/NativePushProvider.js';

const APNS_PRODUCTION_AUTHORITY = 'https://api.push.apple.com';
const APNS_SANDBOX_AUTHORITY = 'https://api.sandbox.push.apple.com';
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;
const APNS_PROVIDER_TOKEN_TTL_SECONDS = 50 * 60;

export interface ApnsPushProviderConfig {
  bundleId: string;
  environment: 'sandbox' | 'production';
  timeoutMs: number;
}

export interface ApnsTransportRequest {
  authority: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface ApnsTransportResponse {
  statusCode: number;
  body: string;
}

export interface ApnsTransportPort {
  send(request: ApnsTransportRequest): Promise<ApnsTransportResponse>;
}

export interface ApnsProviderTokenPort {
  getToken(): Promise<string>;
}

export class ApnsPushProvider implements NativePushProviderPort {
  public constructor(
    private readonly config: ApnsPushProviderConfig,
    private readonly transport: ApnsTransportPort,
    private readonly tokenProvider: ApnsProviderTokenPort,
  ) {}

  public async send(message: NativePushMessage): Promise<NativePushSendResult> {
    if (message.platform !== 'ios') {
      throw new PushProviderError('apns_platform_mismatch', false);
    }
    if (!/^[a-f0-9]{32,256}$/iu.test(message.deviceToken)) {
      return { outcome: 'invalid_token' };
    }

    const authorizationToken = await this.tokenProvider.getToken();
    const response = await this.transport.send({
      authority:
        this.config.environment === 'production'
          ? APNS_PRODUCTION_AUTHORITY
          : APNS_SANDBOX_AUTHORITY,
      path: `/3/device/${message.deviceToken}`,
      headers: {
        authorization: `bearer ${authorizationToken}`,
        'apns-topic': this.config.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
      },
      body: JSON.stringify({
        aps: {
          alert: {
            title: message.title,
            body: message.body,
          },
          sound: 'default',
        },
        ...toProviderData(message.data),
      }),
      timeoutMs: this.config.timeoutMs,
    });

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return { outcome: 'sent' };
    }

    const reason = readProviderReason(response.body);
    if (
      response.statusCode === 410 ||
      reason === 'BadDeviceToken' ||
      reason === 'DeviceTokenNotForTopic' ||
      reason === 'Unregistered'
    ) {
      return { outcome: 'invalid_token' };
    }
    if (response.statusCode === 429) {
      throw new PushProviderError('apns_rate_limited', true);
    }
    if (response.statusCode >= 500) {
      throw new PushProviderError('apns_unavailable', true);
    }
    throw new PushProviderError('apns_rejected', false);
  }
}

export class JoseApnsProviderToken implements ApnsProviderTokenPort {
  private readonly key: ReturnType<typeof importPKCS8>;
  private cached: { token: string; issuedAtSeconds: number } | null = null;

  public constructor(
    private readonly teamId: string,
    private readonly keyId: string,
    privateKeyPem: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.key = importPKCS8(privateKeyPem, 'ES256');
  }

  public async getToken(): Promise<string> {
    const issuedAtSeconds = Math.floor(this.now().getTime() / 1000);
    if (
      this.cached !== null &&
      issuedAtSeconds - this.cached.issuedAtSeconds < APNS_PROVIDER_TOKEN_TTL_SECONDS
    ) {
      return this.cached.token;
    }
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: this.keyId })
      .setIssuer(this.teamId)
      .setIssuedAt(issuedAtSeconds)
      .sign(await this.key);
    this.cached = { token, issuedAtSeconds };
    return token;
  }
}

export class NodeHttp2ApnsTransport implements ApnsTransportPort {
  public async send(request: ApnsTransportRequest): Promise<ApnsTransportResponse> {
    return new Promise((resolve, reject) => {
      const session = connect(request.authority);
      let settled = false;
      let statusCode = 0;
      let responseBytes = 0;
      const chunks: Buffer[] = [];

      const finish = (
        callback: () => void,
      ): void => {
        if (settled) {
          return;
        }
        settled = true;
        session.close();
        callback();
      };

      session.setTimeout(request.timeoutMs, () => {
        finish(() => reject(new PushProviderError('apns_timeout', true)));
      });
      session.on('error', () => {
        finish(() => reject(new PushProviderError('apns_transport_error', true)));
      });

      let stream: ClientHttp2Stream;
      try {
        stream = session.request({
          [constants.HTTP2_HEADER_METHOD]: 'POST',
          [constants.HTTP2_HEADER_PATH]: request.path,
          [constants.HTTP2_HEADER_CONTENT_TYPE]: 'application/json',
          ...request.headers,
        });
      } catch {
        finish(() => reject(new PushProviderError('apns_transport_error', true)));
        return;
      }

      stream.setEncoding('utf8');
      stream.on('response', (headers) => {
        const rawStatus = headers[constants.HTTP2_HEADER_STATUS];
        statusCode = typeof rawStatus === 'number' ? rawStatus : 0;
      });
      stream.on('data', (chunk: string) => {
        const buffer = Buffer.from(chunk, 'utf8');
        responseBytes += buffer.length;
        if (responseBytes <= MAX_PROVIDER_RESPONSE_BYTES) {
          chunks.push(buffer);
        }
      });
      stream.on('end', () => {
        finish(() => resolve({
          statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });
      stream.on('error', () => {
        finish(() => reject(new PushProviderError('apns_transport_error', true)));
      });
      stream.setTimeout(request.timeoutMs, () => {
        stream.close();
        finish(() => reject(new PushProviderError('apns_timeout', true)));
      });
      stream.end(request.body);
    });
  }
}

function toProviderData(
  data: PushNavigationPayload,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

function readProviderReason(body: string): string | null {
  if (body.length === 0 || body.length > MAX_PROVIDER_RESPONSE_BYTES) {
    return null;
  }
  try {
    const parsed = JSON.parse(body) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'reason' in parsed &&
      typeof parsed.reason === 'string'
    ) {
      return parsed.reason;
    }
  } catch {
    return null;
  }
  return null;
}
