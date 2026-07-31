import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import {
  S3EpisodeExportArtifactStorage,
  S3EpisodeExportSourceImageLoader,
} from '../../../../src/infrastructure/aws/S3EpisodeExportStorage.js';

const pngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const sourceKey =
  'session/11111111-1111-4111-8111-111111111111/pages/22222222-2222-4222-8222-222222222222/job.png';
const artifactKey =
  'exports/11111111-1111-4111-8111-111111111111/episodes/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.pdf';

type ExportS3Command =
  | HeadObjectCommand
  | GetObjectCommand
  | PutObjectCommand
  | DeleteObjectCommand;

class FakeS3Client {
  public readonly calls: ExportS3Command[] = [];
  public errors: Error[] = [];
  public headResponse: {
    ContentLength?: number;
    ContentType?: string;
    ETag?: string;
  } = {
    ContentLength: pngBytes.length,
    ContentType: 'image/png',
    ETag: '"export-etag"',
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
    ETag: '"export-etag"',
  };

  public async send(command: ExportS3Command): Promise<unknown> {
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

describe('S3EpisodeExportSourceImageLoader', () => {
  it('HEAD後にETag付きRange GETを行いMIME・範囲・magic bytesを再検証する', async () => {
    const client = new FakeS3Client();
    const loader = buildLoader(client);

    const result = await loader.load({
      s3Key: sourceKey,
      mimeType: 'image/png',
    });

    expect(result).toEqual({
      imageData: pngBytes,
      mimeType: 'image/png',
      eTag: '"export-etag"',
    });
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]).toBeInstanceOf(GetObjectCommand);
    expect(client.calls[1]?.input).toMatchObject({
      Bucket: 'lyra-images',
      Key: sourceKey,
      IfMatch: '"export-etag"',
      Range: `bytes=0-${pngBytes.length - 1}`,
    });
  });

  it('ETag・MIME・range・magic bytes不一致を永続的なsource errorにする', async () => {
    const client = new FakeS3Client();
    client.getResponse.ETag = '"replaced"';

    await expect(buildLoader(client).load({
      s3Key: sourceKey,
      mimeType: 'image/png',
    })).rejects.toMatchObject({
      code: 'EXPORT_SOURCE_INVALID',
      retryable: false,
    });

    const magicClient = new FakeS3Client();
    magicClient.getResponse.Body = {
      async transformToByteArray(): Promise<Uint8Array> {
        return Buffer.alloc(pngBytes.length);
      },
    };
    await expect(buildLoader(magicClient).load({
      s3Key: sourceKey,
      mimeType: 'image/png',
    })).rejects.toMatchObject({
      code: 'EXPORT_SOURCE_INVALID',
      retryable: false,
    });

    const rangeClient = new FakeS3Client();
    rangeClient.getResponse.ContentRange =
      `bytes 0-${pngBytes.length - 1}/${pngBytes.length + 1}`;
    await expect(buildLoader(rangeClient).load({
      s3Key: sourceKey,
      mimeType: 'image/png',
    })).rejects.toMatchObject({
      code: 'EXPORT_SOURCE_INVALID',
      retryable: false,
    });

    const oversizedClient = new FakeS3Client();
    oversizedClient.headResponse.ContentLength = 20 * 1024 * 1024 + 1;
    await expect(buildLoader(oversizedClient).load({
      s3Key: sourceKey,
      mimeType: 'image/png',
    })).rejects.toMatchObject({
      code: 'EXPORT_SOURCE_INVALID',
      retryable: false,
    });
    expect(oversizedClient.calls).toHaveLength(1);
  });

  it('429・5xx・networkだけ再試行し4xxは再試行しない', async () => {
    const retryClient = new FakeS3Client();
    const unavailable = new Error('provider detail');
    Object.assign(unavailable, { $metadata: { httpStatusCode: 503 } });
    retryClient.errors.push(unavailable);

    await expect(buildLoader(retryClient, 2).load({
      s3Key: sourceKey,
      mimeType: 'image/png',
    })).resolves.toMatchObject({ imageData: pngBytes });
    expect(retryClient.calls).toHaveLength(3);

    const deniedClient = new FakeS3Client();
    const denied = new Error(`AccessDenied ${sourceKey}`);
    Object.assign(denied, { $metadata: { httpStatusCode: 403 } });
    deniedClient.errors.push(denied);
    await expect(buildLoader(deniedClient, 2).load({
      s3Key: sourceKey,
      mimeType: 'image/png',
    })).rejects.toMatchObject({
      code: 'EXPORT_SOURCE_UNAVAILABLE',
      retryable: false,
      message: expect.not.stringContaining(sourceKey),
    });
    expect(deniedClient.calls).toHaveLength(1);
  });

  it('SDKがabortを無視してもtimeoutでretryable errorを返す', async () => {
    const client = new FakeS3Client();
    client.send = async (): Promise<never> => new Promise<never>(() => {});
    const loader = new S3EpisodeExportSourceImageLoader(
      client as unknown as S3Client,
      {
        bucketName: 'lyra-images',
        timeoutMs: 1,
        maxAttempts: 1,
        retryDelayMs: 0,
      },
    );

    await expect(loader.load({
      s3Key: sourceKey,
      mimeType: 'image/png',
    })).rejects.toMatchObject({
      code: 'EXPORT_TEMPORARY_FAILURE',
      retryable: true,
    });
  });
});

