import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { AuthTokens } from '@/domain/types';
import { config } from '@/lib/config';
import { MobileFileTransferError } from '@/lib/fileTransferError';

interface DownloadAuthenticatedFileParams {
  path: string;
  filename: string;
  tokens: AuthTokens | null;
  mimeType: string;
  refreshIdToken?: () => Promise<string | null>;
}

interface DownloadExternalFileParams {
  url: string;
  filename: string;
  mimeType: string;
}

export interface ImageDownloadSource {
  url: string;
  headers?: Record<string, string>;
  refreshHeaders?: () => Promise<Record<string, string> | undefined>;
}

interface SaveImageToPhotoLibraryParams {
  filename: string;
  mimeType: string;
  sources: readonly ImageDownloadSource[];
}

const extensionFromMimeType = (mimeType: string): string => {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'application/zip') return 'zip';
  if (mimeType === 'text/csv') return 'csv';
  return 'bin';
};

const supportedImageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

type DownloadedFileMimeType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

const decodeBase64Prefix = (value: string): number[] => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  let accumulator = 0;
  let bitCount = 0;

  for (const character of value.replace(/\s+/gu, '').replace(/=+$/u, '')) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) {
      return [];
    }
    accumulator = (accumulator << 6) | digit;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((accumulator >> bitCount) & 0xff);
      accumulator = bitCount === 0 ? 0 : accumulator & ((1 << bitCount) - 1);
    }
  }

  return bytes;
};

const hasBytePrefix = (bytes: readonly number[], signature: readonly number[]): boolean =>
  bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);

const detectDownloadedFileMimeType = async (uri: string): Promise<DownloadedFileMimeType | null> => {
  const encodedPrefix = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length: 12
  });
  const bytes = decodeBase64Prefix(encodedPrefix);
  if (hasBytePrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (hasBytePrefix(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (
    hasBytePrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.slice(8, 12).every((byte, index) => byte === [0x57, 0x45, 0x42, 0x50][index])
  ) {
    return 'image/webp';
  }
  if (hasBytePrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return 'application/pdf';
  }
  return null;
};

const moveDownloadedFileToMimeExtension = async (
  sourceUri: string,
  filename: string,
  directory: string,
  mimeType: string
): Promise<string> => {
  const expectedExtension = extensionFromMimeType(mimeType);
  const sourceExtension = sourceUri
    .split(/[?#]/u, 1)[0]
    .split('.')
    .at(-1)
    ?.toLowerCase();
  if (
    sourceExtension === expectedExtension ||
    (expectedExtension === 'jpg' && sourceExtension === 'jpeg')
  ) {
    return sourceUri;
  }
  const targetFilename = normalizeDownloadFilename(
    filename,
    expectedExtension,
    'lyra-image'
  );
  const targetUri = `${directory}${targetFilename}`;
  if (sourceUri === targetUri) {
    return sourceUri;
  }
  await FileSystem.deleteAsync(targetUri, { idempotent: true });
  await FileSystem.moveAsync({ from: sourceUri, to: targetUri });
  return targetUri;
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

const isAuthenticationFailureStatus = (status: number): boolean => status === 401 || status === 403;

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
  mimeType,
  refreshIdToken
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
    let result = await FileSystem.downloadAsync(`${baseUrl}${path}`, fileUri, { headers });
    if (isAuthenticationFailureStatus(result.status) && refreshIdToken !== undefined) {
      const refreshedToken = await refreshIdToken();
      if (refreshedToken !== null) {
        await FileSystem.deleteAsync(fileUri, { idempotent: true });
        result = await FileSystem.downloadAsync(`${baseUrl}${path}`, fileUri, {
          headers: { Authorization: `Bearer ${refreshedToken}` }
        });
      }
    }
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
  mimeType,
  refreshIdToken
}: DownloadAuthenticatedFileParams): Promise<string> {
  const baseUrl = config.apiBaseUrl.replace(/\/+$/, '');
  const headers = tokens === null ? undefined : { Authorization: `Bearer ${tokens.idToken}` };

  return saveImageToPhotoLibrary({
    filename,
    mimeType,
    sources: [{
      url: `${baseUrl}${path}`,
      headers,
      refreshHeaders: refreshIdToken === undefined
        ? undefined
        : async () => {
            const refreshedToken = await refreshIdToken();
            return refreshedToken === null
              ? undefined
              : { Authorization: `Bearer ${refreshedToken}` };
          }
    }]
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
      let result = await FileSystem.downloadAsync(source.url, fileUri, { headers: source.headers });
      if (isAuthenticationFailureStatus(result.status) && source.refreshHeaders !== undefined) {
        const refreshedHeaders = await source.refreshHeaders();
        if (refreshedHeaders !== undefined) {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
          result = await FileSystem.downloadAsync(source.url, fileUri, {
            headers: refreshedHeaders
          });
        }
      }
      assertSuccessfulDownload(result.status);
      const downloadedMimeType = await detectDownloadedFileMimeType(result.uri);
      if (downloadedMimeType === null || !supportedImageMimeTypes.has(downloadedMimeType)) {
        await FileSystem.deleteAsync(result.uri, { idempotent: true });
        throw new MobileFileTransferError('IMAGE_SAVE_FAILED');
      }
      downloadedUri = await moveDownloadedFileToMimeExtension(
        result.uri,
        filenameForSourceAttempt(filename, sourceIndex, sources.length),
        directory,
        downloadedMimeType
      );
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
    await createPhotoLibraryAsset(downloadedUri);
    return downloadedUri;
  } catch (error) {
    const failure = classifyFileTransferFailure(error);
    if (failure.code === 'DOWNLOAD_INTERRUPTED') {
      throw new MobileFileTransferError('IMAGE_SAVE_FAILED');
    }
    throw failure;
  }
}

async function createPhotoLibraryAsset(localUri: string): Promise<void> {
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) {
    throw new MobileFileTransferError('PHOTO_LIBRARY_PERMISSION_DENIED');
  }

  await MediaLibrary.Asset.create(localUri);
}

async function savePdfToAndroidDocumentDirectory(
  localUri: string,
  filename: string
): Promise<string> {
  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted || permission.directoryUri === null) {
    throw new MobileFileTransferError('DOWNLOAD_CANCELED');
  }

  const fileContents = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64
  });
  const destinationUri = await FileSystem.StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    filename.replace(/\.pdf$/iu, ''),
    'application/pdf'
  );
  await FileSystem.writeAsStringAsync(destinationUri, fileContents, {
    encoding: FileSystem.EncodingType.Base64
  });
  return destinationUri;
}

