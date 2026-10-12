import { File, UploadType } from 'expo-file-system';

import type { EntityReferenceUploadMimeType } from '@/domain/payloads';
import type { BinaryUploadSource } from '@/lib/directEntityReferenceUpload';

export interface ExpoBinaryUploadFile {
  exists: boolean;
  sizeBytes: number;
  source: BinaryUploadSource;
  detectMimeType: () => Promise<EntityReferenceUploadMimeType | null>;
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
    detectMimeType: async () => {
      const bytes = await file.bytes();
      return detectEntityReferenceMimeType(bytes.subarray(0, 12));
    }
  };
}

export function detectEntityReferenceMimeType(bytes: Uint8Array): EntityReferenceUploadMimeType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}
