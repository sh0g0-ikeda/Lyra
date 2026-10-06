import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { DeleteObjectCommand, GetObjectCommand, ListObjectVersionsCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  FencedStateReferenceStorage,
  type FencedStorageClient,
  type FencedStateReferenceStorageOptions,
  type FencedStateReferenceIntent,
} from '../../../../src/infrastructure/aws/FencedStateReferenceStorage.js';
import { OPENAI_INPUT_IMAGE_MAX_BYTES } from '../../../../src/domain/constants/imageInput.js';
import { buildFencedStateReferenceKey, STATE_REFERENCE_COPY_V2_PROTOCOL } from '../../../../src/domain/state/FencedStateReferenceKey.js';

const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#836fab' } }).png().toBuffer();
const digest = createHash('sha256').update(png).digest('hex');
const source = {
  ownerUserId: 'owner', entityId: 'entity',
  sourceS3Key: 'session/owner/entities/entity/candidate.png', mimeType: 'image/png' as const,
};
const assumptions: FencedStateReferenceStorageOptions['environmentAssumptions'] = {
  versioning: 'never-versioned', exclusiveConditionalImageWriters: true,
  ordinaryMarkersRetained: true, noUnmanagedReplicationOrRestore: true,
};

function setup(response: unknown, expectedBucketOwner?: string): { storage: FencedStateReferenceStorage; commands: unknown[] } {
  const commands: unknown[] = [];
  const sourceReader: FencedStorageClient = {
    config: { maxAttempts: async () => 1 },
    async send(command): Promise<unknown> { commands.push(command); return response; },
  };
  const imageCreator: FencedStorageClient = { ...sourceReader };
  const recovery: FencedStorageClient = { ...sourceReader };
  return {
    storage: new FencedStateReferenceStorage({ sourceReader, imageCreator, recovery }, {
      bucketName: 'local-only', expectedBucketOwner, environmentAssumptions: assumptions,
    }), commands,
  };
}

function sourceResponse(body: unknown = png): Record<string, unknown> {
  return {
    $metadata: { httpStatusCode: 206, attempts: 1 }, ETag: '"source-etag"',
    VersionId: 'source-version', ContentType: 'image/png', ContentLength: png.length,
    ContentRange: `bytes 0-${png.length - 1}/${png.length}`, Body: body,
  };
}

