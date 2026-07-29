import {
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import {
  CognitoAccountIdentityDeletion,
} from '../../../../src/infrastructure/aws/CognitoAccountIdentityDeletion.js';

type CognitoCommand = AdminDisableUserCommand | AdminDeleteUserCommand;

class FakeCognitoClient {
  public commands: CognitoCommand[] = [];
  public error: Error | null = null;

  public async send(command: CognitoCommand): Promise<unknown> {
    this.commands.push(command);
    if (this.error !== null) {
      throw this.error;
    }
    return {};
  }
}

describe('CognitoAccountIdentityDeletion', () => {
  it('Cognito user pool 内の subject を無効化して削除する', async () => {
    const client = new FakeCognitoClient();
    const adapter = new CognitoAccountIdentityDeletion(client, {
      userPoolId: 'ap-northeast-1_pool',
    });

    await adapter.disableIdentity('cognito-subject-1');
    await adapter.deleteIdentity('cognito-subject-1');

    expect(client.commands).toHaveLength(2);
    expect(client.commands[0]).toBeInstanceOf(AdminDisableUserCommand);
    expect(client.commands[0]?.input).toEqual({
      UserPoolId: 'ap-northeast-1_pool',
      Username: 'cognito-subject-1',
    });
    expect(client.commands[1]).toBeInstanceOf(AdminDeleteUserCommand);
    expect(client.commands[1]?.input).toEqual({
      UserPoolId: 'ap-northeast-1_pool',
      Username: 'cognito-subject-1',
    });
  });

  it('既に存在しない Cognito user は disable と delete を冪等に成功扱いにする', async () => {
    const client = new FakeCognitoClient();
    client.error = Object.assign(new Error('user no longer exists'), {
      name: 'UserNotFoundException',
    });
    const adapter = new CognitoAccountIdentityDeletion(client, {
      userPoolId: 'ap-northeast-1_pool',
    });

    await expect(adapter.disableIdentity('cognito-subject-1')).resolves.toBeUndefined();
    await expect(adapter.deleteIdentity('cognito-subject-1')).resolves.toBeUndefined();
  });

  it('設定不足と不正な subject は provider を呼び出さない', async () => {
    expect(
      () => new CognitoAccountIdentityDeletion(new FakeCognitoClient(), { userPoolId: '  ' }),
    ).toThrow(new ConfigurationError('Cognito user pool id is required'));

    const client = new FakeCognitoClient();
    const adapter = new CognitoAccountIdentityDeletion(client, {
      userPoolId: 'ap-northeast-1_pool',
    });

    await expect(adapter.disableIdentity('')).rejects.toEqual(
      new ConfigurationError('Cognito identity subject is required'),
    );
    expect(client.commands).toEqual([]);
  });

  it('Cognito provider error から credential と subject を露出しない', async () => {
    const client = new FakeCognitoClient();
    const secret = 'cognito-provider-secret';
    const subject = 'cognito-subject-1';
    const userPoolId = 'ap-northeast-1_pool';
    client.error = new Error(`Cognito ${subject} ${userPoolId} Authorization: Bearer ${secret}`);
    const adapter = new CognitoAccountIdentityDeletion(client, {
      userPoolId,
    });

    await expect(adapter.deleteIdentity(subject)).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: expect.stringContaining('Bearer [redacted]'),
    });
    await expect(adapter.deleteIdentity(subject)).rejects.not.toMatchObject({
      message: expect.stringContaining(secret),
    });
    await expect(adapter.deleteIdentity(subject)).rejects.not.toMatchObject({
      message: expect.stringContaining(subject),
    });
    await expect(adapter.deleteIdentity(subject)).rejects.not.toMatchObject({
      message: expect.stringContaining(userPoolId),
    });
  });
});
