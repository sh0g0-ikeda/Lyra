import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../../../../src/domain/errors/index.js';
import {
  S3EntityReferenceUploadStorage,
} from '../../../../src/infrastructure/aws/S3EntityReferenceUploadStorage.js';

const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const uploadKey = 'tmp/11111111-1111-4111-8111-111111111111/entities/imports/22222222-2222-4222-8222-222222222222.png';

class FakeS3Client {
  public calls: Array<HeadObjectCommand | GetObjectCommand | CopyObjectCommand> = [];
  public headResponse: { ContentLength?: number; ContentType?: string; ETag?: string } = {
    ContentLength: pngBytes.length,
    ContentType: 'image/png',
    ETag: '"verified-etag"',
  };
  public getResponse: {
    Body?: { transformToByteArray(): Promise<Uint8Array> };
    ContentLength?: number;
    ContentRange?: string;
    ContentType?: string;
    ETag?: string;
  } = {
    Body: {
      async transformToByteArray(): Promise<Uint8Array> {
        return pngBytes;
      },
    },
    ContentLength: pngBytes.length,
    ContentRange: `bytes 0-${pngBytes.length - 1}/${pngBytes.length}`,
    ContentType: 'image/png',
    ETag: '"verified-etag"',
  };
  public errors: Error[] = [];

  public async send(
    command: HeadObjectCommand | GetObjectCommand | CopyObjectCommand,
  ): Promise<unknown> {
    this.calls.push(command);
    const error = this.errors.shift();
    if (error !== undefined) {
      throw error;
    }
    if (command instanceof HeadObjectCommand) {
      return this.headResponse;
    }
    if (command instanceof GetObjectCommand) {
      return this.getResponse;
    }
    return {};
  }
}

