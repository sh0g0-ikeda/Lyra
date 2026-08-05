import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('キャラクター画像取込の端末互換性', () => {
  it('iOS互換表現とAndroid共通のBase64 fallback入力を要求する', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/screens/CharactersScreen.tsx'),
      'utf8',
    );

    expect(source).toContain('allowsMultipleSelection: false');
    expect(source).toContain('base64: true');
    expect(source).toContain('exif: false');
    expect(source).toContain('ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible');
  });
});
