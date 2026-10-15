import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { S3EntityReferenceUploadStorage } from '../../../src/infrastructure/aws/S3EntityReferenceUploadStorage.js';

const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const imageKey = 'tmp/11111111-1111-4111-8111-111111111111/entities/imports/22222222-2222-4222-8222-222222222222.png';

class VerifiedImageClient {
  public async send(command: HeadObjectCommand | GetObjectCommand): Promise<unknown> {
    if (command instanceof HeadObjectCommand) {
      return { ContentLength: imageBytes.length, ContentType: 'image/png', ETag: '"verified"' };
    }
    return {
      Body: { transformToByteArray: async (): Promise<Uint8Array> => imageBytes },
      ContentLength: imageBytes.length,
      ContentRange: `bytes 0-${imageBytes.length - 1}/${imageBytes.length}`,
      ContentType: 'image/png',
      ETag: '"verified"',
    };
  }
}

describe('quoted import image storage delivery policy', () => {
  it('s3_presigned ではCDN placeholderを渡さず内部S3 locatorを返し、cloudfront_signedではCDN URLを保つ', async () => {
    const source = readFileSync(join(process.cwd(), 'worker/dependencies.ts'), 'utf8');
    const quotedImportConstruction = source.slice(
      source.indexOf('const quotedImportWorkerService'),
      source.indexOf('return {', source.indexOf('const quotedImportWorkerService')),
    );

    expect(quotedImportConstruction).toContain('cdnBaseUrl: resolveS3ImageStorageCdnBaseUrl()');
    expect(quotedImportConstruction).not.toContain('cdnBaseUrl: env.IMAGES_CDN_BASE_URL');

    const privateStorage = new S3EntityReferenceUploadStorage(new VerifiedImageClient() as never, {
      bucketName: 'lyra-images',
      uploadUrlTtlSeconds: 300,
    });
    const cloudFrontStorage = new S3EntityReferenceUploadStorage(new VerifiedImageClient() as never, {
      bucketName: 'lyra-images',
      cdnBaseUrl: 'https://images.lyra.example',
      uploadUrlTtlSeconds: 300,
    });

    await expect(privateStorage.loadUploadedImage({
      s3Key: imageKey,
      mimeType: 'image/png',
      sizeBytes: imageBytes.length,
    })).resolves.toMatchObject({ cdnUrl: `s3://lyra-images/${imageKey}` });
    await expect(cloudFrontStorage.loadUploadedImage({
      s3Key: imageKey,
      mimeType: 'image/png',
      sizeBytes: imageBytes.length,
    })).resolves.toMatchObject({ cdnUrl: `https://images.lyra.example/${imageKey}` });
  });
});
