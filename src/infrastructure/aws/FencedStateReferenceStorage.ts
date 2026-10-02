import {
  DeleteObjectCommand, GetObjectCommand, ListObjectVersionsCommand, PutObjectCommand,
  type GetObjectOutput, type ListObjectVersionsOutput, type PutObjectOutput,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  buildFencedStateReferenceKey, STATE_REFERENCE_COPY_V2_PROTOCOL,
} from '../../domain/state/FencedStateReferenceKey.js';
import { OPENAI_INPUT_IMAGE_MAX_BYTES } from '../../domain/constants/imageInput.js';
import { EPISODE_EXPORT_MAX_INPUT_PIXELS } from '../../domain/episodeExportProcessing.js';
import {
  imageDataMatchesEntityReferenceUploadMimeType,
  isEntityReferenceUploadMimeType,
  type EntityReferenceUploadMimeType,
} from '../../domain/constants/entityReferenceUpload.js';

/**
 * Dedicated v2 storage boundary, constructed only by the gated runtime factory.
 * The coordinator owns authorization, durable intent admission, and DB compare-and-set.
 * These adapters own bounded reads, conditional writes, and verifiable storage evidence.
 * Environment attestations are prerequisites, not verification of real S3/IAM policy.
 */
export interface FencedStorageClient {
  config: { maxAttempts: number | (() => Promise<number>) };
  send(
    command: GetObjectCommand | PutObjectCommand | ListObjectVersionsCommand | DeleteObjectCommand,
    options?: { abortSignal: AbortSignal },
  ): Promise<unknown>;
}

export interface FencedStateReferenceStorageOptions {
  bucketName: string;
  /** Required by the real runtime; optional for process-local injected adapters. */
  expectedBucketOwner?: string;
  timeoutMs?: number;
  maxFenceAttempts?: number;
  maxVersionPages?: number;
  maxVersions?: number;
  maxRequests?: number;
  environmentAssumptions: {
    versioning: 'never-versioned' | 'versioned' | 'suspended';
    exclusiveConditionalImageWriters: true;
    ordinaryMarkersRetained: true;
    noUnmanagedReplicationOrRestore: true;
  };
}

export interface FencedSourceRevision {
  eTag: string;
  versionId?: string;
}

export interface LoadFencedSourceInput {
  ownerUserId: string;
  entityId: string;
  sourceS3Key: string;
  mimeType: EntityReferenceUploadMimeType;
  expectedRevision?: FencedSourceRevision;
  expectedDigest?: string;
}

export interface LoadedFencedSource {
  imageData: Buffer;
  mimeType: EntityReferenceUploadMimeType;
  sizeBytes: number;
  digest: string;
  sourceRevision: FencedSourceRevision;
}

/** This exact intent must be durably admitted before createImage is called. */
export interface FencedStateReferenceIntent {
  ownerUserId: string;
  entityId: string;
  protocol: typeof STATE_REFERENCE_COPY_V2_PROTOCOL;
  attemptToken: string;
  s3Key: string;
  mimeType: EntityReferenceUploadMimeType;
  sizeBytes: number;
  digest: string;
  sourceRevision: FencedSourceRevision;
}

interface FencedReceiptIdentity {
  protocol: typeof STATE_REFERENCE_COPY_V2_PROTOCOL;
  attemptToken: string;
  s3Key: string;
  eTag: string;
  versionId?: string;
}

export interface FencedImageReceipt extends FencedReceiptIdentity {
  kind: 'image';
  digest: string;
  mimeType: EntityReferenceUploadMimeType;
  sizeBytes: number;
}

export interface FencedMarkerReceipt extends FencedReceiptIdentity { kind: 'marker' }
export interface FencedErasureReceipt extends FencedMarkerReceipt { historyErased: true }
export type FencedObservation = { kind: 'absent' } | FencedImageReceipt | FencedMarkerReceipt;
export interface FencedStorageOperationBudget {
  beforeRequest(): void;
  remainingTimeMs(): number;
}

/** The image role can create with If-None-Match only, never replace or delete. */
export interface FencedStateReferenceImageCreatePort {
  loadSource(input: LoadFencedSourceInput): Promise<LoadedFencedSource>;
  createImage(input: { intent: FencedStateReferenceIntent; imageData: Buffer }): Promise<FencedImageReceipt>;
}

