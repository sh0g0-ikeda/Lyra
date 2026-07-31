import { GetObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import {
  S3EpisodeExportDownloadSigner,
  type EpisodeExportPresigner,
} from '../../../../src/infrastructure/aws/S3EpisodeExportDownloadSigner.js';
import type { EpisodeExportJob } from '../../../../src/domain/episodeExportJob.js';

const userId = '11111111-1111-4111-8111-111111111111';
const episodeId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const key = `exports/${userId}/episodes/${episodeId}/${jobId}.pdf`;

describe('S3EpisodeExportDownloadSigner', () => {
  it('完全一致するserver keyをsafe filename付きで最大5分だけ署名する', async () => {
    const calls: Array<{ command: GetObjectCommand; expiresIn: number }> = [];
    const presigner: EpisodeExportPresigner = async (_client, command, expiresIn) => {
      calls.push({ command, expiresIn });
      return 'https://downloads.lyra.test/signed';
    };
    const signer = new S3EpisodeExportDownloadSigner(
      {} as never,
      { bucketName: 'lyra-images' },
      presigner,
    );

    await expect(signer.sign({
      job: buildJob(),
      expiresInSeconds: 300,
    })).resolves.toBe('https://downloads.lyra.test/signed');

    expect(calls[0]?.expiresIn).toBe(300);
    expect(calls[0]?.command.input).toEqual({
      Bucket: 'lyra-images',
      Key: key,
      ResponseContentType: 'application/pdf',
      ResponseContentDisposition: 'attachment; filename="safe-export.pdf"',
    });
  });

  it('不一致key・MIME・TTL・HTTP URLを拒否する', async () => {
    let url = 'https://downloads.lyra.test/signed';
    const signer = new S3EpisodeExportDownloadSigner(
      {} as never,
      { bucketName: 'lyra-images' },
      async () => url,
    );

    for (const input of [
      { job: buildJob({ artifactS3Key: 'exports/other.pdf' }), expiresInSeconds: 300 },
      { job: buildJob({ artifactMimeType: 'text/plain' }), expiresInSeconds: 300 },
      { job: buildJob(), expiresInSeconds: 301 },
      { job: buildJob(), expiresInSeconds: 0 },
    ]) {
      await expect(signer.sign(input)).rejects.toThrow(
        'Episode export download is unavailable',
      );
    }

    url = 'http://downloads.lyra.test/unsafe';
    await expect(signer.sign({
      job: buildJob(),
      expiresInSeconds: 60,
    })).rejects.toThrow('Episode export download is unavailable');
  });
});

function buildJob(overrides: Partial<EpisodeExportJob> = {}): EpisodeExportJob {
  const timestamp = new Date('2026-07-31T00:00:00.000Z');
  return {
    id: jobId,
    userId,
    organizationId: null,
    episodeId,
    format: 'pdf',
    filename: 'safe-export.pdf',
    pageIds: ['55555555-5555-4555-8555-555555555555'],
    pageSnapshot: [],
    requestFingerprint: 'a'.repeat(64),
    idempotencyKey: 'request-123',
    status: 'completed',
    progressStage: 'completed',
    progressPercent: 100,
    artifactS3Key: key,
    artifactMimeType: 'application/pdf',
    artifactSizeBytes: 1024,
    artifactDeletedAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: timestamp,
    startedAt: timestamp,
    completedAt: timestamp,
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: timestamp,
    attemptCount: 1,
    processingLeaseToken: null,
    processingLeaseExpiresAt: null,
    lastHeartbeatAt: null,
    ...overrides,
  };
}
