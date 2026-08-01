import { File, UploadType } from 'expo-file-system';

import type { BinaryUploadSource } from '@/lib/directEntityReferenceUpload';

export interface ExpoBinaryUploadFile {
  exists: boolean;
  sizeBytes: number;
  source: BinaryUploadSource;
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
    }
  };
}
