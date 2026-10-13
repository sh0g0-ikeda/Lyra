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
  fileDeleteMock,
  fileCopyMock,
  isAvailableAsyncMock,
  mediaLibraryCreateAssetMock,
  platformMock,
  requestMediaLibraryPermissionsAsyncMock,
  requestDirectoryPermissionsAsyncMock,
  shareAsyncMock
} = vi.hoisted(() => ({
  createFileAsyncMock: vi.fn(),
  downloadAsyncMock: vi.fn(),
  fileDeleteMock: vi.fn(),
  fileCopyMock: vi.fn(),
  isAvailableAsyncMock: vi.fn(),
  mediaLibraryCreateAssetMock: vi.fn(),
  platformMock: { OS: 'ios' },
  requestMediaLibraryPermissionsAsyncMock: vi.fn(),
  requestDirectoryPermissionsAsyncMock: vi.fn(),
  shareAsyncMock: vi.fn()
}));

vi.mock('react-native', () => ({ Platform: platformMock }));

vi.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {
    createFileAsync: createFileAsyncMock,
    requestDirectoryPermissionsAsync: requestDirectoryPermissionsAsyncMock
  },
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///documents/',
  downloadAsync: downloadAsyncMock
}));

vi.mock('expo-file-system', () => ({
  File: class MockFile {
    public constructor(public readonly uri: string) {}

    public delete(): void {
      fileDeleteMock(this.uri);
    }

    public copy(destination: MockFile, options: { overwrite: boolean }): Promise<void> {
      return fileCopyMock(this.uri, destination.uri, options);
    }
  }
}));

vi.mock('expo-sharing', () => ({
  isAvailableAsync: isAvailableAsyncMock,
  shareAsync: shareAsyncMock
}));

vi.mock('expo-media-library', () => ({
  Asset: { create: mediaLibraryCreateAssetMock },
  requestPermissionsAsync: requestMediaLibraryPermissionsAsyncMock,
}));

vi.mock('@/lib/config', () => ({
  config: { apiBaseUrl: 'https://api.example.test' }
}));

