import * as FileSystem from 'expo-file-system/legacy';
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
}

interface DownloadExternalFileParams {
  url: string;
  filename: string;
  mimeType: string;
  headers?: Record<string, string>;
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

const storageAccessFrameworkDisplayName = (filename: string): string =>
  filename.replace(/\.[A-Za-z0-9]{1,10}$/u, '') || 'lyra-download';

const saveDownloadedFile = async (
  sourceUri: string,
  filename: string,
  mimeType: string
): Promise<string> => {
  if (Platform.OS === 'android') {
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted || permission.directoryUri.length === 0) {
      throw new MobileFileTransferError('DOWNLOAD_CANCELED');
    }
    const destinationUri = await FileSystem.StorageAccessFramework.createFileAsync(
      permission.directoryUri,
      storageAccessFrameworkDisplayName(filename),
      mimeType
    );
    const { File } = await import('expo-file-system');
    const source = new File(sourceUri);
    const destination = new File(destinationUri);
    await source.copy(destination, { overwrite: true });
    return destinationUri;
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new MobileFileTransferError('SHARING_UNAVAILABLE');
  }
  await Sharing.shareAsync(sourceUri, { mimeType });
  return sourceUri;
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
    return await saveDownloadedFile(result.uri, safeFilename, mimeType);
  } catch (error) {
    throw classifyFileTransferFailure(error);
  }
}

export async function downloadExternalFile({
  url,
  filename,
  mimeType,
  headers
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
    result = await FileSystem.downloadAsync(url, fileUri, { headers });
    assertSuccessfulDownload(result.status);
  } catch (error) {
    throw classifyFileTransferFailure(error);
  }

  try {
    return await saveDownloadedFile(result.uri, safeFilename, mimeType);
  } catch (error) {
    throw classifyFileTransferFailure(error);
  }
}

export const appendOrganizationQuery = (path: string, organizationId: string | null): string => {
  if (organizationId === null || organizationId.trim().length === 0) {
    return path;
  }
  return `${path}${path.includes('?') ? '&' : '?'}organization_id=${encodeURIComponent(organizationId)}`;
};
