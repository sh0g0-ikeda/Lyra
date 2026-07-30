import { describe, expect, it } from 'vitest';
import type {
  PushTokenDecryptionInput,
  PushTokenEncryptionResult,
} from '../../../../src/services/notification/PushTokenCipher.js';
import type { PushTokenRepository } from '../../../../src/repositories/PushTokenRepository.js';
import { PushTokenRegistryService } from '../../../../src/services/notification/PushTokenRegistryService.js';

const userId = '11111111-1111-4111-8111-111111111111';
const installationId = '22222222-2222-4222-8222-222222222222';
const deviceToken = 'native-device-token-value';
const tokenHash = 'a'.repeat(64);
const tokenCiphertext = `v1.${'a'.repeat(16)}.${'b'.repeat(22)}.${'c'.repeat(22)}`;

describe('PushTokenRegistryService', () => {
  it('平文tokenを保護してRepositoryへ渡しsecretを応答しない', async () => {
    const repository = new FakePushTokenRepository();
    const cipher = new FakePushTokenCipher();
    const service = new PushTokenRegistryService(repository, cipher);

    const result = await service.register(userId, {
      installationId,
      platform: 'android',
      locale: 'en',
      deviceToken,
    });

    expect(repository.upserted).toEqual({
      userId,
      installationId,
      platform: 'android',
      locale: 'en',
      tokenHash,
      tokenCiphertext,
      encryptionKeyId: 'push-key:v1',
    });
    expect(result).toEqual({ installationId, platform: 'android' });
    expect(result).not.toHaveProperty('deviceToken');
    expect(result).not.toHaveProperty('tokenHash');
  });

  it.each([
    'short',
    'token with whitespace',
    'x'.repeat(4097),
  ])('不正なdevice token「%s」をRepository前に拒否する', async (invalidToken) => {
    const repository = new FakePushTokenRepository();
    const service = new PushTokenRegistryService(repository, new FakePushTokenCipher());

    await expect(service.register(userId, {
      installationId,
      platform: 'ios',
      locale: 'ja',
      deviceToken: invalidToken,
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(repository.upserted).toBeNull();
  });

  it('cipherが平文や契約外hashを返す場合は永続化しない', async () => {
    const repository = new FakePushTokenRepository();
    const cipher = new FakePushTokenCipher();
    cipher.encryptionResult = {
      ciphertext: deviceToken,
      keyId: 'push-key:v1',
    };
    cipher.hash = 'not-a-hmac';
    const service = new PushTokenRegistryService(repository, cipher);

    await expect(service.register(userId, {
      installationId,
      platform: 'ios',
      locale: 'ja',
      deviceToken,
    })).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(repository.upserted).toBeNull();
  });

  it('UUIDでないinstallation IDをRepository前に拒否する', async () => {
    const repository = new FakePushTokenRepository();
    const service = new PushTokenRegistryService(repository, new FakePushTokenCipher());

    await expect(service.register(userId, {
      installationId: 'not-a-uuid',
      platform: 'ios',
      locale: 'ja',
      deviceToken,
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(repository.upserted).toBeNull();
  });

  it('logout解除をuserとinstallationへ委譲し未登録でも成功する', async () => {
    const repository = new FakePushTokenRepository();
    const service = new PushTokenRegistryService(repository, new FakePushTokenCipher());

    await expect(service.remove(userId, installationId)).resolves.toBeUndefined();

    expect(repository.deleted).toEqual({ userId, installationId });
  });
});

class FakePushTokenCipher {
  public encryptionResult: PushTokenEncryptionResult = {
    ciphertext: tokenCiphertext,
    keyId: 'push-key:v1',
  };
  public hash = tokenHash;

  public async encrypt(_value: string): Promise<PushTokenEncryptionResult> {
    return this.encryptionResult;
  }

  public async decrypt(_input: PushTokenDecryptionInput): Promise<string> {
    return deviceToken;
  }

  public async deterministicHash(_value: string): Promise<string> {
    return this.hash;
  }
}

class FakePushTokenRepository implements PushTokenRepository {
  public upserted: Parameters<PushTokenRepository['upsertForUser']>[0] | null = null;
  public deleted: { userId: string; installationId: string } | null = null;

  public async upsertForUser(
    input: Parameters<PushTokenRepository['upsertForUser']>[0],
  ): ReturnType<PushTokenRepository['upsertForUser']> {
    this.upserted = input;
    return {
      userId: input.userId,
      installationId: input.installationId,
      platform: input.platform,
      locale: input.locale,
      createdAt: new Date('2026-07-31T00:00:00.000Z'),
      updatedAt: new Date('2026-07-31T00:00:00.000Z'),
    };
  }

  public async deleteForUser(
    deleteUserId: string,
    deleteInstallationId: string,
  ): Promise<boolean> {
    this.deleted = {
      userId: deleteUserId,
      installationId: deleteInstallationId,
    };
    return false;
  }
}