export async function downloadExternalFile({
  url,
  filename,
  mimeType
}: DownloadExternalFileParams): Promise<string> {
  if (!url.startsWith('https://')) {
    throw new MobileFileTransferError('DOWNLOAD_INTERRUPTED');
  }
  const directory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (directory === null) {
    throw new MobileFileTransferError('STORAGE_FULL');
  }

  const safeFilename = normalizeDownloadFilename(filename, extensionFromMimeType(mimeType), 'lyra-export');
  const fileUri = `${directory}${safeFilename}`;
  let result: FileSystem.FileSystemDownloadResult;
  try {
    result = await FileSystem.downloadAsync(url, fileUri);
    assertSuccessfulDownload(result.status);
    const downloadedMimeType = mimeType === 'application/pdf'
      ? await detectDownloadedFileMimeType(result.uri)
      : null;
    if (mimeType === 'application/pdf' && downloadedMimeType !== 'application/pdf') {
      await FileSystem.deleteAsync(result.uri, { idempotent: true });
      throw new MobileFileTransferError('DOWNLOAD_INTERRUPTED');
    }
  } catch (error) {
    throw classifyFileTransferFailure(error);
  }

  try {
    if (mimeType === 'application/pdf' && Platform.OS === 'android') {
      return await savePdfToAndroidDocumentDirectory(result.uri, safeFilename);
    }
    if (!(await Sharing.isAvailableAsync())) {
      throw new MobileFileTransferError('SHARING_UNAVAILABLE');
    }
    await Sharing.shareAsync(result.uri, {
      dialogTitle: safeFilename,
      mimeType,
      ...(mimeType === 'application/pdf' ? { UTI: 'com.adobe.pdf' } : {})
    });
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