/** DB owner/state checks must surround calls; receipts do not authorize DB changes. */
export interface FencedStateReferenceRecoveryPort {
  observe(intent: FencedStateReferenceIntent, budget?: FencedStorageOperationBudget): Promise<FencedObservation>;
  fenceAndErase(intent: FencedStateReferenceIntent, budget?: FencedStorageOperationBudget): Promise<FencedErasureReceipt>;
}

export class FencedStateReferenceStorageError extends Error {
  public readonly code = 'FENCED_STORAGE_BLOCKED';
  public constructor(public readonly reason:
    | 'invalid-intent' | 'invalid-image' | 'unknown-object' | 'unsafe-environment'
    | 'storage-unresolved' | 'conflict-limit' | 'history-blocked') {
    super('State reference storage evidence is incomplete; the attempt remains blocked');
    this.name = 'FencedStateReferenceStorageError';
  }
}

interface StorageClients {
  sourceReader: FencedStorageClient;
  imageCreator: FencedStorageClient;
  recovery: FencedStorageClient;
}

export class FencedStateReferenceStorage implements FencedStateReferenceImageCreatePort, FencedStateReferenceRecoveryPort {
  private readonly timeoutMs: number;
  private readonly maxFenceAttempts: number;
  private readonly maxVersionPages: number;
  private readonly maxVersions: number;
  private readonly maxRequests: number;

  public constructor(
    private readonly clients: StorageClients,
    private readonly options: FencedStateReferenceStorageOptions,
  ) {
    const assumptions = options.environmentAssumptions;
    if (!options.bucketName || (options.expectedBucketOwner !== undefined && !/^\d{12}$/u.test(options.expectedBucketOwner)) || !assumptions
      || !['never-versioned', 'versioned', 'suspended'].includes(assumptions.versioning)
      || assumptions.exclusiveConditionalImageWriters !== true
      || assumptions.ordinaryMarkersRetained !== true
      || assumptions.noUnmanagedReplicationOrRestore !== true
      || clients.imageCreator === clients.recovery) {
      throw blocked('unsafe-environment');
    }
    this.timeoutMs = boundedOption(options.timeoutMs, 15_000, 60_000);
    this.maxFenceAttempts = boundedOption(options.maxFenceAttempts, 3, 10);
    this.maxVersionPages = boundedOption(options.maxVersionPages, 100, 1_000);
    this.maxVersions = boundedOption(options.maxVersions, 1_000, 10_000);
    this.maxRequests = boundedOption(options.maxRequests, 25, 1_000);
  }

  public async loadSource(input: LoadFencedSourceInput): Promise<LoadedFencedSource> {
    input = { ...input, ...(input.expectedRevision && { expectedRevision: { ...input.expectedRevision } }) };
    assertSourceInput(input);
    return this.operation(this.clients.sourceReader, async (client, abortSignal) => {
      const object = await client.send(new GetObjectCommand({
        Bucket: this.options.bucketName, ExpectedBucketOwner: this.options.expectedBucketOwner, Key: input.sourceS3Key,
        Range: `bytes=0-${OPENAI_INPUT_IMAGE_MAX_BYTES}`,
        ...(input.expectedRevision && { IfMatch: input.expectedRevision.eTag,
          VersionId: input.expectedRevision.versionId }),
      }), { abortSignal }) as GetObjectOutput;
      try {
        assertCompleteResponse(object);
        const sizeBytes = object.ContentLength;
        if (!validImageSize(sizeBytes) || object.ContentType !== input.mimeType
          || object.ContentRange !== `bytes 0-${sizeBytes - 1}/${sizeBytes}`
          || !validETag(object.ETag)
          || (input.expectedRevision && (object.ETag !== input.expectedRevision.eTag
            || (input.expectedRevision.versionId !== undefined
              && object.VersionId !== input.expectedRevision.versionId)))) {
          throw blocked('invalid-image');
        }
        const imageData = await readBoundedBody(object.Body, OPENAI_INPUT_IMAGE_MAX_BYTES, abortSignal);
        const digest = digestBytes(imageData);
        if (imageData.length !== sizeBytes
          || !imageDataMatchesEntityReferenceUploadMimeType(imageData, input.mimeType)
          || (input.expectedDigest !== undefined && digest !== input.expectedDigest)) {
          throw blocked('invalid-image');
        }
        await this.assertDecodedImage(imageData, input.mimeType, abortSignal);
        if (object.VersionId !== undefined && !validVersionId(object.VersionId)) throw blocked('invalid-image');
        return { imageData, mimeType: input.mimeType, sizeBytes, digest,
          sourceRevision: { eTag: object.ETag,
            ...(object.VersionId !== undefined && { versionId: object.VersionId }) } };
      } finally {
        destroyBody(object.Body);
      }
    });
  }