beforeEach(() => {
  platformMock.OS = 'ios';
  vi.clearAllMocks();
  requestMediaLibraryPermissionsAsyncMock.mockResolvedValue({ status: 'granted' });
  mediaLibraryCreateAssetMock.mockResolvedValue({ id: 'asset-1' });
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

  it('Android画像は選択フォルダを開かずライブラリへ保存する', async () => {
    platformMock.OS = 'android';
    downloadAsyncMock.mockResolvedValue({ status: 200, uri: 'file:///cache/page.png' });
    await expect(downloadAuthenticatedFile({
      path: '/api/pages/page-1/export-image',
      filename: 'page.png',
      mimeType: 'image/png',
      tokens: null
    })).resolves.toBe('file:///cache/page.png');
    expect(mediaLibraryCreateAssetMock).toHaveBeenCalledWith('file:///cache/page.png');
    expect(requestDirectoryPermissionsAsyncMock).not.toHaveBeenCalled();
    expect(shareAsyncMock).not.toHaveBeenCalled();
  });

  it('画像はフォルダ選択や共有を開かず画像ライブラリへ直接保存する', async () => {
    platformMock.OS = 'android';
    downloadAsyncMock.mockResolvedValue({ status: 200, uri: 'file:///cache/page.png' });
    requestMediaLibraryPermissionsAsyncMock.mockResolvedValue({ status: 'granted' });
    await expect(downloadAuthenticatedFile({
      path: '/api/pages/page-1/export-image',
      filename: 'page.png',
      mimeType: 'image/png',
      tokens: null
    })).resolves.toBe('file:///cache/page.png');

    expect(requestMediaLibraryPermissionsAsyncMock).toHaveBeenCalledOnce();
    expect(requestMediaLibraryPermissionsAsyncMock).toHaveBeenCalledWith(true, ['photo']);
    expect(mediaLibraryCreateAssetMock).toHaveBeenCalledWith('file:///cache/page.png');
    expect(requestDirectoryPermissionsAsyncMock).not.toHaveBeenCalled();
    expect(shareAsyncMock).not.toHaveBeenCalled();
  });

  // expo-media-library on web cannot grant write access; preserve the established share fallback.
  it('Web画像はMediaLibrary権限を要求せず共有経路へ渡す', async () => {
    platformMock.OS = 'web';
    downloadAsyncMock.mockResolvedValue({ status: 200, uri: 'file:///cache/page.png' });
    isAvailableAsyncMock.mockResolvedValue(true);
    shareAsyncMock.mockResolvedValue(undefined);

    await expect(downloadAuthenticatedFile({
      path: '/api/pages/page-1/export-image',
      filename: 'page.png',
      mimeType: 'image/png',
      tokens: null
    })).resolves.toBe('file:///cache/page.png');

    expect(requestMediaLibraryPermissionsAsyncMock).not.toHaveBeenCalled();
    expect(mediaLibraryCreateAssetMock).not.toHaveBeenCalled();
    expect(shareAsyncMock).toHaveBeenCalledWith('file:///cache/page.png', { mimeType: 'image/png' });
  });

  it('AndroidではPDF全体をJavaScriptへ展開せず選択フォルダへ保存する', async () => {
    platformMock.OS = 'android';
    downloadAsyncMock.mockResolvedValue({ status: 200, uri: 'file:///cache/chapter.pdf' });
    requestDirectoryPermissionsAsyncMock.mockResolvedValue({
      directoryUri: 'content://downloads/tree',
      granted: true
    });
    createFileAsyncMock.mockResolvedValue('content://downloads/chapter.pdf');
    fileCopyMock.mockResolvedValue(undefined);

    await expect(downloadAuthenticatedFile({
      path: '/api/exports/export-job-1/download',
      filename: 'chapter.pdf',
      mimeType: 'application/pdf',
      tokens: {
        accessToken: null,
        expiresAt: null,
        idToken: 'id-token',
        refreshToken: null,
        tokenType: null
      }
    })).resolves.toBe('content://downloads/chapter.pdf');

    expect(createFileAsyncMock).toHaveBeenCalledWith(
      'content://downloads/tree',
      'chapter',
      'application/pdf'
    );
    expect(fileCopyMock).toHaveBeenCalledWith(
      'file:///cache/chapter.pdf',
      'content://downloads/chapter.pdf',
      { overwrite: true }
    );
  });

  it('Androidの保存先providerがcopyを拒否した場合は取得済みPDFを共有して保存できる', async () => {
    platformMock.OS = 'android';
    downloadAsyncMock.mockResolvedValue({ status: 200, uri: 'file:///cache/chapter.pdf' });
    requestDirectoryPermissionsAsyncMock.mockResolvedValue({
      directoryUri: 'content://downloads/tree',
      granted: true
    });
    createFileAsyncMock.mockResolvedValue('content://downloads/chapter.pdf');
    fileCopyMock.mockRejectedValue(new Error('Document provider rejected copy'));
    isAvailableAsyncMock.mockResolvedValue(true);
    shareAsyncMock.mockResolvedValue(undefined);

    await expect(downloadAuthenticatedFile({
      path: '/api/exports/export-job-1/download',
      filename: 'chapter.pdf',
      mimeType: 'application/pdf',
      tokens: null
    })).resolves.toBe('file:///cache/chapter.pdf');

    expect(shareAsyncMock).toHaveBeenCalledWith(
      'file:///cache/chapter.pdf',
      { mimeType: 'application/pdf' }
    );
  });

  it('Androidで保存先フォルダを選ばなかった場合は取消として扱う', async () => {
    platformMock.OS = 'android';
    downloadAsyncMock.mockResolvedValue({ status: 200, uri: 'file:///cache/chapter.pdf' });
    requestDirectoryPermissionsAsyncMock.mockResolvedValue({
      directoryUri: '',
      granted: false
    });

    await expect(downloadAuthenticatedFile({
      path: '/api/exports/export-job-1/download',
      filename: 'chapter.pdf',
      mimeType: 'application/pdf',
      tokens: null
    })).rejects.toMatchObject({ code: 'DOWNLOAD_CANCELED' });

    expect(createFileAsyncMock).not.toHaveBeenCalled();
    expect(fileCopyMock).not.toHaveBeenCalled();
    expect(shareAsyncMock).not.toHaveBeenCalled();
  });

  it('AndroidではAPIが返した実際の画像MIMEをライブラリへ保存する', async () => {
    platformMock.OS = 'android';
    downloadAsyncMock.mockResolvedValue({
      status: 200,
      uri: 'file:///cache/page.png',
      mimeType: 'image/jpeg'
    });
    await downloadAuthenticatedFile({
      path: '/api/pages/page-1/export-image',
      filename: 'page',
      mimeType: 'image/png',
      tokens: null
    });

    expect(mediaLibraryCreateAssetMock).toHaveBeenCalledWith('file:///cache/page.png');
    expect(requestDirectoryPermissionsAsyncMock).not.toHaveBeenCalled();
  });

  it('Androidのフォルダ選択が取消例外を返した場合も共有画面を開かない', async () => {
    platformMock.OS = 'android';
    downloadAsyncMock.mockResolvedValue({ status: 200, uri: 'file:///cache/chapter.pdf' });
    requestDirectoryPermissionsAsyncMock.mockRejectedValue(
      new Error('User cancelled directory picker')
    );
    isAvailableAsyncMock.mockResolvedValue(true);

    await expect(downloadAuthenticatedFile({
      path: '/api/exports/export-job-1/download',
      filename: 'chapter.pdf',
      mimeType: 'application/pdf',
      tokens: null
    })).rejects.toMatchObject({ code: 'DOWNLOAD_CANCELED' });

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
