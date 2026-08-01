import { describe, expect, it, vi } from 'vitest';

import {
  DirectEntityUploadError,
  uploadAndImportEntityReference,
  type BinaryUploadSource,
  type BinaryUploadTask
} from '@/lib/directEntityReferenceUpload';

const presignResult = {
  upload_url: 'https://uploads.example.test/entity-reference?signature=opaque',
  upload_token: 'opaque-upload-token',
  expires_at: '2026-07-25T00:05:00.000Z',
  upload_headers: {
    'Content-Type': 'image/png' as const,
    'x-amz-server-side-encryption': 'AES256' as const
  }
};

interface TaskHarness {
  source: BinaryUploadSource;
  uploadAsync: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  emitProgress: (bytesSent: number, totalBytes: number) => void;
}

const createTaskHarness = (): TaskHarness => {
  let progress: ((input: { bytesSent: number; totalBytes: number }) => void) | undefined;
  const uploadAsync = vi.fn<BinaryUploadTask['uploadAsync']>().mockResolvedValue({
    body: '',
    headers: {},
    status: 200
  });
  const cancel = vi.fn();
  const release = vi.fn();
  const source: BinaryUploadSource = {
    createUploadTask: vi.fn((input) => {
      progress = input.onProgress;
      return { uploadAsync, cancel, release };
    })
  };
  return {
    source,
    uploadAsync,
    cancel,
    release,
    emitProgress: (bytesSent, totalBytes) => progress?.({ bytesSent, totalBytes })
  };
};

describe('direct entity reference upload', () => {
  it('PUTの2xx完了後だけupload tokenで解析を開始する', async () => {
    const task = createTaskHarness();
    const order: string[] = [];
    task.uploadAsync.mockImplementation(async () => {
      order.push('upload');
      return { body: '', headers: {}, status: 200 };
    });
    const createPresignedUpload = vi.fn(async () => {
      order.push('presign');
      return presignResult;
    });
    const finalizeImport = vi.fn(async (uploadToken: string) => {
      order.push(`finalize:${uploadToken}`);
      return { suggested_fields: { hair: 'black' } };
    });
    const onFinalizeTokenReady = vi.fn();

    const result = await uploadAndImportEntityReference({
      createPresignedUpload,
      entityId: 'entity-1',
      entityType: 'character',
      finalizeImport,
      mimeType: 'image/png',
      onProgress: vi.fn(),
      onStageChange: vi.fn(),
      onFinalizeTokenReady,
      sizeBytes: 1024,
      source: task.source
    });

    expect(result).toEqual({ suggested_fields: { hair: 'black' } });
    expect(order).toEqual(['presign', 'upload', 'finalize:opaque-upload-token']);
    expect(createPresignedUpload).toHaveBeenCalledWith({
      entity_id: 'entity-1',
      mime_type: 'image/png',
      size_bytes: 1024
    });
    expect(task.source.createUploadTask).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: presignResult.upload_headers,
        mimeType: 'image/png',
        url: presignResult.upload_url
      })
    );
    expect(task.release).toHaveBeenCalledTimes(1);
    expect(onFinalizeTokenReady).toHaveBeenCalledWith('opaque-upload-token');
  });

  it('finalize再確認では既存tokenを使いpresignとPUTを繰り返さない', async () => {
    const task = createTaskHarness();
    const createPresignedUpload = vi.fn();
    const finalizeImport = vi.fn().mockResolvedValue({ ok: true });

    await expect(
      uploadAndImportEntityReference({
        createPresignedUpload,
        entityId: null,
        entityType: 'character',
        finalizeImport,
        mimeType: 'image/png',
        onFinalizeTokenReady: vi.fn(),
        onProgress: vi.fn(),
        onStageChange: vi.fn(),
        resumeFinalizeToken: 'existing-upload-token',
        sizeBytes: 1024,
        source: task.source
      })
    ).resolves.toEqual({ ok: true });

    expect(createPresignedUpload).not.toHaveBeenCalled();
    expect(task.source.createUploadTask).not.toHaveBeenCalled();
    expect(finalizeImport).toHaveBeenCalledWith('existing-upload-token');
  });

  it('進捗を0から100の範囲へ正規化して通知する', async () => {
    const task = createTaskHarness();
    const progress = vi.fn();
    task.uploadAsync.mockImplementation(async () => {
      task.emitProgress(512, 1024);
      task.emitProgress(2048, 1024);
      return { body: '', headers: {}, status: 204 };
    });

    await uploadAndImportEntityReference({
      createPresignedUpload: vi.fn().mockResolvedValue(presignResult),
      entityId: null,
      entityType: 'character',
      finalizeImport: vi.fn().mockResolvedValue({ ok: true }),
      mimeType: 'image/png',
      onProgress: progress,
      onStageChange: vi.fn(),
      sizeBytes: 1024,
      source: task.source
    });

    expect(progress.mock.calls.map(([value]) => value)).toEqual([50, 100]);
  });

  it('PUT失敗時は解析せずnetwork retry可能なエラーを返す', async () => {
    const task = createTaskHarness();
    task.uploadAsync.mockResolvedValue({ body: '', headers: {}, status: 503 });
    const finalizeImport = vi.fn();

    await expect(
      uploadAndImportEntityReference({
        createPresignedUpload: vi.fn().mockResolvedValue(presignResult),
        entityId: null,
        entityType: 'character',
        finalizeImport,
        mimeType: 'image/png',
        onProgress: vi.fn(),
        onStageChange: vi.fn(),
        sizeBytes: 1024,
        source: task.source
      })
    ).rejects.toMatchObject<Partial<DirectEntityUploadError>>({
      code: 'UPLOAD_FAILED',
      retryable: true,
      stage: 'upload'
    });
    expect(finalizeImport).not.toHaveBeenCalled();
  });

  it('cancel signalでnative taskを中止し解析を開始しない', async () => {
    const task = createTaskHarness();
    const controller = new AbortController();
    task.uploadAsync.mockImplementation(
      () =>
        new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        })
    );
    const finalizeImport = vi.fn();
    const operation = uploadAndImportEntityReference({
      createPresignedUpload: vi.fn().mockResolvedValue(presignResult),
      entityId: null,
      entityType: 'character',
      finalizeImport,
      mimeType: 'image/png',
      onProgress: vi.fn(),
      onStageChange: vi.fn(),
      signal: controller.signal,
      sizeBytes: 1024,
      source: task.source
    });

    await vi.waitFor(() => expect(task.uploadAsync).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(operation).rejects.toMatchObject<Partial<DirectEntityUploadError>>({
      code: 'UPLOAD_CANCELED',
      retryable: false
    });
    expect(task.cancel).toHaveBeenCalledTimes(1);
    expect(task.release).toHaveBeenCalledTimes(1);
    expect(finalizeImport).not.toHaveBeenCalled();
  });

  it('解析結果の通信確認に失敗した場合は同じtokenで安全に再確認できる', async () => {
    const task = createTaskHarness();

    await expect(
      uploadAndImportEntityReference({
        createPresignedUpload: vi.fn().mockResolvedValue(presignResult),
        entityId: null,
        entityType: 'character',
        finalizeImport: vi.fn().mockRejectedValue(new TypeError('network unavailable')),
        mimeType: 'image/png',
        onProgress: vi.fn(),
        onStageChange: vi.fn(),
        sizeBytes: 1024,
        source: task.source
      })
    ).rejects.toMatchObject<Partial<DirectEntityUploadError>>({
      code: 'FINALIZE_UNCERTAIN',
      retryable: true,
      stage: 'finalize'
    });
  });
});
