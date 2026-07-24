import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ActionableErrorNotice } from '@/components/ActionableErrorNotice';
import { CharacterOutfitField } from '@/components/CharacterOutfitField';
import { EntityGenerationBlockers } from '@/components/EntityGenerationBlockers';
import { EntityReferenceUploadStatus } from '@/components/EntityReferenceUploadStatus';
import { FormField } from '@/components/FormField';
import { ImagePreviewModal } from '@/components/ImagePreviewModal';
import { JobStatusCard } from '@/components/JobStatusCard';
import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RecordPicker } from '@/components/RecordPicker';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { SegmentedControl } from '@/components/SegmentedControl';
import { WorkspaceContextPicker, useWorkspaceContextSelection } from '@/components/WorkspaceContextPicker';
import { entityTypes, type LabelOption } from '@/constants/options';
import { colors, spacing, textStyles } from '@/constants/theme';
import { mergeCharacterClothingDescription } from '@/domain/characterClothing';
import { entityDirtySaveIntent } from '@/domain/editorDirtyPolicy';
import {
  buildEntityReferenceGenerationBlockers,
  buildSingleCandidateConfirmation,
  selectSingleReferenceCandidate,
  type EntityReferenceCandidate,
  type EntityReferenceGenerationBlockerCode
} from '@/domain/entityReferencePolicy';
import type { EntityReferenceUploadMimeType } from '@/domain/payloads';
import type { EntityStateRecord, EntityType, GenerationJobRecord, SceneRecord } from '@/domain/types';
import { useActiveResourceJobId } from '@/hooks/useActiveResourceJobId';
import { config } from '@/lib/config';
import { confirmAction, confirmDestructiveAction } from '@/lib/confirm';
import {
  DirectEntityUploadError,
  uploadAndImportEntityReference,
  type BinaryUploadSource,
  type DirectEntityUploadStage
} from '@/lib/directEntityReferenceUpload';
import {
  entitiesInfiniteQueryKey,
  entitiesQueryKey,
  entityDetailQueryKey,
  entityReferenceSetQueryKey,
  entityStatesQueryKey,
  jobQueryKey,
  scenesQueryKey,
} from '@/lib/queryKeys';
import { t } from '@/lib/i18n';
import type { ScreenTranslationKey } from '@/lib/i18nScreenMessages';
import {
  entityGenerationBlockerRecoveryTarget
} from '@/lib/errorRecovery';
import { appendOrganizationQuery, downloadAuthenticatedFile } from '@/lib/download';
import { createExpoBinaryUploadFile } from '@/lib/expoBinaryUpload';
import { ApiError } from '@/lib/api';
import {
  flattenUniqueRecords,
  MOBILE_LIST_PAGE_SIZE,
  nextCursorFromPage,
} from '@/lib/listPagination';
import type { MobileTabParamList } from '@/navigation/tabs';
import { useAppState } from '@/state/appState';
import { useDirtyEditorRegistration, useDirtyState } from '@/state/dirtyState';

type DraftRecord = Record<string, string>;
type ImageRequestHeaders = Record<string, string>;
interface EntityStateDraft {
  sceneId: string | null;
  costumeNote: string;
  conditionNote: string;
  hairNote: string;
  expressionDefault: string;
  extraNote: string;
}

interface EntityStateSceneOption {
  id: string;
  sceneId: string | null;
  label: string;
}

interface PendingEntityReferenceUpload {
  entityId: string | null;
  entityType: EntityType;
  mimeType: EntityReferenceUploadMimeType;
  sizeBytes: number;
  source: BinaryUploadSource;
  uploadToken: string | null;
}

const MAX_IMPORT_IMAGE_BYTES = 5 * 1024 * 1024;
const isResourceStaleError = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'RESOURCE_STALE';
const NO_SCENE_OPTION_ID = '__no-scene__';

const emptyEntityStateDraft = (): EntityStateDraft => ({
  sceneId: null,
  costumeNote: '',
  conditionNote: '',
  hairNote: '',
  expressionDefault: 'neutral',
  extraNote: '',
});

const nullable = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const entityStateDraftFromRecord = (entityState: EntityStateRecord | null): EntityStateDraft =>
  entityState === null
    ? emptyEntityStateDraft()
    : {
        sceneId: entityState.scene_id,
        costumeNote: entityState.costume_note ?? '',
        conditionNote: entityState.condition_note ?? '',
        hairNote: entityState.hair_note ?? '',
        expressionDefault: entityState.expression_default,
        extraNote: entityState.extra_note ?? '',
      };

const entityStateLabel = (entityState: EntityStateRecord, language: 'ja' | 'en'): string => {
  const appearance = entityState.costume_note ?? entityState.condition_note ?? entityState.hair_note;
  const fallback = t(language, "generated.screens.CharactersScreen.state.eeaa111e");
  return `${appearance ?? fallback} · ${entityState.expression_default}`;
};

const sceneLabel = (scene: SceneRecord, language: 'ja' | 'en'): string => {
  const details = [scene.location, scene.time, scene.atmosphere].filter((value): value is string => value !== null);
  const fallback = t(language, "generated.screens.CharactersScreen.scene.38cab595");
  return `${scene.order}. ${details.join(' · ') || fallback}`;
};

const resolveAllowedMimeType = (asset: ImagePicker.ImagePickerAsset): EntityReferenceUploadMimeType | null => {
  const sourceName = `${asset.uri} ${asset.fileName ?? ''}`.toLowerCase();
  if (asset.mimeType === 'image/png' || sourceName.includes('.png')) {
    return 'image/png';
  }
  if (asset.mimeType === 'image/webp' || sourceName.includes('.webp')) {
    return 'image/webp';
  }
  if (
    asset.mimeType === 'image/jpeg' ||
    sourceName.includes('.jpg') ||
    sourceName.includes('.jpeg')
  ) {
    return 'image/jpeg';
  }
  return null;
};

const readString = (record: Record<string, unknown>, key: string): string =>
  typeof record[key] === 'string' ? record[key] : '';

const toRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const draftFromRecord = (record: Record<string, unknown>, keys: string[]): DraftRecord =>
  Object.fromEntries(keys.map((key) => [key, readString(record, key)]));

const extrasFromRecord = (record: Record<string, unknown>, keys: string[]): string => {
  const knownKeys = new Set(keys);
  const extras = Object.fromEntries(Object.entries(record).filter(([key]) => !knownKeys.has(key)));
  return Object.keys(extras).length === 0 ? '' : JSON.stringify(extras, null, 2);
};

const safeParseRecord = (value: string): Record<string, unknown> => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const splitCsv = (value: string): string[] =>
  value
    .split(/,|\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const assignOrDelete = (target: Record<string, unknown>, key: string, value: string): void => {
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    target[key] = trimmed;
    return;
  }
  delete target[key];
};

const assignArrayOrDelete = (target: Record<string, unknown>, key: string, value: string): void => {
  const entries = splitCsv(value);
  if (entries.length > 0) {
    target[key] = entries;
    return;
  }
  delete target[key];
};

const assignRecordOrDelete = (target: Record<string, unknown>, key: string, value: Record<string, unknown>): void => {
  if (Object.keys(value).length > 0) {
    target[key] = value;
    return;
  }
  delete target[key];
};

const extractGeneratedReferenceCandidates = (job: GenerationJobRecord | undefined): EntityReferenceCandidate[] => {
  if (
    job === undefined ||
    job.job_type !== 'entity_generate' ||
    job.status !== 'completed' ||
    job.result === null ||
    !Array.isArray(job.result.candidates)
  ) {
    return [];
  }

  if (job.result.provider_result === false) {
    return [];
  }

  return job.result.candidates.flatMap((candidate) => {
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      Array.isArray(candidate) ||
      typeof (candidate as { candidate_token?: unknown }).candidate_token !== 'string'
    ) {
      return [];
    }

    return [
      {
        candidate_token: (candidate as { candidate_token: string }).candidate_token,
        ...(typeof (candidate as { cdn_url?: unknown }).cdn_url === 'string'
          ? { cdn_url: (candidate as { cdn_url: string }).cdn_url }
          : {}),
        source: 'generated' as const
      }
    ];
  });
};

const candidateImageUri = (
  entityId: string | null,
  candidateToken: string,
  organizationId: string | null
): string | null => {
  if (entityId === null || candidateToken.trim().length === 0) {
    return null;
  }

  const params = new URLSearchParams({ candidate_token: candidateToken.trim() });
  if (organizationId !== null && organizationId.trim().length > 0) {
    params.set('organization_id', organizationId);
  }

  const baseUrl = config.apiBaseUrl.replace(/\/+$/, '');
  return `${baseUrl}/api/entities/${encodeURIComponent(entityId)}/reference-candidate-image?${params.toString()}`;
};

const referenceImageUri = (
  entityId: string | null,
  refId: string,
  organizationId: string | null,
  revision: string
): string | null => {
  if (entityId === null || refId.trim().length === 0) {
    return null;
  }
  const baseUrl = config.apiBaseUrl.replace(/\/+$/, '');
  const path = appendOrganizationQuery(
    `/api/entities/${encodeURIComponent(entityId)}/reference/${encodeURIComponent(refId)}/image`,
    organizationId
  );
  return `${baseUrl}${path}${path.includes('?') ? '&' : '?'}revision=${encodeURIComponent(revision)}`;
};

interface ReferenceCandidatePreviewProps {
  candidate: EntityReferenceCandidate;
  fallbackUri: string | null;
  headers: ImageRequestHeaders | undefined;
  language: 'ja' | 'en';
  onOpen: (uri: string, headers?: ImageRequestHeaders) => void;
}

function ReferenceCandidatePreview({
  candidate,
  fallbackUri,
  headers,
  language,
  onOpen
}: ReferenceCandidatePreviewProps): React.JSX.Element {
  const directUri = candidate.cdn_url?.trim() ?? '';
  const [directUriFailed, setDirectUriFailed] = useState(false);
  const [fallbackUriFailed, setFallbackUriFailed] = useState(false);

  useEffect(() => {
    setDirectUriFailed(false);
    setFallbackUriFailed(false);
  }, [directUri, fallbackUri]);

  const useDirectUri = directUri.length > 0 && !directUriFailed;
  const uri = useDirectUri ? directUri : fallbackUri;
  if (uri === null || (!useDirectUri && fallbackUriFailed)) {
    return (
      <View style={styles.candidateImageError}>
        <Text style={styles.caption}>{t(language, "generated.screens.CharactersScreen.could.not.load.image.c9ff565e")}</Text>
      </View>
    );
  }

  const requestHeaders = useDirectUri ? undefined : headers;
  return (
    <Pressable
      accessibilityLabel={t(language, "generated.components.ImagePreviewModal.image.preview.0f884bd2")}
      accessibilityRole="imagebutton"
      onPress={() => onOpen(uri, requestHeaders)}
    >
      <Image
        onError={() => {
          if (useDirectUri) {
            setDirectUriFailed(true);
            return;
          }
          setFallbackUriFailed(true);
        }}
        resizeMode="cover"
        source={requestHeaders === undefined ? { uri } : { uri, headers: requestHeaders }}
        style={styles.candidateImage}
      />
    </Pressable>
  );
}

const formatReferenceStatus = (status: string | undefined, language: 'ja' | 'en'): string => {
  if (status === undefined) {
    return '-';
  }

  const labels: Record<string, ScreenTranslationKey> = {
    empty: 'screen.characters.referenceStatus.empty',
    partial: 'screen.characters.referenceStatus.partial',
    ready: 'screen.characters.referenceStatus.ready'
  };
  const label = labels[status];
  if (label === undefined) {
    return status;
  }
  return t(language, label);
};

const generationBlockerMessage = (
  code: EntityReferenceGenerationBlockerCode,
  language: 'ja' | 'en'
): string => {
  const messages: Record<EntityReferenceGenerationBlockerCode, ScreenTranslationKey> = {
    ACTIVE_PREVIEW_JOB: 'screen.characters.referenceBlocker.activePreviewJob',
    ENTITY_SAVE_REQUIRED: 'screen.characters.referenceBlocker.entitySaveRequired',
    IMPORT_IN_PROGRESS: 'screen.characters.referenceBlocker.importInProgress',
    INSUFFICIENT_CREDITS: 'screen.characters.referenceBlocker.insufficientCredits',
    NAME_REQUIRED: 'screen.characters.referenceBlocker.nameRequired',
    PERMISSION_REQUIRED: 'screen.characters.referenceBlocker.permissionRequired',
    FEATURE_DISABLED: 'screen.characters.referenceBlocker.featureDisabled',
    UNSUPPORTED_TYPE: 'screen.characters.referenceBlocker.unsupportedType'
  };
  return t(language, messages[code]);
};

const toPayloadRecord = (draft: DraftRecord, extras: string): Record<string, unknown> => {
  const payload: Record<string, unknown> = { ...safeParseRecord(extras) };
  Object.entries(draft).forEach(([key, value]) => {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      payload[key] = trimmed;
    } else {
      delete payload[key];
    }
  });
  return payload;
};

const characterFieldKeys = [
  'aliases',
  'gender_expression',
  'age_range',
  'skin_tone',
  'first_impression',
  'standing_style',
  'default_expression',
  'height',
  'build',
  'art_style',
  'visual_anchor',
  'signature_feature',
  'silhouette_keywords',
  'distinguishing_features',
  'head_to_body_ratio',
  'shoulder_width',
  'leg_length',
  'posture_axis',
  'face_shape',
  'eyebrow_shape',
  'nose_shape',
  'mouth_shape',
  'eye_color',
  'eye_shape',
  'eyelid_type',
  'eye_size',
  'eye_angle',
  'pupil_style',
  'under_eye_detail',
  'mouth_default',
  'hair_color',
  'hair_length',
  'hair_style',
  'hair_arrangement',
  'hair_bangs',
  'hair_front_shape',
  'hair_side_hair',
  'hair_back_shape',
  'clothing_category',
  'clothing_main_color',
  'clothing_impression',
  'collar_shape',
  'sleeve_length',
  'skirt_or_pants_shape',
  'clothing_description',
  'shoes',
  'socks_or_legwear'
];

const genericFieldKeys = [
  'category',
  'shape',
  'size',
  'main_color',
  'material',
  'surface_texture',
  'condition',
  'signature_feature',
  'function',
  'movement',
  'visual_anchor'
];

const genericFieldLabels: Record<string, ScreenTranslationKey> = {
  category: 'screen.characters.genericField.category',
  shape: 'screen.characters.genericField.shape',
  size: 'screen.characters.genericField.size',
  main_color: 'screen.characters.genericField.mainColor',
  material: 'screen.characters.genericField.material',
  surface_texture: 'screen.characters.genericField.surfaceTexture',
  condition: 'screen.characters.genericField.condition',
  signature_feature: 'screen.characters.genericField.signatureFeature',
  function: 'screen.characters.genericField.function',
  movement: 'screen.characters.genericField.movement',
  visual_anchor: 'screen.characters.genericField.visualAnchor'
};

const recommendedCharacterKeys = [
  'gender_expression',
  'age_range',
  'first_impression',
  'default_expression',
  'height',
  'build',
  'visual_anchor',
  'signature_feature',
  'hair_color',
  'hair_length',
  'hair_style',
  'clothing_category',
  'clothing_main_color',
  'clothing_description'
];

const nonhumanBaseForms = ['dragon', 'wolf', 'spirit', 'robot', 'zombie', 'deity', 'custom'] as const;
const nonhumanSizes = ['tiny', 'small', 'human_scale', 'large', 'enormous'] as const;
const nonhumanMovements = ['bipedal', 'quadruped', 'flying', 'floating', 'slithering', 'custom'] as const;
const nonhumanThreatLevels = ['harmless', 'low', 'medium', 'high', 'catastrophic'] as const;
const genericArtStyles = ['anime', 'semi_realistic', 'manga', 'painterly'] as const;
const objectCategories = ['weapon', 'tool', 'vehicle', 'structure', 'consumable', 'magical', 'custom'] as const;
const objectMaterials = ['metal', 'wood', 'stone', 'crystal', 'organic', 'energy', 'custom'] as const;
const objectSizes = ['small', 'medium', 'large', 'enormous'] as const;