  public async createImage(input: {
    intent: FencedStateReferenceIntent; imageData: Buffer;
  }): Promise<FencedImageReceipt> {
    const intent = snapshotIntent(input.intent);
    const imageData = Buffer.from(input.imageData);
    assertIntent(intent);
    if (imageData.length !== intent.sizeBytes || digestBytes(imageData) !== intent.digest
      || !imageDataMatchesEntityReferenceUploadMimeType(imageData, intent.mimeType)) throw blocked('invalid-image');
    return this.operation(this.clients.imageCreator, async (client, signal) => {
      await this.assertDecodedImage(imageData, intent.mimeType, signal);
      let put: PutObjectOutput | undefined;
      try {
        put = await client.send(new PutObjectCommand({
          Bucket: this.options.bucketName, ExpectedBucketOwner: this.options.expectedBucketOwner, Key: intent.s3Key, IfNoneMatch: '*',
          Body: imageData, ContentType: intent.mimeType, ContentLength: intent.sizeBytes,
          ChecksumSHA256: Buffer.from(intent.digest, 'hex').toString('base64'),
          CacheControl: 'private, no-store', ServerSideEncryption: 'AES256', Metadata: imageMetadata(intent),
        }), { abortSignal: signal }) as PutObjectOutput;
        this.assertPutReceipt(put);
      } catch (error) {
        if (!isConditionalConflict(error)) throw error;
        // Neither conflict status establishes success; only the following exact GET can.
      }
      const observed = await this.readObject(client, intent, signal);
      if (observed.kind !== 'image' || (put && (put.ETag !== observed.eTag
        || put.VersionId !== observed.versionId))) throw blocked('unknown-object');
      return observed;
    });
  }

  public async observe(
    intent: FencedStateReferenceIntent, budget?: FencedStorageOperationBudget,
  ): Promise<FencedObservation> {
    intent = snapshotIntent(intent);
    assertIntent(intent);
    return this.operation(this.clients.recovery, (client, signal) => this.readObject(client, intent, signal), budget);
  }

  public async fenceAndErase(
    intent: FencedStateReferenceIntent, budget?: FencedStorageOperationBudget,
  ): Promise<FencedErasureReceipt> {
    intent = snapshotIntent(intent);
    assertIntent(intent);
    return this.operation(this.clients.recovery, async (client, signal) => {
      let observed = await this.readObject(client, intent, signal);
      for (let writes = 0; observed.kind !== 'marker'; writes += 1) {
        if (writes >= this.maxFenceAttempts) throw blocked('conflict-limit');
        try {
          const put = await client.send(new PutObjectCommand({
            Bucket: this.options.bucketName, ExpectedBucketOwner: this.options.expectedBucketOwner, Key: intent.s3Key,
            ...(observed.kind === 'absent' ? { IfNoneMatch: '*' } : { IfMatch: observed.eTag }),
            Body: Buffer.alloc(0), ContentType: 'application/octet-stream', ContentLength: 0,
            ChecksumSHA256: Buffer.from(digestBytes(Buffer.alloc(0)), 'hex').toString('base64'),
            CacheControl: 'private, no-store', ServerSideEncryption: 'AES256', Metadata: markerMetadata(intent),
          }), { abortSignal: signal }) as PutObjectOutput;
          this.assertPutReceipt(put);
        } catch (error) {
          if (!isConditionalConflict(error)) throw error;
        }
        // Also executed after the final allowed conflict. A 409/412 is never a receipt.
        observed = await this.readObject(client, intent, signal);
      }
      if (this.options.environmentAssumptions.versioning !== 'never-versioned') {
        await this.eraseHistoricalImages(client, intent, observed, signal);
      }
      const retained = await this.readObject(client, intent, signal);
      if (retained.kind !== 'marker' || retained.eTag !== observed.eTag
        || retained.versionId !== observed.versionId) throw blocked('history-blocked');
      return { ...retained, historyErased: true };
    }, budget);
  }

