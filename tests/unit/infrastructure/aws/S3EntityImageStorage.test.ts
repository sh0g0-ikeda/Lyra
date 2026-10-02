import { CopyObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import { S3EntityImageStorage, createStateReferenceCopyClient } from '../../../../src/infrastructure/aws/S3EntityImageStorage.js';

class FakeS3Client {
  public commands: Array<PutObjectCommand | CopyObjectCommand> = [];
  public error: Error | null = null;

  public async send(command: PutObjectCommand | CopyObjectCommand): Promise<unknown> {
    this.commands.push(command);
    if (this.error !== null) {
      throw this.error;
    }

    return { CopyObjectResult: { ETag: '"state-etag"' }, $metadata: { attempts: 1, httpStatusCode: 200 } };
  }
}

describe('S3EntityImageStorage', () => {
  it('状態copy専用clientはSDK再試行を明示的に1回へ制限する', async () => {
    const client = createStateReferenceCopyClient('ap-northeast-1');
    expect(await client.config.maxAttempts()).toBe(1);
    client.destroy();
  });

  it('専用clientがなければ通常copyへfallbackせず送信前に拒否する', async () => {
    const client = new FakeS3Client();
    const storage = new S3EntityImageStorage(client, { bucketName: 'images' });
    await expect(storage.finalizeStateReferenceImage(stateInput())).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(client.commands).toHaveLength(0);
  });

  it.each([
    {},
    { CopyObjectResult: { ETag: 'etag' } },
    { CopyObjectResult: { ETag: 'etag' }, $metadata: { attempts: 2, httpStatusCode: 200 } },
    { CopyObjectResult: {}, $metadata: { attempts: 1, httpStatusCode: 200 } },
    { CopyObjectResult: { ETag: 'etag' }, $metadata: { attempts: 1, httpStatusCode: 500 } },
  ])('完全な単回成功応答でない場合はcopy成功として返さない: %j', async (response) => {
    const regular = new FakeS3Client();
    const stateClient = { send: vi.fn(async () => response) };
    const storage = new S3EntityImageStorage(regular, { bucketName: 'images' }, stateClient);
    await expect(storage.finalizeStateReferenceImage(stateInput())).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(stateClient.send).toHaveBeenCalledOnce();
    expect(regular.commands).toHaveLength(0);
  });

  it('状態画像の確定先をbase一覧と分離する', async () => {
    const client = new FakeS3Client();
    const storage = new S3EntityImageStorage(client, {
      bucketName: 'images',
      cdnBaseUrl: 'https://cdn.lyra.test',
    }, client);

    const result = await storage.finalizeStateReferenceImage({
      userId: 'actor-user',
      entityId: 'entity-1',
      stateId: 'state-1',
      refId: 'job-1-1',
      sourceS3Key: 'session/actor-user/entities/entity-1/job-1-1.png',
    });

    expect(result.s3Key).toBe('saved/actor-user/entities/entity-1/states/state-1/job-1-1.png');
  });
  it.each([
    { refId: '../other' },
    { stateId: 'state/other' },
    { entityId: '../other' },
    { userId: 'other/owner' },
    { sourceS3Key: 'session/other-user/entities/entity-1/source.png' },
    { sourceS3Key: 'session/actor-user/entities/entity-1/../source.png' },
  ])('不正な状態copyキーをS3送信前に拒否する: %j', async (invalid) => {
    const client = new FakeS3Client();
    const storage = new S3EntityImageStorage(client, { bucketName: 'images' }, client);
    await expect(storage.finalizeStateReferenceImage({
      userId: 'actor-user', entityId: 'entity-1', stateId: 'state-1', refId: 'ref-1',
      sourceS3Key: 'session/actor-user/entities/entity-1/source.png', ...invalid,
    })).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(client.commands).toHaveLength(0);
  });

  it('状態copyは15秒でSDKをabortするがremote完了とは扱わない', async () => {
    vi.useFakeTimers();
    let abortSeen = false;
    let settleCopy!: () => void;
    const client = {
      send: async (_command: PutObjectCommand | CopyObjectCommand, options?: { abortSignal: AbortSignal }) => {
        return new Promise<void>((_resolve, reject) => {
          settleCopy = () => reject(new Error('copy aborted'));
          options?.abortSignal.addEventListener('abort', () => { abortSeen = true; });
        });
      },
    };
    const storage = new S3EntityImageStorage(client, { bucketName: 'images' }, client);
    let finished = false;
    const copying = storage.finalizeStateReferenceImage({
      userId: 'actor-user', entityId: 'entity-1', stateId: 'state-1', refId: 'ref-1',
      sourceS3Key: 'session/actor-user/entities/entity-1/candidate.png',
    });
    const outcome = copying.then(
      (value) => { finished = true; return { status: 'fulfilled' as const, value }; },
      (error: unknown) => { finished = true; return { status: 'rejected' as const, error }; },
    );
    try {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
      expect(abortSeen).toBe(true);
      expect(finished).toBe(false);
      settleCopy();
      expect(await outcome).toMatchObject({ status: 'rejected', error: { code: 'CONFIGURATION_ERROR' } });
      expect(finished).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('import image を tmp 配下へ保存する', async () => {
    const client = new FakeS3Client();
    const storage = new S3EntityImageStorage(client, {
      bucketName: 'bucket',
      cdnBaseUrl: 'https://cdn.lyra.test',
    });

    const result = await storage.storeImportedImage({
      userId: 'user-1',
      imageData: Buffer.from('abc'),
      mimeType: 'image/png',
    });

    const command = client.commands[0] as PutObjectCommand;
    expect(command.input.Key).toContain('tmp/user-1/entities/imports/');
    expect(command.input.CacheControl).toBe('private, max-age=604800, immutable');
    expect(result.s3Key).toContain('tmp/user-1/entities/imports/');
  });

  it('confirm 時は saved 配下へコピーする', async () => {
    const client = new FakeS3Client();
    const storage = new S3EntityImageStorage(client, {
      bucketName: 'bucket',
      cdnBaseUrl: 'https://cdn.lyra.test',
    });

    const result = await storage.finalizeReferenceImage({
      userId: 'user-1',
      entityId: 'entity-1',
      refId: 'ref-1',
      sourceS3Key: 'tmp/user-1/entities/imports/source.png',
    });

    const command = client.commands[0] as CopyObjectCommand;
    expect(command.input.Key).toBe('saved/user-1/entities/entity-1/ref-1.png');
    expect(command.input.CacheControl).toBe('private, max-age=31536000, immutable');
    expect(result.cdnUrl).toBe('https://cdn.lyra.test/saved/user-1/entities/entity-1/ref-1.png');
  });

  it('rejects unsupported source image extensions before copying', async () => {
    const client = new FakeS3Client();
    const storage = new S3EntityImageStorage(client, {
      bucketName: 'bucket',
      cdnBaseUrl: 'https://cdn.lyra.test',
    });

    await expect(
      storage.finalizeReferenceImage({
        userId: 'user-1',
        entityId: 'entity-1',
        refId: 'ref-1',
        sourceS3Key: 'tmp/user-1/entities/imports/source.txt',
      }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });

    expect(client.commands).toHaveLength(0);
  });

  it('rejects source keys outside the entity owner scope before copying', async () => {
    const client = new FakeS3Client();
    const storage = new S3EntityImageStorage(client, {
      bucketName: 'bucket',
      cdnBaseUrl: 'https://cdn.lyra.test',
    });

    await expect(
      storage.finalizeReferenceImage({
        userId: 'user-1',
        entityId: 'entity-1',
        refId: 'ref-1',
        sourceS3Key: 'tmp/user-2/entities/imports/source.png',
      }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });

    expect(client.commands).toHaveLength(0);
  });

  it('S3 保存失敗時の外部エラー文は機密値を伏せる', async () => {
    const client = new FakeS3Client();
    const fakeApiKey = ['sk', 'test-secret'].join('-');
    client.error = new Error(`s3 failed Authorization: Bearer ${fakeApiKey} ${'x'.repeat(600)}`);
    const storage = new S3EntityImageStorage(client, {
      bucketName: 'bucket',
      cdnBaseUrl: 'https://cdn.lyra.test',
    });

    await expect(
      storage.storeGeneratedCandidate({
        userId: 'user-1',
        entityId: 'entity-1',
        jobId: 'job-1',
        candidateIndex: 0,
        imageData: Buffer.from('abc'),
        mimeType: 'image/png',
      }),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: expect.stringContaining('Bearer [redacted]'),
    });

    await expect(
      storage.storeGeneratedCandidate({
        userId: 'user-1',
        entityId: 'entity-1',
        jobId: 'job-2',
        candidateIndex: 0,
        imageData: Buffer.from('abc'),
        mimeType: 'image/png',
      }),
    ).rejects.not.toEqual(
      new ConfigurationError(`s3 failed Authorization: Bearer ${fakeApiKey} ${'x'.repeat(600)}`),
    );
  });
});

function stateInput() {
  return { userId: 'actor-user', entityId: 'entity-1', stateId: 'state-1', refId: 'ref-1',
    sourceS3Key: 'session/actor-user/entities/entity-1/candidate.png' };
}
