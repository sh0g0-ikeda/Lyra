import type { EntityReferenceUploadMimeType } from '@/domain/payloads';
import { createExpoBinaryUploadFile, detectEntityReferenceMimeType, isEntityReferenceHeif, type ExpoBinaryUploadFile } from '@/lib/expoBinaryUpload';
import type { ImageManipulatorContext, ImageRef } from 'expo-image-manipulator';

const maximumImageSizeBytes = 5 * 1024 * 1024;
export type EntityReferenceImagePreparationErrorCode = 'MIME_UNSUPPORTED' | 'FILE_UNREADABLE' | 'FILE_TOO_LARGE' | 'CONVERSION_FAILED';

export class EntityReferenceImagePreparationError extends Error {
  public constructor(public readonly code: EntityReferenceImagePreparationErrorCode) { super(code); this.name = 'EntityReferenceImagePreparationError'; }
}

export interface PreparedEntityReferenceImage {
  file: ExpoBinaryUploadFile;
  mimeType: EntityReferenceUploadMimeType;
  sizeBytes: number;
  dispose: () => void;
}

function assertReportedSize(file: ExpoBinaryUploadFile): void {
  if (!file.exists || file.sizeBytes <= 0) throw new EntityReferenceImagePreparationError('FILE_UNREADABLE');
  if (file.sizeBytes > maximumImageSizeBytes) throw new EntityReferenceImagePreparationError('FILE_TOO_LARGE');
}

function once(action: () => void): () => void {
  let done = false;
  return () => { if (done) return; done = true; try { action(); } catch { /* cache cleanup is best effort */ } };
}

async function bytesFor(file: ExpoBinaryUploadFile): Promise<Uint8Array> {
  try { return await file.readBytes(); } catch { throw new EntityReferenceImagePreparationError('FILE_UNREADABLE'); }
}

function assertActualSize(file: ExpoBinaryUploadFile, bytes: Uint8Array): number {
  if (bytes.length <= 0 || bytes.length > maximumImageSizeBytes || bytes.length !== file.sizeBytes) {
    throw new EntityReferenceImagePreparationError(bytes.length > maximumImageSizeBytes ? 'FILE_TOO_LARGE' : 'FILE_UNREADABLE');
  }
  return bytes.length;
}

/** Keeps JPEG/PNG/WebP bytes intact; transcodes only bounded, verified HEIC/HEIF input into a disposable JPEG cache file. */
export async function prepareEntityReferenceImage(uri: string): Promise<PreparedEntityReferenceImage> {
  let original: ExpoBinaryUploadFile;
  try { original = createExpoBinaryUploadFile(uri); assertReportedSize(original); } catch (error) {
    if (error instanceof EntityReferenceImagePreparationError) throw error;
    throw new EntityReferenceImagePreparationError('FILE_UNREADABLE');
  }
  const originalBytes = await bytesFor(original);
  const originalSize = assertActualSize(original, originalBytes);
  const supported = detectEntityReferenceMimeType(originalBytes.subarray(0, 12));
  if (supported !== null) return { file: original, mimeType: supported, sizeBytes: originalSize, dispose: () => undefined };
  if (!isEntityReferenceHeif(originalBytes.subarray(0, 64))) throw new EntityReferenceImagePreparationError('MIME_UNSUPPORTED');

  let context: ImageManipulatorContext | null = null;
  let image: ImageRef | null = null;
  let converted: ExpoBinaryUploadFile | null = null;
  try {
    const manipulator = await import('expo-image-manipulator');
    const nextContext = manipulator.ImageManipulator.manipulate(uri); context = nextContext;
    const nextImage = await nextContext.renderAsync(); image = nextImage;
    const result = await nextImage.saveAsync({ format: manipulator.SaveFormat.JPEG, compress: 0.9 });
    if (result.uri === uri) throw new EntityReferenceImagePreparationError('CONVERSION_FAILED');
    converted = createExpoBinaryUploadFile(result.uri);
    assertReportedSize(converted);
    const convertedBytes = await bytesFor(converted);
    const convertedSize = assertActualSize(converted, convertedBytes);
    if (detectEntityReferenceMimeType(convertedBytes.subarray(0, 12)) !== 'image/jpeg') throw new EntityReferenceImagePreparationError('CONVERSION_FAILED');
    const disposable = once(converted.dispose);
    return { file: converted, mimeType: 'image/jpeg', sizeBytes: convertedSize, dispose: disposable };
  } catch (error) {
    if (converted !== null) once(converted.dispose)();
    if (error instanceof EntityReferenceImagePreparationError) throw error;
    throw new EntityReferenceImagePreparationError('CONVERSION_FAILED');
  } finally {
    try { image?.release(); } catch { /* native shared refs must not mask stable input errors */ }
    try { context?.release(); } catch { /* native shared refs must not mask stable input errors */ }
  }
}