  private async readObject(
    client: FencedStorageClient, intent: FencedStateReferenceIntent, signal: AbortSignal,
    versionId?: string,
  ): Promise<FencedObservation> {
    let object: GetObjectOutput;
    try {
      object = await client.send(new GetObjectCommand({ Bucket: this.options.bucketName,
        ExpectedBucketOwner: this.options.expectedBucketOwner,
        Key: intent.s3Key, ...(versionId !== undefined && { VersionId: versionId }) }), { abortSignal: signal }) as GetObjectOutput;
    } catch (error) {
      if (httpStatus(error) === 404 && versionId === undefined) return { kind: 'absent' };
      throw error;
    }
    try {
      assertCompleteResponse(object);
      if (!validETag(object.ETag) || object.DeleteMarker === true
        || object.ObjectLockMode !== undefined || object.ObjectLockRetainUntilDate !== undefined
        || (object.ObjectLockLegalHoldStatus !== undefined && object.ObjectLockLegalHoldStatus !== 'OFF')
        || object.ReplicationStatus !== undefined || object.Restore !== undefined || object.Expiration !== undefined
        || (versionId !== undefined && object.VersionId !== versionId)) throw blocked('unknown-object');
      this.assertVersion(object.VersionId);
      const identity: FencedReceiptIdentity = { protocol: intent.protocol, attemptToken: intent.attemptToken,
        s3Key: intent.s3Key, eTag: object.ETag,
        ...(object.VersionId !== undefined && { versionId: object.VersionId }) };
      if (exactMetadata(object.Metadata, markerMetadata(intent))) {
        if (object.ContentLength !== 0 || object.ContentType !== 'application/octet-stream') throw blocked('unknown-object');
        const body = await readBoundedBody(object.Body, 0, signal);
        if (body.length !== 0) throw blocked('unknown-object');
        return { ...identity, kind: 'marker' };
      }
      if (!exactMetadata(object.Metadata, imageMetadata(intent)) || object.ContentType !== intent.mimeType
        || object.ContentLength !== intent.sizeBytes) throw blocked('unknown-object');
      const body = await readBoundedBody(object.Body, OPENAI_INPUT_IMAGE_MAX_BYTES, signal);
      if (body.length !== intent.sizeBytes || digestBytes(body) !== intent.digest
        || !imageDataMatchesEntityReferenceUploadMimeType(body, intent.mimeType)
        || (object.ChecksumSHA256 !== undefined
          && object.ChecksumSHA256 !== Buffer.from(intent.digest, 'hex').toString('base64'))) throw blocked('unknown-object');
      await this.assertDecodedImage(body, intent.mimeType, signal);
      return { ...identity, kind: 'image', digest: intent.digest, sizeBytes: intent.sizeBytes, mimeType: intent.mimeType };
    } finally {
      destroyBody(object.Body);
    }
  }

  private async eraseHistoricalImages(
    client: FencedStorageClient, intent: FencedStateReferenceIntent,
    marker: FencedMarkerReceipt, signal: AbortSignal,
  ): Promise<void> {
    const versions = await this.inspectVersions(client, intent, marker, signal);
    for (const version of versions) {
      if (version.kind !== 'image' || version.versionId === undefined || version.versionId === marker.versionId) continue;
      const deleted = await client.send(new DeleteObjectCommand({ Bucket: this.options.bucketName,
        ExpectedBucketOwner: this.options.expectedBucketOwner,
        Key: intent.s3Key, VersionId: version.versionId }), { abortSignal: signal });
      assertCompleteResponse(deleted);
    }
    // A successful delete response is not a complete-history receipt.
    const remaining = await this.inspectVersions(client, intent, marker, signal);
    if (remaining.some((version) => version.kind === 'image')) throw blocked('history-blocked');
  }

