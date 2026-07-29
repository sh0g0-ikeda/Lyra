import { t } from '@/lib/i18n';
import type { SharedTranslationKey } from '@/lib/i18nSharedMessages';

export type MobileFileTransferErrorCode =
  | 'DOWNLOAD_CANCELED'
  | 'DOWNLOAD_INTERRUPTED'
  | 'NETWORK_UNAVAILABLE'
  | 'STORAGE_FULL'
  | 'SHARING_UNAVAILABLE';

export class MobileFileTransferError extends Error {
  public readonly code: MobileFileTransferErrorCode;

  public constructor(code: MobileFileTransferErrorCode) {
    super(code);
    this.name = 'MobileFileTransferError';
    this.code = code;
  }
}

export function fileTransferErrorMessage(
  error: unknown,
  language: 'ja' | 'en'
): string {
  const code = error instanceof MobileFileTransferError ? error.code : null;
  const messageKeys: Record<MobileFileTransferErrorCode, SharedTranslationKey> = {
    DOWNLOAD_CANCELED: 'shared.fileTransfer.downloadCanceled',
    DOWNLOAD_INTERRUPTED: 'shared.fileTransfer.downloadInterrupted',
    NETWORK_UNAVAILABLE: 'shared.fileTransfer.networkUnavailable',
    STORAGE_FULL: 'shared.fileTransfer.storageFull',
    SHARING_UNAVAILABLE: 'shared.fileTransfer.sharingUnavailable'
  };
  if (code !== null) {
    return t(language, messageKeys[code]);
  }
  return t(language, 'shared.fileTransfer.failed');
}
