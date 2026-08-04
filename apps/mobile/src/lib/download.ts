import { File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

import type { AuthTokens } from '@/domain/types';
import { config } from '@/lib/config';
import { MobileFileTransferError } from '@/lib/fileTransferError';

interface DownloadAuthenticatedFileParams {
  path: string;
  filename: string;
  tokens: AuthTokens | null;
  mimeType: string;
}

interface DownloadExternalFileParams {
  url: string;
  filename: string;
  mimeType: string;
}

export interface ImageDownloadSource {
  url: string;
  headers?: Record<string, string>;
}

interface SaveImageToPhotoLibraryParams {
  filename: string;
  mimeType: string;
  sources: readonly ImageDownloadSource[];
}

interface SaveImageBlobToPhotoLibraryParams {
  filename: string;
  mimeType: string;
  blob: Blob;
}

const extensionFromMimeType = (mimeType: string): string => {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'application/zip') return 'zip';
  if (mimeType === 'text/csv') return 'csv';
  return 'bin';
};

export const normalizeDownloadFilename = (
  filename: string,
  extension: string,
  fallbackStem: string
): string => {
  const safeExtension = extension.replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || 'bin';
  const basename = filename.trim().replace(/\\/g, '/').split('/').at(-1) ?? '';
  const stem = basename
    .replace(/\.[A-Za-z0-9]{1,10}$/u, '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, Math.max(1, 80 - safeExtension.length - 1));
  const safeStem = stem === '.' || stem === '..' || stem.length === 0 ? fallbackStem : stem;
  return `${safeStem}.${safeExtension}`;
};

const assertSuccessfulDownload = (status: number): void => {
  if (status < 200 || status >= 300) {
    throw new Error(`File download failed with status ${status}.`);
  }
};

const filenameForSourceAttempt = (filename: string, attemptIndex: number, sourceCount: number): string => {
  if (sourceCount <= 1) {
    return filename;
  }
  const extensionIndex = filename.lastIndexOf('.');
  if (extensionIndex <= 0) {
    return `${filename}-candidate-${attemptIndex + 1}`;
  }
  return `${filename.slice(0, extensionIndex)}-candidate-${attemptIndex + 1}${filename.slice(extensionIndex)}`;
};

export const classifyFileTransferFailure = (error: unknown): MobileFileTransferError => {
  if (error instanceof MobileFileTransferError) {
    return error;
  }
  const name = error instanceof Error ? error.name.toLowerCase() : '';
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const detail = `${name} ${message}`;
  if (/(cancelled|canceled|user cancel|aborterror)/u.test(detail)) {
    return new MobileFileTransferError('DOWNLOAD_CANCELED');
  }
  if (/(no space|storage full|disk full|enospc|out of storage)/u.test(detail)) {
    return new MobileFileTransferError('STORAGE_FULL');
  }
  if (/(sharing.*unavailable|share.*unavailable|sharing is not available)/u.test(detail)) {
    return new MobileFileTransferError('SHARING_UNAVAILABLE');
  }
  if (/(network|offline|failed to fetch|connection|timed out|timeout|dns|unreachable)/u.test(detail)) {
    return new MobileFileTransferError('NETWORK_UNAVAILABLE');
  }
  return new MobileFileTransferError('DOWNLOAD_INTERRUPTED');
};

export async function downloadAuthenticatedFile({
  path,
  filename,
  tokens,
  mimeType
}: DownloadAuthenticatedFileParams): Promise<string> {
  const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (directory === null) {
    throw new MobileFileTransferError('STORAGE_FULL');
  }

  const safeFilename = normalizeDownloadFilename(filename, extensionFromMimeType(mimeType), 'lyra-download');
  const fileUri = `${directory}${safeFilename}`;
  const baseUrl = config.apiBaseUrl.replace(/\/+$/, '');
  const headers = tokens === null ? undefined : { Authorization: `Bearer ${tokens.idToken}` };
  try {
    const result = await FileSystem.downloadAsync(`${baseUrl}${path}`, fileUri, { headers });
    assertSuccessfulDownload(result.status);
    if (!(await Sharing.isAvailableAsync())) {
      throw new MobileFileTransferError('SHARING_UNAVAILABLE');
    }
    await Sharing.shareAsync(result.uri, { mimeType });
    return result.uri;
  } catch (error) {
    throw classifyFileTransferFailure(error);
  }
}

export async function saveAuthenticatedImageToPhotoLibrary({
  path,
  filename,
  tokens,
  mimeType
}: DownloadAuthenticatedFileParams): Promise<string> {
  const baseUrl = config.apiBaseUrl.replace(/\/+$/, '');
  const headers = tokens === null ? undefined : { Authorization: `Bearer ${tokens.idToken}` };

  return saveImageToPhotoLibrary({
    filename,
    mimeType,
    sources: [{ url: `${baseUrl}${path}`, headers }]
  });
}

export async function saveImageToPhotoLibrary({
  filename,
  mimeType,
  sources
}: SaveImageToPhotoLibraryParams): Promise<string> {
  const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (directory === null) {
    throw new MobileFileTransferError('STORAGE_FULL');
  }
  if (sources.length === 0) {
    throw new MobileFileTransferError('DOWNLOAD_INTERRUPTED');
  }

  const safeFilename = normalizeDownloadFilename(filename, extensionFromMimeType(mimeType), 'lyra-image');
  let downloadedUri: string | null = null;
  let lastFailure: unknown = new MobileFileTransferError('DOWNLOAD_INTERRUPTED');

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = sources[sourceIndex];
    if (!source.url.startsWith('https://')) {
      lastFailure = new MobileFileTransferError('DOWNLOAD_INTERRUPTED');
      continue;
    }
    try {
      const fileUri = `${directory}${filenameForSourceAttempt(safeFilename, sourceIndex, sources.length)}`;
      const result = await FileSystem.downloadAsync(source.url, fileUri, { headers: source.headers });
      assertSuccessfulDownload(result.status);
      downloadedUri = result.uri;
      break;
    } catch (error) {
      const failure = classifyFileTransferFailure(error);
      if (failure.code === 'DOWNLOAD_CANCELED' || failure.code === 'STORAGE_FULL') {
        throw failure;
      }
      lastFailure = failure;
    }
  }

  if (downloadedUri === null) {
    throw classifyFileTransferFailure(lastFailure);
  }

  try {
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (!permission.granted) {
      throw new MobileFileTransferError('PHOTO_LIBRARY_PERMISSION_DENIED');
    }
    try {
      await MediaLibrary.Asset.create(downloadedUri);
    } catch (error) {
      const failure = classifyFileTransferFailure(error);
      if (failure.code === 'DOWNLOAD_INTERRUPTED') {
        throw new MobileFileTransferError('IMAGE_SAVE_FAILED');
      }
      throw failure;
    }
    return downloadedUri;
  } catch (error) {
    throw classifyFileTransferFailure(error);
  }
}

