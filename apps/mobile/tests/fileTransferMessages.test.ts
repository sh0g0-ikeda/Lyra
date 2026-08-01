import { describe, expect, it } from 'vitest';

import { fileTransferErrorMessage, MobileFileTransferError } from '@/lib/fileTransferError';
import { userErrorMessage } from '@/lib/userMessages';

describe('file transfer user messages', () => {
  it.each([
    ['DOWNLOAD_INTERRUPTED', 'ダウンロードが中断されました。通信状態を確認して再試行してください。'],
    ['STORAGE_FULL', '端末の空き容量が不足しています。空き容量を増やして再試行してください。'],
    ['SHARING_UNAVAILABLE', 'この端末では共有機能を利用できません。端末の共有設定を確認してください。']
  ] as const)('%sを日本語で具体的に説明する', (code, expected) => {
    expect(userErrorMessage(new MobileFileTransferError(code), 'ja')).toBe(expected);
  });
});

describe('export transfer specific messages', () => {
  it.each([
    ['DOWNLOAD_CANCELED', 'The download was cancelled. No file was shared.'],
    ['DOWNLOAD_INTERRUPTED', 'The download was interrupted. Check your connection and try again.'],
    ['NETWORK_UNAVAILABLE', 'The network connection is unavailable. Check your connection and try again.'],
    ['STORAGE_FULL', 'The device does not have enough free storage. Free some space and try again.'],
    ['SHARING_UNAVAILABLE', 'Sharing is unavailable on this device. Check the device sharing settings.']
  ] as const)('%s is shown as an actionable English message', (code, expected) => {
    expect(fileTransferErrorMessage(new MobileFileTransferError(code), 'en')).toBe(expected);
  });

  it('ネットワーク不通を日本語の安全な案内に変換する', () => {
    expect(fileTransferErrorMessage(new MobileFileTransferError('NETWORK_UNAVAILABLE'), 'ja')).toBe(
      '\u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u306b\u63a5\u7d9a\u3067\u304d\u307e\u305b\u3093\u3002\u901a\u4fe1\u72b6\u614b\u3092\u78ba\u8a8d\u3057\u3066\u518d\u8a66\u884c\u3057\u3066\u304f\u3060\u3055\u3044\u3002'
    );
  });
});
