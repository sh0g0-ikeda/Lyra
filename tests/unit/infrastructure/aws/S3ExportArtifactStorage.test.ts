import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { S3ExportArtifactStorage } from '../../../../src/infrastructure/aws/S3ExportArtifactStorage.js';

describe('S3ExportArtifactStorage', () => {
  it('rejects a source body whose bytes do not match its declared MIME type', async () => {
    const client = {
      send: vi.fn(async (command: unknown) => {
        if (command instanceof HeadObjectCommand) return { ContentType: 'image/png', ContentLength: 3 };
        if (command instanceof GetObjectCommand) return { ContentType: 'image/png', Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
        throw new Error('unexpected command');
      }),
    };
    const storage = new S3ExportArtifactStorage(client as never, { bucketName: 'private-bucket' });
    await expect(storage.loadPageImage({ s3Key: 'session/user/pages/page.png', mimeType: 'image/png' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