const enumValue = <T extends string>(value: string, allowedValues: readonly T[]): T | undefined => {
  const trimmed = value.trim();
  return allowedValues.includes(trimmed as T) ? (trimmed as T) : undefined;
};

const appendFeature = (features: string[], label: string, value: string): void => {
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    features.push(`${label}: ${trimmed}`);
  }
};

const characterDraftFromStructuredFields = (record: Record<string, unknown>): DraftRecord => {
  const hair = toRecord(record.hair);
  const eyes = toRecord(record.eyes);
  const clothing = toRecord(record.clothing);
  const characterIdentity = toRecord(record.character_identity);
  const proportions = toRecord(record.proportions);
  const faceDetail = toRecord(record.face_detail);
  const hairDetail = toRecord(record.hair_detail);
  const outfitDetail = toRecord(record.outfit_detail);
  const silhouetteKeywords = Array.isArray(characterIdentity.silhouette_keywords)
    ? characterIdentity.silhouette_keywords.filter((entry): entry is string => typeof entry === 'string').join(', ')
    : readString(record, 'silhouette_keywords');
  const aliases = Array.isArray(characterIdentity.aliases)
    ? characterIdentity.aliases.filter((entry): entry is string => typeof entry === 'string').join(', ')
    : readString(record, 'aliases');

  return {
    aliases,
    gender_expression: readString(record, 'gender_expression'),
    age_range: readString(record, 'age_range'),
    skin_tone: readString(record, 'skin_tone'),
    first_impression: readString(record, 'first_impression'),
    standing_style: readString(record, 'standing_style'),
    default_expression: readString(record, 'default_expression'),
    height: readString(record, 'height'),
    build: readString(record, 'build'),
    art_style: readString(record, 'art_style'),
    visual_anchor: readString(characterIdentity, 'visual_anchor') || readString(record, 'visual_anchor'),
    signature_feature: readString(characterIdentity, 'signature_feature') || readString(record, 'signature_feature'),
    silhouette_keywords: silhouetteKeywords,
    distinguishing_features: readString(record, 'distinguishing_features'),
    head_to_body_ratio: readString(proportions, 'head_to_body_ratio') || readString(record, 'head_to_body_ratio'),
    shoulder_width: readString(proportions, 'shoulder_width') || readString(record, 'shoulder_width'),
    leg_length: readString(proportions, 'leg_length') || readString(record, 'leg_length'),
    posture_axis: readString(proportions, 'posture_axis') || readString(record, 'posture_axis'),
    face_shape: readString(record, 'face_shape'),
    eyebrow_shape: readString(record, 'eyebrow_shape'),
    nose_shape: readString(record, 'nose_shape'),
    mouth_shape: readString(record, 'mouth_shape'),
    eye_color: readString(eyes, 'color') || readString(record, 'eye_color'),
    eye_shape: readString(eyes, 'shape') || readString(record, 'eye_shape'),
    eyelid_type: readString(eyes, 'eyelid_type') || readString(record, 'eyelid_type'),
    eye_size: readString(faceDetail, 'eye_size') || readString(record, 'eye_size'),
    eye_angle: readString(faceDetail, 'eye_angle') || readString(record, 'eye_angle'),
    pupil_style: readString(faceDetail, 'pupil_style') || readString(record, 'pupil_style'),
    under_eye_detail: readString(faceDetail, 'under_eye_detail') || readString(record, 'under_eye_detail'),
    mouth_default: readString(faceDetail, 'mouth_default') || readString(record, 'mouth_default'),
    hair_color: readString(hair, 'color') || readString(record, 'hair_color'),
    hair_length: readString(hair, 'length') || readString(record, 'hair_length'),
    hair_style: readString(hair, 'style') || readString(record, 'hair_style'),
    hair_arrangement: readString(hair, 'arrangement') || readString(record, 'hair_arrangement'),
    hair_bangs: readString(hair, 'bangs') || readString(record, 'hair_bangs'),
    hair_front_shape: readString(hairDetail, 'front_shape') || readString(record, 'hair_front_shape'),
    hair_side_hair: readString(hairDetail, 'side_hair') || readString(record, 'hair_side_hair'),
    hair_back_shape: readString(hairDetail, 'back_shape') || readString(record, 'hair_back_shape'),
    clothing_category: readString(clothing, 'category') || readString(record, 'clothing_category'),
    clothing_main_color: readString(clothing, 'main_color') || readString(record, 'clothing_main_color'),
    clothing_impression: readString(clothing, 'impression') || readString(record, 'clothing_impression'),
    collar_shape: readString(outfitDetail, 'collar_shape') || readString(record, 'collar_shape'),
    sleeve_length: readString(outfitDetail, 'sleeve_length') || readString(record, 'sleeve_length'),
    skirt_or_pants_shape: readString(outfitDetail, 'skirt_or_pants_shape') || readString(record, 'skirt_or_pants_shape'),
    clothing_description: readString(clothing, 'description') || readString(record, 'clothing_description'),
    shoes: readString(outfitDetail, 'shoes') || readString(record, 'shoes'),
    socks_or_legwear: readString(outfitDetail, 'socks_or_legwear') || readString(record, 'socks_or_legwear')
  };
};

const genericDraftFromStructuredFields = (record: Record<string, unknown>, entityType: EntityType): DraftRecord => {
  const distinctiveFeatures = readString(record, 'distinctive_features');
  return {
    category: entityType === 'nonhuman' ? readString(record, 'base_form') || readString(record, 'category') : readString(record, 'category'),
    shape: readString(record, 'shape'),
    size: readString(record, 'size'),
    main_color: readString(record, 'main_color'),
    material: readString(record, 'material'),
    surface_texture: readString(record, 'surface_texture'),
    condition: readString(record, 'condition'),
    signature_feature: readString(record, 'signature_feature') || distinctiveFeatures,
    function: readString(record, 'function'),
    movement: readString(record, 'movement'),
    visual_anchor: readString(record, 'visual_anchor')
  };
};

const structuredDraftFromRecord = (record: Record<string, unknown>, entityType: EntityType): DraftRecord =>
  entityType === 'character'
    ? characterDraftFromStructuredFields(record)
    : genericDraftFromStructuredFields(record, entityType);

const styleReferenceFromExtras = (extras: string): Record<string, unknown> | undefined => {
  const parsed = safeParseRecord(extras);
  const styleReference = toRecord(parsed.style_reference);
  const title = readString(styleReference, 'title').trim();
  if (title.length === 0) {
    return undefined;
  }
  return {
    title,
    notes: nullable(readString(styleReference, 'notes'))
  };
};

const toCharacterStructuredFieldsPayload = (draft: DraftRecord, extras: string): Record<string, unknown> => {
  const structuredFields = safeParseRecord(extras);
  assignOrDelete(structuredFields, 'gender_expression', draft.gender_expression ?? '');
  assignOrDelete(structuredFields, 'age_range', draft.age_range ?? '');
  assignOrDelete(structuredFields, 'skin_tone', draft.skin_tone ?? '');
  assignOrDelete(structuredFields, 'first_impression', draft.first_impression ?? '');
  assignOrDelete(structuredFields, 'standing_style', draft.standing_style ?? '');
  assignOrDelete(structuredFields, 'default_expression', draft.default_expression ?? '');
  assignOrDelete(structuredFields, 'face_shape', draft.face_shape ?? '');
  assignOrDelete(structuredFields, 'eyebrow_shape', draft.eyebrow_shape ?? '');
  assignOrDelete(structuredFields, 'nose_shape', draft.nose_shape ?? '');
  assignOrDelete(structuredFields, 'mouth_shape', draft.mouth_shape ?? '');
  assignOrDelete(structuredFields, 'height', draft.height ?? '');
  assignOrDelete(structuredFields, 'build', draft.build ?? '');
  assignOrDelete(structuredFields, 'distinguishing_features', draft.distinguishing_features ?? '');
  assignOrDelete(structuredFields, 'art_style', draft.art_style ?? '');

  const hair = { ...toRecord(structuredFields.hair) };
  assignOrDelete(hair, 'color', draft.hair_color ?? '');
  assignOrDelete(hair, 'length', draft.hair_length ?? '');
  assignOrDelete(hair, 'style', draft.hair_style ?? '');
  assignOrDelete(hair, 'arrangement', draft.hair_arrangement ?? '');
  assignOrDelete(hair, 'bangs', draft.hair_bangs ?? '');
  assignRecordOrDelete(structuredFields, 'hair', hair);

  const eyes = { ...toRecord(structuredFields.eyes) };
  assignOrDelete(eyes, 'color', draft.eye_color ?? '');
  assignOrDelete(eyes, 'shape', draft.eye_shape ?? '');
  assignOrDelete(eyes, 'eyelid_type', draft.eyelid_type ?? '');
  assignRecordOrDelete(structuredFields, 'eyes', eyes);

  const clothingChoices = { ...toRecord(structuredFields.clothing) };
  assignOrDelete(clothingChoices, 'category', draft.clothing_category ?? '');
  assignOrDelete(clothingChoices, 'main_color', draft.clothing_main_color ?? '');
  assignOrDelete(clothingChoices, 'impression', draft.clothing_impression ?? '');
  const clothing = mergeCharacterClothingDescription(
    clothingChoices,
    draft.clothing_description ?? '',
  );
  assignRecordOrDelete(structuredFields, 'clothing', clothing);

  const characterIdentity = { ...toRecord(structuredFields.character_identity) };
  assignArrayOrDelete(characterIdentity, 'aliases', draft.aliases ?? '');
  assignOrDelete(characterIdentity, 'visual_anchor', draft.visual_anchor ?? '');
  assignOrDelete(characterIdentity, 'signature_feature', draft.signature_feature ?? '');
  assignArrayOrDelete(characterIdentity, 'silhouette_keywords', draft.silhouette_keywords ?? '');
  assignRecordOrDelete(structuredFields, 'character_identity', characterIdentity);

  const proportions = { ...toRecord(structuredFields.proportions) };
  assignOrDelete(proportions, 'head_to_body_ratio', draft.head_to_body_ratio ?? '');
  assignOrDelete(proportions, 'shoulder_width', draft.shoulder_width ?? '');
  assignOrDelete(proportions, 'leg_length', draft.leg_length ?? '');
  assignOrDelete(proportions, 'posture_axis', draft.posture_axis ?? '');
  assignRecordOrDelete(structuredFields, 'proportions', proportions);

  const faceDetail = { ...toRecord(structuredFields.face_detail) };
  assignOrDelete(faceDetail, 'eye_size', draft.eye_size ?? '');
  assignOrDelete(faceDetail, 'eye_angle', draft.eye_angle ?? '');
  assignOrDelete(faceDetail, 'pupil_style', draft.pupil_style ?? '');
  assignOrDelete(faceDetail, 'under_eye_detail', draft.under_eye_detail ?? '');
  assignOrDelete(faceDetail, 'mouth_default', draft.mouth_default ?? '');
  assignRecordOrDelete(structuredFields, 'face_detail', faceDetail);

  const hairDetail = { ...toRecord(structuredFields.hair_detail) };
  assignOrDelete(hairDetail, 'front_shape', draft.hair_front_shape ?? '');
  assignOrDelete(hairDetail, 'side_hair', draft.hair_side_hair ?? '');
  assignOrDelete(hairDetail, 'back_shape', draft.hair_back_shape ?? '');
  assignRecordOrDelete(structuredFields, 'hair_detail', hairDetail);

  const outfitDetail = { ...toRecord(structuredFields.outfit_detail) };
  assignOrDelete(outfitDetail, 'collar_shape', draft.collar_shape ?? '');
  assignOrDelete(outfitDetail, 'sleeve_length', draft.sleeve_length ?? '');
  assignOrDelete(outfitDetail, 'skirt_or_pants_shape', draft.skirt_or_pants_shape ?? '');
  assignOrDelete(outfitDetail, 'shoes', draft.shoes ?? '');
  assignOrDelete(outfitDetail, 'socks_or_legwear', draft.socks_or_legwear ?? '');
  assignRecordOrDelete(structuredFields, 'outfit_detail', outfitDetail);

  const styleReference = styleReferenceFromExtras(extras);
  if (styleReference !== undefined) {
    structuredFields.style_reference = styleReference;
  }

  return structuredFields;
};

const toGenericStructuredFieldsPayload = (entityType: EntityType, draft: DraftRecord): Record<string, unknown> => {
  const structuredFields: Record<string, unknown> = {};
  const features: string[] = [];

  if (entityType === 'nonhuman') {
    const baseForm = enumValue(draft.category ?? '', nonhumanBaseForms);
    const size = enumValue(draft.size ?? '', nonhumanSizes);
    const movement = enumValue(draft.movement ?? '', nonhumanMovements);
    if (baseForm === undefined) appendFeature(features, 'category', draft.category ?? '');
    else structuredFields.base_form = baseForm;
    if (size === undefined) appendFeature(features, 'size', draft.size ?? '');
    else structuredFields.size = size;
    if (movement === undefined) appendFeature(features, 'movement', draft.movement ?? '');
    else structuredFields.movement = movement;
    const threatLevel = enumValue((draft.threat_level ?? ''), nonhumanThreatLevels);
    if (threatLevel !== undefined) structuredFields.threat_level = threatLevel;
    const artStyle = enumValue((draft.art_style ?? ''), genericArtStyles);
    if (artStyle !== undefined) structuredFields.art_style = artStyle;
  } else {
    const category = enumValue(draft.category ?? '', objectCategories);
    const material = enumValue(draft.material ?? '', objectMaterials);
    const size = enumValue(draft.size ?? '', objectSizes);
    if (category === undefined) appendFeature(features, 'category', draft.category ?? '');
    else structuredFields.category = category;
    if (material === undefined) appendFeature(features, 'material', draft.material ?? '');
    else structuredFields.material = material;
    if (size === undefined) appendFeature(features, 'size', draft.size ?? '');
    else structuredFields.size = size;
  }

  appendFeature(features, 'shape', draft.shape ?? '');
  appendFeature(features, 'main_color', draft.main_color ?? '');
  appendFeature(features, 'surface_texture', draft.surface_texture ?? '');
  appendFeature(features, 'condition', draft.condition ?? '');
  appendFeature(features, 'signature_feature', draft.signature_feature ?? '');
  appendFeature(features, 'function', draft.function ?? '');
  if (entityType !== 'nonhuman') {
    appendFeature(features, 'movement', draft.movement ?? '');
  }
  appendFeature(features, 'visual_anchor', draft.visual_anchor ?? '');

  if (features.length > 0) {
    structuredFields.distinctive_features = features.join('\n');
  }

  return structuredFields;
};

const toStructuredFieldsPayload = (entityType: EntityType, draft: DraftRecord, extras: string): Record<string, unknown> =>
  entityType === 'character'
    ? toCharacterStructuredFieldsPayload(draft, extras)
    : toGenericStructuredFieldsPayload(entityType, draft);

const speechFieldKeys = [
  'first_person',
  'second_person',
  'tone',
  'politeness',
  'sentence_ending',
  'catchphrase',
  'speech_notes'
];

