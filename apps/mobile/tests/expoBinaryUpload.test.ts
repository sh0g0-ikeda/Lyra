import { describe, expect, it, vi } from 'vitest';
import { createExpoBinaryUploadFile, detectEntityReferenceMimeType, isEntityReferenceHeif } from '@/lib/expoBinaryUpload';

const mocks = vi.hoisted(() => ({ File: vi.fn(), bytes: vi.fn(), createUploadTask: vi.fn() }));

vi.mock('expo-file-system', () => ({ File: class { public constructor(...args: unknown[]) { return mocks.File(...args); } }, UploadType: { BINARY_CONTENT: 'BINARY_CONTENT' } }));


describe('Expo binary upload file', () => {
  it.each([
    ['PNG', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    ['JPEG', Uint8Array.from([0xff, 0xd8, 0xff]), 'image/jpeg'],
    ['WebP', Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]), 'image/webp'],
  ] as const)('%s signatureだけを受理する', (_name, bytes, expected) => {
    expect(detectEntityReferenceMimeType(bytes)).toBe(expected);
  });

  it.each([
    Uint8Array.from([]),
    Uint8Array.from([0x89, 0x50, 0x4e]),
    Uint8Array.from([0x47, 0x49, 0x46, 0x38]),
    Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42]),
  ])('短い又は未対応のsignatureは拒否する', (bytes) => {
    expect(detectEntityReferenceMimeType(bytes)).toBeNull();
  });

  it('bounded HEIF ftyp brandだけを変換候補として識別しAVIFを誤受理しない', () => {
    const heic = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 0x6d, 0x69, 0x66, 0x31, 0, 0, 0, 0]);
    const avifWithHeicCompatible = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
    const malformed = Uint8Array.from([0, 0, 0, 64, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
    expect(isEntityReferenceHeif(heic)).toBe(true); expect(isEntityReferenceHeif(avifWithHeicCompatible)).toBe(false); expect(isEntityReferenceHeif(malformed)).toBe(false);
  });

  it('同じcaptured FileのbytesだけでMIMEを検査しupload taskもそのFileに束縛する', async () => {
    const file = { exists: true, size: 42, bytes: mocks.bytes, createUploadTask: mocks.createUploadTask };
    mocks.File.mockImplementation(() => file);
    mocks.bytes.mockResolvedValue(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(20).fill(0xff)]));
    const upload = createExpoBinaryUploadFile('content://opaque');

    await expect(upload.detectMimeType()).resolves.toBe('image/png');
    await expect(upload.readBytes()).resolves.toEqual(expect.any(Uint8Array));
    upload.source.createUploadTask({ url: 'https://uploads.example.test/opaque', headers: {}, mimeType: 'image/png', onProgress: vi.fn() });
    expect(mocks.File).toHaveBeenCalledWith('content://opaque');
    expect(mocks.bytes).toHaveBeenCalledTimes(2);
    expect(mocks.createUploadTask).toHaveBeenCalledOnce();
  });

  it('File.bytesの読取失敗はそのまま呼出元へ返し、値を保持しない', async () => {
    mocks.File.mockImplementation(() => ({ exists: true, size: 42, bytes: mocks.bytes, createUploadTask: mocks.createUploadTask }));
    mocks.bytes.mockRejectedValue(new Error('private native file error'));

    await expect(createExpoBinaryUploadFile('content://opaque').detectMimeType()).rejects.toThrow('private native file error');
  });
});
