import { describe, expect, it, vi } from 'vitest';

import {
  classifyFileTransferFailure,
  downloadAuthenticatedFile,
  downloadExternalFile,
  normalizeDownloadFilename
} from '@/lib/download';

const { downloadAsyncMock, isAvailableAsyncMock, shareAsyncMock } = vi.hoisted(() => ({
  downloadAsyncMock: vi.fn(),
  isAvailableAsyncMock: vi.fn(),
  shareAsyncMock: vi.fn()
}));

vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///documents/',
  downloadAsync: downloadAsyncMock
}));

vi.mock('expo-sharing', () => ({
  isAvailableAsync: isAvailableAsyncMock,
  shareAsync: shareAsyncMock
}));

vi.mock('@/lib/config', () => ({
  config: { apiBaseUrl: 'https://api.example.test' }
}));

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
