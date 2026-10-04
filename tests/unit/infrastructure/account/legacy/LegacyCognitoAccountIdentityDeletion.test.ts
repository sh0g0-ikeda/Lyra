import { AdminDeleteUserCommand, AdminDisableUserCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { describe, expect, it } from 'vitest';
import { LegacyCognitoAccountIdentityDeletion } from '../../../../../src/infrastructure/account/legacy/LegacyCognitoAccountIdentityDeletion.js';

class FakeCognitoClient {
  public readonly commands: unknown[] = [];
  public result: { Enabled?: boolean } = { Enabled: true };
  public error: unknown = null;
  public async send(command: unknown, _options: { abortSignal: AbortSignal }): Promise<{ Enabled?: boolean }> {
    this.commands.push(command);
    if (this.error !== null) throw this.error;
    return this.result;
  }
}

describe('LegacyCognitoAccountIdentityDeletion', () => {
  it('disableとdeleteを別commandで実行しdisable照合はEnabled falseだけを適用済みにする', async () => {
    const client = new FakeCognitoClient();
    const adapter = new LegacyCognitoAccountIdentityDeletion(client, 'pool-legacy');
    await adapter.disableIdentity('legacy-subject', context());
    await adapter.deleteIdentity('legacy-subject', context());
    expect(client.commands[0]).toBeInstanceOf(AdminDisableUserCommand);
    expect(client.commands[1]).toBeInstanceOf(AdminDeleteUserCommand);
    client.result = { Enabled: false };
    expect(await adapter.reconcileIdentityDisabled('legacy-subject', context())).toBe('applied');
    client.result = { Enabled: false };
    expect(await adapter.reconcileIdentityDeleted('legacy-subject', context())).toBe('unknown');
    expect(client.commands[2]).toBeInstanceOf(AdminGetUserCommand);
  });

  it('期限切れ又はabort済みはCognitoを呼ばず、timeoutやprovider詳細をunknown又は安全な失敗にする', async () => {
    const client = new FakeCognitoClient();
    const adapter = new LegacyCognitoAccountIdentityDeletion(client, 'pool-legacy');
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.disableIdentity('legacy-subject', { signal: controller.signal, deadlineAt: Date.now() + 100 })).rejects.toThrow('Legacy Cognito');
    expect(await adapter.reconcileIdentityDisabled('legacy-subject', context(Date.now() - 1))).toBe('unknown');
    client.error = { message: 'raw legacy-subject provider detail' };
    const failure = await adapter.deleteIdentity('legacy-subject', context()).catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: 'Legacy Cognito account identity deletion failed' });
    expect(failure).not.toMatchObject({ message: expect.stringContaining('legacy-subject') });
    expect(client.commands).toHaveLength(1);
  });

  it('UserNotFoundだけをdeleted照合の適用済みにする', async () => {
    const client = new FakeCognitoClient();
    client.error = { name: 'UserNotFoundException', message: 'raw legacy-subject' };
    const adapter = new LegacyCognitoAccountIdentityDeletion(client, 'pool-legacy');
    expect(await adapter.reconcileIdentityDisabled('legacy-subject', context())).toBe('applied');
    expect(await adapter.reconcileIdentityDeleted('legacy-subject', context())).toBe('applied');
  });
});

function context(deadlineAt = Date.now() + 1_000): { signal: AbortSignal; deadlineAt: number } {
  return { signal: new AbortController().signal, deadlineAt };
}
