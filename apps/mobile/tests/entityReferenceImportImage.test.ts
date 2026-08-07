import { describe, expect, it } from 'vitest';

import {
  decodeEntityReferencePickerImage,
  EntityReferenceImportImageError,
  MAX_ENTITY_REFERENCE_IMPORT_BYTES,
} from '@/domain/entityReferenceImportImage';

describe('Entity reference import image', () => {
  it('pickerのJPEG base64を5MiB以下のdata URLへ変換する', () => {
    const decoded = decodeEntityReferencePickerImage('/9j/AA==');

    expect(decoded).toEqual({
      dataUrl: 'data:image/jpeg;base64,/9j/AA==',
      sizeBytes: 4,
    });
  });

  it.each([
    ['PNG', 'iVBORw0KGgo=', 'data:image/png;base64,iVBORw0KGgo='],
    ['WebP', 'UklGRgAAAABXRUJQ', 'data:image/webp;base64,UklGRgAAAABXRUJQ'],
  ])('Backendが許可する%s signatureを対応するdata URLへ変換する', (
    _format,
    base64,
    dataUrl,
  ) => {
    expect(decodeEntityReferencePickerImage(base64)).toEqual({
      dataUrl,
      sizeBytes: base64 === 'iVBORw0KGgo=' ? 8 : 12,
    });
  });

  it('空・不正base64・JPEG signature不一致を送信前に拒否する', () => {
    for (const value of [null, '', 'not-base64', 'R0lGODlhAQAB']) {
      expect(() => decodeEntityReferencePickerImage(value)).toThrow(
        EntityReferenceImportImageError,
      );
    }
  });

  it('decode後5MiBは許可し1byte超過は拒否する', () => {
    const boundary = jpegBase64OfDecodedSize(MAX_ENTITY_REFERENCE_IMPORT_BYTES);
    const oversized = jpegBase64OfDecodedSize(MAX_ENTITY_REFERENCE_IMPORT_BYTES + 1);

    expect(decodeEntityReferencePickerImage(boundary).sizeBytes)
      .toBe(MAX_ENTITY_REFERENCE_IMPORT_BYTES);
    expect(() => decodeEntityReferencePickerImage(oversized)).toThrowError(
      expect.objectContaining({ reason: 'too_large' }),
    );
  });
});

function jpegBase64OfDecodedSize(sizeBytes: number): string {
  const encodedLength = 4 * Math.ceil(sizeBytes / 3);
  const paddingLength = (3 - (sizeBytes % 3)) % 3;
  return `/9j/${'A'.repeat(encodedLength - 4 - paddingLength)}${'='.repeat(paddingLength)}`;
}
