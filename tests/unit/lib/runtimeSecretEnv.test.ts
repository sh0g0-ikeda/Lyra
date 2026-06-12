import { GetSecretValueCommand, type GetSecretValueCommandOutput } from '@aws-sdk/client-secrets-manager';
import { describe, expect, it } from 'vitest';
import { loadRuntimeSecretEnv, type RuntimeSecretClient } from '../../../src/lib/runtimeSecretEnv.js';

function createSecretClient(secret: unknown, sentCommands: GetSecretValueCommand[] = []): RuntimeSecretClient {
  return {
    async send(command: GetSecretValueCommand): Promise<GetSecretValueCommandOutput> {
      sentCommands.push(command);
      return { SecretString: JSON.stringify(secret) } as GetSecretValueCommandOutput;
    },
  };
}

describe('loadRuntimeSecretEnv', () => {
  it('secret id がない場合は何もしない', async () => {
    const targetEnv: NodeJS.ProcessEnv = {};
    await loadRuntimeSecretEnv({ targetEnv });
    expect(targetEnv).toEqual({});
  });

  it('Secrets Manager の JSON を環境変数として展開する', async () => {
    const targetEnv: NodeJS.ProcessEnv = {
      LYRA_APP_SECRET_ID: 'lyra/prod/app',
      AWS_REGION: 'ap-northeast-1',
    };
    const sentCommands: GetSecretValueCommand[] = [];

    await loadRuntimeSecretEnv({
      targetEnv,
      client: createSecretClient(
        {
          APP_ENV: 'production',
          DATABASE_POOL_MAX: 5,
          GENERATION_ENABLED: true,
          UNUSED_NULL: null,
        },
        sentCommands,
      ),
    });

    expect(sentCommands).toHaveLength(1);
    expect(targetEnv.APP_ENV).toBe('production');
    expect(targetEnv.DATABASE_POOL_MAX).toBe('5');
    expect(targetEnv.GENERATION_ENABLED).toBe('true');
    expect(targetEnv.UNUSED_NULL).toBeUndefined();
  });

  it('既存の環境変数はデフォルトで上書きしない', async () => {
    const targetEnv: NodeJS.ProcessEnv = {
      LYRA_APP_SECRET_ID: 'lyra/prod/app',
      APP_ENV: 'development',
    };

    await loadRuntimeSecretEnv({
      targetEnv,
      client: createSecretClient({ APP_ENV: 'production' }),
    });

    expect(targetEnv.APP_ENV).toBe('development');
  });

  it('overwrite 指定時は既存の環境変数を上書きする', async () => {
    const targetEnv: NodeJS.ProcessEnv = {
      LYRA_APP_SECRET_ID: 'lyra/prod/app',
      APP_ENV: 'development',
    };

    await loadRuntimeSecretEnv({
      targetEnv,
      overwrite: true,
      client: createSecretClient({ APP_ENV: 'production' }),
    });

    expect(targetEnv.APP_ENV).toBe('production');
  });

  it('JSON object 以外の secret は拒否する', async () => {
    await expect(
      loadRuntimeSecretEnv({
        targetEnv: { LYRA_APP_SECRET_ID: 'lyra/prod/app' },
        client: createSecretClient(['APP_ENV', 'production']),
      }),
    ).rejects.toThrow('Runtime secret must be a JSON object');
  });

  it('object や array の値は環境変数として拒否する', async () => {
    await expect(
      loadRuntimeSecretEnv({
        targetEnv: { LYRA_APP_SECRET_ID: 'lyra/prod/app' },
        client: createSecretClient({ APP_ENV: { nested: true } }),
      }),
    ).rejects.toThrow('Runtime secret value for APP_ENV must be a string, number, boolean, or null');
  });
});