  private async inspectVersions(
    client: FencedStorageClient, intent: FencedStateReferenceIntent,
    marker: FencedMarkerReceipt, signal: AbortSignal,
  ): Promise<Array<FencedImageReceipt | FencedMarkerReceipt>> {
    const entries: Array<{ versionId: string; eTag: string; latest: boolean }> = [];
    let keyMarker: string | undefined;
    let versionMarker: string | undefined;
    const cursors = new Set<string>();
    const ids = new Set<string>();
    for (let pageNumber = 0; ; pageNumber += 1) {
      if (pageNumber >= this.maxVersionPages) throw blocked('history-blocked');
      const page = await client.send(new ListObjectVersionsCommand({ Bucket: this.options.bucketName,
        ExpectedBucketOwner: this.options.expectedBucketOwner,
        Prefix: intent.s3Key, KeyMarker: keyMarker, VersionIdMarker: versionMarker,
        MaxKeys: Math.min(this.maxVersions, 1_000),
      }), { abortSignal: signal }) as ListObjectVersionsOutput;
      assertCompleteResponse(page);
      if ((page.DeleteMarkers ?? []).some((entry) => entry.Key === undefined || entry.Key === intent.s3Key)) throw blocked('history-blocked');
      for (const entry of page.Versions ?? []) {
        if (entry.Key === undefined) throw blocked('history-blocked');
        if (entry.Key !== intent.s3Key) continue;
        if (!validVersionId(entry.VersionId) || !validETag(entry.ETag) || typeof entry.IsLatest !== 'boolean'
          || ids.has(entry.VersionId) || entries.length >= this.maxVersions) throw blocked('history-blocked');
        ids.add(entry.VersionId);
        entries.push({ versionId: entry.VersionId, eTag: entry.ETag, latest: entry.IsLatest });
      }
      if (page.IsTruncated === false) break;
      if (page.IsTruncated !== true || typeof page.NextKeyMarker !== 'string'
        || !validVersionId(page.NextVersionIdMarker)) throw blocked('history-blocked');
      const cursor = JSON.stringify([page.NextKeyMarker, page.NextVersionIdMarker]);
      if (cursors.has(cursor)) throw blocked('history-blocked');
      cursors.add(cursor);
      keyMarker = page.NextKeyMarker;
      versionMarker = page.NextVersionIdMarker;
    }
    const latest = entries.filter((entry) => entry.latest);
    if (latest.length !== 1 || latest[0].versionId !== marker.versionId || latest[0].eTag !== marker.eTag) {
      throw blocked('history-blocked');
    }
    const verified: Array<FencedImageReceipt | FencedMarkerReceipt> = [];
    for (const entry of entries) {
      const version = await this.readObject(client, intent, signal, entry.versionId);
      if (version.kind === 'absent' || version.eTag !== entry.eTag
        || (entry.latest && version.kind !== 'marker')) throw blocked('history-blocked');
      verified.push(version);
    }
    return verified;
  }

  private assertPutReceipt(put: PutObjectOutput): void {
    assertCompleteResponse(put);
    if (!validETag(put.ETag)) throw blocked('storage-unresolved');
    this.assertVersion(put.VersionId);
  }

  private assertVersion(versionId: string | undefined): void {
    if (this.options.environmentAssumptions.versioning === 'never-versioned') {
      if (versionId !== undefined) throw blocked('unsafe-environment');
    } else if (!validVersionId(versionId)) throw blocked('unknown-object');
  }

