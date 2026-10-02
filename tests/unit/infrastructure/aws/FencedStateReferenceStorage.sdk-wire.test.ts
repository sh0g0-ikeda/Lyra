import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { FencedStateReferenceStorage, type FencedStateReferenceIntent } from '../../../../src/infrastructure/aws/FencedStateReferenceStorage.js';
import { buildFencedStateReferenceKey, STATE_REFERENCE_COPY_V2_PROTOCOL } from '../../../../src/domain/state/FencedStateReferenceKey.js';

const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#836fab' } }).png().toBuffer();
const scope = {
  ownerUserId: '11111111-1111-4111-8111-111111111111',
  entityId: '22222222-2222-4222-8222-222222222222',
  attemptToken: '33333333-3333-4333-8333-333333333333', mimeType: 'image/png' as const,
};
const intent: FencedStateReferenceIntent = { ...scope, protocol: STATE_REFERENCE_COPY_V2_PROTOCOL,
  s3Key: buildFencedStateReferenceKey(scope), sizeBytes: png.length,
  digest: createHash('sha256').update(png).digest('hex'), sourceRevision: { eTag: '"source"' } };

interface WireRequest { method: string; path: string; headers: Record<string, string>; body?: unknown }
interface WireObject { body: Buffer; headers: Record<string, string> }

/** Real SDK serializer, synthetic request handler. No network transport exists here. */
function fixture(): {
  storage: FencedStateReferenceStorage;
  requests: Array<{ role: string; request: WireRequest }>;
  failNextPut(): void;
  destroy(): void;
} {
  const requests: Array<{ role: string; request: WireRequest }> = [];
  let current: WireObject | undefined;
  let failPut = false;
  let serial = 0;
  function client(role: string): S3Client {
    return new S3Client({ region: 'ap-northeast-1', endpoint: 'https://offline.invalid', maxAttempts: 1,
      credentials: { accessKeyId: 'SYNTHETIC_LOCAL_ONLY', secretAccessKey: 'SYNTHETIC_LOCAL_ONLY' },
      requestHandler: {
        handle: async (request: WireRequest) => {
          requests.push({ role, request });
          if (request.method === 'PUT') {
            if (failPut) return { response: { statusCode: 503, headers: { 'content-type': 'application/xml' },
              body: Readable.from(['<Error><Code>ServiceUnavailable</Code><Message>synthetic</Message></Error>']) } };
            const preconditionFails = (request.headers['if-none-match'] === '*' && current !== undefined)
              || (request.headers['if-match'] !== undefined && request.headers['if-match'] !== current?.headers.etag);
            if (preconditionFails) return { response: { statusCode: 412, headers: { 'content-type': 'application/xml' },
              body: Readable.from(['<Error><Code>PreconditionFailed</Code></Error>']) } };
            if (!(request.body instanceof Uint8Array)) throw new Error('Expected a bounded binary PUT body');
            serial += 1;
            const headers: Record<string, string> = { etag: `"wire-${serial}"`,
              'content-type': request.headers['content-type'], 'content-length': String(request.body.byteLength) };
            for (const [key, value] of Object.entries(request.headers)) {
              if (key.startsWith('x-amz-meta-')) headers[key] = value;
            }
            current = { body: Buffer.from(request.body), headers };
            return { response: { statusCode: 200, headers: { etag: headers.etag }, body: Readable.from([]) } };
          }
          if (request.method !== 'GET') throw new Error(`Unexpected wire method ${request.method}`);
          if (!current) return { response: { statusCode: 404, headers: { 'content-type': 'application/xml' },
            body: Readable.from(['<Error><Code>NoSuchKey</Code></Error>']) } };
          return { response: { statusCode: 200, headers: current.headers, body: Readable.from([current.body]) } };
        }, destroy: (): void => {},
      },
    });
  }
  const sourceReader = client('source'); const imageCreator = client('image'); const recovery = client('recovery');
  return { requests,
    storage: new FencedStateReferenceStorage({ sourceReader, imageCreator, recovery }, {
      bucketName: 'synthetic-local-only', expectedBucketOwner: '123456789012', environmentAssumptions: { versioning: 'never-versioned',
        exclusiveConditionalImageWriters: true, ordinaryMarkersRetained: true, noUnmanagedReplicationOrRestore: true },
    }),
    failNextPut: (): void => { failPut = true; },
    destroy: (): void => { sourceReader.destroy(); imageCreator.destroy(); recovery.destroy(); },
  };
}

describe('FencedStateReferenceStorage の実SDK wire契約（外部通信なし）', () => {
  it('画像作成とmarker置換の条件header・metadata・空bodyをserializeする', async () => {
    const local = fixture();
    try {
      const image = await local.storage.createImage({ intent, imageData: png });
      const fenced = await local.storage.fenceAndErase(intent);
      expect(fenced.historyErased).toBe(true);
      const puts = local.requests.filter(({ request }) => request.method === 'PUT');
      expect(puts).toHaveLength(2);
      expect(puts[0].role).toBe('image');
      expect(puts[0].request.headers['if-none-match']).toBe('*');
      expect(puts[0].request.headers['if-match']).toBeUndefined();
      expect(puts[0].request.headers['x-amz-meta-lyra-digest']).toBe(intent.digest);
      expect(puts[0].request.headers['x-amz-checksum-sha256']).toBe(Buffer.from(intent.digest, 'hex').toString('base64'));
      expect(puts[1].role).toBe('recovery');
      expect(puts[1].request.headers['if-match']).toBe(image.eTag);
      expect(puts[1].request.headers['if-none-match']).toBeUndefined();
      expect(puts[1].request.body).toEqual(Buffer.alloc(0));
      expect(Object.keys(puts[1].request.headers).filter((key) => key.startsWith('x-amz-meta-')).sort()).toEqual([
        'x-amz-meta-lyra-attempt', 'x-amz-meta-lyra-kind', 'x-amz-meta-lyra-protocol',
      ]);
      expect(puts[1].request.path).toBe(puts[0].request.path);
      expect(local.requests.every(({ request }) => request.headers['x-amz-expected-bucket-owner'] === '123456789012')).toBe(true);
    } finally { local.destroy(); }
  });

  it('不在keyのmarkerはIf-None-Matchを送る', async () => {
    const local = fixture();
    try {
      await local.storage.fenceAndErase(intent);
      const put = local.requests.find(({ request }) => request.method === 'PUT')!.request;
      expect(put.headers['if-none-match']).toBe('*');
      expect(put.body).toEqual(Buffer.alloc(0));
    } finally { local.destroy(); }
  });

  it('503でもSDK handler呼出しは単回で成功receiptを返さない', async () => {
    const local = fixture();
    try {
      local.failNextPut();
      await expect(local.storage.createImage({ intent, imageData: png })).rejects.toMatchObject({ reason: 'storage-unresolved' });
      expect(local.requests).toHaveLength(1);
      expect(local.requests[0].request.method).toBe('PUT');
    } finally { local.destroy(); }
  });
});