const japaneseOptionLabels: Record<string, string> = {
  Accessory: 'アクセサリー',
  'Accessory / prop': 'アクセサリー・小道具',
  Ahoge: 'アホ毛',
  Beard: 'ひげ',
  'Beauty mark': 'ほくろ',
  'Broad-shouldered': '肩幅広め',
  'Color blocking': '色面の切り分け',
  'Compact silhouette': 'コンパクトなシルエット',
  Earrings: 'イヤリング',
  'Expression gap': '表情のギャップ',
  'Eye bags': '目の下のくま',
  'Eye color contrast': '目の色の対比',
  'Eye line': '目線',
  'Face + hair balance': '顔と髪のバランス',
  Fang: '八重歯',
  Glasses: '眼鏡',
  Goatee: 'あごひげ',
  'Hair shape': '髪型',
  'Hair streak': 'メッシュ',
  'Long coat outline': 'ロングコートの輪郭',
  'Military block': '軍服らしい面構成',
  'Outfit shape': '服の形',
  'Posture read': '姿勢の読み取りやすさ',
  Scar: '傷跡',
  'Scar / mark': '傷跡・印',
  'Sharp jawline': '鋭い顎のライン',
  'Silhouette edge': 'シルエットの端',
  'Silhouette outline': 'シルエット輪郭',
  'Skirt line': 'スカートライン',
  'Soft rounded outline': '柔らかい丸みの輪郭',
  Stance: '立ち姿',
  Stubble: '無精ひげ',
  'Tall and slender': '背が高く細身',
  'Thick eyebrows': '太い眉',
  ageless: '年齢不詳',
  'about eight heads tall': '8頭身くらい',
  'about seven and a half heads tall': '7.5頭身くらい',
  'about seven heads tall': '7頭身くらい',
  'about six and a half heads tall': '6.5頭身くらい',
  'about six heads tall': '6頭身くらい',
  androgynous: '中性的',
  anime: 'アニメ調',
  'ankle socks': 'くるぶし丈ソックス',
  armor: '鎧',
  arms_crossed: '腕組み',
  ash_blonde: 'アッシュブロンド',
  athletic: '引き締まった体型',
  auburn: '赤茶',
  average: '標準',
  'balanced eyes': '標準的な目',
  'balanced leg length': '標準的な脚の長さ',
  'balanced shoulders': '標準的な肩幅',
  'bare legs': '素足',
  black: '黒',
  blonde: '金髪',
  blue: '青',
  blunt: 'ぱっつん',
  'blunt front': 'ぱっつん前髪',
  boots: 'ブーツ',
  bored_gaze: '退屈そうな目線',
  braid: '三つ編み',
  'braided back': '編み込んだ後ろ髪',
  'bright reflective pupils': '明るい反射の瞳',
  bright_friendly: '明るく親しみやすい',
  broad: '肩幅広め',
  'broad shoulders': '広い肩幅',
  brown: '茶色',
  bun: 'お団子',
  business_casual: 'ビジネスカジュアル',
  button: '丸い小鼻',
  buzz_cut: '坊主',
  calm_neutral: '穏やかな無表情',
  'cargo pants': 'カーゴパンツ',
  casual: 'カジュアル',
  center_part: 'センター分け',
  center_parted: 'センター分け',
  'centered and straight': 'まっすぐ中心軸',
  'center-parted front': 'センター分け前髪',
  cheerful_smile: '快活な笑顔',
  child: '子ども',
  'clean bob back': '整ったボブの後ろ髪',
  'closed neutral mouth': '閉じた自然な口元',
  coarse: '硬め',
  'combat boots': 'コンバットブーツ',
  'combat utility details': '戦闘用の実用ディテール',
  'comma front': 'コンマ風前髪',
  comma_hair: 'コンマヘア',
  confident_open: '自信があり開いた姿勢',
  confident_smirk: '自信のある笑み',
  cool_distant: 'クールで距離感がある',
  cool_unfazed: 'クールで動じない',
  crew_cut: 'クルーカット',
  curly: 'カール',
  curtain: 'カーテンバング',
  'curtain front': 'カーテン風前髪',
  curvy: '曲線的',
  custom: '自由入力',
  cute: 'かわいい',
  dark_brown: '濃い茶色',
  deep: '濃い肌',
  'defined lower lash line': '下まつげの線あり',
  diamond: 'ダイヤ型',
  double: '二重',
  down: '下ろし髪',
  'dress shoes': '革靴',
  'drooping eyes': 'たれ目',
  'ear-length sides': '耳丈の横髪',
  early_teens: '10代前半',
  elegant: '上品',
  elegant_upright: '上品な直立',
  energetic_bold: '元気で大胆',
  fade_cut: 'フェードカット',
  'faded sides': 'フェードした横髪',
  fair: '色白',
  fantasy: 'ファンタジー',
  female: '女性',
  'firm straight mouth': 'きゅっと結んだ口',
  fluffy: 'ふんわり',
  formal: 'フォーマル',
  formal_dress: 'フォーマルドレス',
  forties_plus: '40代以上',
  full: 'ふっくら',
  gentle: 'やさしい',
  gentle_soft: 'やさしく柔らかい',
  gold: '金色',
  gothic: 'ゴシック',
  gray: '灰色',
  green: '緑',
  guarded_stance: '警戒した姿勢',
  half_up: 'ハーフアップ',
  hands_in_pockets: 'ポケットに手',
  heart: 'ハート型',
  heavy: '重め',
  'heavy eye bags': '濃い目のくま',
  heels: 'ヒール',
  high_arch: '高いアーチ',
  'hooded neckline': 'フード付き襟元',
  hoodie: 'パーカー',
  idol_stage: 'アイドル衣装',
  japanese: '和風',
  jeans: 'ジーンズ',
  'knee socks': 'ひざ丈ソックス',
  lab_coat: '白衣',
  large: '大きめ',
  'large eyes': '大きい目',
  'large pupils': '大きい瞳',
  late_teens: '10代後半',
  'layered back': 'レイヤーの後ろ髪',
  'layered practical details': '実用的な重ね着ディテール',
  lean: '引き締まった細身',
  'level eye line': '水平な目元',
  light: '明るめ',
  loafers: 'ローファー',
  long: '長い',
  'long legs': '長い脚',
  'long loose back': '長く下ろした後ろ髪',
  'long side locks': '長い横髪',
  'long skirt': 'ロングスカート',
  'long sleeves': '長袖',
  long_bangs: '長い前髪',
  long_straight: 'ロングストレート',
  male: '男性',
  man_bun: 'マンバン',
  manga: '漫画調',
  mature_composed: '大人びて落ち着いた',
  medium: '中くらい',
  medium_layered: 'ミディアムレイヤー',
  'messy front': '無造作な前髪',
  messy_bangs: '無造作な前髪',
  messy_short: '無造作ショート',
  military: '軍服',
  'minimal clean design': 'ミニマルで整ったデザイン',
  muscular: '筋肉質',
  mysterious_fragile: '神秘的で儚い',
  narrow: '細い',
  'narrow shoulders': '狭い肩幅',
  natural_relaxed: '自然でリラックス',
  navy: '紺',
  none: 'なし',
  'none visible': '目立つ要素なし',
  'open outward posture': '外へ開いた姿勢',
  'ornamental trim': '装飾的な縁取り',
  oval: '卵型',
  painterly: '絵画調',
  parted: '分け前髪',
  petite: '小柄',
  pink: 'ピンク',
  playful_confident: '遊び心があり自信あり',
  pompadour: 'ポンパドール',
  ponytail: 'ポニーテール',
  'ponytail fall': 'ポニーテールの落ち方',
  practical: '実用的',
  purple: '紫',
  quiet_neat: '静かできちんとした',
  red: '赤',
  rough: 'ラフ',
  round: '丸型',
  'round collar': '丸襟',
  rounded: '丸みあり',
  'rounded front curve': '丸みのある前髪',
  rugged_calm: '無骨で落ち着いた',
  'sailor collar': 'セーラー襟',
  school: '制服',
  'school shoes': '学生靴',
  semi_realistic: 'セミリアル',
  serious: '真面目',
  serious_focus: '真剣な表情',
  serious_reliable: '真面目で信頼感がある',
  sharp: '鋭い',
  'sharp collar': '鋭い襟',
  'sharp pupils': '鋭い瞳',
  sharp_elite: '鋭くエリート感',
  shaved: '刈り上げ',
  'shaved sides': '刈り上げた横髪',
  shaved_sides: 'サイド刈り上げ',
  short: '短い',
  'short clipped back': '短く整えた後ろ髪',
  'short legs': '短めの脚',
  'short side locks': '短い横髪',
  'short skirt': '短いスカート',
  'short sleeves': '半袖',
  'short textured front': '短く束感のある前髪',
  short_bangs: '短い前髪',
  short_bob: 'ショートボブ',
  short_cut: 'ショートカット',
  shorts: 'ショートパンツ',
  shy_reserved: '控えめ',
  side_part: '横分け',
  side_ponytail: 'サイドポニーテール',
  side_swept: '流し前髪',
  sideburns: 'もみあげ',
  'side-swept front': '流した前髪',
  silver: '銀色',
  'simple uniform detailing': 'シンプルな制服ディテール',
  single: '一重',
  slacks: 'スラックス',
  sleeveless: 'ノースリーブ',
  slender: '細身',
  slick: 'なでつけ',
  slick_back: 'オールバック',
  'slight eye bags': '薄いくま',
  'slight smile': 'わずかな笑み',
  'slightly backward-leaning': '少し後ろ重心',
  'slightly downturned eyes': '少したれ目',
  'slightly forward-leaning': '少し前傾',
  'slightly upturned eyes': '少しつり目',
  small: '小さめ',
  'small eyes': '小さい目',
  'small pupils': '小さい瞳',
  smirk: '片笑い',
  sneakers: 'スニーカー',
  soft: 'やわらかい',
  'soft cheek framing': '頬にかかる柔らかい横髪',
  'soft inward posture': '内向きの柔らかい姿勢',
  'soft parted lips': '少し開いた柔らかい口元',
  'soft round pupils': '柔らかい丸い瞳',
  'soft shadows': '柔らかい影',
  soft_arch: 'ゆるいアーチ',
  soft_smile: 'やわらかい笑顔',
  soft_triangle: '柔らかい三角型',
  spiky: 'ツンツン',
  sports: 'スポーツ',
  square: '四角型',
  standard: '標準',
  'standing collar': '立ち襟',
  stern_look: '厳しい目つき',
  still_quiet: '静かに立つ',
  stocky: 'がっしり',
  stoic_reserved: '寡黙で控えめ',
  straight: 'まっすぐ',
  'straight front line': 'まっすぐな前髪ライン',
  'straight long back': 'ストレートの後ろ髪',
  'straight pants': 'ストレートパンツ',
  street_jacket: 'ストリートジャケット',
  streetwear: 'ストリートウェア',
  'strongly upturned eyes': '強いつり目',
  suit: 'スーツ',
  'swept-up front': '上げた前髪',
  tactical: 'タクティカル',
  tall: '高い',
  tan: '小麦色',
  'tapered nape': '襟足を絞った形',
  teasing_smile: 'からかう笑み',
  thick: '太め',
  'thigh-high socks': '太もも丈ソックス',
  thin: '細め',
  thirties: '30代',
  'three-quarter sleeves': '七分袖',
  tied_back: '後ろ結び',
  'tied-back hair': '後ろで結んだ髪',
  tights: 'タイツ',
  tired_neutral: '疲れ気味の無表情',
  topknot: 'トップノット',
  tousled: 'くしゃっと',
  traditional_formal: '伝統的な正装',
  trench_coat: 'トレンチコート',
  'trimmed sides': '整えた横髪',
  'tucked behind ears': '耳かけ',
  twenties: '20代',
  twin_tails: 'ツインテール',
  two_block: 'ツーブロック',
  two_tone: 'ツートーン',
  undercut: 'アンダーカット',
  'undercut back': 'アンダーカットの後ろ髪',
  unspecified: '未指定',
  upright_neat: 'きちんと直立',
  'very large eyes': 'とても大きい目',
  very_long: 'とても長い',
  very_short: 'とても短い',
  very_short_height: 'とても低い',
  very_tall_height: 'とても高い',
  wavy: 'ウェーブ',
  white: '白',
  wide: '横広',
  'wide pants': 'ワイドパンツ',
  'wide sleeves': '広袖',
  wide_grounded_stance: '足幅広く安定した姿勢',
  wild: 'ワイルド',
  winter_coat: '冬用コート',
  'wolf nape': 'ウルフ風の襟足',
  wolf_cut: 'ウルフカット',
  workwear: '作業着'
};

const optionSet = (entries: [string, string][]): LabelOption<string>[] =>
  entries.map(([value, label]) => ({ value, labelJa: japaneseOptionLabels[value] ?? label, labelEn: label }));

const genderOptions = optionSet([
  ['', '-'],
  ['female', 'Female'],
  ['male', 'Male'],
  ['androgynous', 'Androgynous'],
  ['unspecified', 'Unspecified']
]);

const ageOptions = optionSet([
  ['', '-'],
  ['child', 'Child'],
  ['early_teens', 'Early teens'],
  ['late_teens', 'Late teens'],
  ['twenties', 'Twenties'],
  ['thirties', 'Thirties'],
  ['forties_plus', 'Forties+'],
  ['ageless', 'Ageless']
]);

const skinToneOptions = optionSet([
  ['', '-'],
  ['fair', 'Fair'],
  ['light', 'Light'],
  ['medium', 'Medium'],
  ['tan', 'Tan'],
  ['deep', 'Deep'],
  ['custom', 'Custom']
]);

const firstImpressionOptions = optionSet([
  ['', '-'],
  ['bright_friendly', 'Bright friendly'],
  ['quiet_neat', 'Quiet neat'],
  ['cool_distant', 'Cool distant'],
  ['gentle_soft', 'Gentle soft'],
  ['serious_reliable', 'Serious reliable'],
  ['mysterious_fragile', 'Mysterious fragile'],
  ['energetic_bold', 'Energetic bold'],
  ['stoic_reserved', 'Stoic reserved'],
  ['rugged_calm', 'Rugged calm'],
  ['sharp_elite', 'Sharp elite'],
  ['playful_confident', 'Playful confident'],
  ['mature_composed', 'Mature composed']
]);

const standingStyleOptions = optionSet([
  ['', '-'],
  ['upright_neat', 'Upright neat'],
  ['natural_relaxed', 'Natural relaxed'],
  ['shy_reserved', 'Shy reserved'],
  ['confident_open', 'Confident open'],
  ['still_quiet', 'Still quiet'],
  ['arms_crossed', 'Arms crossed'],
  ['hands_in_pockets', 'Hands in pockets'],
  ['guarded_stance', 'Guarded stance'],
  ['wide_grounded_stance', 'Wide grounded stance'],
  ['elegant_upright', 'Elegant upright']
]);

const expressionOptions = optionSet([
  ['', '-'],
  ['soft_smile', 'Soft smile'],
  ['calm_neutral', 'Calm neutral'],
  ['serious_focus', 'Serious focus'],
  ['cheerful_smile', 'Cheerful smile'],
  ['shy_reserved', 'Shy reserved'],
  ['cool_unfazed', 'Cool unfazed'],
  ['stern_look', 'Stern look'],
  ['tired_neutral', 'Tired neutral'],
  ['confident_smirk', 'Confident smirk'],
  ['bored_gaze', 'Bored gaze'],
  ['teasing_smile', 'Teasing smile']
]);

const heightOptions = optionSet([
  ['', '-'],
  ['very_short_height', 'Very short height'],
  ['short', 'Short'],
  ['average', 'Average'],
  ['tall', 'Tall'],
  ['very_tall_height', 'Very tall height']
]);

const bodyOptions = optionSet([
  ['', '-'],
  ['petite', 'Petite'],
  ['slender', 'Slender'],
  ['average', 'Average'],
  ['athletic', 'Athletic'],
  ['muscular', 'Muscular'],
  ['curvy', 'Curvy'],
  ['lean', 'Lean'],
  ['stocky', 'Stocky'],
  ['broad', 'Broad build'],
  ['large', 'Large build']
]);

const artStyleOptions = optionSet([
  ['', '-'],
  ['anime', 'Anime'],
  ['semi_realistic', 'Semi-realistic'],
  ['manga', 'Manga'],
  ['painterly', 'Painterly']
]);

const faceShapeOptions = optionSet([
  ['', '-'],
  ['round', 'Round'],
  ['oval', 'Oval'],
  ['heart', 'Heart'],
  ['square', 'Square'],
  ['diamond', 'Diamond'],
  ['long', 'Long'],
  ['soft_triangle', 'Soft triangle'],
  ['custom', 'Custom']
]);