  private async assertDecodedImage(
    bytes: Buffer, mimeType: EntityReferenceUploadMimeType, signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw blocked('storage-unresolved');
    // Same 40M-pixel ceiling as the existing thumbnail/export decoders. Loading is
    // bounded before decoding; the tiny output avoids buffering a full raw image.
    const decoder = sharp(bytes, { failOn: 'warning', limitInputPixels: EPISODE_EXPORT_MAX_INPUT_PIXELS,
      sequentialRead: true }).timeout({ seconds: Math.max(1, Math.ceil(this.timeoutMs / 1_000)) });
    const abort = (): void => { decoder.destroy(); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      const metadata = await decoder.metadata();
      const expectedFormat = mimeType === 'image/jpeg' ? 'jpeg' : mimeType === 'image/png' ? 'png' : 'webp';
      if (metadata.format !== expectedFormat || !metadata.width || !metadata.height
        || metadata.width * metadata.height > EPISODE_EXPORT_MAX_INPUT_PIXELS
        || (metadata.pages !== undefined && metadata.pages !== 1)) throw blocked('invalid-image');
      if (signal.aborted) throw blocked('storage-unresolved');
      // metadata() does not decode pixels. This pipeline does, with decoder-level
      // JPEG shrink disabled, and raises truncation/corruption warnings as errors.
      await decoder.resize({ width: 1, height: 1, fit: 'fill', fastShrinkOnLoad: false }).raw().toBuffer();
      if (signal.aborted) throw blocked('storage-unresolved');
    } catch (error) {
      if (error instanceof FencedStateReferenceStorageError) throw error;
      throw blocked(signal.aborted ? 'storage-unresolved' : 'invalid-image');
    } finally {
      signal.removeEventListener('abort', abort);
      decoder.destroy();
    }
  }

  private async operation<T>(
    client: FencedStorageClient,
    action: (client: FencedStorageClient, signal: AbortSignal) => Promise<T>,
    budget?: FencedStorageOperationBudget,
  ): Promise<T> {
    const controller = new AbortController();
    const allowedTime = Math.min(this.timeoutMs, budget?.remainingTimeMs() ?? this.timeoutMs);
    if (!Number.isFinite(allowedTime) || allowedTime <= 0) throw blocked('storage-unresolved');
    const deadline = Date.now() + allowedTime;
    let requests = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(blocked('storage-unresolved')); }, allowedTime);
    });
    try {
      return await Promise.race([timeout, (async (): Promise<T> => {
        const attempts = typeof client.config.maxAttempts === 'number'
          ? client.config.maxAttempts : await client.config.maxAttempts();
        if (attempts !== 1) throw blocked('unsafe-environment');
        if (controller.signal.aborted) throw blocked('storage-unresolved');
        const boundedClient: FencedStorageClient = { config: client.config,
          send: async (command): Promise<unknown> => {
            const remaining = Math.min(deadline - Date.now(), budget?.remainingTimeMs() ?? this.timeoutMs);
            if (controller.signal.aborted || !Number.isFinite(remaining) || remaining <= 0
              || requests >= this.maxRequests) throw blocked('storage-unresolved');
            budget?.beforeRequest();
            if (controller.signal.aborted || Date.now() >= deadline) throw blocked('storage-unresolved');
            requests += 1;
            return client.send(command, { abortSignal: controller.signal });
          } };
        return action(boundedClient, controller.signal);
      })()]);
    } catch (error) {
      if (error instanceof FencedStateReferenceStorageError) throw error;
      throw blocked('storage-unresolved');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

function assertSourceInput(input: LoadFencedSourceInput): void {
  const segments = input.sourceS3Key.split('/');
  const extension = input.mimeType === 'image/jpeg' ? '(?:jpeg|jpg)'
    : input.mimeType === 'image/webp' ? 'webp' : 'png';
  if (!safeSegment(input.ownerUserId) || !safeSegment(input.entityId)
    || !isEntityReferenceUploadMimeType(input.mimeType)
    || segments.length !== 5 || segments[1] !== input.ownerUserId || segments[2] !== 'entities'
    || !((segments[0] === 'session' && segments[3] === input.entityId)
      || (segments[0] === 'tmp' && segments[3] === 'imports'))
    || !new RegExp(`^[a-zA-Z0-9_-]{1,160}\\.${extension}$`, 'u').test(segments[4] ?? '')
    || (input.expectedDigest !== undefined && !validDigest(input.expectedDigest))
    || (input.expectedRevision !== undefined && (!validETag(input.expectedRevision.eTag)
      || (input.expectedRevision.versionId !== undefined && !validVersionId(input.expectedRevision.versionId))))) {
    throw blocked('invalid-intent');
  }
}

function assertIntent(intent: FencedStateReferenceIntent): void {
  try {
    if (intent.protocol !== STATE_REFERENCE_COPY_V2_PROTOCOL
      || intent.s3Key !== buildFencedStateReferenceKey(intent)
      || !validImageSize(intent.sizeBytes) || !validDigest(intent.digest)
      || !validETag(intent.sourceRevision.eTag)
      || (intent.sourceRevision.versionId !== undefined && !validVersionId(intent.sourceRevision.versionId))) {
      throw blocked('invalid-intent');
    }
  } catch {
    throw blocked('invalid-intent');
  }
}

function snapshotIntent(intent: FencedStateReferenceIntent): FencedStateReferenceIntent {
  assertIntent(intent);
  return { ...intent, sourceRevision: { ...intent.sourceRevision } };
}

function markerMetadata(intent: FencedStateReferenceIntent): Record<string, string> {
  return { 'lyra-protocol': intent.protocol, 'lyra-attempt': intent.attemptToken, 'lyra-kind': 'marker' };
}
function imageMetadata(intent: FencedStateReferenceIntent): Record<string, string> {
  return { ...markerMetadata(intent), 'lyra-kind': 'image', 'lyra-digest': intent.digest,
    'lyra-bytes': String(intent.sizeBytes), 'lyra-mime': intent.mimeType };
}
function exactMetadata(actual: Record<string, string> | undefined, expected: Record<string, string>): boolean {
  return actual !== undefined && Object.keys(actual).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && actual[key] === value);
}
function isConditionalConflict(error: unknown): boolean { return httpStatus(error) === 409 || httpStatus(error) === 412; }

