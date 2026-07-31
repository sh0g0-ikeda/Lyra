import * as ImagePicker from 'expo-image-picker';
import {
  decodeEntityReferencePickerImage,
  type EntityReferenceImportImage,
} from '../domain/entityReferenceImportImage';

export interface EntityReferenceImagePickerPort {
  pick(): Promise<EntityReferenceImportImage | null>;
}

export async function pickEntityReferenceImage(): Promise<EntityReferenceImportImage | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    allowsEditing: false,
    allowsMultipleSelection: false,
    base64: true,
    exif: false,
    mediaTypes: ['images'],
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    quality: 0.85,
    selectionLimit: 1,
  });
  if (result.canceled) {
    return null;
  }

  return decodeEntityReferencePickerImage(result.assets[0]?.base64);
}

export const entityReferenceImagePicker: EntityReferenceImagePickerPort = {
  pick: pickEntityReferenceImage,
};