const eyebrowShapeOptions = optionSet([
  ['', '-'],
  ['straight', 'Straight'],
  ['soft_arch', 'Soft arch'],
  ['high_arch', 'High arch'],
  ['thick', 'Thick'],
  ['thin', 'Thin'],
  ['sharp', 'Sharp'],
  ['custom', 'Custom']
]);

const noseShapeOptions = optionSet([
  ['', '-'],
  ['small', 'Small'],
  ['straight', 'Straight'],
  ['button', 'Button'],
  ['sharp', 'Sharp'],
  ['rounded', 'Rounded'],
  ['broad', 'Broad'],
  ['custom', 'Custom']
]);

const mouthShapeOptions = optionSet([
  ['', '-'],
  ['soft', 'Soft'],
  ['full', 'Full'],
  ['thin', 'Thin'],
  ['wide', 'Wide'],
  ['smirk', 'Smirk'],
  ['serious', 'Serious'],
  ['custom', 'Custom']
]);

const eyeColorOptions = optionSet([
  ['', '-'],
  ['black', 'Black'],
  ['brown', 'Brown'],
  ['blue', 'Blue'],
  ['green', 'Green'],
  ['red', 'Red'],
  ['gold', 'Gold'],
  ['silver', 'Silver'],
  ['purple', 'Purple'],
  ['custom', 'Custom']
]);

const eyeShapeOptions = optionSet([
  ['', '-'],
  ['gentle', 'Gentle'],
  ['sharp', 'Sharp'],
  ['round', 'Round'],
  ['narrow', 'Narrow']
]);

const eyelidTypeOptions = optionSet([
  ['', '-'],
  ['single', 'Single'],
  ['double', 'Double']
]);

const eyeSizeOptions = optionSet([
  ['', '-'],
  ['small eyes', 'small eyes'],
  ['balanced eyes', 'balanced eyes'],
  ['large eyes', 'large eyes'],
  ['very large eyes', 'very large eyes']
]);

const eyeAngleOptions = optionSet([
  ['', '-'],
  ['level eye line', 'level eye line'],
  ['slightly upturned eyes', 'slightly upturned eyes'],
  ['strongly upturned eyes', 'strongly upturned eyes'],
  ['slightly downturned eyes', 'slightly downturned eyes'],
  ['drooping eyes', 'drooping eyes']
]);

const pupilStyleOptions = optionSet([
  ['', '-'],
  ['small pupils', 'small pupils'],
  ['large pupils', 'large pupils'],
  ['sharp pupils', 'sharp pupils'],
  ['soft round pupils', 'soft round pupils'],
  ['bright reflective pupils', 'bright reflective pupils']
]);

const underEyeDetailOptions = optionSet([
  ['', '-'],
  ['none visible', 'none visible'],
  ['soft shadows', 'soft shadows'],
  ['defined lower lash line', 'defined lower lash line'],
  ['slight eye bags', 'slight eye bags'],
  ['heavy eye bags', 'heavy eye bags']
]);

const mouthDefaultOptions = optionSet([
  ['', '-'],
  ['closed neutral mouth', 'closed neutral mouth'],
  ['slight smile', 'slight smile'],
  ['firm straight mouth', 'firm straight mouth'],
  ['soft parted lips', 'soft parted lips']
]);

const hairColorOptions = optionSet([
  ['', '-'],
  ['black', 'Black'],
  ['brown', 'Brown'],
  ['dark_brown', 'Dark brown'],
  ['blonde', 'Blonde'],
  ['ash_blonde', 'Ash blonde'],
  ['auburn', 'Auburn'],
  ['silver', 'Silver'],
  ['gray', 'Gray'],
  ['white', 'White'],
  ['blue', 'Blue'],
  ['green', 'Green'],
  ['red', 'Red'],
  ['pink', 'Pink'],
  ['purple', 'Purple'],
  ['two_tone', 'Two tone'],
  ['custom', 'Custom']
]);

const hairLengthOptions = optionSet([
  ['', '-'],
  ['very_short', 'Very short'],
  ['short', 'Short'],
  ['medium', 'Medium'],
  ['long', 'Long'],
  ['very_long', 'Very long']
]);

const hairStyleOptions = optionSet([
  ['', '-'],
  ['straight', 'Straight'],
  ['wavy', 'Wavy'],
  ['curly', 'Curly'],
  ['wild', 'Wild'],
  ['tousled', 'Tousled'],
  ['spiky', 'Spiky'],
  ['fluffy', 'Fluffy'],
  ['slick', 'Slick'],
  ['coarse', 'Coarse'],
  ['shaved', 'Shaved']
]);

const hairArrangementOptions = optionSet([
  ['', '-'],
  ['down', 'Down'],
  ['short_cut', 'Short cut'],
  ['buzz_cut', 'Buzz cut'],
  ['crew_cut', 'Crew cut'],
  ['two_block', 'Two block'],
  ['undercut', 'Undercut'],
  ['fade_cut', 'Fade cut'],
  ['side_part', 'Side part'],
  ['center_part', 'Center part'],
  ['comma_hair', 'Comma hair'],
  ['slick_back', 'Slick back'],
  ['messy_short', 'Messy short'],
  ['pompadour', 'Pompadour'],
  ['short_bob', 'Short bob'],
  ['medium_layered', 'Medium layered'],
  ['wolf_cut', 'Wolf cut'],
  ['long_straight', 'Long straight'],
  ['ponytail', 'Ponytail'],
  ['side_ponytail', 'Side ponytail'],
  ['twin_tails', 'Twin tails'],
  ['bun', 'Bun'],
  ['man_bun', 'Man bun'],
  ['topknot', 'Topknot'],
  ['braid', 'Braid'],
  ['half_up', 'Half up'],
  ['tied_back', 'Tied back'],
  ['shaved_sides', 'Shaved sides'],
  ['custom', 'Custom']
]);

const hairBangsOptions = optionSet([
  ['', '-'],
  ['none', 'None'],
  ['light', 'Light'],
  ['standard', 'Standard'],
  ['heavy', 'Heavy'],
  ['side_swept', 'Side swept'],
  ['blunt', 'Blunt'],
  ['parted', 'Parted'],
  ['center_parted', 'Center parted'],
  ['curtain', 'Curtain'],
  ['messy_bangs', 'Messy bangs'],
  ['short_bangs', 'Short bangs'],
  ['long_bangs', 'Long bangs']
]);

const hairFrontShapeOptions = optionSet([
  ['', '-'],
  ['straight front line', 'straight front line'],
  ['center-parted front', 'center-parted front'],
  ['rounded front curve', 'rounded front curve'],
  ['side-swept front', 'side-swept front'],
  ['blunt front', 'blunt front'],
  ['short textured front', 'short textured front'],
  ['comma front', 'comma front'],
  ['curtain front', 'curtain front'],
  ['messy front', 'messy front'],
  ['swept-up front', 'swept-up front']
]);

const hairSideOptions = optionSet([
  ['', '-'],
  ['short side locks', 'short side locks'],
  ['soft cheek framing', 'soft cheek framing'],
  ['long side locks', 'long side locks'],
  ['tucked behind ears', 'tucked behind ears'],
  ['trimmed sides', 'trimmed sides'],
  ['faded sides', 'faded sides'],
  ['shaved sides', 'shaved sides'],
  ['sideburns', 'sideburns'],
  ['ear-length sides', 'ear-length sides']
]);

const hairBackShapeOptions = optionSet([
  ['', '-'],
  ['clean bob back', 'clean bob back'],
  ['layered back', 'layered back'],
  ['straight long back', 'straight long back'],
  ['ponytail fall', 'ponytail fall'],
  ['braided back', 'braided back'],
  ['tapered nape', 'tapered nape'],
  ['short clipped back', 'short clipped back'],
  ['undercut back', 'undercut back'],
  ['tied-back hair', 'tied-back hair'],
  ['long loose back', 'long loose back'],
  ['wolf nape', 'wolf nape']
]);

const clothingOptions = optionSet([
  ['', '-'],
  ['military', 'Military'],
  ['school', 'School'],
  ['casual', 'Casual'],
  ['suit', 'Suit'],
  ['business_casual', 'Business casual'],
  ['lab_coat', 'Lab coat'],
  ['trench_coat', 'Trench coat'],
  ['tactical', 'Tactical'],
  ['traditional_formal', 'Traditional formal'],
  ['street_jacket', 'Street jacket'],
  ['fantasy', 'Fantasy'],
  ['japanese', 'Japanese'],
  ['streetwear', 'Streetwear'],
  ['hoodie', 'Hoodie'],
  ['sports', 'Sports'],
  ['winter_coat', 'Winter coat'],
  ['workwear', 'Workwear'],
  ['armor', 'Armor'],
  ['gothic', 'Gothic'],
  ['formal_dress', 'Formal dress'],
  ['idol_stage', 'Idol stage'],
  ['custom', 'Custom']
]);

const clothingColorOptions = optionSet([
  ['', '-'],
  ['black', 'Black'],
  ['white', 'White'],
  ['navy', 'Navy'],
  ['gray', 'Gray'],
  ['brown', 'Brown'],
  ['red', 'Red'],
  ['blue', 'Blue'],
  ['green', 'Green'],
  ['custom', 'Custom']
]);

const clothingImpressionOptions = optionSet([
  ['', '-'],
  ['formal', 'Formal'],
  ['practical', 'Practical'],
  ['elegant', 'Elegant'],
  ['rough', 'Rough'],
  ['cute', 'Cute'],
  ['custom', 'Custom']
]);

interface ChoiceFieldProps {
  label: string;
  value: string;
  options: LabelOption<string>[];
  language: 'ja' | 'en';
  onChange: (value: string) => void;
}