async function readBoundedBody(body: unknown, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  if (signal.aborted) throw blocked('storage-unresolved');
  if (body instanceof Uint8Array) {
    if (body.byteLength > maxBytes) throw blocked('invalid-image');
    return Buffer.from(body);
  }
  if (typeof body !== 'object' || body === null || !(Symbol.asyncIterator in body)
    || typeof body[Symbol.asyncIterator] !== 'function') throw blocked('invalid-image');
  const chunks: Buffer[] = [];
  let total = 0;
  const stop = (): void => destroyBody(body);
  signal.addEventListener('abort', stop, { once: true });
  try {
    for await (const chunk of body as AsyncIterable<unknown>) {
      if (signal.aborted) throw blocked('storage-unresolved');
      if (!(chunk instanceof Uint8Array)) throw blocked('invalid-image');
      total += chunk.byteLength;
      if (total > maxBytes) throw blocked('invalid-image');
      chunks.push(Buffer.from(chunk));
    }
    if (signal.aborted) throw blocked('storage-unresolved');
    return Buffer.concat(chunks, total);
  } finally {
    signal.removeEventListener('abort', stop);
    destroyBody(body);
  }
}

function destroyBody(body: unknown): void {
  if (typeof body === 'object' && body !== null && 'destroy' in body && typeof body.destroy === 'function') body.destroy();
}

function assertCompleteResponse(output: unknown): void {
  const status = httpStatus(output);
  if (status === undefined || status < 200 || status > 299) throw blocked('storage-unresolved');
  if (typeof output !== 'object' || output === null || !('$metadata' in output)) throw blocked('storage-unresolved');
  const metadata = output.$metadata;
  if (typeof metadata !== 'object' || metadata === null) throw blocked('storage-unresolved');
  if ('attempts' in metadata && metadata.attempts !== 1) throw blocked('unsafe-environment');
}

function httpStatus(output: unknown): number | undefined {
  if (typeof output !== 'object' || output === null || !('$metadata' in output)) return undefined;
  const metadata = output.$metadata;
  return typeof metadata === 'object' && metadata !== null && 'httpStatusCode' in metadata
    && typeof metadata.httpStatusCode === 'number' ? metadata.httpStatusCode : undefined;
}

function blocked(reason: FencedStateReferenceStorageError['reason']): FencedStateReferenceStorageError {
  return new FencedStateReferenceStorageError(reason);
}
function validImageSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= OPENAI_INPUT_IMAGE_MAX_BYTES;
}
function validDigest(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value); }
function digestBytes(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function safeSegment(value: string): boolean { return /^[a-zA-Z0-9_-]{1,128}$/u.test(value); }
function validETag(value: unknown): value is string {
  return typeof value === 'string' && /^"[\x21\x23-\x7e]{1,254}"$/u.test(value);
}
function validVersionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1_024 && !/[\x00-\x20\x7f]/u.test(value);
}
function boundedOption(value: number | undefined, fallback: number, maximum: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw blocked('unsafe-environment');
  return result;
}
