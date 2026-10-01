import { JWT } from 'google-auth-library';

import type { PushNavigationPayload } from '../../domain/pushNotification.js';
import {
  PushProviderError,
  type NativePushMessage,
  type NativePushProviderPort,
  type NativePushSendResult,
} from '../../services/notification/NativePushProvider.js';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;

export interface FcmPushProviderConfig {
  projectId: string;
  timeoutMs: number;
}

export interface FcmHttpRequest {
  url: string;
  authorization: string;
  body: string;
  timeoutMs: number;
}

export interface FcmHttpResponse {
  statusCode: number;
  body: string;
}

export interface FcmHttpPort {
  post(request: FcmHttpRequest): Promise<FcmHttpResponse>;
}

export interface FcmAccessTokenPort {
  getAccessToken(): Promise<string>;
}

export class FcmPushProvider implements NativePushProviderPort {
  public constructor(
    private readonly config: FcmPushProviderConfig,
    private readonly http: FcmHttpPort,
    private readonly accessTokenProvider: FcmAccessTokenPort,
  ) {}

  public async send(message: NativePushMessage): Promise<NativePushSendResult> {
    if (message.platform !== 'android') {
      throw new PushProviderError('fcm_platform_mismatch', false);
    }
    if (
      message.deviceToken.trim().length < 16 ||
      message.deviceToken.length > 4096 ||
      /\s/u.test(message.deviceToken)
    ) {
      return { outcome: 'invalid_token' };
    }
    const accessToken = await getFcmAccessToken(
      this.accessTokenProvider,
      this.config.timeoutMs,
    );
    const response = await this.http.post({
      url: `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/messages:send`,
      authorization: `Bearer ${accessToken}`,
      body: JSON.stringify({
        message: {
          token: message.deviceToken,
          notification: {
            title: message.title,
            body: message.body,
          },
          data: toProviderData(message.data),
          android: {
            priority: 'high',
            notification: {
              channel_id: 'job-status',
            },
          },
        },
      }),
      timeoutMs: this.config.timeoutMs,
    });

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return { outcome: 'sent' };
    }
    if (isUnregisteredResponse(response.statusCode, response.body)) {
      return { outcome: 'invalid_token' };
    }
    if (response.statusCode === 429) {
      throw new PushProviderError('fcm_rate_limited', true);
    }
    if (response.statusCode >= 500) {
      throw new PushProviderError('fcm_unavailable', true);
    }
    throw new PushProviderError('fcm_rejected', false);
  }
}

async function getFcmAccessToken(
  provider: FcmAccessTokenPort,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new PushProviderError('fcm_auth_timeout', true)));
    }, timeoutMs);

    void Promise.resolve()
      .then(() => provider.getAccessToken())
      .then(
        (token) => {
          if (token.trim().length === 0) {
            finish(() => reject(new PushProviderError('fcm_auth_unavailable', true)));
            return;
          }
          finish(() => resolve(token));
        },
        (error: unknown) => {
          finish(() => reject(
            error instanceof PushProviderError
              ? error
              : new PushProviderError('fcm_auth_unavailable', true),
          ));
        },
      );
  });
}

export class GoogleServiceAccountFcmAccessToken implements FcmAccessTokenPort {
  private readonly client: JWT;

  public constructor(clientEmail: string, privateKey: string) {
    this.client = new JWT({
      email: clientEmail,
      key: privateKey,
      scopes: [FCM_SCOPE],
    });
  }

  public async getAccessToken(): Promise<string> {
    const response = await this.client.getAccessToken();
    const token = response.token;
    if (typeof token !== 'string' || token.length === 0) {
      throw new PushProviderError('fcm_auth_unavailable', true);
    }
    return token;
  }
}

export class FetchFcmHttpClient implements FcmHttpPort {
  public async post(request: FcmHttpRequest): Promise<FcmHttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: {
          authorization: request.authorization,
          'content-type': 'application/json',
        },
        body: request.body,
        signal: controller.signal,
      });
      const body = await readBoundedResponseBody(response);
      return { statusCode: response.status, body };
    } catch {
      throw new PushProviderError('fcm_transport_error', true);
    } finally {
      clearTimeout(timeout);
    }
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

function isUnregisteredResponse(statusCode: number, body: string): boolean {
  if (body.length > MAX_PROVIDER_RESPONSE_BYTES) {
    return false;
  }
  return (
    (statusCode === 400 || statusCode === 404) &&
    /"errorCode"\s*:\s*"UNREGISTERED"/u.test(body)
  );
}

async function readBoundedResponseBody(response: Response): Promise<string> {
  const text = await response.text();
  return Buffer.byteLength(text, 'utf8') <= MAX_PROVIDER_RESPONSE_BYTES
    ? text
    : text.slice(0, MAX_PROVIDER_RESPONSE_BYTES);
}