describe('FencedStateReferenceStorage の上限付き画像読取', () => {
  it('pins the configured bucket owner on source reads', async () => {
    const { storage, commands } = setup(sourceResponse(), '123456789012');
    await storage.loadSource(source);
    expect((commands[0] as GetObjectCommand).input.ExpectedBucketOwner).toBe('123456789012');
  });
  it('所有者のsession画像を実byte・MIME・digestとrevision付きで取得する', async () => {
    const { storage, commands } = setup(sourceResponse());
    expect(await storage.loadSource(source)).toEqual({
      imageData: png, mimeType: 'image/png', sizeBytes: png.length, digest,
      sourceRevision: { eTag: '"source-etag"', versionId: 'source-version' },
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(GetObjectCommand);
    expect((commands[0] as GetObjectCommand).input.Range).toBe(`bytes=0-${OPENAI_INPUT_IMAGE_MAX_BYTES}`);
    expect(commands.some((command) => command instanceof PutObjectCommand)).toBe(false);
  });

  it.each([
    { ownerUserId: 'other' }, { entityId: 'other' },
    { sourceS3Key: 'saved/owner/entities/entity/candidate.png' },
    { sourceS3Key: 'session/owner/entities/entity/../candidate.png' },
    { sourceS3Key: 'session/owner/entities/entity/candidate.jpeg' },
  ])('不正なsource scopeの場合は送信前に拒否する: %j', async (invalid) => {
    const { storage, commands } = setup(sourceResponse());
    await expect(storage.loadSource({ ...source, ...invalid })).rejects.toMatchObject({
      code: 'FENCED_STORAGE_BLOCKED',
    });
    expect(commands).toHaveLength(0);
  });

  it('ContentLengthが偽でも実際のstream上限を超えた時点で停止する', async () => {
    let chunks = 0;
    async function* body(): AsyncGenerator<Buffer> {
      chunks += 1; yield Buffer.alloc(OPENAI_INPUT_IMAGE_MAX_BYTES);
      chunks += 1; yield Buffer.alloc(1);
      chunks += 1; yield png;
    }
    const { storage } = setup(sourceResponse(body()));
    await expect(storage.loadSource(source)).rejects.toMatchObject({ reason: 'invalid-image' });
    expect(chunks).toBe(2);
  });

  it.each([
    { ContentType: 'image/jpeg' }, { ContentLength: OPENAI_INPUT_IMAGE_MAX_BYTES + 1 },
    { Body: Buffer.from('not a png') }, { ContentRange: 'bytes 0-3/4' },
  ])('不一致metadataまたは画像本文の場合は拒否する: %j', async (invalid) => {
    const { storage } = setup({ ...sourceResponse(), ...invalid });
    await expect(storage.loadSource(source)).rejects.toMatchObject({ code: 'FENCED_STORAGE_BLOCKED' });
  });

  it('元のrevisionとdigestが不一致の場合は拒否する', async () => {
    const { storage } = setup(sourceResponse());
    await expect(storage.loadSource({ ...source, expectedDigest: '0'.repeat(64) })).rejects.toMatchObject({ reason: 'invalid-image' });
    await expect(storage.loadSource({ ...source, expectedRevision: { eTag: '"other"' } })).rejects.toMatchObject({ reason: 'invalid-image' });
  });

  it('同一所有者のtmp importも5MiB上限付きで読める', async () => {
    const { storage } = setup(sourceResponse());
    expect((await storage.loadSource({ ...source, sourceS3Key: 'tmp/owner/entities/imports/upload.png' })).digest).toBe(digest);
  });

  it.each(['png', 'jpeg', 'webp'] as const)('%sは実pixel decodeを行いheader付きの切断本文を拒否する', async (format) => {
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ac375b' } }).toFormat(format).toBuffer();
    const mimeType = `image/${format}` as 'image/png' | 'image/jpeg' | 'image/webp';
    const request = { ...source, mimeType, sourceS3Key: `session/owner/entities/entity/candidate.${format}` };
    function response(body: Buffer): Record<string, unknown> {
      return { ...sourceResponse(body), ContentLength: body.length, ContentType: mimeType,
        ContentRange: `bytes 0-${body.length - 1}/${body.length}` };
    }
    expect((await setup(response(bytes)).storage.loadSource(request)).imageData).toEqual(bytes);
    const truncated = bytes.subarray(0, Math.floor(bytes.length / 2));
    await expect(setup(response(truncated)).storage.loadSource(request)).rejects.toMatchObject({ reason: 'invalid-image' });
  });

  it('圧縮byteが小さくても40M pixelを超える画像headerをdecode前に拒否する', async () => {
    const hugeHeader = Buffer.from(png);
    hugeHeader.writeUInt32BE(40_000_001, 16);
    hugeHeader.writeUInt32BE(1, 20);
    hugeHeader.writeUInt32BE(crc32(hugeHeader.subarray(12, 29)), 29);
    // Header is parseable; the storage's stricter pixel ceiling must reject it.
    expect(await sharp(hugeHeader).metadata()).toMatchObject({ width: 40_000_001, height: 1 });
    await expect(setup(sourceResponse(hugeHeader)).storage.loadSource(source)).rejects.toMatchObject({ reason: 'invalid-image' });
  });
});

// Compile-time contract: a real configured SDK client can be injected without an adapter cast.
function acceptsSdkClient(client: S3Client): FencedStorageClient { return client; }
void acceptsSdkClient;

const intentScope = {
  ownerUserId: '11111111-1111-4111-8111-111111111111',
  entityId: '22222222-2222-4222-8222-222222222222',
  attemptToken: '33333333-3333-4333-8333-333333333333', mimeType: 'image/png' as const,
};
function intent(): FencedStateReferenceIntent {
  return { ...intentScope, protocol: STATE_REFERENCE_COPY_V2_PROTOCOL,
    s3Key: buildFencedStateReferenceKey(intentScope), digest, sizeBytes: png.length,
    sourceRevision: { eTag: '"source-etag"' } };
}
interface StoredVersion {
  id: string;
  body: Buffer;
  metadata: Record<string, string>;
  contentType: string;
  eTag: string;
  extra?: Record<string, unknown>;
}

/** Atomic conditional-put model; no socket, credentials, cloud emulator, or real S3. */
class StorageModel {
  public versions: StoredVersion[] = [];
  public commands: Array<{ role: string; command: GetObjectCommand | PutObjectCommand | ListObjectVersionsCommand | DeleteObjectCommand }> = [];
  public versioned = false;
  public pageSize = 1;
  public beforePut?: (command: PutObjectCommand) => void;
  public failList = false;
  public failDelete = false;
  public failPut?: number;
  private serial = 0;

  public client(role: string): FencedStorageClient {
    return { config: { maxAttempts: async () => 1 }, send: async (command): Promise<unknown> => {
      this.commands.push({ role, command });
      if (command instanceof GetObjectCommand) {
        const found = command.input.VersionId === undefined ? this.versions.at(-1)
          : this.versions.find((version) => version.id === command.input.VersionId);
        if (!found) throw httpError(404);
        return { $metadata: { httpStatusCode: 200, attempts: 1 }, ETag: found.eTag,
          ...(this.versioned && { VersionId: found.id }), Body: found.body,
          ContentLength: found.body.length, ContentType: found.contentType,
          Metadata: found.metadata, ...found.extra };
      }
      if (command instanceof PutObjectCommand) {
        this.beforePut?.(command);
        if (this.failPut) throw httpError(this.failPut);
        const current = this.versions.at(-1);
        if ((command.input.IfNoneMatch === '*' && current)
          || (command.input.IfMatch !== undefined && command.input.IfMatch !== current?.eTag)) throw httpError(412);
        const next = this.store(command.input.Body as Buffer, command.input.Metadata ?? {}, command.input.ContentType ?? '');
        return { $metadata: { httpStatusCode: 200, attempts: 1 }, ETag: next.eTag,
          ...(this.versioned && { VersionId: next.id }) };
      }
      if (command instanceof ListObjectVersionsCommand) {
        if (this.failList) throw httpError(403);
        const start = command.input.VersionIdMarker === undefined ? 0
          : this.versions.findIndex((version) => version.id === command.input.VersionIdMarker) + 1;
        const page = this.versions.slice(start, start + this.pageSize);
        const more = start + page.length < this.versions.length;
        return { $metadata: { httpStatusCode: 200, attempts: 1 }, IsTruncated: more,
          ...(more && { NextKeyMarker: intent().s3Key, NextVersionIdMarker: page.at(-1)?.id }),
          Versions: page.map((version) => ({ Key: intent().s3Key, VersionId: version.id,
            ETag: version.eTag, IsLatest: version === this.versions.at(-1) })) };
      }
      if (this.failDelete) throw httpError(403);
      if (!command.input.VersionId) throw new Error('Key-only delete is forbidden in this model');
      this.versions = this.versions.filter((version) => version.id !== command.input.VersionId);
      return { $metadata: { httpStatusCode: 204, attempts: 1 } };
    } };
  }

  public store(body: Buffer, metadata: Record<string, string>, contentType: string): StoredVersion {
    this.serial += 1;
    const version = { id: `version-${this.serial}`, body: Buffer.from(body), metadata: { ...metadata },
      contentType, eTag: `"etag-${this.serial}"` };
    if (!this.versioned) this.versions = [];
    this.versions.push(version);
    return version;
  }

  public storage(options: Partial<FencedStateReferenceStorageOptions> = {}): FencedStateReferenceStorage {
    return new FencedStateReferenceStorage({ sourceReader: this.client('source'),
      imageCreator: this.client('image'), recovery: this.client('recovery') }, {
      bucketName: 'local-only', environmentAssumptions: { ...assumptions,
        versioning: this.versioned ? 'versioned' : 'never-versioned' }, ...options,
    });
  }
}
function httpError(status: number): Error & { $metadata: { httpStatusCode: number } } {
  return Object.assign(new Error('Synthetic failure; never surface this provider text'), { $metadata: { httpStatusCode: status } });
}

describe('FencedStateReferenceStorage の条件付き作成・fence', () => {
  it('pins expected bucket owner on every image, marker, version-list and exact-version delete command', async () => {
    const model = new StorageModel(); model.versioned = true;
    const storage = model.storage({ expectedBucketOwner: '123456789012' });
    await storage.createImage({ intent: intent(), imageData: png });
    await storage.fenceAndErase(intent());
    expect(model.commands.some(({ command }) => command instanceof DeleteObjectCommand)).toBe(true);
    expect(model.commands.some(({ command }) => command instanceof ListObjectVersionsCommand)).toBe(true);
    expect(model.commands.every(({ command }) => command.input.ExpectedBucketOwner === '123456789012')).toBe(true);
  });
  it('専用keyへ単回の条件付き画像PUTを送り完全な画像receiptを返す', async () => {
    const model = new StorageModel();
    const receipt = await model.storage().createImage({ intent: intent(), imageData: png });
    expect(receipt).toMatchObject({ kind: 'image', digest, s3Key: intent().s3Key });
    const writes = model.commands.filter(({ command }) => command instanceof PutObjectCommand);
    expect(writes).toHaveLength(1);
    expect(writes[0].role).toBe('image');
    expect((writes[0].command as PutObjectCommand).input).toMatchObject({
      IfNoneMatch: '*', ContentType: 'image/png', ContentLength: png.length,
      ChecksumSHA256: Buffer.from(digest, 'hex').toString('base64'),
    });
    expect((writes[0].command as PutObjectCommand).input.IfMatch).toBeUndefined();
    expect(JSON.stringify((writes[0].command as PutObjectCommand).input.Metadata)).not.toContain(intentScope.ownerUserId);
  });

  it('画像不在時は同じkeyに通常の空markerを作り遅延画像を拒否する', async () => {
    const model = new StorageModel();
    const storage = model.storage();
    expect(await storage.fenceAndErase(intent())).toMatchObject({ kind: 'marker', historyErased: true });
    const current = model.versions.at(-1)!;
    expect(current.body).toHaveLength(0);
    expect(current.metadata).toEqual({ 'lyra-protocol': STATE_REFERENCE_COPY_V2_PROTOCOL,
      'lyra-attempt': intent().attemptToken, 'lyra-kind': 'marker' });
    await expect(storage.createImage({ intent: intent(), imageData: png })).rejects.toMatchObject({ code: 'FENCED_STORAGE_BLOCKED' });
    expect(model.versions.at(-1)).toBe(current);
    expect(model.commands.some(({ command }) => command instanceof DeleteObjectCommand)).toBe(false);
  });

  it('画像が勝った場合は観測ETagのIf-Matchで空markerへ置換する', async () => {
    const model = new StorageModel(); const storage = model.storage();
    const image = await storage.createImage({ intent: intent(), imageData: png });
    await storage.fenceAndErase(intent());
    const marker = model.commands.filter(({ role, command }) => role === 'recovery' && command instanceof PutObjectCommand).at(-1)!.command as PutObjectCommand;
    expect(marker.input).toMatchObject({ Key: intent().s3Key, IfMatch: image.eTag, ContentLength: 0 });
    expect(marker.input.IfNoneMatch).toBeUndefined();
    expect(model.versions).toHaveLength(1);
  });

  it.each([409, 412])('marker競合%dを成功にせず再読取し上限回数で止まる', async (status) => {
    const model = new StorageModel(); model.failPut = status;
    await expect(model.storage({ maxFenceAttempts: 2 }).fenceAndErase(intent())).rejects.toMatchObject({ reason: 'conflict-limit' });
    expect(model.commands.filter(({ command }) => command instanceof PutObjectCommand)).toHaveLength(2);
    expect(model.commands.filter(({ command }) => command instanceof GetObjectCommand)).toHaveLength(3);
  });

  it('unknown tokenまたは本文digest不一致の場合は置換も削除もしない', async () => {
    const model = new StorageModel(); const storage = model.storage();
    await storage.createImage({ intent: intent(), imageData: png });
    model.versions[0].metadata['lyra-attempt'] = 'unknown';
    await expect(storage.fenceAndErase(intent())).rejects.toMatchObject({ reason: 'unknown-object' });
    model.versions[0].metadata['lyra-attempt'] = intent().attemptToken;
    model.versions[0].body[8] ^= 1;
    await expect(storage.observe(intent())).rejects.toMatchObject({ reason: 'unknown-object' });
    expect(model.commands.filter(({ command }) => command instanceof PutObjectCommand)).toHaveLength(1);
  });

  it('画像作成の412後も厳格な画像GETが一致した場合だけreceiptを返す', async () => {
    const model = new StorageModel(); const storage = model.storage();
    const first = await storage.createImage({ intent: intent(), imageData: png });
    expect(await storage.createImage({ intent: intent(), imageData: png })).toEqual(first);
    expect(model.versions).toHaveLength(1);
  });

  it('同じtokenの複数recovery workerは一つのmarkerへ収束する', async () => {
    const model = new StorageModel();
    const receipts = await Promise.all([model.storage(), model.storage(), model.storage()]
      .map((storage) => storage.fenceAndErase(intent())));
    expect(new Set(receipts.map((receipt) => receipt.eTag)).size).toBe(1);
    expect(receipts.every((receipt) => receipt.historyErased)).toBe(true);
    expect(model.versions).toHaveLength(1);
  });

  it.each(['nonempty', 'extra-metadata', 'wrong-type', 'expiration', 'restore'])('不正なmarker %s を証拠として採用しない', async (invalid) => {
    const model = new StorageModel(); const storage = model.storage();
    await storage.fenceAndErase(intent());
    const marker = model.versions[0];
    if (invalid === 'nonempty') marker.body = Buffer.from('x');
    if (invalid === 'extra-metadata') marker.metadata['owner'] = intent().ownerUserId;
    if (invalid === 'wrong-type') marker.contentType = 'image/png';
    if (invalid === 'expiration') marker.extra = { Expiration: 'expiry-date="tomorrow"' };
    if (invalid === 'restore') marker.extra = { Restore: 'ongoing-request="true"' };
    const writesBefore = model.commands.filter(({ command }) => command instanceof PutObjectCommand).length;
    await expect(storage.fenceAndErase(intent())).rejects.toMatchObject({ reason: 'unknown-object' });
    expect(model.commands.filter(({ command }) => command instanceof PutObjectCommand)).toHaveLength(writesBefore);
  });

  it('空keyのmarker作成より画像が先着した場合は再観測してIf-Matchへ進む', async () => {
    const model = new StorageModel();
    model.beforePut = (command): void => {
      if (command.input.Metadata?.['lyra-kind'] !== 'marker') return;
      model.beforePut = undefined;
      model.store(png, { 'lyra-protocol': intent().protocol, 'lyra-attempt': intent().attemptToken,
        'lyra-kind': 'image', 'lyra-digest': digest, 'lyra-bytes': String(png.length), 'lyra-mime': 'image/png' }, 'image/png');
    };
    expect(await model.storage().fenceAndErase(intent())).toMatchObject({ historyErased: true });
    const puts = model.commands.filter(({ command }) => command instanceof PutObjectCommand);
    expect(puts).toHaveLength(2);
    expect((puts[0].command as PutObjectCommand).input.IfNoneMatch).toBe('*');
    expect((puts[1].command as PutObjectCommand).input.IfMatch).toBe('"etag-1"');
  });

  it('元のimage PUT応答が失われても成功にせず再読取から復旧できる', async () => {
    const model = new StorageModel();
    const imageClient = model.client('image');
    const storage = new FencedStateReferenceStorage({ sourceReader: model.client('source'),
      recovery: model.client('recovery'), imageCreator: { ...imageClient, send: async (command, options): Promise<unknown> => {
        const result = await imageClient.send(command, options);
        if (command instanceof PutObjectCommand) throw new Error('lost response');
        return result;
      } } }, { bucketName: 'local-only', environmentAssumptions: assumptions });
    await expect(storage.createImage({ intent: intent(), imageData: png })).rejects.toMatchObject({ reason: 'storage-unresolved' });
    expect(model.commands.filter(({ role, command }) => role === 'image' && command instanceof GetObjectCommand)).toHaveLength(0);
    expect(await storage.fenceAndErase(intent())).toMatchObject({ historyErased: true });
  });

  it('SDK timeoutとabortは未確定を返し遅い完了を成功へ変更しない', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const model = new StorageModel(); let resolvePut!: (value: unknown) => void;
      let dispatchReady!: () => void;
      const dispatched = new Promise<void>((resolve) => { dispatchReady = resolve; });
      let sawAbort = false;
      const imageCreator: FencedStorageClient = { config: { maxAttempts: 1 },
        send: async (_command, options): Promise<unknown> => {
          options?.abortSignal.addEventListener('abort', () => { sawAbort = true; });
          return new Promise((resolve) => { resolvePut = resolve; dispatchReady(); });
        } };
      const storage = new FencedStateReferenceStorage({ sourceReader: model.client('source'), imageCreator,
        recovery: model.client('recovery') }, { bucketName: 'local-only', timeoutMs: 10, environmentAssumptions: assumptions });
      const outcome = storage.createImage({ intent: intent(), imageData: png }).catch((error: unknown) => error);
      // Let the local image decoder finish before advancing the SDK timeout.
      await dispatched;
      vi.advanceTimersByTime(11);
      expect(await outcome).toMatchObject({ reason: 'storage-unresolved' });
      expect(sawAbort).toBe(true);
      resolvePut({ $metadata: { httpStatusCode: 200 }, ETag: '"late"' });
      await Promise.resolve();
      expect(await outcome).toMatchObject({ reason: 'storage-unresolved' });
    } finally { vi.useRealTimers(); }
  });

  it('共有external budgetは全SDK送信前に実行されmarker保存後の上限でも保留を返す', async () => {
    const model = new StorageModel(); let calls = 0;
    const storage = model.storage();
    await expect(storage.fenceAndErase(intent(), { remainingTimeMs: () => 1_000,
      beforeRequest: () => { calls += 1; if (calls > 2) throw new Error('budget'); },
    })).rejects.toMatchObject({ reason: 'storage-unresolved' });
    expect(calls).toBe(3);
    expect(model.commands).toHaveLength(2);
    expect(model.versions[0].metadata['lyra-kind']).toBe('marker');
    expect(await storage.fenceAndErase(intent())).toMatchObject({ historyErased: true });
  });

  it('残時間0または内部request上限では追加送信しない', async () => {
    const model = new StorageModel();
    await expect(model.storage().observe(intent(), { beforeRequest: (): void => {}, remainingTimeMs: () => 0 }))
      .rejects.toMatchObject({ reason: 'storage-unresolved' });
    expect(model.commands).toHaveLength(0);
    await expect(model.storage({ maxRequests: 1 }).fenceAndErase(intent())).rejects.toMatchObject({ reason: 'storage-unresolved' });
    expect(model.commands).toHaveLength(1);
  });

  it('SDKのretry設定が単回でなければ送信を拒否する', async () => {
    const model = new StorageModel(); const imageCreator = model.client('image');
    imageCreator.config.maxAttempts = 3;
    const storage = new FencedStateReferenceStorage({ sourceReader: model.client('source'), imageCreator,
      recovery: model.client('recovery') }, { bucketName: 'local-only', environmentAssumptions: assumptions });
    await expect(storage.createImage({ intent: intent(), imageData: png })).rejects.toMatchObject({ reason: 'unsafe-environment' });
    expect(model.commands).toHaveLength(0);
  });

  it.each([
    { protocol: 'legacy' }, { s3Key: 'saved/user/entities/entity/image.png' },
    { ownerUserId: '44444444-4444-4444-8444-444444444444' }, { attemptToken: 'not-uuid' },
    { digest: 'unknown' }, { sizeBytes: OPENAI_INPUT_IMAGE_MAX_BYTES + 1 },
  ])('legacyまたは不正intentの場合はSDKを呼ばない: %j', async (invalid) => {
    const model = new StorageModel();
    await expect(model.storage().observe({ ...intent(), ...invalid } as FencedStateReferenceIntent))
      .rejects.toMatchObject({ reason: 'invalid-intent' });
    expect(model.commands).toHaveLength(0);
  });

  it('version履歴を全page列挙して画像のexact versionのみ消し現在markerを残す', async () => {
    const model = new StorageModel(); model.versioned = true;
    const storage = model.storage();
    const image = await storage.createImage({ intent: intent(), imageData: png });
    expect(await storage.fenceAndErase(intent())).toMatchObject({ kind: 'marker', historyErased: true });
    const deletes = model.commands.filter(({ command }) => command instanceof DeleteObjectCommand);
    expect(deletes).toHaveLength(1);
    expect((deletes[0].command as DeleteObjectCommand).input).toEqual({ Bucket: 'local-only', Key: intent().s3Key, VersionId: image.versionId });
    expect(model.versions).toHaveLength(1);
    expect(model.versions[0].metadata['lyra-kind']).toBe('marker');
    expect(model.commands.filter(({ command }) => command instanceof ListObjectVersionsCommand).length).toBeGreaterThanOrEqual(3);
  });

  it.each(['unknown', 'locked', 'replica', 'list-failure', 'delete-failure'])('消去を証明できない履歴 %s は保留を維持する', async (failure) => {
    const model = new StorageModel(); model.versioned = true;
    const storage = model.storage();
    await storage.createImage({ intent: intent(), imageData: png });
    await storage.fenceAndErase(intent());
    const marker = model.versions[0];
    model.versions.unshift({ ...marker, id: 'history', body: png,
      contentType: 'image/png', metadata: failure === 'unknown' ? {} : {
        'lyra-protocol': intent().protocol, 'lyra-attempt': intent().attemptToken,
        'lyra-kind': 'image', 'lyra-digest': digest, 'lyra-bytes': String(png.length), 'lyra-mime': 'image/png',
      }, extra: failure === 'locked' ? { ObjectLockLegalHoldStatus: 'ON' }
        : failure === 'replica' ? { ReplicationStatus: 'COMPLETED' } : {} });
    model.failList = failure === 'list-failure'; model.failDelete = failure === 'delete-failure';
    await expect(storage.fenceAndErase(intent())).rejects.toMatchObject({ code: 'FENCED_STORAGE_BLOCKED' });
    expect(model.versions.at(-1)).toBe(marker);
  });

  it('suspended bucketの現在null-version markerを保持し過去画像を消す', async () => {
    const model = new StorageModel(); model.versioned = true;
    const storage = model.storage({ environmentAssumptions: { ...assumptions, versioning: 'suspended' } });
    await storage.createImage({ intent: intent(), imageData: png });
    const originalStore = model.store.bind(model);
    model.store = (body, metadata, contentType): StoredVersion => {
      const version = originalStore(body, metadata, contentType);
      if (metadata['lyra-kind'] === 'marker') version.id = 'null';
      return version;
    };
    expect(await storage.fenceAndErase(intent())).toMatchObject({ versionId: 'null', historyErased: true });
    expect(model.versions.map((version) => version.id)).toEqual(['null']);
    expect(model.commands.filter(({ command }) => command instanceof DeleteObjectCommand)
      .some(({ command }) => (command as DeleteObjectCommand).input.VersionId === 'null')).toBe(false);
  });

  it('version page上限を超えた場合は消去せずmarkerを保持する', async () => {
    const model = new StorageModel(); model.versioned = true;
    const storage = model.storage({ maxVersionPages: 1 });
    await storage.createImage({ intent: intent(), imageData: png });
    await expect(storage.fenceAndErase(intent())).rejects.toMatchObject({ reason: 'history-blocked' });
    expect(model.commands.filter(({ command }) => command instanceof DeleteObjectCommand)).toHaveLength(0);
    expect(model.versions.at(-1)?.metadata['lyra-kind']).toBe('marker');
  });

  it.each(['delete-marker', 'looping-cursor'])('未知のversion履歴 %s を保留にする', async (invalid) => {
    const model = new StorageModel(); model.versioned = true;
    const recovery = model.client('recovery');
    const guarded: FencedStorageClient = { ...recovery, send: async (command, options): Promise<unknown> => {
      const result = await recovery.send(command, options);
      if (!(command instanceof ListObjectVersionsCommand)) return result;
      return invalid === 'delete-marker' ? { ...result as object, DeleteMarkers: [{ Key: intent().s3Key, VersionId: 'delete-version' }] }
        : { $metadata: { httpStatusCode: 200 }, IsTruncated: true, NextKeyMarker: intent().s3Key, NextVersionIdMarker: 'repeat' };
    } };
    const storage = new FencedStateReferenceStorage({ sourceReader: model.client('source'),
      imageCreator: model.client('image'), recovery: guarded }, {
      bucketName: 'local-only', environmentAssumptions: { ...assumptions, versioning: 'versioned' },
    });
    await expect(storage.fenceAndErase(intent())).rejects.toMatchObject({ reason: 'history-blocked' });
    expect(model.commands.filter(({ command }) => command instanceof DeleteObjectCommand)).toHaveLength(0);
    expect(model.versions.at(-1)?.metadata['lyra-kind']).toBe('marker');
  });
});
