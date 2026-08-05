import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classifyFileTransferFailure,
  downloadAuthenticatedFile,
  downloadExternalFile,
  normalizeDownloadFilename,
  saveImageToPhotoLibrary,
  saveAuthenticatedImageToPhotoLibrary
} from '@/lib/download';

const {
  downloadAsyncMock,
  isAvailableAsyncMock,
  requestMediaLibraryPermissionsMock,
  assetCreateMock,
  shareAsyncMock,
  writeAsStringAsyncMock,
  readAsStringAsyncMock,
  moveAsyncMock,
  deleteAsyncMock,
  requestDirectoryPermissionsAsyncMock,
  createFileAsyncMock,
  platformOs
} = vi.hoisted(() => ({
  downloadAsyncMock: vi.fn(),
  isAvailableAsyncMock: vi.fn(),
  requestMediaLibraryPermissionsMock: vi.fn(),
  assetCreateMock: vi.fn(),
  shareAsyncMock: vi.fn(),
  writeAsStringAsyncMock: vi.fn(),
  readAsStringAsyncMock: vi.fn(),
  moveAsyncMock: vi.fn(),
  deleteAsyncMock: vi.fn(),
  requestDirectoryPermissionsAsyncMock: vi.fn(),
  createFileAsyncMock: vi.fn(),
  platformOs: { value: 'ios' as 'ios' | 'android' }
}));

vi.mock('react-native', () => ({ Platform: { get OS() { return platformOs.value; } } }));

vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///documents/',
  downloadAsync: downloadAsyncMock,
  writeAsStringAsync: writeAsStringAsyncMock,
  readAsStringAsync: readAsStringAsyncMock,
  moveAsync: moveAsyncMock,
  deleteAsync: deleteAsyncMock,
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: requestDirectoryPermissionsAsyncMock,
    createFileAsync: createFileAsyncMock
  },
  EncodingType: { Base64: 'base64' }
}));

vi.mock('expo-sharing', () => ({
  isAvailableAsync: isAvailableAsyncMock,
  shareAsync: shareAsyncMock
}));

vi.mock('expo-media-library', () => ({
  Asset: { create: assetCreateMock },
  requestPermissionsAsync: requestMediaLibraryPermissionsMock,
}));

vi.mock('@/lib/config', () => ({
  config: { apiBaseUrl: 'https://api.example.test' }
}));

