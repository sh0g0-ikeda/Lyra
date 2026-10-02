const TASK_PROTECTION_PATH = 'task-protection/v1/state';
const REQUEST_TIMEOUT_MS = 3_000;

type TaskProtectionFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface TaskScaleInProtection {
  protect(expiresInMinutes: number): Promise<void>;
  unprotect(): Promise<void>;
}

export class TaskScaleInProtectionError extends Error {
  public constructor(
    public readonly operation: 'protect' | 'unprotect',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TaskScaleInProtectionError';
  }
}

class DisabledTaskScaleInProtection implements TaskScaleInProtection {
  public async protect(_expiresInMinutes: number): Promise<void> {
    return undefined;
  }

  public async unprotect(): Promise<void> {
    return undefined;
  }
}

export class EcsTaskScaleInProtection implements TaskScaleInProtection {
  private readonly endpoint: string;

  public constructor(
    agentUri: string,
    private readonly fetcher: TaskProtectionFetch = fetch,
  ) {
    this.endpoint = buildTaskProtectionEndpoint(agentUri);
  }

  public async protect(expiresInMinutes: number): Promise<void> {
    if (!Number.isSafeInteger(expiresInMinutes) || expiresInMinutes < 1 || expiresInMinutes > 2_880) {
      throw new TaskScaleInProtectionError(
        'protect',
        'ECS task scale-in protection expiry must be an integer from 1 to 2880 minutes',
      );
    }

    await this.updateProtection(
      true,
      { ProtectionEnabled: true, ExpiresInMinutes: expiresInMinutes },
    );
  }

  public async unprotect(): Promise<void> {
    await this.updateProtection(false, { ProtectionEnabled: false });
  }

  private async updateProtection(
    expectedEnabled: boolean,
    body: { ProtectionEnabled: boolean; ExpiresInMinutes?: number },
  ): Promise<void> {
    const operation = expectedEnabled ? 'protect' : 'unprotect';
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new TaskScaleInProtectionError(
        operation,
        `Failed to ${operation} ECS task scale-in protection`,
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new TaskScaleInProtectionError(
        operation,
        `ECS task scale-in protection ${operation} request failed with status ${response.status}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new TaskScaleInProtectionError(
        operation,
        `ECS task scale-in protection ${operation} response was invalid`,
        { cause: error },
      );
    }
    if (readProtectionEnabled(payload) !== expectedEnabled) {
      throw new TaskScaleInProtectionError(
        operation,
        `ECS task scale-in protection ${operation} response did not confirm the requested state`,
      );
    }
  }
}

export function assertTaskScaleInProtectionEnvironment(
  environment: NodeJS.ProcessEnv,
): void {
  const enabled = environment.ECS_TASK_SCALE_IN_PROTECTION_ENABLED;
  if (enabled !== undefined && enabled !== 'true' && enabled !== 'false') {
    throw new Error('ECS_TASK_SCALE_IN_PROTECTION_ENABLED must be true or false when set');
  }
  if (enabled === 'true' && environment.ECS_AGENT_URI === undefined) {
    throw new Error('ECS_AGENT_URI is required when ECS task scale-in protection is enabled');
  }
}

export function createTaskScaleInProtectionFromEnvironment(
  environment: NodeJS.ProcessEnv,
  fetcher: TaskProtectionFetch = fetch,
): TaskScaleInProtection {
  assertTaskScaleInProtectionEnvironment(environment);
  if (environment.ECS_TASK_SCALE_IN_PROTECTION_ENABLED !== 'true') {
    return new DisabledTaskScaleInProtection();
  }

  return new EcsTaskScaleInProtection(environment.ECS_AGENT_URI as string, fetcher);
}

function buildTaskProtectionEndpoint(agentUri: string): string {
  let base: URL;
  try {
    base = new URL(agentUri.endsWith('/') ? agentUri : `${agentUri}/`);
  } catch (error) {
    throw new Error('ECS_AGENT_URI must be a valid URL', { cause: error });
  }
  if (base.protocol !== 'http:') {
    throw new Error('ECS_AGENT_URI must use http');
  }

  return new URL(TASK_PROTECTION_PATH, base).toString();
}

function readProtectionEnabled(payload: unknown): boolean | undefined {
  if (typeof payload !== 'object' || payload === null || !('protection' in payload)) {
    return undefined;
  }
  const protection = payload.protection;
  if (typeof protection !== 'object' || protection === null || !('ProtectionEnabled' in protection)) {
    return undefined;
  }

  return typeof protection.ProtectionEnabled === 'boolean'
    ? protection.ProtectionEnabled
    : undefined;
}