function ChoiceField({ label, value, options, language, onChange }: ChoiceFieldProps): React.JSX.Element {
  const renderOptions = useMemo(
    () => (options.some((option) => option.value === 'custom') ? options : [...options, { value: 'custom', labelJa: '自由入力', labelEn: 'Custom' }]),
    [options]
  );
  const concreteOptionValues = useMemo(
    () => new Set(renderOptions.map((option) => option.value).filter((optionValue) => optionValue !== '' && optionValue !== 'custom')),
    [renderOptions]
  );
  const inferredValue = value === '' ? '' : concreteOptionValues.has(value) ? value : 'custom';
  const [customMode, setCustomMode] = useState(inferredValue === 'custom');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const selectedOption = renderOptions.find((option) => option.value === (customMode ? 'custom' : inferredValue));
  const selectedLabel = customMode && value.trim().length > 0
    ? value
    : selectedOption === undefined
      ? '-'
      : language === 'ja'
        ? selectedOption.labelJa
        : selectedOption.labelEn;

  useEffect(() => {
    if (value !== '') {
      setCustomMode(!concreteOptionValues.has(value));
    }
  }, [concreteOptionValues, value]);

  const selectValue = (nextValue: string): void => {
    if (nextValue === 'custom') {
      setCustomMode(true);
      onChange(concreteOptionValues.has(value) ? '' : value);
      setOptionsOpen(false);
      return;
    }

    setCustomMode(false);
    onChange(nextValue);
    setOptionsOpen(false);
  };

  return (
    <View style={styles.choiceField}>
      <Text style={styles.label}>{label}</Text>
      <Pressable accessibilityRole="button" onPress={() => setOptionsOpen((current) => !current)} style={styles.choiceTrigger}>
        <Text numberOfLines={1} style={styles.choiceValue}>{selectedLabel}</Text>
        <Text style={styles.choiceChevron}>{optionsOpen ? '^' : 'v'}</Text>
      </Pressable>
      <Modal animationType="fade" onRequestClose={() => setOptionsOpen(false)} transparent visible={optionsOpen}>
        <Pressable
          accessibilityLabel={t(language, "generated.screens.CharactersScreen.close.603bc62f")}
          accessibilityRole="button"
          onPress={() => setOptionsOpen(false)}
          style={styles.choiceModalBackdrop}
        >
          <View
            accessibilityLabel={label}
            accessibilityViewIsModal
            onAccessibilityEscape={() => setOptionsOpen(false)}
            onStartShouldSetResponder={() => true}
            style={styles.choiceModalSheet}
          >
            <View style={styles.choiceModalHeader}>
              <Text style={styles.groupTitle}>{label}</Text>
              <Pressable accessibilityLabel={t(language, "generated.screens.CharactersScreen.close.603bc62f")} accessibilityRole="button" onPress={() => setOptionsOpen(false)} style={styles.choiceModalClose}>
                <Text style={styles.choiceModalCloseText}>x</Text>
              </Pressable>
            </View>
            <ScrollView accessibilityRole="radiogroup" contentContainerStyle={styles.choiceMenu} style={styles.choiceModalScroll}>
              {renderOptions.map((option) => {
                const selected = option.value === inferredValue || (customMode && option.value === 'custom');
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    key={option.value}
                    onPress={() => selectValue(option.value)}
                    style={[styles.choiceOption, selected ? styles.choiceOptionSelected : null]}
                  >
                    <View style={[styles.choiceRadioOuter, selected ? styles.choiceRadioOuterSelected : null]}>
                      {selected ? <View style={styles.choiceRadioInner} /> : null}
                    </View>
                    <Text style={[styles.choiceOptionText, selected ? styles.choiceOptionTextSelected : null]}>
                      {language === 'ja' ? option.labelJa : option.labelEn}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
      {customMode ? (
        <FormField label={t(language, "generated.screens.CharactersScreen.custom.value.75dadf38")} onChangeText={onChange} value={value} />
      ) : null}
    </View>
  );
}

interface CollapsibleGroupProps {
  title: string;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}

function CollapsibleGroup({ title, defaultCollapsed = false, children }: CollapsibleGroupProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <View style={styles.group}>
      <Pressable accessibilityRole="button" onPress={() => setCollapsed((current) => !current)} style={styles.groupHeader}>
        <Text style={styles.groupTitle}>{title}</Text>
        <Text style={styles.groupChevron}>{collapsed ? 'v' : '^'}</Text>
      </Pressable>
      {collapsed ? null : <View style={styles.groupBody}>{children}</View>}
    </View>
  );
}

export function CharactersScreen(): React.JSX.Element {
  const navigation = useNavigation<BottomTabNavigationProp<MobileTabParamList>>();
  const queryClient = useQueryClient();
  const { api, hasCapability, language, logout, selection, session, sessionKey, tokens, trackJob, updateSelection } = useAppState();
  const { resolveDirtyEditors } = useDirtyState();
  const organizationId = selection.organizationId;
  const canEdit = hasCapability('edit_work');
  const canGenerate = hasCapability('generate');
  const canExport = hasCapability('export');
  const [entityType, setEntityType] = useState<EntityType>('character');
  const [entityEditorMode, setEntityEditorMode] = useState<'create' | 'edit'>('create');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [promptSupplement, setPromptSupplement] = useState('');
  const [structuredDraft, setStructuredDraft] = useState<DraftRecord>(() => draftFromRecord({}, characterFieldKeys));
  const [structuredExtras, setStructuredExtras] = useState('');
  const [speechDraft, setSpeechDraft] = useState<DraftRecord>(() => draftFromRecord({}, speechFieldKeys));
  const [speechExtras, setSpeechExtras] = useState('');
  const [candidateToken, setCandidateToken] = useState('');
  const [importResult, setImportResult] = useState<string | null>(null);
  const [lastImportedCandidateToken, setLastImportedCandidateToken] = useState<string | null>(null);
  const [lastImportedCandidateEntityId, setLastImportedCandidateEntityId] = useState<string | null>(null);
  const [pendingEntityReferenceUpload, setPendingEntityReferenceUpload] =
    useState<PendingEntityReferenceUpload | null>(null);
  const [entityReferenceUploadProgress, setEntityReferenceUploadProgress] = useState(0);
  const [entityReferenceUploadStage, setEntityReferenceUploadStage] =
    useState<DirectEntityUploadStage | null>(null);
  const [localJob, setLocalJob] = useState<{
    id: string;
    resourceId: string;
  } | null>(null);
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);
  const [previewImageHeaders, setPreviewImageHeaders] = useState<ImageRequestHeaders | undefined>(undefined);
  const [selectedEntityStateId, setSelectedEntityStateId] = useState<string | null>(null);
  const [entityStateDraft, setEntityStateDraft] = useState<EntityStateDraft>(emptyEntityStateDraft);
  const lastSyncedEntityId = useRef<string | null>(null);
  const lastSyncedEntityStateId = useRef<string | null>(null);
  const [entityStale, setEntityStale] = useState(false);
  const [dirtySaveError, setDirtySaveError] = useState<Error | null>(null);
  const entityReferenceUploadAbortController = useRef<AbortController | null>(null);
  const screenScrollRef = useRef<ScrollView | null>(null);
  const [sectionOffsets, setSectionOffsets] = useState({ editor: 0, import: 0 });
  const workspaceContext = useWorkspaceContextSelection();
  const activeWorkId = workspaceContext.selectedWorkId;

  const activeFieldKeys = entityType === 'character' ? characterFieldKeys : genericFieldKeys;

  const entitiesQuery = useInfiniteQuery({
    enabled: activeWorkId !== null,
    queryKey: entitiesInfiniteQueryKey(sessionKey, activeWorkId, organizationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.getEntitiesPage(activeWorkId ?? '', {
      organizationId,
      limit: MOBILE_LIST_PAGE_SIZE,
      cursor: pageParam,
    }),
    getNextPageParam: nextCursorFromPage,
  });
  const entities = useMemo(
    () => flattenUniqueRecords(entitiesQuery.data?.pages.map((page) => page.entities) ?? []),
    [entitiesQuery.data?.pages],
  );
  const generationAvailabilityQuery = useQuery({
    queryKey: ['entity-reference-generation-availability', sessionKey],
    queryFn: () => api.getEntityReferenceGenerationAvailability()
  });

  const selectedEntityFromList = useMemo(
    () => entities.find((entity) => entity.id === selection.entityId) ?? null,
    [entities, selection.entityId],
  );
  const selectedEntityQuery = useQuery({
    enabled: selection.entityId !== null && selectedEntityFromList === null,
    queryKey: entityDetailQueryKey(sessionKey, selection.entityId, organizationId),
    queryFn: () => api.getEntity(selection.entityId ?? '', organizationId),
  });
  const selectedEntity = selectedEntityFromList ?? selectedEntityQuery.data ?? null;
  const activeServerJobId = useActiveResourceJobId({
    api,
    jobTypes: ['entity_generate'],
    organizationId,
    resourceId: selectedEntity?.id ?? null,
    resourceParam: 'entity_id',
    sessionKey,
  });
  const displayedJobId =
    localJob !== null && localJob.resourceId === selectedEntity?.id
      ? localJob.id
      : activeServerJobId;

  useEffect(
    () => () => {
      entityReferenceUploadAbortController.current?.abort();
    },
    []
  );

  useEffect(() => {
    entityReferenceUploadAbortController.current?.abort();
    entityReferenceUploadAbortController.current = null;
    setPendingEntityReferenceUpload(null);
    setEntityReferenceUploadProgress(0);
    setEntityReferenceUploadStage(null);
  }, [entityType, organizationId, selectedEntity?.id, sessionKey]);

  const entityDirty =
    selectedEntity === null
      ? name.trim().length > 0 ||
        description.trim().length > 0 ||
        promptSupplement.trim().length > 0 ||
        structuredExtras.trim().length > 0 ||
        speechExtras.trim().length > 0 ||
        Object.values(structuredDraft).some((value) => value.trim().length > 0) ||
        Object.values(speechDraft).some((value) => value.trim().length > 0)
      : entityType !== selectedEntity.entity_type ||
        name !== selectedEntity.name ||
        description !== (selectedEntity.free_description ?? '') ||
        promptSupplement !== (selectedEntity.prompt_supplement ?? '') ||
        JSON.stringify(structuredDraft) !== JSON.stringify(structuredDraftFromRecord(selectedEntity.structured_fields ?? {}, selectedEntity.entity_type)) ||
        structuredExtras !== extrasFromRecord(
          selectedEntity.structured_fields ?? {},
          selectedEntity.entity_type === 'character' ? characterFieldKeys : genericFieldKeys
        ) ||
        JSON.stringify(speechDraft) !== JSON.stringify(draftFromRecord(selectedEntity.speech_profile ?? {}, speechFieldKeys)) ||
        speechExtras !== extrasFromRecord(selectedEntity.speech_profile ?? {}, speechFieldKeys);

  const referenceQuery = useQuery({
    enabled: selectedEntity !== null,
    queryKey: entityReferenceSetQueryKey(sessionKey, selectedEntity?.id ?? null, organizationId),
    queryFn: () => api.getEntityReferenceSet(selectedEntity?.id ?? '', organizationId)
  });

  const entityStatesQuery = useQuery({
    enabled: selectedEntity !== null,
    queryKey: entityStatesQueryKey(sessionKey, selectedEntity?.id ?? null, organizationId),
    queryFn: () => api.getEntityStates(selectedEntity?.id ?? '', organizationId),
  });

  const scenesQuery = useQuery({
    enabled: workspaceContext.selectedEpisodeId !== null,
    queryKey: scenesQueryKey(sessionKey, workspaceContext.selectedEpisodeId, organizationId),
    queryFn: () => api.getScenes(workspaceContext.selectedEpisodeId ?? '', organizationId),
  });

  const selectedEntityState = useMemo(
    () => entityStatesQuery.data?.entity_states.find((entityState) => entityState.id === selectedEntityStateId) ?? null,
    [entityStatesQuery.data?.entity_states, selectedEntityStateId],
  );

  const entityStateSceneOptions = useMemo<EntityStateSceneOption[]>(() => {
    const scenes = scenesQuery.data?.scenes ?? [];
    const currentScene = entityStateDraft.sceneId === null
      ? null
      : scenes.find((scene) => scene.id === entityStateDraft.sceneId) ?? null;
    const retainedScene = entityStateDraft.sceneId === null || currentScene !== null
      ? []
      : [{
          id: entityStateDraft.sceneId,
          sceneId: entityStateDraft.sceneId,
          label: t(language, "generated.screens.CharactersScreen.linked.scene.in.another.episode.5d80da85"),
        }];
    return [
      {
        id: NO_SCENE_OPTION_ID,
        sceneId: null,
        label: t(language, "generated.screens.CharactersScreen.no.linked.scene.1a565443"),
      },
      ...retainedScene,
      ...scenes.map((scene) => ({
        id: scene.id,
        sceneId: scene.id,
        label: sceneLabel(scene, language),
      })),
    ];
  }, [entityStateDraft.sceneId, language, scenesQuery.data?.scenes]);

  const jobQuery = useQuery({
    enabled: displayedJobId !== null,
    queryKey: jobQueryKey(sessionKey, displayedJobId, organizationId),
    queryFn: () => api.getJob(displayedJobId ?? '', organizationId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'processing' ? 2500 : false;
    }
  });

  const imageRequestHeaders = useMemo<ImageRequestHeaders | undefined>(
    () => (tokens === null ? undefined : { Authorization: `Bearer ${tokens.idToken}` }),
    [tokens]
  );

  const activeReferenceCandidate = useMemo(
    () =>
      selectSingleReferenceCandidate({
        importedCandidate:
          lastImportedCandidateToken === null
            ? null
            : { candidate_token: lastImportedCandidateToken, source: 'import' },
        generatedCandidates: extractGeneratedReferenceCandidates(jobQuery.data)
      }),
    [jobQuery.data, lastImportedCandidateToken]
  );

  const candidateTokenIsImported = lastImportedCandidateToken !== null && candidateToken.trim() === lastImportedCandidateToken;
  const importedCandidateMatchesEntity =
    selectedEntity !== null && lastImportedCandidateEntityId !== null && lastImportedCandidateEntityId === selectedEntity.id;
  const candidateTokenUsable =
    candidateToken.trim().length > 0 && (!candidateTokenIsImported || importedCandidateMatchesEntity);
  const activeOrganization = session?.organizations.find(
    (organization) => organization.id === organizationId
  );
  const availableCredits =
    organizationId === null
      ? session?.personal_credits?.total_credits ?? null
      : activeOrganization?.total_credits ?? null;
  const hasActivePreviewJob =
    displayedJobId !== null &&
    (jobQuery.data === undefined ||
      jobQuery.data.status === 'queued' ||
      jobQuery.data.status === 'processing');
  const openImagePreview = (uri: string, headers?: ImageRequestHeaders): void => {
    setPreviewImageHeaders(headers);
    setPreviewImageUri(uri);
  };

  const closeImagePreview = (): void => {
    setPreviewImageHeaders(undefined);
    setPreviewImageUri(null);
  };

  useEffect(() => {
    const nextId = selectedEntity?.id ?? null;
    if (lastSyncedEntityId.current === nextId && entityDirty) {
      return;
    }
    lastSyncedEntityId.current = nextId;
    if (selectedEntity !== null) {
      setEntityEditorMode('edit');
    }
    setEntityType(selectedEntity?.entity_type ?? 'character');
    setName(selectedEntity?.name ?? '');
    setDescription(selectedEntity?.free_description ?? '');
    setPromptSupplement(selectedEntity?.prompt_supplement ?? '');
    setStructuredDraft(structuredDraftFromRecord(selectedEntity?.structured_fields ?? {}, selectedEntity?.entity_type ?? 'character'));
    setStructuredExtras(extrasFromRecord(selectedEntity?.structured_fields ?? {}, selectedEntity?.entity_type === 'character' ? characterFieldKeys : genericFieldKeys));
    setSpeechDraft(draftFromRecord(selectedEntity?.speech_profile ?? {}, speechFieldKeys));
    setSpeechExtras(extrasFromRecord(selectedEntity?.speech_profile ?? {}, speechFieldKeys));
    setImportResult(null);
    setLastImportedCandidateToken(null);
    setLastImportedCandidateEntityId(null);
    setCandidateToken('');
    setLocalJob(null);
    setSelectedEntityStateId(null);
    setEntityStateDraft(emptyEntityStateDraft());
    lastSyncedEntityStateId.current = null;
  }, [entityDirty, selectedEntity]);

  useEffect(() => {
    setEntityStale(false);
  }, [selectedEntity?.id]);

  useEffect(() => {
    if (lastSyncedEntityStateId.current === selectedEntityStateId) {
      return;
    }
    lastSyncedEntityStateId.current = selectedEntityStateId;
    setEntityStateDraft(entityStateDraftFromRecord(selectedEntityState));
  }, [selectedEntityState, selectedEntityStateId]);

  useEffect(() => {
    setStructuredDraft((current) => {
      const nextKeys = entityType === 'character' ? characterFieldKeys : genericFieldKeys;
      return Object.fromEntries(nextKeys.map((key) => [key, current[key] ?? '']));
    });
  }, [entityType]);

  useEffect(() => {
    const nextCandidateToken = activeReferenceCandidate?.candidate_token ?? '';
    setCandidateToken((current) => current === nextCandidateToken ? current : nextCandidateToken);
  }, [activeReferenceCandidate?.candidate_token]);

  const setStructuredValue = (key: string, value: string): void => {
    setStructuredDraft((current) => ({ ...current, [key]: value }));
  };

  const setSpeechValue = (key: string, value: string): void => {
    setSpeechDraft((current) => ({ ...current, [key]: value }));
  };

  const invalidateEntities = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: entitiesQueryKey(sessionKey, activeWorkId, organizationId) });
  };

  const invalidateReference = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: entityReferenceSetQueryKey(sessionKey, selectedEntity?.id ?? null, organizationId) });
  };

  const invalidateEntityStates = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: entityStatesQueryKey(sessionKey, selectedEntity?.id ?? null, organizationId),
    });
  };

  const toEntityStatePayload = () => ({
    scene_id: entityStateDraft.sceneId,
    costume_note: nullable(entityStateDraft.costumeNote),
    costume_ref_id: null,
    condition_note: nullable(entityStateDraft.conditionNote),
    hair_note: nullable(entityStateDraft.hairNote),
    expression_default: entityStateDraft.expressionDefault.trim() || 'neutral',
    extra_note: nullable(entityStateDraft.extraNote),
  });

  const toEntityPayload = (): {
    entity_type: EntityType;
    name: string;
    free_description: string | null;
    prompt_supplement: string | null;
    structured_fields: Record<string, unknown>;
    speech_profile: Record<string, unknown>;
  } => ({
    entity_type: entityType,
    name: name.trim(),
    free_description: nullable(description),
    prompt_supplement: nullable(promptSupplement),
    structured_fields: toStructuredFieldsPayload(entityType, structuredDraft, structuredExtras),
    speech_profile: toPayloadRecord(speechDraft, speechExtras)
  });

  const toEntityUpdatePayload = () => ({
    ...toEntityPayload(),
    expected_updated_at: selectedEntity?.updated_at ?? '',
  });

  const createEntityMutation = useMutation({
    mutationFn: () => api.createEntity(activeWorkId ?? '', toEntityPayload(), organizationId),
    onSuccess: async (entity) => {
      setEntityEditorMode('edit');
      await updateSelection({ entityId: entity.id }, { skipDirtyCheck: true });
      await invalidateEntities();
    }
  });

  const updateEntityMutation = useMutation({
    mutationFn: () => api.updateEntity(selectedEntity?.id ?? '', toEntityUpdatePayload(), organizationId),
    onSuccess: async () => {
      setEntityStale(false);
      await invalidateEntities();
    },
    onError: (error) => {
      if (isResourceStaleError(error)) {
        setEntityStale(true);
      }
    }
  });

  const deleteEntityMutation = useMutation({
    mutationFn: () => api.deleteEntity(selectedEntity?.id ?? '', organizationId),
    onSuccess: async () => {
      setEntityEditorMode('create');
      await updateSelection({ entityId: null }, { skipDirtyCheck: true });
      await invalidateEntities();
    }
  });
  const saveNewEntityMutation = createEntityMutation.mutateAsync;
  const saveExistingEntityMutation = updateEntityMutation.mutateAsync;

  const discardEntityDraft = useCallback((): void => {
    setEntityEditorMode(selectedEntity === null ? 'create' : 'edit');
    setEntityType(selectedEntity?.entity_type ?? 'character');
    setName(selectedEntity?.name ?? '');
    setDescription(selectedEntity?.free_description ?? '');
    setPromptSupplement(selectedEntity?.prompt_supplement ?? '');
    setStructuredDraft(
      structuredDraftFromRecord(
        selectedEntity?.structured_fields ?? {},
        selectedEntity?.entity_type ?? 'character'
      )
    );
    setStructuredExtras(
      extrasFromRecord(
        selectedEntity?.structured_fields ?? {},
        selectedEntity?.entity_type === 'character' ? characterFieldKeys : genericFieldKeys
      )
    );
    setSpeechDraft(draftFromRecord(selectedEntity?.speech_profile ?? {}, speechFieldKeys));
    setSpeechExtras(extrasFromRecord(selectedEntity?.speech_profile ?? {}, speechFieldKeys));
    setCandidateToken('');
    setImportResult(null);
    setLastImportedCandidateToken(null);
    setLastImportedCandidateEntityId(null);
    setLocalJob(null);
    setEntityStale(false);
    setDirtySaveError(null);
  }, [
    selectedEntity,
    setCandidateToken,
    setDescription,
    setDirtySaveError,
    setEntityEditorMode,
    setEntityStale,
    setEntityType,
    setImportResult,
    setLastImportedCandidateEntityId,
    setLastImportedCandidateToken,
    setLocalJob,
    setName,
    setPromptSupplement,
    setSpeechDraft,
    setSpeechExtras,
    setStructuredDraft,
    setStructuredExtras
  ]);

  const saveEntityDraft = useCallback(async (): Promise<void> => {
    const intent = entityDirtySaveIntent({
      dirty: entityDirty,
      selectedEntityId: selectedEntity?.id ?? null
    });
    if (intent === null) {
      return;
    }
    setDirtySaveError(null);
    try {
      if (name.trim().length === 0) {
        throw new Error(t(language, "generated.screens.CharactersScreen.enter.a.name.4cb35ca6"));
      }
      if (intent === 'create') {
        if (activeWorkId === null) {
          throw new Error(t(language, "generated.screens.CharactersScreen.select.a.work.first.d7bcfe9f"));
        }
        await saveNewEntityMutation();
        return;
      }
      await saveExistingEntityMutation();
    } catch (error) {
      setDirtySaveError(
        error instanceof Error
          ? error
          : new Error(t(language, "generated.screens.CharactersScreen.unsaved.changes.could.not.be.saved.88963a72"))
      );
      throw error;
    }
  }, [
    activeWorkId,
    entityDirty,
    language,
    name,
    saveExistingEntityMutation,
    saveNewEntityMutation,
    selectedEntity?.id,
    setDirtySaveError
  ]);

  useDirtyEditorRegistration({
    id: 'character-editor',
    dirty: entityDirty,
    discard: discardEntityDraft,
    save: saveEntityDraft
  });

  const createEntityStateMutation = useMutation({
    mutationFn: () => api.createEntityState(selectedEntity?.id ?? '', toEntityStatePayload(), organizationId),
    onSuccess: async (entityState) => {
      setSelectedEntityStateId(entityState.id);
      await invalidateEntityStates();
    },
  });

  const updateEntityStateMutation = useMutation({
    mutationFn: () =>
      api.updateEntityState(selectedEntity?.id ?? '', selectedEntityStateId ?? '', toEntityStatePayload(), organizationId),
    onSuccess: invalidateEntityStates,
  });

  const importImageMutation = useMutation({
    mutationFn: async (mode: 'select' | 'retry') => {
      let pendingUpload = pendingEntityReferenceUpload;
      if (mode === 'select') {
        setPendingEntityReferenceUpload(null);
        const result = await ImagePicker.launchImageLibraryAsync({
          allowsEditing: false,
          base64: false,
          mediaTypes: ['images'],
          quality: 1
        });
        if (result.canceled) {
          return null;
        }

        const asset = result.assets[0];
        if (asset === undefined) {
          throw new Error(t(language, "generated.screens.CharactersScreen.the.selected.image.could.not.be.read.859c11bf"));
        }
        const mimeType = resolveAllowedMimeType(asset);
        if (mimeType === null) {
          throw new Error(t(language, "generated.screens.CharactersScreen.select.a.jpeg.png.or.webp.image.aa36e2b9"));
        }
        const uploadFile = createExpoBinaryUploadFile(asset.uri);
        if (!uploadFile.exists || uploadFile.sizeBytes <= 0) {
          throw new Error(t(language, "generated.screens.CharactersScreen.the.selected.image.could.not.be.read.859c11bf"));
        }
        if (uploadFile.sizeBytes > MAX_IMPORT_IMAGE_BYTES) {
          throw new Error(t(language, "generated.screens.CharactersScreen.the.image.must.be.5.mb.or.smaller.f810b162"));
        }

        pendingUpload = {
          entityId: selectedEntity?.id ?? null,
          entityType,
          mimeType,
          sizeBytes: uploadFile.sizeBytes,
          source: uploadFile.source,
          uploadToken: null
        };
        setPendingEntityReferenceUpload(pendingUpload);
      }

      if (pendingUpload === null) {
        throw new Error(t(language, "generated.screens.CharactersScreen.there.is.no.image.to.retry.a75c5e5a"));
      }
      const activeUpload = pendingUpload;

      entityReferenceUploadAbortController.current?.abort();
      const abortController = new AbortController();
      entityReferenceUploadAbortController.current = abortController;
      setEntityReferenceUploadProgress(0);

      try {
        return await uploadAndImportEntityReference({
          source: activeUpload.source,
          mimeType: activeUpload.mimeType,
          sizeBytes: activeUpload.sizeBytes,
          entityType: activeUpload.entityType,
          entityId: activeUpload.entityId,
          resumeFinalizeToken: mode === 'retry' ? activeUpload.uploadToken : null,
          signal: abortController.signal,
          createPresignedUpload: (payload) => api.createEntityReferenceUpload(payload, organizationId),
          finalizeImport: (uploadToken) =>
            api.importEntityImage(
              {
                entity_type: activeUpload.entityType,
                ...(activeUpload.entityId === null ? {} : { entity_id: activeUpload.entityId }),
                upload_token: uploadToken
              },
              organizationId
            ),
          onProgress: setEntityReferenceUploadProgress,
          onFinalizeTokenReady: (uploadToken) => {
            setPendingEntityReferenceUpload({ ...activeUpload, uploadToken });
          },
          onStageChange: setEntityReferenceUploadStage
        });
      } finally {
        if (entityReferenceUploadAbortController.current === abortController) {
          entityReferenceUploadAbortController.current = null;
        }
      }
    },
    onSuccess: (result) => {
      if (result === null) {
        setEntityReferenceUploadStage(null);
        setEntityReferenceUploadProgress(0);
        return;
      }
      setPendingEntityReferenceUpload(null);
      setEntityReferenceUploadStage(null);
      setEntityReferenceUploadProgress(0);
      const nextKeys = entityType === 'character' ? characterFieldKeys : genericFieldKeys;
      setStructuredDraft(structuredDraftFromRecord(result.suggested_fields, entityType));
      setStructuredExtras(extrasFromRecord(result.suggested_fields, nextKeys));
      setPromptSupplement(result.prompt_supplement);
      setCandidateToken(result.tmp_image_token);
      setLastImportedCandidateToken(result.tmp_image_token);
      setLastImportedCandidateEntityId(selectedEntity?.id ?? null);
      setLocalJob(null);
      setImportResult(JSON.stringify(result.suggested_fields, null, 2));
    }
  });

  const generateReferenceMutation = useMutation({
    mutationFn: async () => {
      if (selectedEntity !== null && name.trim().length > 0) {
        try {
          await api.updateEntity(selectedEntity.id, toEntityUpdatePayload(), organizationId);
        } catch (error) {
          if (isResourceStaleError(error)) {
            setEntityStale(true);
          }
          throw error;
        }
      }
      return api.generateEntityReference(
        selectedEntity?.id ?? '',
        lastImportedCandidateToken === null || !importedCandidateMatchesEntity ? {} : { source_candidate_token: lastImportedCandidateToken },
        organizationId
      );
    },
    onSuccess: async (result) => {
      setLocalJob({
        id: result.job_id,
        resourceId: selectedEntity?.id ?? '',
      });
      await trackJob(result.job_id);
      await invalidateEntities();
    }
  });

  const confirmReferenceMutation = useMutation({
    mutationFn: () => {
      const confirmation = buildSingleCandidateConfirmation(
        candidateTokenUsable ? candidateToken : ''
      );
      if (confirmation === null) {
        throw new Error('A valid reference candidate is required.');
      }
      return api.confirmEntityReference(
        selectedEntity?.id ?? '',
        {
          ...confirmation,
          prompt_supplement: nullable(promptSupplement)
        },
        organizationId
      );
    },
    onSuccess: async () => {
      setCandidateToken('');
      setLastImportedCandidateToken(null);
      setLastImportedCandidateEntityId(null);
      setLocalJob(null);
      await Promise.all([invalidateEntities(), invalidateReference()]);
    }
  });

  const deleteReferenceMutation = useMutation({
    mutationFn: (refId: string) => api.deleteEntityReference(selectedEntity?.id ?? '', refId, organizationId),
    onSuccess: invalidateReference
  });

  const downloadReferenceMutation = useMutation({
    mutationFn: (refId: string) =>
      downloadAuthenticatedFile({
        path: appendOrganizationQuery(
          `/api/entities/${encodeURIComponent(selectedEntity?.id ?? '')}/reference/${encodeURIComponent(refId)}/image`,
          organizationId
        ),
        filename: `lyra-reference-${refId}.png`,
        tokens,
        mimeType: 'image/png'
      })
  });

  const downloadCandidateMutation = useMutation({
    mutationFn: () => {
      if (!candidateTokenUsable) {
        throw new Error('Candidate token is not valid for the selected entity.');
      }
      const params = new URLSearchParams({ candidate_token: candidateToken.trim() });
      if (organizationId !== null && organizationId.trim().length > 0) {
        params.set('organization_id', organizationId);
      }
      return downloadAuthenticatedFile({
        path: `/api/entities/${encodeURIComponent(selectedEntity?.id ?? '')}/reference-candidate-image?${params.toString()}`,
        filename: `lyra-candidate-${selectedEntity?.id ?? 'image'}.png`,
        tokens,
        mimeType: 'image/png'
      });
    }
  });

  const generationBlockers = buildEntityReferenceGenerationBlockers({
    availableCredits,
    canGenerate,
    entityType,
    featureEnabled: generationAvailabilityQuery.data?.enabled === true,
    hasActiveJob: hasActivePreviewJob,
    importPending: importImageMutation.isPending,
    name,
    selectedEntityId: selectedEntity?.id ?? null
  });

  const recordSectionOffset =
    (section: 'editor' | 'import') =>
    (event: LayoutChangeEvent): void => {
      const nextOffset = event.nativeEvent.layout.y;
      setSectionOffsets((current) =>
        current[section] === nextOffset ? current : { ...current, [section]: nextOffset }
      );
    };

  const scrollToCharacterSection = (section: 'editor' | 'import'): void => {
    screenScrollRef.current?.scrollTo({
      animated: true,
      y: Math.max(0, sectionOffsets[section] - spacing.sm)
    });
  };

  const handleGenerationBlockerAction = (
    code: EntityReferenceGenerationBlockerCode,
  ): void => {
    const recoveryTarget = entityGenerationBlockerRecoveryTarget(code);
    if (
      recoveryTarget === 'credits' ||
      recoveryTarget === 'jobs' ||
      recoveryTarget === 'workspace'
    ) {
      void resolveDirtyEditors(language).then((canLeave) => {
        if (canLeave) {
          navigation.navigate('Account');
        }
      });
      return;
    }

    switch (code) {
      case 'ENTITY_SAVE_REQUIRED':
      case 'NAME_REQUIRED':
      case 'UNSUPPORTED_TYPE':
        scrollToCharacterSection('editor');
        return;
      case 'IMPORT_IN_PROGRESS':
        scrollToCharacterSection('import');
        return;
      case 'ACTIVE_PREVIEW_JOB':
      case 'INSUFFICIENT_CREDITS':
      case 'PERMISSION_REQUIRED':
        return;
      case 'FEATURE_DISABLED':
        return;
    }
  };

  const confirmDeleteEntity = (): void => {
    if (selectedEntity === null) {
      return;
    }

    confirmDestructiveAction({
      language,
      title: t(language, "generated.screens.CharactersScreen.delete.character.7657942c"),
      message: t(language, 'screen.characters.deleteCharacter', {
        entityName: selectedEntity.name
      }),
      onConfirm: () => deleteEntityMutation.mutate()
    });
  };

  const confirmDeleteReference = (refId: string): void => {
    confirmDestructiveAction({
      language,
      title: t(language, "generated.screens.CharactersScreen.delete.reference.image.18162c6a"),
      message: t(language, "generated.screens.CharactersScreen.delete.this.reference.image.this.cannot.09bdc09a"),
      onConfirm: () => deleteReferenceMutation.mutate(refId)
    });
  };

  const switchEntity = (entityId: string): void => {
    if (selection.entityId === entityId) {
      return;
    }
    void (async () => {
      if (await updateSelection({ entityId })) {
        setEntityEditorMode('edit');
      }
    })();
  };

  const beginNewEntityDraft = (): void => {
    const reset = (): void => {
      setEntityEditorMode('create');
      setEntityType('character');
      setName('');
      setDescription('');
      setPromptSupplement('');
      setStructuredDraft(draftFromRecord({}, characterFieldKeys));
      setStructuredExtras('');
      setSpeechDraft(draftFromRecord({}, speechFieldKeys));
      setSpeechExtras('');
      setCandidateToken('');
      setImportResult(null);
      setLastImportedCandidateToken(null);
      setLastImportedCandidateEntityId(null);
      setLocalJob(null);
      lastSyncedEntityId.current = null;
    };
    void (async () => {
      if (!(await resolveDirtyEditors(language))) {
        return;
      }
      await updateSelection({ entityId: null }, { skipDirtyCheck: true });
      reset();
    })();
  };

  const reloadStaleEntity = async (): Promise<void> => {
    if (selectedEntity === null || activeWorkId === null) {
      return;
    }
    await queryClient.fetchQuery({
      queryKey: entityDetailQueryKey(sessionKey, selectedEntity.id, organizationId),
      queryFn: () => api.getEntity(selectedEntity.id, organizationId),
    });
    await queryClient.invalidateQueries({
      queryKey: entitiesQueryKey(sessionKey, activeWorkId, organizationId),
    });
    lastSyncedEntityId.current = null;
    setEntityStale(false);
  };

  const beginNewEntityStateDraft = (): void => {
    setSelectedEntityStateId(null);
    setEntityStateDraft(emptyEntityStateDraft());
    lastSyncedEntityStateId.current = null;
  };

  const confirmGenerateReference = (): void => {
    confirmAction({
      language,
      title: t(language, "generated.screens.CharactersScreen.generate.reference.preview.dddf055c"),
      message: t(language, "generated.screens.CharactersScreen.character.details.will.be.saved.before.g.119135cb"),
      confirmLabel: t(language, 'generateReference'),
      onConfirm: () => generateReferenceMutation.mutate()
    });
  };

  const characterErrors = [
    entitiesQuery.error,
    referenceQuery.error,
    entityStatesQuery.error,
    scenesQuery.error,
    jobQuery.error,
    createEntityMutation.error,
    updateEntityMutation.error,
    deleteEntityMutation.error,
    importImageMutation.error,
    generateReferenceMutation.error,
    confirmReferenceMutation.error,
    deleteReferenceMutation.error,
    downloadReferenceMutation.error,
    downloadCandidateMutation.error,
    createEntityStateMutation.error,
    updateEntityStateMutation.error,
    dirtySaveError,
  ].filter(
    (error): error is Error =>
      error instanceof Error && !(error instanceof DirectEntityUploadError)
  );

  const typeOptions = entityTypes.map((option) => ({
    value: option.value,
    label: language === 'ja' ? option.labelJa : option.labelEn
  }));
  const filledStructuredCount = activeFieldKeys.filter((key) => (structuredDraft[key] ?? '').trim().length > 0).length;
  const filledRecommendedCount =
    entityType === 'character'
      ? recommendedCharacterKeys.filter((key) => (structuredDraft[key] ?? '').trim().length > 0).length
      : filledStructuredCount;
  const recommendedTotal = entityType === 'character' ? recommendedCharacterKeys.length : activeFieldKeys.length;
  const refreshCharacters = (): void => {
    void invalidateEntities();
    void invalidateReference();
    void invalidateEntityStates();
    void scenesQuery.refetch();
    void generationAvailabilityQuery.refetch();
    void jobQuery.refetch();
  };

  return (
    <Screen
      onRefresh={refreshCharacters}
      refreshing={entitiesQuery.isFetching || referenceQuery.isFetching}
      scrollViewRef={screenScrollRef}
      subtitle={t(language, "generated.screens.CharactersScreen.create.characters.import.visual.traits.a.bae42b0d")}
      title={t(language, 'characters')}
    >
      <WorkspaceContextPicker context={workspaceContext} />
      {!canEdit ? (
        <Notice
          message={t(language, "generated.screens.CharactersScreen.you.can.view.characters.in.this.workspac.f7a74880")}
          tone="info"
        />
      ) : null}
      {activeWorkId === null ? <Notice message={t(language, 'selectWorkFirst')} tone="warning" /> : null}
      {characterErrors.length === 0 ? null : (
        <ActionableErrorNotice
          actions={{
            characters: () => scrollToCharacterSection('editor'),
            credits: () => {
              void resolveDirtyEditors(language).then((canLeave) => {
                if (canLeave) {
                  navigation.navigate('Account');
                }
              });
            },
            jobs: () => {
              void resolveDirtyEditors(language).then((canLeave) => {
                if (canLeave) {
                  navigation.navigate('Account');
                }
              });
            },
            login: () => {
              void resolveDirtyEditors(language).then((canLeave) => {
                if (canLeave) {
                  void logout();
                }
              });
            },
            retry: refreshCharacters,
            workspace: () => {
              void resolveDirtyEditors(language).then((canLeave) => {
                if (canLeave) {
                  navigation.navigate('Account');
                }
              });
            }
          }}
          error={characterErrors[0]}
          language={language}
        />
      )}
      {entityStale ? (
        <View style={styles.buttonRow}>
          <Notice
            message={t(language, "generated.screens.CharactersScreen.your.draft.is.preserved.reloading.the.la.613ed976")}
            tone="warning"
          />
          <PrimaryButton
            label={t(language, "generated.screens.CharactersScreen.reload.latest.state.327b1d0e")}
            onPress={() => {
              void reloadStaleEntity();
            }}
            variant="secondary"
          />
        </View>
      ) : null}
      <Section collapsible persistKey="characters:list" title={t(language, "generated.screens.CharactersScreen.character.list.ea7139da")}>
        <PrimaryButton
          disabled={!canEdit || activeWorkId === null}
          disabledReason={!canEdit ? t(language, "generated.screens.CharactersScreen.editing.permission.is.required.6d3b86ee") : activeWorkId === null ? t(language, "generated.screens.CharactersScreen.select.a.work.first.1219842f") : undefined}
          label={t(language, "generated.screens.CharactersScreen.new.character.899f7080")}
          onPress={beginNewEntityDraft}
          variant="secondary"
        />
        <RecordPicker
          emptyLabel={t(language, 'emptyCharacters')}
          hasNextPage={entitiesQuery.hasNextPage}
          helperText={t(language, "generated.screens.CharactersScreen.choose.a.character.to.edit.unsaved.edits.c0acfd1a")}
          isFetchingNextPage={entitiesQuery.isFetchingNextPage}
          items={entities}
          language={language}
          labelForItem={(entity) => entity.name}
          onEndReached={() => {
            void entitiesQuery.fetchNextPage();
          }}
          onSelect={switchEntity}
          selectedId={selection.entityId}
        />
      </Section>

      <View onLayout={recordSectionOffset('editor')}>
        <Section collapsible persistKey="characters:editor" subtitle={t(language, "generated.screens.CharactersScreen.fill.only.what.you.know.and.save.before.1a296e88")} title={entityEditorMode === 'create' ? t(language, "generated.screens.CharactersScreen.create.character.20818b4a") : t(language, "generated.screens.CharactersScreen.character.editor.669746e4")}>
        <Notice
          message={
            entityEditorMode === 'create'
              ? t(language, "generated.screens.CharactersScreen.creating.a.new.character.existing.charac.3dc75fb0")
              : t(language, "generated.screens.CharactersScreen.editing.the.selected.character.9454ccd6")
          }
          tone="info"
        />
        <FormField label={t(language, 'name')} maxLength={100} onChangeText={setName} value={name} />
        <SegmentedControl onChange={setEntityType} options={typeOptions} value={entityType} />
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.caption}>{t(language, "generated.screens.CharactersScreen.required.64cf5d7a")}</Text>
            <Text style={styles.metric}>{name.trim().length > 0 ? t(language, "generated.screens.CharactersScreen.name.ok.9d30f555") : t(language, "generated.screens.CharactersScreen.name.required.4b1380a3")}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.caption}>{t(language, "generated.screens.CharactersScreen.recommended.655b10bd")}</Text>
            <Text style={styles.metric}>{filledRecommendedCount}/{recommendedTotal}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.caption}>{t(language, 'referenceSet')}</Text>
            <Text style={styles.metric}>{formatReferenceStatus(referenceQuery.data?.status, language)}</Text>
          </View>
        </View>
        {entityType === 'character' ? (
          <>
            <CollapsibleGroup title={t(language, "generated.screens.CharactersScreen.identity.90859a65")}>
              <FormField
                help={t(language, "generated.screens.CharactersScreen.separate.multiple.aliases.with.commas.or.2ab505cd")}
                label={t(language, "generated.screens.CharactersScreen.aliases.658c65b6")}
                maxLength={500}
                onChangeText={(value) => setStructuredValue('aliases', value)}
                value={structuredDraft.aliases ?? ''}
              />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.gender.cbf7a6be")} language={language} onChange={(value) => setStructuredValue('gender_expression', value)} options={genderOptions} value={structuredDraft.gender_expression ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.age.range.3bfd3fb9")} language={language} onChange={(value) => setStructuredValue('age_range', value)} options={ageOptions} value={structuredDraft.age_range ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.skin.tone.a4e7759d")} language={language} onChange={(value) => setStructuredValue('skin_tone', value)} options={skinToneOptions} value={structuredDraft.skin_tone ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.first.impression.bb21e31e")} language={language} onChange={(value) => setStructuredValue('first_impression', value)} options={firstImpressionOptions} value={structuredDraft.first_impression ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.standing.style.1bdc1343")} language={language} onChange={(value) => setStructuredValue('standing_style', value)} options={standingStyleOptions} value={structuredDraft.standing_style ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.default.expression.bfd9df1b")} language={language} onChange={(value) => setStructuredValue('default_expression', value)} options={expressionOptions} value={structuredDraft.default_expression ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.height.236db459")} language={language} onChange={(value) => setStructuredValue('height', value)} options={heightOptions} value={structuredDraft.height ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.body.type.fc7291c4")} language={language} onChange={(value) => setStructuredValue('build', value)} options={bodyOptions} value={structuredDraft.build ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.art.style.3dbfd980")} language={language} onChange={(value) => setStructuredValue('art_style', value)} options={artStyleOptions} value={structuredDraft.art_style ?? ''} />
            </CollapsibleGroup>

            <CollapsibleGroup title={t(language, "generated.screens.CharactersScreen.face.f4d8eb6a")}>
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.face.shape.129e8c22")} language={language} onChange={(value) => setStructuredValue('face_shape', value)} options={faceShapeOptions} value={structuredDraft.face_shape ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.eyebrow.shape.0e2aaabf")} language={language} onChange={(value) => setStructuredValue('eyebrow_shape', value)} options={eyebrowShapeOptions} value={structuredDraft.eyebrow_shape ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.nose.shape.aa0c3304")} language={language} onChange={(value) => setStructuredValue('nose_shape', value)} options={noseShapeOptions} value={structuredDraft.nose_shape ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.mouth.shape.5bb52b67")} language={language} onChange={(value) => setStructuredValue('mouth_shape', value)} options={mouthShapeOptions} value={structuredDraft.mouth_shape ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.eye.color.bb37815d")} language={language} onChange={(value) => setStructuredValue('eye_color', value)} options={eyeColorOptions} value={structuredDraft.eye_color ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.eye.shape.bed1cf59")} language={language} onChange={(value) => setStructuredValue('eye_shape', value)} options={eyeShapeOptions} value={structuredDraft.eye_shape ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.eyelid.type.e7c5af18")} language={language} onChange={(value) => setStructuredValue('eyelid_type', value)} options={eyelidTypeOptions} value={structuredDraft.eyelid_type ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.eye.size.4ef0e5dd")} language={language} onChange={(value) => setStructuredValue('eye_size', value)} options={eyeSizeOptions} value={structuredDraft.eye_size ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.eye.angle.8d8d89c0")} language={language} onChange={(value) => setStructuredValue('eye_angle', value)} options={eyeAngleOptions} value={structuredDraft.eye_angle ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.pupil.style.684fe07c")} language={language} onChange={(value) => setStructuredValue('pupil_style', value)} options={pupilStyleOptions} value={structuredDraft.pupil_style ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.under.eye.detail.a1b8a2dd")} language={language} onChange={(value) => setStructuredValue('under_eye_detail', value)} options={underEyeDetailOptions} value={structuredDraft.under_eye_detail ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.mouth.default.4bde6546")} language={language} onChange={(value) => setStructuredValue('mouth_default', value)} options={mouthDefaultOptions} value={structuredDraft.mouth_default ?? ''} />
            </CollapsibleGroup>

            <CollapsibleGroup title={t(language, "generated.screens.CharactersScreen.hair.d1fbc0ef")}>
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.hair.color.71cf2ed1")} language={language} onChange={(value) => setStructuredValue('hair_color', value)} options={hairColorOptions} value={structuredDraft.hair_color ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.hair.length.210757f7")} language={language} onChange={(value) => setStructuredValue('hair_length', value)} options={hairLengthOptions} value={structuredDraft.hair_length ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.hair.style.746c37e2")} language={language} onChange={(value) => setStructuredValue('hair_style', value)} options={hairStyleOptions} value={structuredDraft.hair_style ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.hair.arrangement.89c8a64e")} language={language} onChange={(value) => setStructuredValue('hair_arrangement', value)} options={hairArrangementOptions} value={structuredDraft.hair_arrangement ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.bangs.3536fcad")} language={language} onChange={(value) => setStructuredValue('hair_bangs', value)} options={hairBangsOptions} value={structuredDraft.hair_bangs ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.front.shape.f367f4ed")} language={language} onChange={(value) => setStructuredValue('hair_front_shape', value)} options={hairFrontShapeOptions} value={structuredDraft.hair_front_shape ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.side.hair.8ce048dc")} language={language} onChange={(value) => setStructuredValue('hair_side_hair', value)} options={hairSideOptions} value={structuredDraft.hair_side_hair ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.back.shape.a85f5892")} language={language} onChange={(value) => setStructuredValue('hair_back_shape', value)} options={hairBackShapeOptions} value={structuredDraft.hair_back_shape ?? ''} />
            </CollapsibleGroup>

            <CollapsibleGroup title={t(language, "generated.screens.CharactersScreen.outfit.c6a8820c")}>
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.category.da912e83")} language={language} onChange={(value) => setStructuredValue('clothing_category', value)} options={clothingOptions} value={structuredDraft.clothing_category ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.main.color.250a10a8")} language={language} onChange={(value) => setStructuredValue('clothing_main_color', value)} options={clothingColorOptions} value={structuredDraft.clothing_main_color ?? ''} />
              <ChoiceField label={t(language, "generated.screens.CharactersScreen.impression.811cb717")} language={language} onChange={(value) => setStructuredValue('clothing_impression', value)} options={clothingImpressionOptions} value={structuredDraft.clothing_impression ?? ''} />
              <CharacterOutfitField
                language={language}
                onChange={(value) =>
                  setStructuredValue('clothing_description', value)
                }
                value={structuredDraft.clothing_description ?? ''}
              />
            </CollapsibleGroup>
          </>
        ) : (
          <>
            <Text style={styles.groupTitle}>{t(language, "generated.screens.CharactersScreen.generic.traits.9f53c262")}</Text>
            {activeFieldKeys.map((key) => (
              <FormField key={key} label={genericFieldLabels[key] === undefined ? key.replace(/_/g, ' ') : t(language, genericFieldLabels[key])} onChangeText={(value) => setStructuredValue(key, value)} value={structuredDraft[key] ?? ''} />
            ))}
          </>
        )}
        <CollapsibleGroup defaultCollapsed title={t(language, "generated.screens.CharactersScreen.speech.profile.84432725")}>
          <FormField label={t(language, "generated.screens.CharactersScreen.first.person.8a934999")} onChangeText={(value) => setSpeechValue('first_person', value)} value={speechDraft.first_person ?? ''} />
          <FormField label={t(language, "generated.screens.CharactersScreen.second.person.3e7151f4")} onChangeText={(value) => setSpeechValue('second_person', value)} value={speechDraft.second_person ?? ''} />
          <FormField label={t(language, "generated.screens.CharactersScreen.tone.56847163")} onChangeText={(value) => setSpeechValue('tone', value)} value={speechDraft.tone ?? ''} />
          <FormField label={t(language, "generated.screens.CharactersScreen.politeness.3b687516")} onChangeText={(value) => setSpeechValue('politeness', value)} value={speechDraft.politeness ?? ''} />
          <FormField label={t(language, "generated.screens.CharactersScreen.sentence.ending.dacac89c")} onChangeText={(value) => setSpeechValue('sentence_ending', value)} value={speechDraft.sentence_ending ?? ''} />
          <FormField label={t(language, "generated.screens.CharactersScreen.catchphrase.16b47ba7")} onChangeText={(value) => setSpeechValue('catchphrase', value)} value={speechDraft.catchphrase ?? ''} />
          <FormField label={t(language, "generated.screens.CharactersScreen.speech.notes.5a43c77a")} multiline onChangeText={(value) => setSpeechValue('speech_notes', value)} value={speechDraft.speech_notes ?? ''} />
        </CollapsibleGroup>
        </Section>
      </View>

      <View onLayout={recordSectionOffset('import')}>
        <Section collapsible persistKey="characters:image-import" subtitle={t(language, "generated.screens.CharactersScreen.import.a.character.image.so.its.appearan.ed76afc3")} title={t(language, 'imageImport')} tone="highlight">
        <Notice
          message={t(language, "generated.screens.CharactersScreen.choose.jpeg.png.or.webp.large.images.can.2bf9c35d")}
          tone="info"
        />
        <PrimaryButton
          disabled={!canGenerate || activeWorkId === null}
          disabledReason={
            !canGenerate
              ? t(language, "generated.screens.CharactersScreen.generation.permission.is.required.1bc5b7af")
              : activeWorkId === null
                ? t(language, "generated.screens.CharactersScreen.select.a.work.first.1219842f")
                : undefined
          }
          label={t(language, 'imageImport')}
          loading={importImageMutation.isPending}
          onPress={() => importImageMutation.mutate('select')}
        />
        <EntityReferenceUploadStatus
          error={
            importImageMutation.error instanceof DirectEntityUploadError
              ? importImageMutation.error
              : null
          }
          isPending={importImageMutation.isPending}
          language={language}
          onCancel={() => entityReferenceUploadAbortController.current?.abort()}
          onRetry={() => importImageMutation.mutate('retry')}
          progress={entityReferenceUploadProgress}
          stage={entityReferenceUploadStage}
        />
        {importResult === null ? null : (
          <Notice message={t(language, "generated.screens.CharactersScreen.suggested.fields.were.applied.to.the.for.1570bad8")} tone="info" />
        )}
        </Section>
      </View>

      <Section
        collapsible
        persistKey="characters:description-save"
        subtitle={t(language, "generated.screens.CharactersScreen.you.do.not.need.to.fill.every.field.c49dd414")}
        title={t(language, "generated.screens.CharactersScreen.description.and.save.19130ad8")}
      >
        <FormField
          help={t(language, "generated.screens.CharactersScreen.describe.traits.not.covered.by.the.choic.a92e98e3")}
          label={t(language, 'description')}
          maxLength={2000}
          multiline
          onChangeText={setDescription}
          value={description}
        />
        <View style={styles.buttonRow}>
          {entityEditorMode === 'create' ? (
            <PrimaryButton disabled={!canEdit || activeWorkId === null || name.trim().length === 0} disabledReason={!canEdit ? t(language, "generated.screens.CharactersScreen.editing.permission.is.required.6d3b86ee") : activeWorkId === null ? t(language, "generated.screens.CharactersScreen.select.a.work.first.1219842f") : name.trim().length === 0 ? t(language, "generated.screens.CharactersScreen.name.is.required.a58dfb87") : undefined} label={t(language, 'create')} loading={createEntityMutation.isPending} onPress={() => createEntityMutation.mutate()} />
          ) : (
            <>
              <PrimaryButton disabled={!canEdit || entityStale || selectedEntity === null || name.trim().length === 0} disabledReason={!canEdit ? t(language, "generated.screens.CharactersScreen.editing.permission.is.required.6d3b86ee") : entityStale ? t(language, "generated.screens.CharactersScreen.reload.the.latest.state.8874ff96") : selectedEntity === null ? t(language, "generated.screens.CharactersScreen.select.a.character.first.7075de9f") : name.trim().length === 0 ? t(language, "generated.screens.CharactersScreen.name.is.required.a58dfb87") : undefined} label={t(language, 'save')} loading={updateEntityMutation.isPending} onPress={() => updateEntityMutation.mutate()} variant="secondary" />
              <PrimaryButton disabled={!canEdit || selectedEntity === null} disabledReason={!canEdit ? t(language, "generated.screens.CharactersScreen.editing.permission.is.required.6d3b86ee") : selectedEntity === null ? t(language, "generated.screens.CharactersScreen.select.a.character.first.7075de9f") : undefined} label={t(language, "generated.screens.CharactersScreen.delete.8deafb71")} loading={deleteEntityMutation.isPending} onPress={confirmDeleteEntity} variant="danger" />
            </>
          )}
        </View>
      </Section>

      <Section collapsible persistKey="characters:reference-set" subtitle={t(language, "generated.screens.CharactersScreen.page.generation.uses.confirmed.reference.6e2b8447")} title={t(language, 'referenceSet')}>
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.caption}>{t(language, "generated.screens.CharactersScreen.status.bd826326")}</Text>
            <Text style={styles.metric}>{formatReferenceStatus(referenceQuery.data?.status, language)}</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.caption}>{t(language, "generated.screens.CharactersScreen.primary.a481ddc0")}</Text>
            <Text style={styles.metric}>
              {referenceQuery.data?.primary_ref_id === null || referenceQuery.data?.primary_ref_id === undefined
                ? t(language, "generated.screens.CharactersScreen.not.set.3ecccf12")
                : t(language, "generated.screens.CharactersScreen.set.d44ebb68")}
            </Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.caption}>{t(language, "generated.screens.CharactersScreen.images.716d1857")}</Text>
            <Text style={styles.metric}>{referenceQuery.data?.reference_images.length ?? 0}</Text>
          </View>
        </View>
        {activeReferenceCandidate === null && (referenceQuery.data?.reference_images.length ?? 0) === 0 ? (
          <Notice
            message={t(language, "generated.screens.CharactersScreen.imported.generated.and.confirmed.referen.b5e84403")}
            tone="info"
          />
        ) : (
          <>
            <Text style={styles.groupTitle}>{t(language, "generated.screens.CharactersScreen.preview.and.confirmed.images.78120ddc")}</Text>
            <ScrollView
              contentContainerStyle={styles.referenceHorizontal}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {activeReferenceCandidate === null ? null : (
                <View style={styles.candidateCard}>
                  <ReferenceCandidatePreview
                    candidate={activeReferenceCandidate}
                    fallbackUri={candidateImageUri(selectedEntity?.id ?? null, activeReferenceCandidate.candidate_token, organizationId)}
                    headers={imageRequestHeaders}
                    language={language}
                    onOpen={openImagePreview}
                  />
                  <Text style={styles.caption}>
                    {activeReferenceCandidate.source === 'import'
                      ? t(language, "generated.screens.CharactersScreen.imported.candidate.69aa8c45")
                      : t(language, "generated.screens.CharactersScreen.generated.candidate.e8dea344")}
                  </Text>
                  <Text style={styles.referenceId}>{t(language, "generated.screens.CharactersScreen.pending.confirmation.dbf9672b")}</Text>
                </View>
              )}
          {(referenceQuery.data?.reference_images ?? []).map((reference) => {
            const uri = referenceImageUri(
              selectedEntity?.id ?? null,
              reference.ref_id,
              organizationId,
              referenceQuery.data?.updated_at ?? ''
            );
            return (
            <View key={reference.ref_id} style={styles.referenceCard}>
              {uri === null ? null : (
                <Pressable
                  accessibilityLabel={t(language, "generated.components.ImagePreviewModal.image.preview.0f884bd2")}
                  accessibilityRole="imagebutton"
                  onPress={() => openImagePreview(uri, imageRequestHeaders)}
                >
                  <Image
                    resizeMode="cover"
                    source={imageRequestHeaders === undefined ? { uri } : { uri, headers: imageRequestHeaders }}
                    style={styles.referenceImage}
                  />
                </Pressable>
              )}
              <Text style={styles.caption}>{reference.source}</Text>
              <Text style={styles.referenceId}>{t(language, "generated.screens.CharactersScreen.confirmed.reference.c533ad2d")}</Text>
              <Pressable accessibilityRole="button" disabled={!canExport} onPress={() => downloadReferenceMutation.mutate(reference.ref_id)} style={styles.smallLink}>
                <Text style={styles.smallLinkText}>{t(language, "generated.screens.CharactersScreen.save.80b89d5e")}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={!canEdit || deleteReferenceMutation.isPending} onPress={() => confirmDeleteReference(reference.ref_id)} style={styles.smallDangerLink}>
                <Text style={styles.smallDangerLinkText}>{t(language, "generated.screens.CharactersScreen.delete.8deafb71")}</Text>
              </Pressable>
            </View>
            );
          })}
            </ScrollView>
          </>
        )}
        <EntityGenerationBlockers
          blockers={generationBlockers}
          language={language}
          messageForCode={(code) => generationBlockerMessage(code, language)}
          onAction={handleGenerationBlockerAction}
        />
        <PrimaryButton
          disabled={entityStale || generationBlockers.length > 0}
          disabledReason={entityStale ? t(language, "generated.screens.CharactersScreen.reload.the.latest.state.8874ff96") : generationBlockers.length === 0 ? undefined : generationBlockerMessage(generationBlockers[0].code, language)}
          label={t(language, 'generateReference')}
          loading={generateReferenceMutation.isPending}
          onPress={confirmGenerateReference}
        />
        <JobStatusCard
          api={api}
          jobId={displayedJobId}
          language={language}
          organizationId={organizationId}
          onCompleted={async () => {
            await Promise.all([invalidateEntities(), invalidateReference()]);
          }}
          sessionKey={sessionKey}
        />
        {candidateTokenIsImported && !importedCandidateMatchesEntity ? (
          <Notice
            message={t(language, "generated.screens.CharactersScreen.this.imported.candidate.is.not.bound.to.5df63d79")}
            tone="warning"
          />
        ) : null}
        <PrimaryButton
          disabled={!canExport || selectedEntity === null || !candidateTokenUsable}
          disabledReason={!canExport ? t(language, "generated.screens.CharactersScreen.export.permission.is.required.8c8fb948") : selectedEntity === null ? t(language, "generated.screens.CharactersScreen.select.a.character.first.7075de9f") : !candidateTokenUsable ? t(language, "generated.screens.CharactersScreen.select.a.candidate.valid.for.this.charac.049d04a0") : undefined}
          label={t(language, "generated.screens.CharactersScreen.save.candidate.image.9e676bff")}
          loading={downloadCandidateMutation.isPending}
          onPress={() => downloadCandidateMutation.mutate()}
          variant="ghost"
        />
        <PrimaryButton
          disabled={!canEdit || selectedEntity === null || !candidateTokenUsable}
          disabledReason={!canEdit ? t(language, "generated.screens.CharactersScreen.editing.permission.is.required.6d3b86ee") : selectedEntity === null ? t(language, "generated.screens.CharactersScreen.select.a.character.first.7075de9f") : !candidateTokenUsable ? t(language, "generated.screens.CharactersScreen.review.a.candidate.image.for.the.current.efd0db5c") : undefined}
          label={t(language, 'confirmReference')}
          loading={confirmReferenceMutation.isPending}
          onPress={() => confirmReferenceMutation.mutate()}
          variant="secondary"
        />
      </Section>
      <Section
        collapsible
        persistKey="characters:continuity-states"
        subtitle={t(language, "generated.screens.CharactersScreen.save.appearance.injury.hair.expression.a.c2141b7d")}
        title={t(language, "generated.screens.CharactersScreen.continuity.states.48740dcf")}
      >
        {selectedEntity === null ? (
          <Notice message={t(language, "generated.screens.CharactersScreen.select.a.character.to.view.continuity.st.daadb345")} tone="info" />
        ) : (
          <>
            <RecordPicker
              emptyLabel={t(language, "generated.screens.CharactersScreen.no.saved.continuity.states.04cab054")}
              helperText={t(language, "generated.screens.CharactersScreen.choose.a.saved.state.to.review.its.detai.cfa068cc")}
              items={entityStatesQuery.data?.entity_states ?? []}
              language={language}
              labelForItem={(entityState) => entityStateLabel(entityState, language)}
              onSelect={setSelectedEntityStateId}
              selectedId={selectedEntityStateId}
            />
            {!canEdit ? (
              <Notice
                message={t(language, "generated.screens.CharactersScreen.your.role.can.view.continuity.states.but.23a644a4")}
                tone="info"
              />
            ) : (
              <>
                <PrimaryButton
                  label={t(language, "generated.screens.CharactersScreen.new.continuity.state.b05dbb62")}
                  onPress={beginNewEntityStateDraft}
                  variant="secondary"
                />
                <Text style={styles.label}>{t(language, "generated.screens.CharactersScreen.linked.scene.fd25b85a")}</Text>
                <RecordPicker
                  emptyLabel={t(language, "generated.screens.CharactersScreen.select.a.scene.2d324a16")}
                  helperText={
                    workspaceContext.selectedEpisodeId === null
                      ? t(language, "generated.screens.CharactersScreen.select.an.episode.in.the.current.work.to.95fb116b")
                      : t(language, "generated.screens.CharactersScreen.only.scenes.in.the.current.work.and.epis.e19258a4")
                  }
                  items={entityStateSceneOptions}
                  language={language}
                  labelForItem={(option) => option.label}
                  onSelect={(optionId) => {
                    const option = entityStateSceneOptions.find((candidate) => candidate.id === optionId);
                    setEntityStateDraft((current) => ({ ...current, sceneId: option?.sceneId ?? null }));
                  }}
                  selectedId={entityStateDraft.sceneId ?? NO_SCENE_OPTION_ID}
                />
                <FormField
                  label={t(language, "generated.screens.CharactersScreen.costume.570639c7")}
                  maxLength={2000}
                  multiline
                  onChangeText={(value) => setEntityStateDraft((current) => ({ ...current, costumeNote: value }))}
                  value={entityStateDraft.costumeNote}
                />
                <FormField
                  label={t(language, "generated.screens.CharactersScreen.condition.or.injury.74dd8c28")}
                  maxLength={2000}
                  multiline
                  onChangeText={(value) => setEntityStateDraft((current) => ({ ...current, conditionNote: value }))}
                  value={entityStateDraft.conditionNote}
                />
                <FormField
                  label={t(language, "generated.screens.CharactersScreen.hair.state.ee902ab9")}
                  maxLength={2000}
                  multiline
                  onChangeText={(value) => setEntityStateDraft((current) => ({ ...current, hairNote: value }))}
                  value={entityStateDraft.hairNote}
                />
                <FormField
                  label={t(language, "generated.screens.CharactersScreen.default.expression.bfd9df1b")}
                  maxLength={100}
                  onChangeText={(value) => setEntityStateDraft((current) => ({ ...current, expressionDefault: value }))}
                  value={entityStateDraft.expressionDefault}
                />
                <FormField
                  label={t(language, "generated.screens.CharactersScreen.additional.notes.eaab6b21")}
                  maxLength={2000}
                  multiline
                  onChangeText={(value) => setEntityStateDraft((current) => ({ ...current, extraNote: value }))}
                  value={entityStateDraft.extraNote}
                />
                <PrimaryButton
                  disabled={entityStateDraft.expressionDefault.trim().length === 0}
                  disabledReason={t(language, "generated.screens.CharactersScreen.enter.a.default.expression.8c8a9f52")}
                  label={selectedEntityStateId === null ? t(language, "generated.screens.CharactersScreen.save.state.16ffde3c") : t(language, "generated.screens.CharactersScreen.update.state.dd1b42b7")}
                  loading={createEntityStateMutation.isPending || updateEntityStateMutation.isPending}
                  onPress={() => {
                    if (selectedEntityStateId === null) {
                      createEntityStateMutation.mutate();
                      return;
                    }
                    updateEntityStateMutation.mutate();
                  }}
                />
              </>
            )}
          </>
        )}
      </Section>
      <ImagePreviewModal headers={previewImageHeaders} language={language} onClose={closeImagePreview} uri={previewImageUri} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  caption: {
    ...textStyles.caption
  },
  choiceField: {
    gap: spacing.xs
  },
  choiceChevron: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20
  },
  choiceModalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md
  },
  choiceModalClose: {
    alignItems: 'center',
    backgroundColor: colors.field,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44
  },
  choiceModalCloseText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 20
  },
  choiceModalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between'
  },
  choiceModalScroll: {
    width: '100%'
  },
  choiceModalSheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.md,
    maxHeight: '76%',
    maxWidth: 520,
    padding: spacing.md,
    width: '100%'
  },
  choiceMenu: {
    gap: spacing.xs
  },
  choiceOption: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  choiceOptionSelected: {
    backgroundColor: 'rgba(229, 199, 107, 0.12)',
    borderColor: 'rgba(229, 199, 107, 0.44)'
  },
  choiceOptionText: {
    ...textStyles.body,
    color: colors.ink,
    flex: 1,
    fontWeight: '600',
    minWidth: 0
  },
  choiceOptionTextSelected: {
    color: colors.primary,
    fontWeight: '700'
  },
  choiceRadioInner: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: 10,
    width: 10
  },
  choiceRadioOuter: {
    alignItems: 'center',
    borderColor: colors.mutedSoft,
    borderRadius: 999,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22
  },
  choiceRadioOuterSelected: {
    borderColor: colors.primary
  },
  choiceTrigger: {
    alignItems: 'center',
    backgroundColor: colors.field,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  choiceValue: {
    ...textStyles.body,
    flex: 1,
    minWidth: 0
  },
  candidateCard: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: spacing.sm,
    width: 160
  },
  candidateCardSelected: {
    borderColor: colors.primary,
    borderWidth: 2
  },
  candidateImage: {
    aspectRatio: 0.72,
    backgroundColor: colors.field,
    borderRadius: 6,
    width: '100%'
  },
  candidateImageError: {
    alignItems: 'center',
    aspectRatio: 0.72,
    backgroundColor: colors.field,
    borderRadius: 6,
    justifyContent: 'center',
    padding: spacing.sm,
    width: '100%'
  },
  group: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingTop: spacing.sm
  },
  groupBody: {
    gap: spacing.md
  },
  groupChevron: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 21
  },
  groupHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 44
  },
  groupTitle: {
    ...textStyles.body,
    flex: 1,
    minWidth: 0,
    color: colors.primary,
    fontWeight: '700'
  },
  label: {
    ...textStyles.caption,
    color: colors.ink,
    fontWeight: '700'
  },
  metric: {
    ...textStyles.body,
    flexShrink: 1,
    fontWeight: '700'
  },
  metricCard: {
    backgroundColor: 'rgba(16, 16, 16, 0.82)',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    minWidth: 88,
    padding: spacing.sm
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  referenceCard: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: spacing.sm,
    width: 160
  },
  referenceHorizontal: {
    gap: spacing.sm
  },
  referenceId: {
    ...textStyles.caption,
    color: colors.ink
  },
  referenceImage: {
    aspectRatio: 0.72,
    backgroundColor: colors.field,
    borderRadius: 6,
    width: '100%'
  },
  result: {
    backgroundColor: 'rgba(16, 16, 16, 0.82)',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md
  },
  smallLink: {
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  },
  smallLinkText: {
    ...textStyles.caption,
    color: colors.primary,
    fontWeight: '700',
    textAlign: 'center'
  },
  selectedCandidateText: {
    color: colors.ink
  },
  smallDangerLink: {
    borderColor: 'rgba(244, 67, 54, 0.38)',
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  },
  smallDangerLinkText: {
    ...textStyles.caption,
    color: colors.danger,
    fontWeight: '700',
    textAlign: 'center'
  }
});
