import {
  GetObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  EPISODE_EXPORT_DOWNLOAD_URL_TTL_SECONDS,
  buildEpisodeExportArtifactKey,
} from '../../domain/episodeExportJob.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import type {
  EpisodeExportDownloadSignerPort,
} from '../../services/export/EpisodeExportService.js';

export interface S3EpisodeExportDownloadSignerOptions {
  bucketName: string;
}

export type EpisodeExportPresigner = (
  client: S3Client,
  command: GetObjectCommand,
  expiresInSeconds: number,
) => Promise<string>;

export class S3EpisodeExportDownloadSigner
implements EpisodeExportDownloadSignerPort {
  public constructor(
    private readonly client: S3Client,
    private readonly options: S3EpisodeExportDownloadSignerOptions,
    private readonly presigner: EpisodeExportPresigner = defaultPresigner,
  ) {
    if (
      options.bucketName.trim().length < 1
      || options.bucketName.length > 255
      || /[\u0000-\u001f\u007f]/u.test(options.bucketName)
    ) {
      throw unavailable();
    }
  }

  public async sign(
    input: Parameters<EpisodeExportDownloadSignerPort['sign']>[0],
  ): Promise<string> {
    if (
      !Number.isSafeInteger(input.expiresInSeconds)
      || input.expiresInSeconds < 1
      || input.expiresInSeconds > EPISODE_EXPORT_DOWNLOAD_URL_TTL_SECONDS
      || input.job.status !== 'completed'
      || input.job.artifactS3Key === null
      || input.job.artifactMimeType === null
    ) {
      throw unavailable();
    }

    const expectedKey = buildEpisodeExportArtifactKey({
      userId: input.job.userId,
      organizationId: input.job.organizationId,
      episodeId: input.job.episodeId,
      jobId: input.job.id,
      format: input.job.format,
    });
    const expectedMimeType =
      input.job.format === 'pdf' ? 'application/pdf' : 'application/zip';
    if (
      input.job.artifactS3Key !== expectedKey
      || input.job.artifactMimeType !== expectedMimeType
    ) {
      throw unavailable();
    }

    try {
      const url = await this.presigner(
        this.client,
        new GetObjectCommand({
          Bucket: this.options.bucketName,
          Key: expectedKey,
          ResponseContentType: expectedMimeType,
          ResponseContentDisposition:
            `attachment; filename="${safeAsciiFilename(input.job.filename, input.job.format)}"`,
        }),
        input.expiresInSeconds,
      );
      if (!isHttpsUrl(url)) {
        throw unavailable();
      }
      return url;
    } catch {
      throw unavailable();
    }
  }
}

async function defaultPresigner(
  client: S3Client,
  command: GetObjectCommand,
  expiresInSeconds: number,
): Promise<string> {
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

function safeAsciiFilename(value: string, format: 'pdf' | 'zip'): string {
  const fallback = `lyra-export.${format}`;
  const ascii = value
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/gu, '-')
    .replace(/["\\;]/gu, '-')
    .replace(/[./]+$/gu, '')
    .trim();
  if (ascii.length < 1 || ascii.length > 160) {
    return fallback;
  }
  return ascii.toLowerCase().endsWith(`.${format}`)
    ? ascii
    : `${ascii}.${format}`;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function unavailable(): ConfigurationError {
  return new ConfigurationError('Episode export download is unavailable');
}
