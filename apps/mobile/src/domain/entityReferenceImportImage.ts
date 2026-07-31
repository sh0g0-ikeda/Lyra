export const MAX_ENTITY_REFERENCE_IMPORT_BYTES = 5 * 1024 * 1024;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50] as const;

export type EntityReferenceImportImageErrorReason =
  | 'invalid'
  | 'missing'
  | 'too_large';

export class EntityReferenceImportImageError extends Error {
  public constructor(public readonly reason: EntityReferenceImportImageErrorReason) {
    super(`Entity reference import image is ${reason}`);
    this.name = 'EntityReferenceImportImageError';
  }
}

export interface EntityReferenceImportImage {
  dataUrl: string;
  sizeBytes: number;
}

export function decodeEntityReferencePickerImage(
  value: string | null | undefined,
): EntityReferenceImportImage {
  if (value === null || value === undefined || value.length === 0) {
    throw new EntityReferenceImportImageError('missing');
  }
  if (
    value !== value.trim()
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)
  ) {
    throw new EntityReferenceImportImageError('invalid');
  }

  const mimeType = detectImageMimeType(decodeBase64Prefix(value, 12));
  if (mimeType === null) {
    throw new EntityReferenceImportImageError('invalid');
  }

  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const sizeBytes = (value.length / 4) * 3 - padding;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw new EntityReferenceImportImageError('invalid');
  }
  if (sizeBytes > MAX_ENTITY_REFERENCE_IMPORT_BYTES) {
    throw new EntityReferenceImportImageError('too_large');
  }

  return {
    dataUrl: `data:${mimeType};base64,${value}`,
    sizeBytes,
  };
}

function decodeBase64Prefix(value: string, maxBytes: number): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < value.length && bytes.length < maxBytes; index += 4) {
    const first = BASE64_ALPHABET.indexOf(value[index] ?? '');
    const second = BASE64_ALPHABET.indexOf(value[index + 1] ?? '');
    const thirdCharacter = value[index + 2] ?? '=';
    const fourthCharacter = value[index + 3] ?? '=';
    const third = thirdCharacter === '=' ? 0 : BASE64_ALPHABET.indexOf(thirdCharacter);
    const fourth = fourthCharacter === '=' ? 0 : BASE64_ALPHABET.indexOf(fourthCharacter);

    bytes.push((first << 2) | (second >> 4));
    if (thirdCharacter !== '=' && bytes.length < maxBytes) {
      bytes.push(((second & 0x0f) << 4) | (third >> 2));
    }
    if (fourthCharacter !== '=' && bytes.length < maxBytes) {
      bytes.push(((third & 0x03) << 6) | fourth);
    }
  }
  return bytes;
}

function detectImageMimeType(bytes: readonly number[]): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (matchesBytes(bytes, 0, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (matchesBytes(bytes, 0, PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (
    matchesBytes(bytes, 0, RIFF_SIGNATURE)
    && matchesBytes(bytes, 8, WEBP_SIGNATURE)
  ) {
    return 'image/webp';
  }
  return null;
}

function matchesBytes(
  actual: readonly number[],
  offset: number,
  expected: readonly number[],
): boolean {
  return expected.every((value, index) => actual[offset + index] === value);
}