describe('S3EpisodeExportArtifactStorage', () => {
  it('exact key・MIME・size・private no-store・SSEで保存し同じkeyだけ削除する', async () => {
    const client = new FakeS3Client();
    const storage = buildArtifactStorage(client);
    const identity = buildArtifactIdentity();

    await storage.store({
      ...identity,
      s3Key: artifactKey,
      mimeType: 'application/pdf',
      artifactData: Buffer.from('%PDF-test'),
    });
    await storage.delete({
      ...identity,
      s3Key: artifactKey,
      mimeType: 'application/pdf',
    });

    expect(client.calls[0]).toBeInstanceOf(PutObjectCommand);
    expect(client.calls[0]?.input).toMatchObject({
      Bucket: 'lyra-images',
      Key: artifactKey,
      ContentType: 'application/pdf',
      ContentLength: 9,
      CacheControl: 'private, max-age=0, no-store',
      ServerSideEncryption: 'AES256',
    });
    expect(client.calls[1]).toBeInstanceOf(DeleteObjectCommand);
    expect(client.calls[1]?.input).toMatchObject({
      Bucket: 'lyra-images',
      Key: artifactKey,
    });
  });

  it('migration契約と異なるkeyやMIMEをprovider呼出し前に拒否する', async () => {
    const client = new FakeS3Client();
    const storage = buildArtifactStorage(client);

    await expect(storage.store({
      ...buildArtifactIdentity(),
      s3Key: 'exports/other.pdf',
      mimeType: 'application/zip',
      artifactData: Buffer.from('test'),
    })).rejects.toMatchObject({
      code: 'EXPORT_STORAGE_FAILED',
      retryable: false,
    });
    expect(client.calls).toHaveLength(0);
  });

  it('artifact PUTもnetwork・429・5xxだけを有界再試行する', async () => {
    const client = new FakeS3Client();
    const unavailable = new Error('provider detail');
    Object.assign(unavailable, { $metadata: { httpStatusCode: 503 } });
    client.errors.push(unavailable);
    const storage = buildArtifactStorage(client, 2);

    await expect(storage.store({
      ...buildArtifactIdentity(),
      s3Key: artifactKey,
      mimeType: 'application/pdf',
      artifactData: Buffer.from('%PDF-test'),
    })).resolves.toBeUndefined();
    expect(client.calls).toHaveLength(2);
  });
});

function buildLoader(
  client: FakeS3Client,
  maxAttempts = 1,
): S3EpisodeExportSourceImageLoader {
  return new S3EpisodeExportSourceImageLoader(
    client as unknown as S3Client,
    {
      bucketName: 'lyra-images',
      timeoutMs: 1_000,
      maxAttempts,
      retryDelayMs: 0,
    },
  );
}

function buildArtifactStorage(
  client: FakeS3Client,
  maxAttempts = 1,
): S3EpisodeExportArtifactStorage {
  return new S3EpisodeExportArtifactStorage(
    client as unknown as S3Client,
    {
      bucketName: 'lyra-images',
      timeoutMs: 1_000,
      maxAttempts,
      retryDelayMs: 0,
    },
  );
}

function buildArtifactIdentity(): {
  userId: string;
  organizationId: null;
  episodeId: string;
  jobId: string;
  format: 'pdf';
} {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    organizationId: null,
    episodeId: '33333333-3333-4333-8333-333333333333',
    jobId: '44444444-4444-4444-8444-444444444444',
    format: 'pdf',
  };
}
