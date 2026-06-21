import {
  GetSecretValueCommand,
  SecretsManagerClient,
  type GetSecretValueCommandOutput,
} from '@aws-sdk/client-secrets-manager';

export interface RuntimeSecretClient {
  send(command: GetSecretValueCommand): Promise<GetSecretValueCommandOutput>;
}

export interface LoadRuntimeSecretEnvOptions {
  readonly secretId?: string;
  readonly region?: string;
  readonly client?: RuntimeSecretClient;
  readonly targetEnv?: NodeJS.ProcessEnv;
  readonly overwrite?: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toEnvValue(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function parseSecretString(secretString: string): Record<string, string | null> {
  const parsed = JSON.parse(secretString) as unknown;
  if (!isPlainRecord(parsed)) {
    throw new Error('Runtime secret must be a JSON object');
  }

  const values: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null) {
      values[key] = null;
      continue;
    }

    const envValue = toEnvValue(value);
    if (envValue === undefined) {
      throw new Error(`Runtime secret value for ${key} must be a string, number, boolean, or null`);
    }
    values[key] = envValue;
  }
  return values;
}

// Loads one JSON Secrets Manager payload before env.ts is imported by production entrypoints.
export async function loadRuntimeSecretEnv(options: LoadRuntimeSecretEnvOptions = {}): Promise<void> {
  const targetEnv = options.targetEnv ?? process.env;
  const secretId = options.secretId ?? targetEnv.LYRA_APP_SECRET_ID;
  if (secretId === undefined || secretId.trim() === '') {
    return;
  }

  const client =
    options.client ??
    new SecretsManagerClient({
      region: options.region ?? targetEnv.AWS_REGION,
    });
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

  if (response.SecretString === undefined || response.SecretString.trim() === '') {
    throw new Error('Runtime secret does not contain SecretString JSON');
  }

  const secretValues = parseSecretString(response.SecretString);
  for (const [key, value] of Object.entries(secretValues)) {
    if (value === null) {
      continue;
    }
    if (!options.overwrite && targetEnv[key] !== undefined) {
      continue;
    }
    targetEnv[key] = value;
  }
}
