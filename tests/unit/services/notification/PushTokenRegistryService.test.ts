import { describe, expect, it } from 'vitest';
import type {
  PushTokenCipherPort,
  PushTokenEncryptionResult,
} from '../../../../src/services/notification/PushTokenCipherPort.js';
import {
  PushTokenRegistryService,
} from '../../../../src/services/notification/PushTokenRegistryService.js';
import type {
  PushTokenRepository,
  UpsertPushTokenInput,
} from '../../../../src/repositories/PushTokenRepository.js';
import type {
  PushTokenRegistration,
} from '../../../../src/domain/pushToken.js';

const userId = '11111111-1111-4111-8111-111111111111';
const installationId = '22222222-2222-4222-8222-222222222222';
const rawToken = 'native-provider-token-value-1234567890';

class FakeCipher implements PushTokenCipherPort {
  public encryptedValues: string[] = [];
  public hashedValues: string[] = [];

  public async encrypt(value: string): Promise<PushTokenEncryptionResult> {
    this.encryptedValues.push(value);
    return {
      ciphertext: 'encrypted:v1:opaque-value',
      keyId: 'push-key-v1',
    };
  }

  public async decrypt(): Promise<string> {
    throw new Error('not used by registry service');
  }

  public async deterministicHash(value: string): Promise<string> {
    this.hashedValues.push(value);
    return 'hmac-sha256:0123456789abcdef0123456789abcdef';
  }
}

class FakeRepository implements PushTokenRepository {
  public upserts: UpsertPushTokenInput[] = [];
  public deletions: Array<{ userId: string; installationId: string }> = [];

  public async upsertForUser(input: UpsertPushTokenInput): Promise<PushTokenRegistration> {
    this.upserts.push(input);
    return {
      userId: input.userId,
      installationId: input.installationId,
      platform: input.platform,
      locale: input.locale,
      createdAt: new Date('2026-07-25T00:00:00.000Z'),
      updatedAt: new Date('2026-07-25T00:01:00.000Z'),
    };
  }

  public async deleteForUser(targetUserId: string, targetInstallationId: string): Promise<boolean> {
    this.deletions.push({ userId: targetUserId, installationId: targetInstallationId });
    return false;
  }
}

describe('PushTokenRegistryService', () => {
  it('raw tokenをcipherとhash portへだけ渡し保護済み値だけを保存する', async () => {
    const repository = new FakeRepository();
    const cipher = new FakeCipher();
    const service = new PushTokenRegistryService(repository, cipher);

    const result = await service.register(userId, {
      installationId,
      platform: 'ios',
      deviceToken: rawToken,
      locale: 'en',
    });

    expect(cipher.encryptedValues).toEqual([rawToken]);
    expect(cipher.hashedValues).toEqual([rawToken]);
    expect(repository.upserts).toEqual([
      {
        userId,
        installationId,
        platform: 'ios',
        locale: 'en',
        tokenCiphertext: 'encrypted:v1:opaque-value',
        tokenHash: 'hmac-sha256:0123456789abcdef0123456789abcdef',
        encryptionKeyId: 'push-key-v1',
      },
    ]);
    expect(result).toEqual({ installationId, platform: 'ios' });
    expect(JSON.stringify(result)).not.toContain(rawToken);
    expect(JSON.stringify(result)).not.toContain('encrypted:v1');
    expect(JSON.stringify(result)).not.toContain('hmac-sha256');
  });

  it('cipherが平文を返す場合に永続化しない', async () => {
    const repository = new FakeRepository();
    const cipher = new FakeCipher();
    cipher.encrypt = async (): Promise<PushTokenEncryptionResult> => ({
      ciphertext: rawToken,
      keyId: 'push-key-v1',
    });
    const service = new PushTokenRegistryService(repository, cipher);

    await expect(
      service.register(userId, {
        installationId,
        platform: 'android',
        deviceToken: rawToken,
        locale: 'ja',
      }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(repository.upserts).toHaveLength(0);
  });

  it('削除時に認証userとinstallationだけをrepositoryへ渡して存在有無を公開しない', async () => {
    const repository = new FakeRepository();
    const service = new PushTokenRegistryService(repository, new FakeCipher());

    await expect(service.remove(userId, installationId)).resolves.toBeUndefined();
    expect(repository.deletions).toEqual([{ userId, installationId }]);
  });
});