describe('S3EntityReferenceUploadStorage', () => {
  it('Content-Lengthを署名対象にして申告サイズを強制する', async () => {
    const client = new S3Client({
      region: 'ap-northeast-1',
      credentials: {
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'test-secret-access-key',
      },
    });
    const storage = new S3EntityReferenceUploadStorage(client, {
      bucketName: 'lyra-images',
      uploadUrlTtlSeconds: 300,
    });

    const signedUrl = await storage.createPresignedPutUrl({
      s3Key: uploadKey,
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
      expiresInSeconds: 300,
    });

    const signedHeaders = new URL(signedUrl).searchParams.get('X-Amz-SignedHeaders');
    expect(signedHeaders).toContain('content-length');
    expect(signedHeaders).toContain('content-type');
  });

  it('server-owned key・MIME・size・SSE・短命期限でPUT URLを発行する', async () => {
    const client = new FakeS3Client();
    let command: PutObjectCommand | null = null;
    const storage = new S3EntityReferenceUploadStorage(
      client as unknown as S3Client,
      { bucketName: 'lyra-images', uploadUrlTtlSeconds: 300 },
      async (_client, signedCommand, expiresInSeconds) => {
        command = signedCommand;
        expect(expiresInSeconds).toBe(300);
        return 'https://s3.example.test/upload';
      },
    );

    await expect(storage.createPresignedPutUrl({
      s3Key: uploadKey,
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
      expiresInSeconds: 300,
    })).resolves.toBe('https://s3.example.test/upload');

    expect((command as PutObjectCommand | null)?.input).toMatchObject({
      Bucket: 'lyra-images',
      Key: uploadKey,
      ContentType: 'image/png',
      ContentLength: pngBytes.length,
      ServerSideEncryption: 'AES256',
    });
  });

  it('HEAD後のGETを申告サイズに制限して総サイズ・MIME・byte数を再検証する', async () => {
    const client = new FakeS3Client();
    const result = await buildStorage(client).loadUploadedImage({
      s3Key: uploadKey,
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
    });

    expect(result).toMatchObject({
      imageData: Buffer.from(pngBytes),
      mimeType: 'image/png',
      eTag: '"verified-etag"',
      cdnUrl: `s3://lyra-images/${uploadKey}`,
    });
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]?.input).toMatchObject({
      Bucket: 'lyra-images',
      Key: uploadKey,
      Range: `bytes=0-${pngBytes.length - 1}`,
    });
  });

  it('検証済みETagを条件にclientが書けない別keyへS3内コピーする', async () => {
    const client = new FakeS3Client();
    const storage = buildStorage(client);
    const destinationKey = 'tmp/11111111-1111-4111-8111-111111111111/entities/imports/33333333-3333-4333-8333-333333333333.png';

    const result = await storage.stabilizeUploadedImage({
      sourceS3Key: uploadKey,
      destinationS3Key: destinationKey,
      mimeType: 'image/png',
      eTag: '"verified-etag"',
    });

    expect(result).toEqual({
      s3Key: destinationKey,
      cdnUrl: `s3://lyra-images/${destinationKey}`,
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toBeInstanceOf(CopyObjectCommand);
    expect(client.calls[0]?.input).toMatchObject({
      Bucket: 'lyra-images',
      Key: destinationKey,
      CopySource: `lyra-images/${uploadKey}`,
      CopySourceIfMatch: '"verified-etag"',
      ContentType: 'image/png',
      MetadataDirective: 'REPLACE',
      ServerSideEncryption: 'AES256',
    });
  });

  it('HEAD後により大きいobjectへ差し替わった場合はRange総サイズ不一致で拒否する', async () => {
    const client = new FakeS3Client();
    client.getResponse.ContentRange = `bytes 0-${pngBytes.length - 1}/${pngBytes.length + 1000}`;

    await expect(buildStorage(client).loadUploadedImage({
      s3Key: uploadKey,
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
    })).resolves.toBeNull();
  });

  it('HEADとGETの間でETagが変わったobjectは拒否する', async () => {
    const client = new FakeS3Client();
    client.getResponse.ETag = '"replacement-etag"';

    await expect(buildStorage(client).loadUploadedImage({
      s3Key: uploadKey,
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
    })).resolves.toBeNull();
  });

  it('missing・MIME・size不一致はnullにしてprovider詳細を返さない', async () => {
    const missingClient = new FakeS3Client();
    const missing = new Error(`NoSuchKey ${uploadKey}`);
    Object.assign(missing, { $metadata: { httpStatusCode: 404 } });
    missingClient.errors.push(missing);
    await expect(buildStorage(missingClient).loadUploadedImage({
      s3Key: uploadKey,
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
    })).resolves.toBeNull();

    const mismatchClient = new FakeS3Client();
    mismatchClient.headResponse = {
      ContentLength: pngBytes.length + 1,
      ContentType: 'image/jpeg',
      ETag: '"verified-etag"',
    };
    await expect(buildStorage(mismatchClient).loadUploadedImage({
      s3Key: uploadKey,
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
    })).resolves.toBeNull();
  });

  it('4xxは再試行せず5xxだけ安全なreadを再試行する', async () => {
    const deniedClient = new FakeS3Client();
    const denied = new Error(`AccessDenied ${uploadKey}`);
    Object.assign(denied, { $metadata: { httpStatusCode: 403 } });
    deniedClient.errors.push(denied);
    await expect(buildStorage(deniedClient, 2).loadUploadedImage({
      s3Key: uploadKey,
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
    })).rejects.toEqual(new ConfigurationError('Unable to verify uploaded image'));
    expect(deniedClient.calls).toHaveLength(1);

    const retryClient = new FakeS3Client();
    const unavailable = new Error('ServiceUnavailable');
    Object.assign(unavailable, { $metadata: { httpStatusCode: 503 } });
    retryClient.errors.push(unavailable);
    await expect(buildStorage(retryClient, 2).loadUploadedImage({
      s3Key: uploadKey,
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
    })).resolves.toMatchObject({ imageData: Buffer.from(pngBytes) });
    expect(retryClient.calls).toHaveLength(3);
  });

  it('S3 SDKがabortを処理しなくてもtimeoutで待機を打ち切る', async () => {
    const client = new FakeS3Client();
    client.send = async (): Promise<never> => new Promise<never>(() => {});
    const storage = new S3EntityReferenceUploadStorage(
      client as unknown as S3Client,
      {
        bucketName: 'lyra-images',
        uploadUrlTtlSeconds: 300,
        safeReadTimeoutMs: 1,
        maxSafeReadAttempts: 1,
        retryDelayMs: 0,
      },
      async () => 'https://s3.example.test/upload',
    );

    await expect(storage.loadUploadedImage({
      s3Key: uploadKey,
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
    })).rejects.toEqual(new ConfigurationError('Unable to verify uploaded image'));
  });
});

function buildStorage(
  client: FakeS3Client,
  maxSafeReadAttempts = 1,
): S3EntityReferenceUploadStorage {
  return new S3EntityReferenceUploadStorage(
    client as unknown as S3Client,
    {
      bucketName: 'lyra-images',
      uploadUrlTtlSeconds: 300,
      safeReadTimeoutMs: 1_000,
      maxSafeReadAttempts,
      retryDelayMs: 0,
    },
    async () => 'https://s3.example.test/upload',
  );
}
