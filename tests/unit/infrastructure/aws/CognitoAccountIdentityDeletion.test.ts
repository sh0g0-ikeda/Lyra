import {
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { describe, expect, it } from 'vitest';
import { CognitoAccountIdentityDeletion } from '../../../../src/infrastructure/aws/CognitoAccountIdentityDeletion.js';

class FakeCognitoClient {
  public readonly commands: unknown[] = [];
  public readonly abortSignals: AbortSignal[] = [];
  public error: unknown = null;

  public async send(
    command: unknown,
    options: { abortSignal: AbortSignal },
  ): Promise<Record<string, never>> {
    this.commands.push(command);
    this.abortSignals.push(options.abortSignal);
    if (this.error !== null) {
      throw this.error;
    }
    return {};
  }
}

class HangingCognitoClient {
  public async send(
    _command: unknown,
    options: { abortSignal: AbortSignal },
  ): Promise<Record<string, never>> {
    return new Promise((_resolve, reject) => {
      options.abortSignal.addEventListener(
        'abort',
        () => reject(new Error('provider aborted')),
        { once: true },
      );
    });
  }
}

describe('CognitoAccountIdentityDeletion', () => {
  it('固定poolの本人subだけをdisableしてdeleteする', async () => {
    const client = new FakeCognitoClient();
    const adapter = new CognitoAccountIdentityDeletion(
      client,
      'ap-northeast-1_pool',
    );

    await adapter.disableIdentity('cognito-sub-1');
    await adapter.deleteIdentity('cognito-sub-1');

    expect(client.commands[0]).toBeInstanceOf(AdminDisableUserCommand);
    expect(client.commands[0]).toMatchObject({
      input: {
        UserPoolId: 'ap-northeast-1_pool',
        Username: 'cognito-sub-1',
      },
    });
    expect(client.commands[1]).toBeInstanceOf(AdminDeleteUserCommand);
    expect(client.abortSignals).toHaveLength(2);
  });

  it('既に存在しないidentityは冪等成功にする', async () => {
    const client = new FakeCognitoClient();
    client.error = { name: 'UserNotFoundException' };
    const adapter = new CognitoAccountIdentityDeletion(client, 'pool-1');

    await expect(adapter.disableIdentity('cognito-sub-1')).resolves.toBeUndefined();
    await expect(adapter.deleteIdentity('cognito-sub-1')).resolves.toBeUndefined();
  });

  it('Cognitoが応答しない場合はbounded timeoutで中断する', async () => {
    const adapter = new CognitoAccountIdentityDeletion(
      new HangingCognitoClient(),
      'pool-1',
      1,
    );

    await expect(adapter.disableIdentity('cognito-sub-1')).rejects.toThrow(
      'timed out',
    );
  });
});
