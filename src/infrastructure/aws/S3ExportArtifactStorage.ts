import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MAX_EXPORT_SOURCE_IMAGE_BYTES, type ExportImageMimeType } from '../../domain/exportJob.js';
import { ConfigurationError, PayloadTooLargeError, ValidationError } from '../../domain/errors/index.js';
import type { BuiltExportArtifact } from '../export/ExportArtifactBuilder.js';

export interface ExportArtifactStoragePort {
  loadPageImage(input: { s3Key: string; mimeType: ExportImageMimeType }): Promise<Buffer>;
  storeArtifact(input: { jobId: string; artifact: BuiltExportArtifact; expiresAt: Date }): Promise<{ s3Key: string }>;
  createDownloadUrl(input: { s3Key: string; filename: string; expiresInSeconds: number }): Promise<string>;
  deleteArtifact(s3Key: string): Promise<void>;
}

export interface S3ExportArtifactStorageOptions { bucketName: string; sourceReadTimeoutMs?: number; maxSourceImageBytes?: number; }
export type ExportArtifactPresigner = (client: S3Client, command: GetObjectCommand, expiresInSeconds: number) => Promise<string>;

export class S3ExportArtifactStorage implements ExportArtifactStoragePort {
  public constructor(private readonly client: S3Client, private readonly options: S3ExportArtifactStorageOptions, private readonly presign: ExportArtifactPresigner = defaultPresign) {}

  public async loadPageImage(input: { s3Key: string; mimeType: ExportImageMimeType }): Promise<Buffer> {
    assertSafeSourceKey(input.s3Key);
    const maxBytes = this.options.maxSourceImageBytes ?? MAX_EXPORT_SOURCE_IMAGE_BYTES;
    try {
      const head = await readWithRetry(() => withTimeout((signal) => this.client.send(new HeadObjectCommand({ Bucket: this.options.bucketName, Key: input.s3Key }), { abortSignal: signal }), this.options.sourceReadTimeoutMs));
      if (head.ContentType !== input.mimeType || head.ContentLength === undefined || head.ContentLength <= 0) throw new ValidationError('Export source image is unavailable');
      if (head.ContentLength > maxBytes) throw new PayloadTooLargeError('Export source image is too large');
      const object = await readWithRetry(() => withTimeout((signal) => this.client.send(new GetObjectCommand({ Bucket: this.options.bucketName, Key: input.s3Key }), { abortSignal: signal }), this.options.sourceReadTimeoutMs));
      if (object.ContentType !== input.mimeType || !hasByteArrayBody(object.Body)) throw new ValidationError('Export source image is unavailable');
      const data = Buffer.from(await object.Body.transformToByteArray());
      if (data.length !== head.ContentLength || data.length > maxBytes || !hasExpectedImageSignature(data, input.mimeType)) throw new ValidationError('Export source image is unavailable');
      return data;
    } catch (error) {
      if (error instanceof ValidationError || error instanceof PayloadTooLargeError) throw error;
      throw new ConfigurationError('Unable to load export source image');
    }
  }

  public async storeArtifact(input: { jobId: string; artifact: BuiltExportArtifact; expiresAt: Date }): Promise<{ s3Key: string }> {
    if (!/^[0-9a-f-]{36}$/u.test(input.jobId)) throw new ConfigurationError('Export job ID is invalid');
    const s3Key = `exports/${input.jobId}.${input.artifact.extension}`;
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.options.bucketName, Key: s3Key, Body: input.artifact.data, ContentType: input.artifact.mimeType, ContentDisposition: 'attachment', CacheControl: 'private, no-store', ServerSideEncryption: 'AES256', Metadata: { expires_at: input.expiresAt.toISOString() } }));
      return { s3Key };
    } catch { throw new ConfigurationError('Unable to store export artifact'); }
  }

  public async createDownloadUrl(input: { s3Key: string; filename: string; expiresInSeconds: number }): Promise<string> {
    if (!/^exports\/[0-9a-f-]{36}\.(pdf|zip)$/u.test(input.s3Key)) throw new ConfigurationError('Export artifact key is invalid');
    if (!Number.isInteger(input.expiresInSeconds) || input.expiresInSeconds <= 0 || input.expiresInSeconds > 900) throw new ConfigurationError('Export download expiry is invalid');
    try { return await this.presign(this.client, new GetObjectCommand({ Bucket: this.options.bucketName, Key: input.s3Key, ResponseContentDisposition: `attachment; filename="${input.filename.replace(/["\\\r\n]/gu, '-')}"` }), input.expiresInSeconds); }
    catch { throw new ConfigurationError('Unable to create export download URL'); }
  }

  public async deleteArtifact(s3Key: string): Promise<void> {
    if (!/^exports\/[0-9a-f-]{36}\.(pdf|zip)$/u.test(s3Key)) throw new ConfigurationError('Export artifact key is invalid');
    try { await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucketName, Key: s3Key })); }
    catch { throw new ConfigurationError('Unable to delete export artifact'); }
  }
}

async function defaultPresign(client: S3Client, command: GetObjectCommand, expiresInSeconds: number): Promise<string> { return getSignedUrl(client, command, { expiresIn: expiresInSeconds }); }
async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs = 30_000): Promise<T> { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { return await operation(controller.signal); } finally { clearTimeout(timer); } }
function hasByteArrayBody(value: unknown): value is { transformToByteArray(): Promise<Uint8Array> } { return typeof value === 'object' && value !== null && 'transformToByteArray' in value && typeof value.transformToByteArray === 'function'; }
function assertSafeSourceKey(key: string): void { if (key.length === 0 || key.length > 1024 || key.includes('..') || key.includes('\\') || key.includes('\0')) throw new ConfigurationError('Export source key is invalid'); }
async function readWithRetry<T>(operation: () => Promise<T>): Promise<T> { let failure: unknown; for (let attempt = 0; attempt < 3; attempt += 1) { try { return await operation(); } catch (error) { failure = error; if (!isRetryableReadError(error) || attempt === 2) throw error; await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1))); } } throw failure; }
function isRetryableReadError(error: unknown): boolean { if (typeof error !== 'object' || error === null) return false; const name = 'name' in error && typeof error.name === 'string' ? error.name : ''; if (name === 'AbortError' || name === 'TimeoutError' || name === 'NetworkingError') return true; if (!('$metadata' in error) || typeof error.$metadata !== 'object' || error.$metadata === null) return false; const status = 'httpStatusCode' in error.$metadata ? error.$metadata.httpStatusCode : undefined; return typeof status === 'number' && (status === 429 || status >= 500); }
function hasExpectedImageSignature(data: Buffer, mimeType: ExportImageMimeType): boolean { if (mimeType === 'image/png') return data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])); if (mimeType === 'image/jpeg') return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff; return data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP'; }