beforeEach(() => {
  vi.clearAllMocks();
  platformOs.value = 'ios';
  readAsStringAsyncMock.mockReset();
  readAsStringAsyncMock.mockImplementation(async (uri: string, options?: { length?: number }) => {
    if (options?.length === 12) {
      return uri.endsWith('.pdf') ? 'JVBERi0xLjQ=' : 'iVBORw0KGgoAAAAN';
    }
    return 'JVBERi0xLjQ=';
  });
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

  it('認証済みファイルが401または403の場合は更新トークンで一度だけ再取得する', async () => {
    downloadAsyncMock
      .mockResolvedValueOnce({ status: 403, uri: 'file:///cache/lyra-organization-usage.csv' })
      .mockResolvedValueOnce({ status: 200, uri: 'file:///cache/lyra-organization-usage.csv' });
    isAvailableAsyncMock.mockResolvedValue(true);
    shareAsyncMock.mockResolvedValue(undefined);
    const refreshIdToken = vi.fn().mockResolvedValue('refreshed-id-token');

    await downloadAuthenticatedFile({
      path: '/api/organizations/org-1/usage.csv',
      filename: 'lyra-organization-usage',
      mimeType: 'text/csv',
      refreshIdToken,
      tokens: {
        accessToken: null,
        expiresAt: null,
        idToken: 'expired-id-token',
        refreshToken: 'refresh-token',
        tokenType: null
      }
    });

    expect(refreshIdToken).toHaveBeenCalledOnce();
    expect(downloadAsyncMock).toHaveBeenNthCalledWith(
      2,
      'https://api.example.test/api/organizations/org-1/usage.csv',
      'file:///cache/lyra-organization-usage.csv',
      { headers: { Authorization: 'Bearer refreshed-id-token' } }
    );
  });

  it('認証済みのページ画像を写真ライブラリへ保存し、共有シートを開かない', async () => {
    downloadAsyncMock.mockResolvedValue({
      status: 200,
      uri: 'file:///cache/lyra-page-1.png',
      mimeType: 'image/png',
      headers: { 'content-type': 'image/png' }
    });
    requestMediaLibraryPermissionsMock.mockResolvedValue({ granted: true });
    assetCreateMock.mockResolvedValue(undefined);

    await saveAuthenticatedImageToPhotoLibrary({
      path: '/api/pages/page-1/export-image',
      filename: 'lyra-page-1',
      mimeType: 'image/png',
      tokens: {
        accessToken: null,
        expiresAt: null,
        idToken: 'id-token',
        refreshToken: null,
        tokenType: null
      }
    });

    expect(downloadAsyncMock).toHaveBeenCalledWith(
      'https://api.example.test/api/pages/page-1/export-image',
      'file:///cache/lyra-page-1.png',
      { headers: { Authorization: 'Bearer id-token' } }
    );
    expect(assetCreateMock).toHaveBeenCalledWith('file:///cache/lyra-page-1.png');
    expect(shareAsyncMock).not.toHaveBeenCalled();
  });

  it('JPEGレスポンスは実データに合う拡張子へ変更してから写真へ登録する', async () => {
    downloadAsyncMock.mockResolvedValue({
      status: 200,
      uri: 'file:///cache/lyra-page-1.png',
      mimeType: 'image/jpeg',
      headers: { 'content-type': 'image/jpeg' }
    });
    readAsStringAsyncMock.mockResolvedValueOnce('/9j/4AAQSkZJRgAB');
    requestMediaLibraryPermissionsMock.mockResolvedValue({ granted: true });
    assetCreateMock.mockResolvedValue(undefined);

    await expect(
      saveAuthenticatedImageToPhotoLibrary({
        path: '/api/pages/page-1/export-image',
        filename: 'lyra-page-1',
        mimeType: 'image/png',
        tokens: null
      })
    ).resolves.toBe('file:///cache/lyra-page-1.jpg');

    expect(moveAsyncMock).toHaveBeenCalledWith({
      from: 'file:///cache/lyra-page-1.png',
      to: 'file:///cache/lyra-page-1.jpg'
    });
    expect(assetCreateMock).toHaveBeenCalledWith('file:///cache/lyra-page-1.jpg');
  });

  it('WebPレスポンスは実データに合う拡張子へ変更してから写真へ登録する', async () => {
    downloadAsyncMock.mockResolvedValue({
      status: 200,
      uri: 'file:///cache/lyra-page-1.png',
      mimeType: null,
      headers: { 'Content-Type': 'image/webp; charset=binary' }
    });
    readAsStringAsyncMock.mockResolvedValueOnce('UklGRiQAAABXRUJQ');
    requestMediaLibraryPermissionsMock.mockResolvedValue({ granted: true });
    assetCreateMock.mockResolvedValue(undefined);

    await expect(
      saveAuthenticatedImageToPhotoLibrary({
        path: '/api/pages/page-1/export-image',
        filename: 'lyra-page-1',
        mimeType: 'image/png',
        tokens: null
      })
    ).resolves.toBe('file:///cache/lyra-page-1.webp');

    expect(assetCreateMock).toHaveBeenCalledWith('file:///cache/lyra-page-1.webp');
  });

  it('画像以外の成功レスポンスを写真ライブラリへ登録しない', async () => {
    downloadAsyncMock.mockResolvedValue({
      status: 200,
      uri: 'file:///cache/lyra-page-1.png',
      mimeType: 'text/html',
      headers: { 'content-type': 'text/html' }
    });
    readAsStringAsyncMock.mockResolvedValueOnce('PGh0bWw+PGJvZHk+');

    await expect(
      saveAuthenticatedImageToPhotoLibrary({
        path: '/api/pages/page-1/export-image',
        filename: 'lyra-page-1',
        mimeType: 'image/png',
        tokens: null
      })
    ).rejects.toMatchObject({ code: 'IMAGE_SAVE_FAILED' });
    expect(assetCreateMock).not.toHaveBeenCalled();
  });

  it('レスポンスのMIME宣言より実ファイルのJPEG署名を優先する', async () => {
    downloadAsyncMock.mockResolvedValue({
      status: 200,
      uri: 'file:///cache/lyra-page-1.png',
      mimeType: 'image/png',
      headers: { 'content-type': 'image/png' }
    });
    readAsStringAsyncMock.mockResolvedValueOnce('/9j/4AAQSkZJRgAB');
    requestMediaLibraryPermissionsMock.mockResolvedValue({ granted: true });
    assetCreateMock.mockResolvedValue(undefined);

    await expect(
      saveAuthenticatedImageToPhotoLibrary({
        path: '/api/pages/page-1/export-image',
        filename: 'lyra-page-1',
        mimeType: 'image/png',
        tokens: null
      })
    ).resolves.toBe('file:///cache/lyra-page-1.jpg');

    expect(assetCreateMock).toHaveBeenCalledWith('file:///cache/lyra-page-1.jpg');
  });

  it('認証期限切れの場合は一度だけ更新トークンで再取得する', async () => {
    downloadAsyncMock
      .mockResolvedValueOnce({
        status: 401,
        uri: 'file:///cache/lyra-page-1.png',
        mimeType: 'application/json',
        headers: { 'content-type': 'application/json' }
      })
      .mockResolvedValueOnce({
        status: 200,
        uri: 'file:///cache/lyra-page-1.png',
        mimeType: 'image/png',
        headers: { 'content-type': 'image/png' }
      });
    requestMediaLibraryPermissionsMock.mockResolvedValue({ granted: true });
    assetCreateMock.mockResolvedValue(undefined);
    const refreshIdToken = vi.fn().mockResolvedValue('refreshed-id-token');

    await saveAuthenticatedImageToPhotoLibrary({
      path: '/api/pages/page-1/export-image',
      filename: 'lyra-page-1',
      mimeType: 'image/png',
      refreshIdToken,
      tokens: {
        accessToken: null,
        expiresAt: null,
        idToken: 'expired-id-token',
        refreshToken: 'refresh-token',
        tokenType: null
      }
    });

    expect(refreshIdToken).toHaveBeenCalledOnce();
    expect(downloadAsyncMock).toHaveBeenNthCalledWith(
      2,
      'https://api.example.test/api/pages/page-1/export-image',
      'file:///cache/lyra-page-1.png',
      { headers: { Authorization: 'Bearer refreshed-id-token' } }
    );
  });

  it('署名付き画像URLが拒否された場合に認証済み画像へフォールバックして保存する', async () => {
    downloadAsyncMock
      .mockResolvedValueOnce({ status: 403, uri: 'file:///cache/signed-page.png' })
      .mockResolvedValueOnce({ status: 200, uri: 'file:///cache/authenticated-page.png' });
    requestMediaLibraryPermissionsMock.mockResolvedValue({ granted: true });
    assetCreateMock.mockResolvedValue(undefined);

    await saveImageToPhotoLibrary({
      filename: 'lyra-page-1',
      mimeType: 'image/png',
      sources: [
        { url: 'https://cdn.lyra.test/page-1.png?Signature=expired' },
        {
          url: 'https://api.example.test/api/pages/page-1/export-image',
          headers: { Authorization: 'Bearer id-token' }
        }
      ]
    });

    expect(downloadAsyncMock).toHaveBeenNthCalledWith(
      1,
      'https://cdn.lyra.test/page-1.png?Signature=expired',
      'file:///cache/lyra-page-1-candidate-1.png',
      { headers: undefined }
    );
    expect(downloadAsyncMock).toHaveBeenNthCalledWith(
      2,
      'https://api.example.test/api/pages/page-1/export-image',
      'file:///cache/lyra-page-1-candidate-2.png',
      { headers: { Authorization: 'Bearer id-token' } }
    );
    expect(assetCreateMock).toHaveBeenCalledWith('file:///cache/authenticated-page.png');
  });

  it('写真ライブラリの権限が拒否された場合は専用エラーを返す', async () => {
    downloadAsyncMock.mockResolvedValue({ status: 200, uri: 'file:///cache/lyra-page-1.png' });
    requestMediaLibraryPermissionsMock.mockResolvedValue({ granted: false });

    await expect(
      saveAuthenticatedImageToPhotoLibrary({
        path: '/api/pages/page-1/export-image',
        filename: 'lyra-page-1',
        mimeType: 'image/png',
        tokens: null
      })
    ).rejects.toMatchObject({ code: 'PHOTO_LIBRARY_PERMISSION_DENIED' });
    expect(assetCreateMock).not.toHaveBeenCalled();
  });

  it('写真ライブラリへの登録失敗をダウンロード中断と誤表示しない', async () => {
    downloadAsyncMock.mockResolvedValue({ status: 200, uri: 'file:///cache/lyra-page-1.png' });
    requestMediaLibraryPermissionsMock.mockResolvedValue({ granted: true });
    assetCreateMock.mockRejectedValueOnce(new Error('Native media library registration failed'));

    await expect(
      saveAuthenticatedImageToPhotoLibrary({
        path: '/api/pages/page-1/export-image',
        filename: 'lyra-page-1',
        mimeType: 'image/png',
        tokens: null
      })
    ).rejects.toMatchObject({ code: 'IMAGE_SAVE_FAILED' });
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

  it('PDFを永続領域へ取得しPDFとして共有シートへ渡す', async () => {
    downloadAsyncMock.mockResolvedValueOnce({ status: 200, uri: 'file:///documents/export.pdf' });
    isAvailableAsyncMock.mockResolvedValueOnce(true);

    await expect(
      downloadExternalFile({
        filename: 'export.pdf',
        mimeType: 'application/pdf',
        url: 'https://downloads.example.test/export.pdf?signature=safe'
      })
    ).resolves.toBe('file:///documents/export.pdf');

    expect(downloadAsyncMock).toHaveBeenCalledWith(
      'https://downloads.example.test/export.pdf?signature=safe',
      'file:///documents/export.pdf'
    );
    expect(shareAsyncMock).toHaveBeenCalledWith('file:///documents/export.pdf', {
      UTI: 'com.adobe.pdf',
      dialogTitle: 'export.pdf',
      mimeType: 'application/pdf'
    });
  });

  it('PDF以外の成功レスポンスをPDFとして保存または共有しない', async () => {
    downloadAsyncMock.mockResolvedValueOnce({
      status: 200,
      uri: 'file:///documents/export.pdf',
      mimeType: 'text/html',
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
    readAsStringAsyncMock.mockResolvedValueOnce('PGh0bWw+PGJvZHk+');

    await expect(
      downloadExternalFile({
        filename: 'export.pdf',
        mimeType: 'application/pdf',
        url: 'https://downloads.example.test/export.pdf?signature=safe'
      })
    ).rejects.toMatchObject({ code: 'DOWNLOAD_INTERRUPTED' });

    expect(deleteAsyncMock).toHaveBeenCalledWith('file:///documents/export.pdf', {
      idempotent: true
    });
    expect(shareAsyncMock).not.toHaveBeenCalled();
    expect(requestDirectoryPermissionsAsyncMock).not.toHaveBeenCalled();
  });

  it('application/octet-streamのPDFを実ファイル署名で判定して保存する', async () => {
    downloadAsyncMock.mockResolvedValueOnce({
      status: 200,
      uri: 'file:///documents/export.pdf',
      mimeType: 'application/octet-stream',
      headers: { 'content-type': 'application/octet-stream' }
    });
    readAsStringAsyncMock.mockResolvedValueOnce('JVBERi0xLjQ=');
    isAvailableAsyncMock.mockResolvedValueOnce(true);

    await expect(
      downloadExternalFile({
        filename: 'export.pdf',
        mimeType: 'application/pdf',
        url: 'https://downloads.example.test/export.pdf?signature=safe'
      })
    ).resolves.toBe('file:///documents/export.pdf');

    expect(shareAsyncMock).toHaveBeenCalledWith('file:///documents/export.pdf', {
      UTI: 'com.adobe.pdf',
      dialogTitle: 'export.pdf',
      mimeType: 'application/pdf'
    });
  });

  it('PDFと宣言されたHTMLを実ファイル署名で拒否する', async () => {
    downloadAsyncMock.mockResolvedValueOnce({
      status: 200,
      uri: 'file:///documents/export.pdf',
      mimeType: 'application/pdf',
      headers: { 'content-type': 'application/pdf' }
    });
    readAsStringAsyncMock.mockResolvedValueOnce('PGh0bWw+PGJvZHk+');

    await expect(
      downloadExternalFile({
        filename: 'export.pdf',
        mimeType: 'application/pdf',
        url: 'https://downloads.example.test/export.pdf?signature=safe'
      })
    ).rejects.toMatchObject({ code: 'DOWNLOAD_INTERRUPTED' });

    expect(deleteAsyncMock).toHaveBeenCalledWith('file:///documents/export.pdf', {
      idempotent: true
    });
    expect(shareAsyncMock).not.toHaveBeenCalled();
  });

  it('AndroidのPDFをユーザーが選んだフォルダへ保存し共有シートに依存しない', async () => {
    platformOs.value = 'android';
    downloadAsyncMock.mockResolvedValueOnce({ status: 200, uri: 'file:///documents/export.pdf' });
    requestDirectoryPermissionsAsyncMock.mockResolvedValueOnce({
      granted: true,
      directoryUri: 'content://documents/tree/lyra'
    });
    createFileAsyncMock.mockResolvedValueOnce('content://documents/document/lyra%2Fexport.pdf');

    await expect(
      downloadExternalFile({
        filename: 'export.pdf',
        mimeType: 'application/pdf',
        url: 'https://downloads.example.test/export.pdf?signature=safe'
      })
    ).resolves.toBe('content://documents/document/lyra%2Fexport.pdf');

    expect(requestDirectoryPermissionsAsyncMock).toHaveBeenCalledOnce();
    expect(createFileAsyncMock).toHaveBeenCalledWith(
      'content://documents/tree/lyra',
      'export',
      'application/pdf'
    );
    expect(readAsStringAsyncMock).toHaveBeenCalledWith('file:///documents/export.pdf', {
      encoding: 'base64'
    });
    expect(writeAsStringAsyncMock).toHaveBeenCalledWith(
      'content://documents/document/lyra%2Fexport.pdf',
      'JVBERi0xLjQ=',
      { encoding: 'base64' }
    );
    expect(shareAsyncMock).not.toHaveBeenCalled();
  });

  it('AndroidのPDF保存先選択を取り消した場合は完了扱いにしない', async () => {
    platformOs.value = 'android';
    downloadAsyncMock.mockResolvedValueOnce({ status: 200, uri: 'file:///documents/export.pdf' });
    requestDirectoryPermissionsAsyncMock.mockResolvedValueOnce({ granted: false, directoryUri: null });

    await expect(
      downloadExternalFile({
        filename: 'export.pdf',
        mimeType: 'application/pdf',
        url: 'https://downloads.example.test/export.pdf?signature=safe'
      })
    ).rejects.toMatchObject({ code: 'DOWNLOAD_CANCELED' });
    expect(shareAsyncMock).not.toHaveBeenCalled();
  });

  it('共有先がない端末を共有不可として返す', async () => {
    downloadAsyncMock.mockResolvedValueOnce({ status: 200, uri: 'file:///documents/export.pdf' });
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
    downloadAsyncMock.mockResolvedValueOnce({ status: 200, uri: 'file:///documents/export.pdf' });
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
