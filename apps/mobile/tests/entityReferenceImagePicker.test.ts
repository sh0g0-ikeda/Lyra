import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ImagePicker from 'expo-image-picker';
import { pickEntityReferenceImage } from '../src/infrastructure/entityReferenceImagePicker';

vi.mock('expo-image-picker', () => ({
  UIImagePickerPreferredAssetRepresentationMode: {
    Compatible: 'compatible',
  },
  launchImageLibraryAsync: vi.fn(),
}));

describe('Entity reference image picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('画像1枚だけをbase64 JPEGとして選びEXIFを要求しない', async () => {
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      assets: [{
        assetId: null,
        base64: '/9j/AA==',
        duration: null,
        exif: null,
        fileName: 'home.jpg',
        fileSize: 4,
        height: 100,
        mimeType: 'image/jpeg',
        pairedVideoAsset: null,
        type: 'image',
        uri: 'file:///home.jpg',
        width: 100,
      }],
      canceled: false,
    });

    await expect(pickEntityReferenceImage()).resolves.toEqual({
      dataUrl: 'data:image/jpeg;base64,/9j/AA==',
      sizeBytes: 4,
    });
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({
      allowsEditing: false,
      allowsMultipleSelection: false,
      base64: true,
      exif: false,
      mediaTypes: ['images'],
      preferredAssetRepresentationMode: 'compatible',
      quality: 0.85,
      selectionLimit: 1,
    });
  });

  it('picker取消はerrorではなくnullを返す', async () => {
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      assets: null,
      canceled: true,
    });

    await expect(pickEntityReferenceImage()).resolves.toBeNull();
  });
});
