import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classifyFileTransferFailure,
  downloadAuthenticatedFile,
  downloadExternalFile,
  normalizeDownloadFilename
} from '@/lib/download';

const {
  createFileAsyncMock,
  downloadAsyncMock,
  isAvailableAsyncMock,
  platformMock,
  readAsStringAsyncMock,
  requestDirectoryPermissionsAsyncMock,
  shareAsyncMock,
  writeAsStringAsyncMock
} = vi.hoisted(() => ({
  createFileAsyncMock: vi.fn(),
  downloadAsyncMock: vi.fn(),
  isAvailableAsyncMock: vi.fn(),
  platformMock: { OS: 'ios' },
  readAsStringAsyncMock: vi.fn(),
  requestDirectoryPermissionsAsyncMock: vi.fn(),
  shareAsyncMock: vi.fn(),
  writeAsStringAsyncMock: vi.fn()
}));

vi.mock('react-native', () => ({ Platform: platformMock }));

vi.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  StorageAccessFramework: {
    createFileAsync: createFileAsyncMock,
    requestDirectoryPermissionsAsync: requestDirectoryPermissionsAsyncMock
  },
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///documents/',
  downloadAsync: downloadAsyncMock,
  readAsStringAsync: readAsStringAsyncMock,
  writeAsStringAsync: writeAsStringAsyncMock
}));

vi.mock('expo-sharing', () => ({
  isAvailableAsync: isAvailableAsyncMock,
  shareAsync: shareAsyncMock
}));

vi.mock('@/lib/config', () => ({
  config: { apiBaseUrl: 'https://api.example.test' }
}));

beforeEach(() => {
  platformMock.OS = 'ios';
  vi.clearAllMocks();
});

describe('mobile download filenames', () => {
  it('ユーザー指定名からパストラバーサルと予約文字を除去しPNG拡張子を維持する', async () => {
    downloadAsyncMock.mockResolvedValue({ status: 200, uri: 'file:///cache/my-story-.png' });
    isAvailableAsyncMock.mockResolvedValue(true);
    shareAsyncMock.mockResolvedValue(undefined);

    await downloadAuthenticatedFile({
      path: '/api/pages/page-1/export-image',
      filename: '../../my:story?.zip',
      mimeType: 'image/png',
      tokens: null
    });

    expect(normalizeDownloadFilename('../../my:story?.zip', 'png', 'lyra-page')).toBe('my-story-.png');
    expect(downloadAsyncMock).toHaveBeenCalledWith(
      'https://api.example.test/api/pages/page-1/export-image',
      'file:///cache/my-story-.png',
      { headers: undefined }
    );
  });

  it('法人利用履歴CSVを.csv拡張子で保存して共有する', async () => {
    downloadAsyncMock.mockResolvedValue({
      status: 200,
      uri: 'file:///cache/lyra-organization-usage.csv'
    });
    isAvailableAsyncMock.mockResolvedValue(true);
    shareAsyncMock.mockResolvedValue(undefined);

    await downloadAuthenticatedFile({
      path: '/api/organizations/org-1/usage.csv',
      filename: 'lyra-organization-usage',
      mimeType: 'text/csv',
      tokens: {
        accessToken: null,
        expiresAt: null,
        idToken: 'id-token',
        refreshToken: null,
        tokenType: null
      }
    });

    expect(downloadAsyncMock).toHaveBeenCalledWith(
      'https://api.example.test/api/organizations/org-1/usage.csv',
      'file:///cache/lyra-organization-usage.csv',
      { headers: { Authorization: 'Bearer id-token' } }
    );
    expect(shareAsyncMock).toHaveBeenCalledWith(
      'file:///cache/lyra-organization-usage.csv',
      { mimeType: 'text/csv' }
    );
  });

  it('Androidでは選択したフォルダへ画像を実ファイルとして保存する', async () => {
    platformMock.OS = 'android';
    downloadAsyncMock.mockResolvedValue({ status: 200, uri: 'file:///cache/page.png' });
    requestDirectoryPermissionsAsyncMock.mockResolvedValue({
      directoryUri: 'content://downloads/tree',
      granted: true
    });
    createFileAsyncMock.mockResolvedValue('content://downloads/page.png');
    readAsStringAsyncMock.mockResolvedValue('base64-image');
    writeAsStringAsyncMock.mockResolvedValue(undefined);

    await expect(downloadAuthenticatedFile({
      path: '/api/pages/page-1/export-image',
      filename: 'page.png',
      mimeType: 'image/png',
      tokens: null
    })).resolves.toBe('content://downloads/page.png');

    expect(createFileAsyncMock).toHaveBeenCalledWith(
      'content://downloads/tree',
      'page.png',
      'image/png'
    );
    expect(writeAsStringAsyncMock).toHaveBeenCalledWith(
      'content://downloads/page.png',
      'base64-image',
      { encoding: 'base64' }
    );
    expect(shareAsyncMock).not.toHaveBeenCalled();
  });
});

describe('mobile download failure classification', () => {
  it.each([
    ['User cancelled the share sheet', 'DOWNLOAD_CANCELED'],
    ['The transfer was interrupted', 'DOWNLOAD_INTERRUPTED'],
    ['Network request failed', 'NETWORK_UNAVAILABLE'],
    ['ENOSPC: no space left on device', 'STORAGE_FULL'],
    ['Sharing is unavailable', 'SHARING_UNAVAILABLE']
  ] as const)('%s を安全な区分に変換する', (message, expectedCode) => {
    expect(classifyFileTransferFailure(new Error(message)).code).toBe(expectedCode);
  });

  it.each([
    ['Network request failed', 'NETWORK_UNAVAILABLE'],
    ['ENOSPC: no space left on device', 'STORAGE_FULL'],
    ['The transfer was interrupted', 'DOWNLOAD_INTERRUPTED']
  ] as const)('署名付きURLの取得失敗 %s を %s として返す', async (message, expectedCode) => {
    downloadAsyncMock.mockRejectedValueOnce(new Error(message));

    await expect(
      downloadExternalFile({
        filename: 'export.pdf',
        mimeType: 'application/pdf',
        url: 'https://downloads.example.test/export.pdf?signature=safe'
      })
    ).rejects.toMatchObject({ code: expectedCode });
    expect(downloadAsyncMock).toHaveBeenCalledWith(
      'https://downloads.example.test/export.pdf?signature=safe',
      'file:///cache/export.pdf',
      { headers: undefined }
    );
  });

  it('共有先がない端末を共有不可として返す', async () => {
    downloadAsyncMock.mockResolvedValueOnce({ status: 200, uri: 'file:///cache/export.pdf' });
    isAvailableAsyncMock.mockResolvedValueOnce(false);

    await expect(
      downloadExternalFile({
        filename: 'export.pdf',
        mimeType: 'application/pdf',
        url: 'https://downloads.example.test/export.pdf?signature=safe'
      })
    ).rejects.toMatchObject({ code: 'SHARING_UNAVAILABLE' });
  });

  it('共有シートの取消をダウンロード取消として返す', async () => {
    downloadAsyncMock.mockResolvedValueOnce({ status: 200, uri: 'file:///cache/export.pdf' });
    isAvailableAsyncMock.mockResolvedValueOnce(true);
    shareAsyncMock.mockRejectedValueOnce(new Error('User cancelled the share sheet'));

    await expect(
      downloadExternalFile({
        filename: 'export.pdf',
        mimeType: 'application/pdf',
        url: 'https://downloads.example.test/export.pdf?signature=safe'
      })
    ).rejects.toMatchObject({ code: 'DOWNLOAD_CANCELED' });
  });
});
