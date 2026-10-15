import { File, UploadType } from 'expo-file-system';

import type { EntityReferenceUploadMimeType } from '@/domain/payloads';
import type { BinaryUploadSource } from '@/lib/directEntityReferenceUpload';

export interface ExpoBinaryUploadFile {
  exists: boolean;
  sizeBytes: number;
  source: BinaryUploadSource;
  readBytes: () => Promise<Uint8Array>;
  detectMimeType: () => Promise<EntityReferenceUploadMimeType | null>;
  dispose: () => void;
}

export function createExpoBinaryUploadFile(uri: string): ExpoBinaryUploadFile {
  const file = new File(uri);
  return {
    exists: file.exists,
    sizeBytes: file.size,
    source: {
      createUploadTask: ({ url, headers, mimeType, signal, onProgress }) =>
        file.createUploadTask(url, {
          headers,
          httpMethod: 'PUT',
          mimeType,
          onProgress,
          sessionType: 'foreground',
          signal,
          uploadType: UploadType.BINARY_CONTENT
        })
    },
    readBytes: async () => new Uint8Array(await file.bytes()),
    detectMimeType: async () => {
      const bytes = await file.bytes();
      return detectEntityReferenceMimeType(bytes.subarray(0, 12));
    },
    dispose: () => { file.delete(); }
  };
}

export function detectEntityReferenceMimeType(bytes: Uint8Array): EntityReferenceUploadMimeType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

const heifBrands = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'heif']);
const incompatibleIsoBmffBrands = new Set(['avif', 'avis', 'av01', 'avc1', 'hvc1', 'hev1', 'mp41', 'mp42', 'isom', 'iso2', 'qt  ']);

/** Identifies only image HEIF brands in the bounded ISO-BMFF ftyp header; AVIF and video brands stay unsupported. */
export function isEntityReferenceHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) return false;
  const boxSize = (bytes[0]! * 0x1000000) + (bytes[1]! * 0x10000) + (bytes[2]! * 0x100) + bytes[3]!;
  if (boxSize < 16 || boxSize > bytes.length || boxSize > 64) return false;
  const limit = boxSize;
  const brandAt = (offset: number): string => String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
  let heif = false;
  for (let offset = 8; offset + 4 <= limit; offset += 4) {
    if (offset === 12) continue;
    const brand = brandAt(offset);
    if (incompatibleIsoBmffBrands.has(brand)) return false;
    if (heifBrands.has(brand)) heif = true;
  }
  return heif;
}
