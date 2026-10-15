import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareEntityReferenceImage } from '@/lib/prepareEntityReferenceImage';

const mocks = vi.hoisted(() => ({
  files: new Map<string, { exists: boolean; size: number; bytes: () => Promise<Uint8Array>; delete: () => void; createUploadTask: () => unknown }>(),
  manipulate: vi.fn(), render: vi.fn(), save: vi.fn(), contextRelease: vi.fn(), imageRelease: vi.fn()
}));

vi.mock('expo-file-system', () => ({
  File: class { public constructor(uri: string) { const file = mocks.files.get(uri); if (file === undefined) throw new Error('missing'); return file; } },
  UploadType: { BINARY_CONTENT: 'BINARY_CONTENT' }
}));
vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: mocks.manipulate },
  SaveFormat: { JPEG: 'jpeg' }
}));


const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const heic = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 0x6d, 0x69, 0x66, 0x31, 0, 0, 0, 0]);
function file(bytes: Uint8Array, size = bytes.length): { exists: boolean; size: number; bytes: () => Promise<Uint8Array>; delete: () => void; createUploadTask: () => unknown } {
  return { exists: true, size, bytes: vi.fn().mockResolvedValue(bytes), delete: vi.fn(), createUploadTask: vi.fn() };
}

describe('entity reference image preparation', () => {
  beforeEach(() => { mocks.files.clear(); vi.clearAllMocks(); });
  it('HEICは一度だけJPEGへ変換し、出力signatureと実sizeを検証してcacheだけを破棄する', async () => {
    const source = file(heic); const converted = file(jpeg, 4);
    mocks.files.set('file:///photo.heic', source); mocks.files.set('file:///cache.jpg', converted);
    const image = { saveAsync: mocks.save, release: mocks.imageRelease };
    mocks.manipulate.mockReturnValue({ renderAsync: mocks.render, release: mocks.contextRelease }); mocks.render.mockResolvedValue(image); mocks.save.mockResolvedValue({ uri: 'file:///cache.jpg' });

    const prepared = await prepareEntityReferenceImage('file:///photo.heic');
    expect(mocks.manipulate).toHaveBeenCalledOnce(); expect(mocks.save).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.9 });
    expect(prepared.mimeType).toBe('image/jpeg'); expect(prepared.sizeBytes).toBe(4); expect(source.delete).not.toHaveBeenCalled();
    prepared.dispose(); prepared.dispose();
    expect(converted.delete).toHaveBeenCalledOnce(); expect(mocks.contextRelease).toHaveBeenCalledOnce(); expect(mocks.imageRelease).toHaveBeenCalledOnce();
  });

  it.each([['JPEG', jpeg], ['PNG', png], ['WebP', Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])]])('%sは変換せず同じsourceを返す', async (_name, bytes) => {
    const source = file(bytes); mocks.files.set('file:///source', source);
    const prepared = await prepareEntityReferenceImage('file:///source');
    expect(mocks.manipulate).not.toHaveBeenCalled(); expect(prepared.sizeBytes).toBe(bytes.length); expect(prepared.mimeType).toMatch(/^image\/(jpeg|png|webp)$/u);
  });

  it('HEIC変換後の非JPEGをupload前に拒否してcacheを破棄する', async () => {
    mocks.files.set('file:///photo.heic', file(heic)); const converted = file(png); mocks.files.set('file:///cache.jpg', converted);
    const image = { saveAsync: mocks.save, release: mocks.imageRelease };
    mocks.manipulate.mockReturnValue({ renderAsync: mocks.render, release: mocks.contextRelease }); mocks.render.mockResolvedValue(image); mocks.save.mockResolvedValue({ uri: 'file:///cache.jpg' });
    await expect(prepareEntityReferenceImage('file:///photo.heic')).rejects.toMatchObject({ code: 'CONVERSION_FAILED' });
    expect(converted.delete).toHaveBeenCalledOnce();
  });

  it('HEIC変換後の実bytesが5MiB超ならupload前にcacheを破棄する', async () => {
    mocks.files.set('file:///photo.heic', file(heic)); const oversized = new Uint8Array(5 * 1024 * 1024 + 1); oversized.set(jpeg); const converted = file(oversized); mocks.files.set('file:///cache.jpg', converted);
    mocks.manipulate.mockReturnValue({ renderAsync: mocks.render, release: mocks.contextRelease }); mocks.render.mockResolvedValue({ saveAsync: mocks.save, release: mocks.imageRelease }); mocks.save.mockResolvedValue({ uri: 'file:///cache.jpg' });
    await expect(prepareEntityReferenceImage('file:///photo.heic')).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' }); expect(converted.delete).toHaveBeenCalledOnce();
  });
});
