import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';

export const ECS_TASK_PROTECTION_EXPIRES_IN_MINUTES = 60;
export const ECS_TASK_PROTECTION_HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;
export const ECS_TASK_PROTECTION_REQUEST_TIMEOUT_MS = 5_000;

export interface EcsTaskProtectionResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

export interface EcsTaskProtectionFetch {
  (url: string, init: {
    method: 'PUT';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }): Promise<EcsTaskProtectionResponse>;
}

export interface EcsTaskProtectionOptions {
  agentUri: string;
  fetch: EcsTaskProtectionFetch;
  expiresInMinutes?: number;
  heartbeatIntervalMs?: number;
  requestTimeoutMs?: number;
  warn?: (message: string) => void;
}

/**
 * Guards a long-running worker operation against ECS scale-in. The agent URI is
 * intentionally supplied only by the worker runtime configuration, never by a
 * queue message or HTTP client.
 */
export class EcsTaskProtection {
  private readonly stateUrl: string;
  private readonly expiresInMinutes: number;
  private readonly heartbeatIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly warn: (message: string) => void;

  public constructor(private readonly options: EcsTaskProtectionOptions) {
    this.stateUrl = toProtectionStateUrl(options.agentUri);
    this.expiresInMinutes = options.expiresInMinutes ?? ECS_TASK_PROTECTION_EXPIRES_IN_MINUTES;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? ECS_TASK_PROTECTION_HEARTBEAT_INTERVAL_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? ECS_TASK_PROTECTION_REQUEST_TIMEOUT_MS;
    this.warn = options.warn ?? console.warn;
    assertPositiveInteger(this.expiresInMinutes, 'ECS task protection expiry');
    assertPositiveInteger(this.heartbeatIntervalMs, 'ECS task protection heartbeat interval');
    assertPositiveInteger(this.requestTimeoutMs, 'ECS task protection request timeout');
  }

  public async protect(): Promise<void> {
    await this.update(true, this.expiresInMinutes);
  }

  public async release(): Promise<void> {
    await this.update(false);
  }

  public async runProtected<T>(
    work: () => Promise<T>,
    onCompleted?: () => Promise<void>,
  ): Promise<T> {
    await this.protect();
    let consecutiveHeartbeatFailures = 0;
    let heartbeatInFlight = false;
    let heartbeatPromise: Promise<void> | null = null;
    const heartbeat = async (): Promise<void> => {
      if (heartbeatInFlight) {
        return;
      }
      heartbeatInFlight = true;
      try {
        await this.protect();
        consecutiveHeartbeatFailures = 0;
      } catch (error) {
        consecutiveHeartbeatFailures += 1;
        const safeMessage = sanitizePersistedErrorMessage(error, 'ECS task protection renewal failed');
        this.warn(
          `[generation-worker] ${safeMessage}; task protection expiry cannot be guaranteed after ${consecutiveHeartbeatFailures} renewal failure(s), retrying while the active job continues`,
        );
      } finally {
        heartbeatInFlight = false;
      }
    };
    const timer = setInterval(() => {
      heartbeatPromise = heartbeat().finally(() => {
        heartbeatPromise = null;
      });
    }, this.heartbeatIntervalMs);
    let primaryError: unknown = null;
    try {
      return await work();
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      clearInterval(timer);
      await heartbeatPromise;
      let completionError: unknown = null;
      try {
        await onCompleted?.();
      } catch (error) {
        completionError = error;
        if (primaryError !== null) this.warn(`[generation-worker] ${sanitizePersistedErrorMessage(error, 'ECS task protection completion callback failed')}`);
      }
      try {
        await this.release();
      } catch (error) {
        const safeMessage = sanitizePersistedErrorMessage(error, 'ECS task protection release failed');
        this.warn(`[generation-worker] ${safeMessage}`);
      }
      if (primaryError === null && completionError !== null) {
        throw completionError;
      }
    }
  }

  private async update(protectionEnabled: boolean, expiresInMinutes?: number): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.options.fetch(this.stateUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ProtectionEnabled: protectionEnabled,
          ...(expiresInMinutes === undefined ? {} : { ExpiresInMinutes: expiresInMinutes }),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`ECS task protection request failed: ${response.status} ${response.statusText}`);
      }
      const payload = await response.json();
      if (!isExpectedProtectionResponse(payload, protectionEnabled)) {
        throw new Error('ECS task protection response did not confirm the requested state');
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('ECS task protection request timed out');
      }
      throw toError(error, 'ECS task protection request failed');
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toProtectionStateUrl(agentUri: string): string {
  const base = new URL(agentUri);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error('ECS agent URI must use HTTP or HTTPS');
  }
  return new URL('/task-protection/v1/state', base).toString();
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function isExpectedProtectionResponse(value: unknown, expected: boolean): boolean {
  return typeof value === 'object'
    && value !== null
    && 'ProtectionEnabled' in value
    && value.ProtectionEnabled === expected;
}