/**
 * Saves already-authenticated image bytes to the device photo library.
 *
 * Page images use the API client's authenticated fetch path before this helper
 * is invoked. That makes token refresh and image saving follow the same
 * behavior on Android and iOS instead of handing a possibly-expired token to
 * a platform-specific downloader.
 */
export async function saveImageBlobToPhotoLibrary({
  filename,
  mimeType,
  blob
}: SaveImageBlobToPhotoLibraryParams): Promise<string> {
  const safeFilename = normalizeDownloadFilename(filename, extensionFromMimeType(mimeType), 'lyra-image');

  try {
    const file = new File(Paths.cache, safeFilename);
    if (file.exists) {
      file.delete();
    }
    file.write(new Uint8Array(await blob.arrayBuffer()));

    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (!permission.granted) {
      throw new MobileFileTransferError('PHOTO_LIBRARY_PERMISSION_DENIED');
    }
    await MediaLibrary.Asset.create(file.uri);
    return file.uri;
  } catch (error) {
    const failure = classifyFileTransferFailure(error);
    if (failure.code === 'DOWNLOAD_INTERRUPTED') {
      throw new MobileFileTransferError('IMAGE_SAVE_FAILED');
    }
    throw failure;
  }
}

export async function downloadExternalFile({
  url,
  filename,
  mimeType
}: DownloadExternalFileParams): Promise<string> {
  if (!url.startsWith('https://')) {
    throw new MobileFileTransferError('DOWNLOAD_INTERRUPTED');
  }
  const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (directory === null) {
    throw new MobileFileTransferError('STORAGE_FULL');
  }

  const safeFilename = normalizeDownloadFilename(filename, extensionFromMimeType(mimeType), 'lyra-export');
  const fileUri = `${directory}${safeFilename}`;
  let result: FileSystem.FileSystemDownloadResult;
  try {
    result = await FileSystem.downloadAsync(url, fileUri);
    assertSuccessfulDownload(result.status);
  } catch (error) {
    throw classifyFileTransferFailure(error);
  }

  try {
    if (!(await Sharing.isAvailableAsync())) {
      throw new MobileFileTransferError('SHARING_UNAVAILABLE');
    }
    await Sharing.shareAsync(result.uri, { mimeType });
  } catch (error) {
    throw classifyFileTransferFailure(error);
  }
  return result.uri;
}

export const appendOrganizationQuery = (path: string, organizationId: string | null): string => {
  if (organizationId === null || organizationId.trim().length === 0) {
    return path;
  }
  return `${path}${path.includes('?') ? '&' : '?'}organization_id=${encodeURIComponent(organizationId)}`;
};
