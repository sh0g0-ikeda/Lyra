import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image as ExpoImage } from 'expo-image';

import { PageErrorRecoveryNotice } from '@/components/PageErrorRecoveryNotice';
import { ExportJobCard } from '@/components/ExportJobCard';
import { ExcessPanelDeletionPlan } from '@/components/ExcessPanelDeletionPlan';
import { ConfirmedPageSummary } from '@/components/ConfirmedPageSummary';
import { FormField } from '@/components/FormField';
import { ImagePreviewModal } from '@/components/ImagePreviewModal';
import { JobStatusCard } from '@/components/JobStatusCard';
import { LayoutTemplatePreview, type FramePreviewDefinition } from '@/components/LayoutTemplatePreview';
import { Notice } from '@/components/Notice';
import { PageCompletionActions } from '@/components/PageCompletionActions';
import { PageImageViewer } from '@/components/PageImageViewer';
import { PageSceneAutofillAction } from '@/components/PageSceneAutofillAction';
import { PageThumbnailPicker } from '@/components/PageThumbnailPicker';
import { PageProvenanceFields } from '@/components/PageProvenanceFields';
import { PanelDialoguePlacementNotice } from '@/components/PanelDialoguePlacementNotice';
import { PanelDialogueEditor } from '@/components/PanelDialogueEditor';
import { PanelEditorSections } from '@/components/PanelEditorSections';
import { PanelOrderList } from '@/components/PanelOrderList';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RecordPicker } from '@/components/RecordPicker';
import { Screen } from '@/components/Screen';
import { Section } from '@/components/Section';
import { SegmentedControl } from '@/components/SegmentedControl';
import { WorkspaceHierarchyNavigator } from '@/components/WorkspaceHierarchyNavigator';
import { useWorkspaceContextSelection } from '@/components/WorkspaceContextPicker';
import {
  angleOptions,
  panelAssignmentDefaults,
  panelCompositionSourceOptions,
  panelEntityActionOptions,
  panelEntityExpressionOptions,
  panelEntityFacingOptions,
  panelEntityPositionOptions,
  panelEntityRoleOptions,
  panelRoleOptions,
  panelSizeOptions,
  shotTypeOptions
} from '@/constants/options';
import { panelCharacterStateOverrideUiEnabled } from '@/constants/mobileFeatureVisibility';
import { colors, spacing, textStyles } from '@/constants/theme';
import { shouldHydrateEditorDraft } from '@/domain/editorDraftSyncPolicy';
import {
  imageSourceListIdentity,
  type RemoteImageSource
} from '@/domain/imageSourceCandidates';
import { buildAtomicSaveAndGeneratePayload } from '@/domain/pageAtomicGeneration';
import { isPanelDialogueSpeakerValid } from '@/domain/panelDialoguePolicy';
import { buildPageEntityStateOptions } from '@/domain/pageEntityStateOptions';
import { buildEpisodeExportPayload } from '@/domain/pageExport';
import { createSafeLayoutTemplatePayload, selectExcessPanels } from '@/domain/pageSafety';
import { selectPageForEpisode } from '@/domain/pageSelection';
import {
  buildFullPageImageSources,
  buildPageThumbnailImageSources
} from '@/domain/pageImageSources';
import type {
  CompositionRecord,
  EntityRecord,
  ExportFormat,
  PageGenerationBlockerRecord,
  PageLayoutTemplateRecord,
  PageRecord,
  PanelDialogueLine,
  PanelEntityAssignmentRecord,
  PanelFrameRecord,
  PanelRecord
} from '@/domain/types';
import { useActiveResourceJobId } from '@/hooks/useActiveResourceJobId';
import { useResetOnScopeChange } from '@/hooks/useResetOnScopeChange';
import { confirmAction, confirmDestructiveAction } from '@/lib/confirm';
import { config } from '@/lib/config';
import { appendOrganizationQuery, downloadAuthenticatedFile, downloadExternalFile } from '@/lib/download';
import { fileTransferErrorMessage } from '@/lib/fileTransferError';
import {
  errorRecoveryActionLabel,
  pageGenerationBlockerRecoveryTarget
} from '@/lib/errorRecovery';
import { t } from '@/lib/i18n';
import type { ScreenTranslationKey } from '@/lib/i18nScreenMessages';
import { ApiError } from '@/lib/api';
import {
  flattenUniqueRecords,
  MOBILE_LIST_PAGE_SIZE,
  nextCursorFromPage,
} from '@/lib/listPagination';
import {
  activeResourceJobQueryKey,
  entitiesInfiniteQueryKey,
  entitiesQueryKey,
  compositionsQueryKey,
  entityStatesQueryKey,
  framesQueryKey,
  pageDetailQueryKey,
  pageGenerationReadinessQueryKey,
  pageLayoutTemplatesQueryKey,
  pagesInfiniteQueryKey,
  pagesQueryKey,
  panelsQueryKey,
  jobsQueryKey,
  scenesQueryKey
} from '@/lib/queryKeys';
import {
  currentQueryError,
  isApiNotFoundError,
  supportingQueryError
} from '@/lib/queryErrorPolicy';
import { userErrorMessage } from '@/lib/userMessages';
import type { MobileTabParamList } from '@/navigation/tabs';
import { useAppState } from '@/state/appState';
import { useDirtyEditorRegistration, useDirtyState } from '@/state/dirtyState';

type ImageRequestHeaders = Record<string, string>;

interface PageGenerationAttempt {
  pageId: string;
  payloadFingerprint: string;
  idempotencyKey: string;
}

interface EpisodeExportAttempt {
  payloadFingerprint: string;
  idempotencyKey: string;
}

const WEB_EDITOR_URL = 'https://app.lyra-editor.com/';

type AssignmentDraft = Omit<PanelEntityAssignmentRecord, 'facing_direction'> & {
  facing_direction: NonNullable<PanelEntityAssignmentRecord['facing_direction']> | '';
};

interface FrameDraft {
  id: string;
  page_id: string;
  panel_id: string | null;
  vertices: { x: string; y: string }[];
  border_style: PanelFrameRecord['border_style'];
  border_width: string;
  border_color: string;
  z_index: string;
  reading_order: string;
}

const nullable = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const emptyToNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const numeric = (value: string, fallback: number): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const integer = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isIntegerInRangeText = (value: string, min: number, max: number): boolean => {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return false;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max;
};

const isNumberInRangeText = (value: string, min: number, max: number): boolean => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max;
};

const isHexColorText = (value: string): boolean => /^#[0-9A-Fa-f]{6}$/.test(value.trim());

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuidText = (value: string): boolean => uuidPattern.test(value.trim());

const defaultComposition: PanelRecord['composition'] = {
  source: 'ai_auto',
  gallery_item_id: null,
  composition_prompt: null,
  shot_type: null,
  angle: null,
  custom_note: null
};

const readRecordString = (record: Record<string, unknown>, key: string): string =>
  typeof record[key] === 'string' ? record[key] : '';

const readStyleReference = (layoutConfig: Record<string, unknown>): { title: string; notes: string } => {
  const rawReference = layoutConfig.style_reference;
  if (typeof rawReference !== 'object' || rawReference === null || Array.isArray(rawReference)) {
    return { title: '', notes: '' };
  }

  const styleReference = rawReference as Record<string, unknown>;
  return {
    title: readRecordString(styleReference, 'title'),
    notes: readRecordString(styleReference, 'notes')
  };
};

const generationErrorMessage = (error: unknown, language: 'ja' | 'en'): string | null => {
  return error === null || error === undefined ? null : userErrorMessage(error, language);
};

const formatPageStatus = (status: PageRecord['status'], language: 'ja' | 'en'): string => {
  const labels: Record<PageRecord['status'], ScreenTranslationKey> = {
    designing: 'screen.pages.status.designing',
    generating: 'screen.pages.status.generating',
    generated: 'screen.pages.status.generated',
    editing: 'screen.pages.status.editing',
    confirmed: 'screen.pages.status.confirmed'
  };
  return t(language, labels[status]);
};

const pageLayoutTemplateLabels: Record<string, ScreenTranslationKey> = {
  splash_1: 'screen.pages.layout.splash1',
  climax_2: 'screen.pages.layout.climax2',
  vertical_2: 'screen.pages.layout.vertical2',
  top_wide_3: 'screen.pages.layout.topWide3',
  bottom_wide_3: 'screen.pages.layout.bottomWide3',
  standard_4: 'screen.pages.layout.standard4',
  stacked_wide_4: 'screen.pages.layout.stackedWide4',
  wide_top_4: 'screen.pages.layout.wideTop4',
  wide_bottom_4: 'screen.pages.layout.wideBottom4',
  tall_left_4: 'screen.pages.layout.tallLeft4',
  right_tall_4: 'screen.pages.layout.rightTall4',
  action_5: 'screen.pages.layout.action5',
  balanced_5: 'screen.pages.layout.balanced5',
  middle_wide_5: 'screen.pages.layout.middleWide5',
  top_wide_5: 'screen.pages.layout.topWide5',
  standard_6: 'screen.pages.layout.standard6',
  split_6: 'screen.pages.layout.split6',
  battle_7: 'screen.pages.layout.battle7',
  dense_8: 'screen.pages.layout.dense8'
};

const pageLayoutTemplateLabel = (
  template: PageLayoutTemplateRecord,
  language: 'ja' | 'en'
): string => {
  const localized = pageLayoutTemplateLabels[template.id];
  const fallback = template.label_key.replace(/^page\.layoutTemplate\./, '').replaceAll('_', ' ');
  return `${localized === undefined ? fallback : t(language, localized)} (${template.panel_count})`;
};

const generationBlockerMessages: Record<
  PageGenerationBlockerRecord['code'],
  ScreenTranslationKey
> = {
  GENERATION_DISABLED: 'screen.pages.blocker.generationDisabled',
  FRAME_REQUIRED: 'screen.pages.blocker.frameRequired',
  PANEL_REQUIRED: 'screen.pages.blocker.panelRequired',
  FRAME_PANEL_MISMATCH: 'screen.pages.blocker.framePanelMismatch',
  PANEL_ORDER_INVALID: 'screen.pages.blocker.panelOrderInvalid',
  DIALOGUE_SPEAKER_REQUIRED: 'screen.pages.blocker.dialogueSpeakerRequired',
  DIALOGUE_SPEAKER_NOT_IN_PANEL: 'screen.pages.blocker.dialogueSpeakerNotInPanel',
  ASSIGNED_ENTITY_INVALID: 'screen.pages.blocker.assignedEntityInvalid',
  PAGE_GENERATING: 'screen.pages.blocker.pageGenerating',
  PAGE_REOPEN_REQUIRED: 'screen.pages.blocker.pageReopenRequired',
  CHARACTER_REFERENCE_REQUIRED: 'screen.pages.blocker.characterReferenceRequired',
  REFERENCE_IMAGE_LIMIT_EXCEEDED: 'screen.pages.blocker.referenceImageLimitExceeded',
  ACTIVE_GENERATION_JOB: 'screen.pages.blocker.activeGenerationJob',
  INSUFFICIENT_CREDITS: 'screen.pages.blocker.insufficientCredits'
};

const generationBlockerMessage = (
  blocker: PageGenerationBlockerRecord,
  language: 'ja' | 'en'
): string => t(language, generationBlockerMessages[blocker.code]);

const generationBlockerActionLabel = (
  blocker: PageGenerationBlockerRecord,
  language: 'ja' | 'en'
): string | null => {
  const recoveryTarget = pageGenerationBlockerRecoveryTarget(blocker.code);
  if (recoveryTarget !== null) {
    return errorRecoveryActionLabel(recoveryTarget, language);
  }
  const labels: Record<
    Exclude<PageGenerationBlockerRecord['action'], 'wait_for_generation' | 'none'>,
    ScreenTranslationKey
  > = {
    open_layout: 'screen.pages.blockerAction.openLayout',
    open_panels: 'screen.pages.blockerAction.openPanels',
    open_characters: 'screen.pages.blockerAction.openCharacters',
    reopen_page: 'screen.pages.blockerAction.reopenPage'
  };
  return blocker.action === 'wait_for_generation' || blocker.action === 'none'
    ? null
    : t(language, labels[blocker.action]);
};
const labelOptions = <T extends string>(
  options: { value: T; labelJa: string; labelEn: string }[],
  language: 'ja' | 'en'
): { value: T; label: string }[] =>
  options.map((option) => ({
    value: option.value,
    label: language === 'ja' ? option.labelJa : option.labelEn
  }));

interface PanelDisclosureProps {
  title: string;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}

function PanelDisclosure({ title, defaultCollapsed = false, children }: PanelDisclosureProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <View style={styles.panelDisclosure}>
      <Pressable accessibilityRole="button" onPress={() => setCollapsed((current) => !current)} style={styles.panelDisclosureHeader}>
        <Text style={styles.groupTitle}>{title}</Text>
        <Text style={styles.panelDisclosureChevron}>{collapsed ? 'v' : '^'}</Text>
      </Pressable>
      {collapsed ? null : <View style={styles.panelDisclosureBody}>{children}</View>}
    </View>
  );
}

const toAssignmentDraft = (assignment: PanelEntityAssignmentRecord): AssignmentDraft => ({
  ...assignment,
  facing_direction: assignment.facing_direction ?? ''
});

const toAssignmentRecord = (assignment: AssignmentDraft): PanelEntityAssignmentRecord => {
  const facingDirection: PanelEntityAssignmentRecord['facing_direction'] =
    assignment.facing_direction === '' ? null : assignment.facing_direction;

  return {
    ...assignment,
    custom_expression: assignment.expression === 'custom' ? nullable(assignment.custom_expression ?? '') : null,
    custom_action: assignment.action === 'custom' ? nullable(assignment.custom_action ?? '') : null,
    effect_note: nullable(assignment.effect_note ?? ''),
    state_id: nullable(assignment.state_id ?? ''),
    facing_direction: facingDirection
  };
};

const toFrameDraft = (frame: PanelFrameRecord): FrameDraft => {
  const vertices = frame.vertices.slice(0, 4).map((vertex) => ({
    x: String(vertex.x),
    y: String(vertex.y)
  }));
  while (vertices.length < 4) {
    vertices.push({ x: '0', y: '0' });
  }

  return {
    id: frame.id,
    page_id: frame.page_id,
    panel_id: frame.panel_id,
    vertices,
    border_style: frame.border_style,
    border_width: String(frame.border_width),
    border_color: frame.border_color,
    z_index: String(frame.z_index),
    reading_order: String(frame.reading_order)
  };
};

const toFrameRecord = (draft: FrameDraft): PanelFrameRecord => ({
  id: draft.id,
  page_id: draft.page_id,
  panel_id: draft.panel_id,
  vertices: draft.vertices.slice(0, 4).map((vertex) => ({
    x: clampPreviewCoordinate(numeric(vertex.x, 0)),
    y: clampPreviewCoordinate(numeric(vertex.y, 0))
  })),
  border_style: draft.border_style,
  border_width: Math.min(20, Math.max(0, integer(draft.border_width, 1))),
  border_color: isHexColorText(draft.border_color) ? draft.border_color.trim() : '#000000',
  z_index: Math.min(1000, Math.max(0, integer(draft.z_index, 1))),
  reading_order: Math.min(1000, Math.max(1, integer(draft.reading_order, 1)))
});

const clampPreviewCoordinate = (value: number): number => Math.min(1, Math.max(0, value));

const formatCoordinate = (value: number): string => {
  const fixed = clampPreviewCoordinate(value).toFixed(3);
  return fixed.replace(/\.?0+$/, '');
};

const toFramePreviewDefinition = (draft: FrameDraft): FramePreviewDefinition => ({
  vertices: draft.vertices.map((vertex) => ({
    x: clampPreviewCoordinate(numeric(vertex.x, 0)),
    y: clampPreviewCoordinate(numeric(vertex.y, 0))
  }))
});

function CompositionPicker(props: {
  compositions: CompositionRecord[];
  language: 'ja' | 'en';
  onSelect: (composition: CompositionRecord) => void;
  selectedId: string;
  disabled?: boolean;
}): React.JSX.Element {
  if (props.compositions.length === 0) {
    return <Text style={styles.emptySmall}>{t(props.language, "generated.screens.PagesScreen.no.compositions.available.8247a317")}</Text>;
  }

  return (
    <ScrollView horizontal contentContainerStyle={styles.compositionStrip} showsHorizontalScrollIndicator={false}>
      {props.compositions.slice(0, 10).map((composition) => {
        const selected = composition.id === props.selectedId;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: props.disabled, selected }}
            disabled={props.disabled}
            key={composition.id}
            onPress={() => props.onSelect(composition)}
            style={[styles.compositionCard, selected ? styles.compositionCardSelected : null]}
          >
            {composition.preview_cdn_url === null ? (
              <View style={styles.compositionImagePlaceholder} />
            ) : (
              <ExpoImage
                cachePolicy="memory-disk"
                contentFit="cover"
                source={{ uri: composition.preview_cdn_url }}
                style={styles.compositionImage}
              />
            )}
            <Text numberOfLines={2} style={[styles.compositionLabel, selected ? styles.compositionLabelSelected : null]}>
              {composition.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function EntityStatePicker(props: {
  disabled?: boolean;
  entityId: string;
  language: 'ja' | 'en';
  onSelect: (stateId: string | null) => void;
  selectedStateId: string | null;
}): React.JSX.Element {
  const { api, selection, sessionKey } = useAppState();
  const organizationId = selection.organizationId;
  const statesQuery = useQuery({
    queryKey: entityStatesQueryKey(sessionKey, props.entityId, organizationId),
    queryFn: () => api.getEntityStates(props.entityId, organizationId)
  });
  const options = buildPageEntityStateOptions({
    entityId: props.entityId,
    language: props.language,
    states: statesQuery.data?.entity_states ?? []
  });
  const selectedStateMissing =
    props.selectedStateId !== null &&
    !options.some((option) => option.id === props.selectedStateId);
  const displayOptions = selectedStateMissing
    ? [
        ...options,
        {
          id: props.selectedStateId ?? '',
          label: t(props.language, "generated.screens.PagesScreen.current.state.refresh.required.91442687")
        }
      ]
    : options;
  const selectedOption =
    displayOptions.find((option) => option.id === (props.selectedStateId ?? '')) ??
    displayOptions[0];

  return (
    <View style={styles.editorStack}>
      <Text style={styles.label}>{t(props.language, "generated.screens.PagesScreen.continuity.state.1cb4d861")}</Text>
      {statesQuery.error === null ? null : (
        <Notice
          message={t(props.language, "generated.screens.PagesScreen.state.options.could.not.be.loaded.refres.09d4b30d")}
          tone="warning"
        />
      )}
      {props.disabled ? (
        <Text style={styles.readOnlyValue}>
          {selectedOption?.label ??
            t(props.language, "generated.screens.PagesScreen.no.state.override.716bb1b8")}
        </Text>
      ) : (
        <RecordPicker
          emptyLabel={
            statesQuery.isPending
              ? t(props.language, "generated.screens.PagesScreen.loading.states.a49a997c")
              : t(props.language, "generated.screens.PagesScreen.no.state.override.716bb1b8")
          }
          items={displayOptions}
          labelForItem={(option) => option.label}
          language={props.language}
          onSelect={(stateId) => props.onSelect(stateId.length === 0 ? null : stateId)}
          searchable={false}
          selectedId={props.selectedStateId ?? ''}
        />
      )}
    </View>
  );
}

function AssignmentEditor(props: {
  assignments: AssignmentDraft[];
  entities: EntityRecord[];
  language: 'ja' | 'en';
  onChange: (assignments: AssignmentDraft[]) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [removedAssignment, setRemovedAssignment] = useState<{ assignment: AssignmentDraft; index: number } | null>(null);
  const assignedIds = new Set(props.assignments.map((assignment) => assignment.entity_id));
  const availableEntities = props.entities.filter((entity) => !assignedIds.has(entity.id));

  const updateAssignment = (entityId: string, patch: Partial<AssignmentDraft>): void => {
    props.onChange(
      props.assignments.map((assignment) =>
        assignment.entity_id === entityId ? { ...assignment, ...patch } : assignment
      )
    );
  };

  const addEntity = (entityId: string): void => {
    setRemovedAssignment(null);
    props.onChange([
      ...props.assignments,
      {
        ...panelAssignmentDefaults,
        entity_id: entityId,
        facing_direction: panelAssignmentDefaults.facing_direction ?? ''
      }
    ]);
  };

  const removeAssignment = (entityId: string): void => {
    const index = props.assignments.findIndex((assignment) => assignment.entity_id === entityId);
    const assignment = props.assignments[index];
    if (index < 0 || assignment === undefined) {
      return;
    }
    setRemovedAssignment({ assignment, index });
    props.onChange(props.assignments.filter((item) => item.entity_id !== entityId));
  };

  const undoRemove = (): void => {
    if (removedAssignment === null) {
      return;
    }
    const insertIndex = Math.min(removedAssignment.index, props.assignments.length);
    props.onChange([
      ...props.assignments.slice(0, insertIndex),
      removedAssignment.assignment,
      ...props.assignments.slice(insertIndex)
    ]);
    setRemovedAssignment(null);
  };

  return (
    <View style={styles.editorStack}>
      <Text style={styles.groupTitle}>{t(props.language, "generated.screens.PagesScreen.characters.in.panel.f467d2e7")}</Text>
      {props.disabled ? null : availableEntities.length === 0 ? (
        <Text style={styles.emptySmall}>{t(props.language, "generated.screens.PagesScreen.no.more.characters.to.add.2be1c576")}</Text>
      ) : (
        <View style={styles.chipRow}>
          {availableEntities.map((entity) => (
            <Pressable accessibilityRole="button" key={entity.id} onPress={() => addEntity(entity.id)} style={styles.chip}>
              <Text style={styles.chipLabel}>+ {entity.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {removedAssignment === null ? null : (
        <View style={styles.undoRow}>
          <Text style={styles.emptySmall}>{t(props.language, "generated.screens.PagesScreen.character.assignment.removed.317e9fad")}</Text>
          <PrimaryButton disabled={props.disabled} label={t(props.language, "generated.screens.PagesScreen.undo.0b96087f")} onPress={undoRemove} variant="ghost" />
        </View>
      )}
      {props.assignments.map((assignment) => {
        const entity = props.entities.find((item) => item.id === assignment.entity_id);
        return (
          <View key={assignment.entity_id} style={styles.subCard}>
            <View style={styles.subCardHeader}>
              <Text style={styles.subCardTitle}>{entity?.name ?? assignment.entity_id}</Text>
              <PrimaryButton
                disabled={props.disabled}
                label={t(props.language, "generated.screens.PagesScreen.remove.21a05866")}
                onPress={() => removeAssignment(assignment.entity_id)}
                variant="ghost"
              />
            </View>
            <Text style={styles.label}>{t(props.language, "generated.screens.PagesScreen.role.99bfaa69")}</Text>
            <SegmentedControl
              disabled={props.disabled}
              onChange={(value) => updateAssignment(assignment.entity_id, { role: value })}
              options={labelOptions(panelEntityRoleOptions, props.language)}
              value={assignment.role}
            />
            <Text style={styles.label}>{t(props.language, "generated.screens.PagesScreen.placement.2ae5e6c8")}</Text>
            <SegmentedControl
              disabled={props.disabled}
              onChange={(value) => updateAssignment(assignment.entity_id, { position: value })}
              options={labelOptions(panelEntityPositionOptions, props.language)}
              value={assignment.position}
            />
            <Text style={styles.label}>{t(props.language, "generated.screens.PagesScreen.facing.734a5667")}</Text>
            <SegmentedControl
              disabled={props.disabled}
              onChange={(value) => updateAssignment(assignment.entity_id, { facing_direction: value })}
              options={[
                { value: '', label: '-' },
                ...labelOptions(panelEntityFacingOptions, props.language)
              ]}
              value={assignment.facing_direction}
            />
            <Text style={styles.label}>{t(props.language, "generated.screens.PagesScreen.expression.475a6c0f")}</Text>
            <SegmentedControl
              disabled={props.disabled}
              onChange={(value) => updateAssignment(assignment.entity_id, { expression: value })}
              options={labelOptions(panelEntityExpressionOptions, props.language)}
              value={assignment.expression}
            />
            {assignment.expression === 'custom' ? (
              <FormField editable={!props.disabled} label={t(props.language, "generated.screens.PagesScreen.custom.expression.20a63769")} maxLength={100} onChangeText={(value) => updateAssignment(assignment.entity_id, { custom_expression: value })} value={assignment.custom_expression ?? ''} />
            ) : null}
            <Text style={styles.label}>{t(props.language, "generated.screens.PagesScreen.pose.632d61df")}</Text>
            <SegmentedControl
              disabled={props.disabled}
              onChange={(value) => updateAssignment(assignment.entity_id, { action: value })}
              options={labelOptions(panelEntityActionOptions, props.language)}
              value={assignment.action}
            />
            {assignment.action === 'custom' ? (
              <FormField editable={!props.disabled} label={t(props.language, "generated.screens.PagesScreen.custom.pose.c687f0ab")} maxLength={100} onChangeText={(value) => updateAssignment(assignment.entity_id, { custom_action: value })} value={assignment.custom_action ?? ''} />
            ) : null}
            <FormField editable={!props.disabled} label={t(props.language, "generated.screens.PagesScreen.effect.e2da3225")} maxLength={200} onChangeText={(value) => updateAssignment(assignment.entity_id, { effect_note: value })} value={assignment.effect_note ?? ''} />
            {panelCharacterStateOverrideUiEnabled ? (
              <PanelDisclosure defaultCollapsed title={t(props.language, "generated.screens.PagesScreen.advanced.050db87b")}>
                <EntityStatePicker
                  disabled={props.disabled}
                  entityId={assignment.entity_id}
                  language={props.language}
                  onSelect={(stateId) => updateAssignment(assignment.entity_id, { state_id: stateId })}
                  selectedStateId={assignment.state_id}
                />
              </PanelDisclosure>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function FrameVertexNudger(props: {
  frame: FrameDraft;
  language: 'ja' | 'en';
  onNudge: (index: number, dx: number, dy: number) => void;
}): React.JSX.Element {
  const step = 0.01;

  return (
    <View style={styles.subCard}>
      <Text style={styles.groupTitle}>{t(props.language, "generated.screens.PagesScreen.nudge.vertices.afb45115")}</Text>
      <Text style={styles.emptySmall}>{t(props.language, "generated.screens.PagesScreen.move.each.vertex.by.1.when.numeric.editi.a950933b")}</Text>
      {props.frame.vertices.map((vertex, index) => (
        <View key={`${props.frame.id}-nudge-${index}`} style={styles.vertexRow}>
          <Text style={styles.vertexLabel}>{t(props.language, "generated.screens.PagesScreen.vertex.0788b266")} {index + 1}: {vertex.x}, {vertex.y}</Text>
          <View style={styles.nudgeButtons}>
            <PrimaryButton label="←" onPress={() => props.onNudge(index, -step, 0)} variant="ghost" />
            <PrimaryButton label="↑" onPress={() => props.onNudge(index, 0, -step)} variant="ghost" />
            <PrimaryButton label="↓" onPress={() => props.onNudge(index, 0, step)} variant="ghost" />
            <PrimaryButton label="→" onPress={() => props.onNudge(index, step, 0)} variant="ghost" />
          </View>
        </View>
      ))}
    </View>
  );
}

interface TemplatePickerModalProps {
  frames: FramePreviewDefinition[];
  language: 'ja' | 'en';
  onChange: (value: string) => void;
  onClose: () => void;
  options: { value: string; label: string }[];
  value: string;
  visible: boolean;
}

function TemplatePickerModal({
  frames,
  language,
  onChange,
  onClose,
  options,
  value,
  visible
}: TemplatePickerModalProps): React.JSX.Element {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable
        accessibilityLabel={t(language, "generated.screens.PagesScreen.close.603bc62f")}
        accessibilityRole="button"
        onPress={onClose}
        style={styles.templateModalBackdrop}
      >
        <View
          accessibilityLabel={t(language, "generated.screens.PagesScreen.layout.template.a08d40fa")}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          onStartShouldSetResponder={() => true}
          style={styles.templateModalSheet}
        >
          <View style={styles.templateModalHeader}>
            <Text style={styles.groupTitle}>{t(language, "generated.screens.PagesScreen.layout.template.a08d40fa")}</Text>
            <Pressable accessibilityLabel={t(language, "generated.screens.PagesScreen.close.603bc62f")} accessibilityRole="button" onPress={onClose} style={styles.templateModalClose}>
              <Text style={styles.templateModalCloseText}>x</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.templateModalBody} style={styles.templateModalScroll}>
            <View accessibilityRole="radiogroup" style={styles.templateRadioList}>
              {options.map((option) => {
                const selected = option.value === value;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    key={option.value}
                    onPress={() => onChange(option.value)}
                    style={[styles.templateRadioOption, selected ? styles.templateRadioOptionSelected : null]}
                  >
                    <View style={[styles.templateRadioOuter, selected ? styles.templateRadioOuterSelected : null]}>
                      {selected ? <View style={styles.templateRadioInner} /> : null}
                    </View>
                    <Text style={[styles.templateRadioLabel, selected ? styles.templateRadioLabelSelected : null]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <LayoutTemplatePreview
              frames={frames}
              title={t(language, "generated.screens.PagesScreen.selected.template.2f5419bf")}
            />
          </ScrollView>
          <PrimaryButton label={t(language, "generated.screens.PagesScreen.close.603bc62f")} onPress={onClose} variant="secondary" />
        </View>
      </Pressable>
    </Modal>
  );
}

export function PagesScreen(): React.JSX.Element {
  const navigation = useNavigation<BottomTabNavigationProp<MobileTabParamList>>();
  const queryClient = useQueryClient();
  const { api, hasCapability, language, logout, selection, sessionKey, tokens, trackJob, updateSelection } = useAppState();
  const { resolveDirtyEditors } = useDirtyState();
  const organizationId = selection.organizationId;
  const canEdit = hasCapability('edit_work');
  const canGenerate = hasCapability('generate');
  const canExport = hasCapability('export');
  const [styleReferenceTitle, setStyleReferenceTitle] = useState('');
  const [styleReferenceNotes, setStyleReferenceNotes] = useState('');
  const [sourceSceneIds, setSourceSceneIds] = useState<string[]>([]);
  const [pagePurpose, setPagePurpose] = useState('');
  const [continuityNote, setContinuityNote] = useState('');
  const [templateId, setTemplateId] = useState('standard_4');
  const [templateModalVisible, setTemplateModalVisible] = useState(false);
  const [panelId, setPanelId] = useState<string | null>(null);
  const [panelRole, setPanelRole] = useState<PanelRecord['panel_role']>('action');
  const [panelSize, setPanelSize] = useState<PanelRecord['panel_size']>('standard');
  const [situationText, setSituationText] = useState('');
  const [compositionSource, setCompositionSource] = useState<PanelRecord['composition']['source']>('ai_auto');
  const [compositionGalleryItemId, setCompositionGalleryItemId] = useState('');
  const [compositionPrompt, setCompositionPrompt] = useState('');
  const [shotType, setShotType] = useState('');
  const [angle, setAngle] = useState('');
  const [customNote, setCustomNote] = useState('');
  const [dialogueInPanel, setDialogueInPanel] = useState(true);
  const [dialogues, setDialogues] = useState<PanelDialogueLine[]>([]);
  const [assignments, setAssignments] = useState<AssignmentDraft[]>([]);
  const [sfxText, setSfxText] = useState('');
  const [backgroundNote, setBackgroundNote] = useState('');
  const [panelNotes, setPanelNotes] = useState('');
  const [frameId, setFrameId] = useState<string | null>(null);
  const [frameDrafts, setFrameDrafts] = useState<FrameDraft[]>([]);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('pdf');
  const [exportFilename, setExportFilename] = useState('lyra-pages');
  const [exportSelectedPageIds, setExportSelectedPageIds] = useState<string[]>([]);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [pageImageDownloadError, setPageImageDownloadError] = useState<string | null>(null);
  const [localJob, setLocalJob] = useState<{
    id: string;
    resourceId: string;
  } | null>(null);
  const [pageStale, setPageStale] = useState(false);
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);
  const [previewImageHeaders, setPreviewImageHeaders] = useState<ImageRequestHeaders | undefined>(undefined);
  const [failedPageImageSourceIdentity, setFailedPageImageSourceIdentity] =
    useState<string | null>(null);
  const lastSyncedPageId = useRef<string | null>(null);
  const lastSyncedPanelId = useRef<string | null>(null);
  const lastSyncedFramePageId = useRef<string | null>(null);
  const generationAttemptRef = useRef<PageGenerationAttempt | null>(null);
  const exportAttemptRef = useRef<EpisodeExportAttempt | null>(null);
  const workspaceContext = useWorkspaceContextSelection();
  const activeWorkId = workspaceContext.selectedWorkId;
  const activeEpisodeId = workspaceContext.selectedEpisodeId;

  const pagesQuery = useInfiniteQuery({
    enabled: activeEpisodeId !== null,
    queryKey: pagesInfiniteQueryKey(sessionKey, activeEpisodeId, organizationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.getPagesPage(activeEpisodeId ?? '', {
      organizationId,
      limit: MOBILE_LIST_PAGE_SIZE,
      cursor: pageParam,
    }),
    getNextPageParam: nextCursorFromPage,
  });
  const pages = useMemo(
    () => flattenUniqueRecords(pagesQuery.data?.pages.map((page) => page.pages) ?? []),
    [pagesQuery.data?.pages],
  );

  const pageLayoutTemplatesQuery = useQuery({
    queryKey: pageLayoutTemplatesQueryKey(sessionKey),
    queryFn: () => api.getPageLayoutTemplates()
  });

  const selectedPageFromList = useMemo(
    () => pages.find((page) => page.id === selection.pageId) ?? null,
    [pages, selection.pageId],
  );
  const shouldFetchSelectedPageDetail =
    activeEpisodeId !== null &&
    pagesQuery.isSuccess &&
    selection.pageId !== null &&
    selectedPageFromList === null;
  const selectedPageQuery = useQuery({
    enabled: shouldFetchSelectedPageDetail,
    queryKey: pageDetailQueryKey(sessionKey, selection.pageId, organizationId),
    queryFn: () => api.getPage(selection.pageId ?? '', organizationId),
  });
  const selectedPageCandidate =
    selectedPageFromList ?? selectedPageQuery.data ?? null;
  const selectedPage =
    selectedPageCandidate?.episode_id === activeEpisodeId
      ? selectedPageCandidate
      : null;
  const selectedPageDetailNotFound =
    shouldFetchSelectedPageDetail &&
    selectedPageQuery.error instanceof ApiError &&
    selectedPageQuery.error.status === 404;
  const selectedPageWrongEpisode =
    shouldFetchSelectedPageDetail &&
    selectedPageQuery.data !== undefined &&
    selectPageForEpisode(selectedPageQuery.data, activeEpisodeId) === null;
  useEffect(() => {
    if (
      selection.pageId === null ||
      (!selectedPageDetailNotFound && !selectedPageWrongEpisode)
    ) {
      return;
    }
    void updateSelection(
      { pageId: null },
      { skipDirtyCheck: true }
    );
  }, [
    selectedPageDetailNotFound,
    selectedPageWrongEpisode,
    selection.pageId,
    updateSelection
  ]);
  const activeServerJobId = useActiveResourceJobId({
    api,
    jobTypes: ['page_generate'],
    organizationId,
    resourceId: selectedPage?.id ?? null,
    resourceParam: 'page_id',
    sessionKey,
  });
  const displayedJobId =
    localJob !== null && localJob.resourceId === selectedPage?.id
      ? localJob.id
      : activeServerJobId;

  const pageGenerationReadinessQuery = useQuery({
    enabled: canGenerate && selectedPage !== null,
    queryKey: pageGenerationReadinessQueryKey(
      sessionKey,
      selectedPage?.id ?? null,
      organizationId
    ),
    queryFn: () => api.getPageGenerationReadiness(selectedPage?.id ?? '', organizationId)
  });

  useEffect(() => {
    const templates = pageLayoutTemplatesQuery.data?.templates ?? [];
    if (templates.length === 0 || templates.some((template) => template.id === templateId)) {
      return;
    }
    setTemplateId(
      templates.find((template) => template.id === 'standard_4')?.id ??
        templates[0]?.id ??
        'standard_4'
    );
  }, [pageLayoutTemplatesQuery.data?.templates, templateId]);

  useEffect(() => {
    generationAttemptRef.current = null;
    setPageStale(false);
  }, [selectedPage?.id]);

  useEffect(() => {
    exportAttemptRef.current = null;
    setExportJobId(null);
    setExportSelectedPageIds([]);
  }, [activeEpisodeId, organizationId, sessionKey]);

  const generatedPages = useMemo(
    () => pages.filter((page) => page.generated_image !== null),
    [pages]
  );
  const imageAuthorizationHeader = useMemo<string | null>(
    () => (tokens === null ? null : `Bearer ${tokens.idToken}`),
    [tokens]
  );
  const fullPageImageSourcesFor = useCallback((page: PageRecord) =>
    buildFullPageImageSources({
      apiBaseUrl: config.apiBaseUrl,
      authorizationHeader: imageAuthorizationHeader,
      organizationId,
      page,
      sessionKey,
    }),
  [imageAuthorizationHeader, organizationId, sessionKey]);
  const pageThumbnailImageSourcesFor = useCallback((page: PageRecord) =>
    buildPageThumbnailImageSources({
      apiBaseUrl: config.apiBaseUrl,
      authorizationHeader: imageAuthorizationHeader,
      organizationId,
      page,
      sessionKey,
    }),
  [imageAuthorizationHeader, organizationId, sessionKey]);
  const selectedPageImageSources = useMemo(
    () => selectedPage === null ? [] : fullPageImageSourcesFor(selectedPage),
    [fullPageImageSourcesFor, selectedPage]
  );
  const selectedPageImageSourceIdentity =
    imageSourceListIdentity(selectedPageImageSources);
  const pageImageFailed =
    failedPageImageSourceIdentity === selectedPageImageSourceIdentity;

  useEffect(() => {
    if (selectedPage === null) {
      return;
    }
    const selectedIndex = pages.findIndex((page) => page.id === selectedPage.id);
    if (selectedIndex < 0) {
      return;
    }
    const adjacentSources = [pages[selectedIndex - 1], pages[selectedIndex + 1]]
      .filter((page): page is PageRecord => page?.generated_image !== null && page !== undefined)
      .map((page) => pageThumbnailImageSourcesFor(page)[0])
      .filter((source): source is RemoteImageSource => source !== undefined);
    if (adjacentSources.length > 0) {
      void Promise.all(
        adjacentSources.map((source) =>
          ExpoImage.prefetch(source.uri, {
            cachePolicy: 'disk',
            headers: source.headers
          }).catch(() => false)
        )
      );
    }
  }, [pageThumbnailImageSourcesFor, pages, selectedPage]);

  const pageHierarchyReady =
    activeEpisodeId !== null && pagesQuery.isSuccess;
  const scenesQuery = useQuery({
    enabled: pageHierarchyReady,
    queryKey: scenesQueryKey(sessionKey, activeEpisodeId, organizationId),
    queryFn: () => api.getScenes(activeEpisodeId ?? '', organizationId)
  });

  const entitiesQuery = useInfiniteQuery({
    enabled: pageHierarchyReady && activeWorkId !== null,
    queryKey: entitiesInfiniteQueryKey(sessionKey, activeWorkId, organizationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.getEntitiesPage(activeWorkId ?? '', {
      organizationId,
      limit: MOBILE_LIST_PAGE_SIZE,
      cursor: pageParam,
    }),
    getNextPageParam: nextCursorFromPage,
  });

  const compositionsQuery = useQuery({
    enabled: selectedPage !== null,
    queryKey: compositionsQueryKey(sessionKey),
    queryFn: () => api.getCompositions()
  });

  const panelsQuery = useQuery({
    enabled: selectedPage !== null,
    queryKey: panelsQueryKey(sessionKey, selectedPage?.id ?? null, organizationId),
    queryFn: () => api.getPanels(selectedPage?.id ?? '', organizationId)
  });

  const framesQuery = useQuery({
    enabled: selectedPage !== null,
    queryKey: framesQueryKey(sessionKey, selectedPage?.id ?? null, organizationId),
    queryFn: () => api.getFrames(selectedPage?.id ?? '', organizationId)
  });
  const selectedPageResourceNotFound =
    selectedPage !== null &&
    [
      pageGenerationReadinessQuery.error,
      panelsQuery.error,
      framesQuery.error
    ].some(isApiNotFoundError);
  useEffect(() => {
    if (!selectedPageResourceNotFound || selection.pageId === null) {
      return;
    }
    void updateSelection(
      { pageId: null },
      { skipDirtyCheck: true }
    );
  }, [
    selectedPageResourceNotFound,
    selection.pageId,
    updateSelection
  ]);

  const selectedPanel = useMemo(
    () => panelsQuery.data?.panels.find((panel) => panel.id === panelId) ?? null,
    [panelId, panelsQuery.data?.panels]
  );

  const selectedFrame = useMemo(
    () => frameDrafts.find((frame) => frame.id === frameId) ?? null,
    [frameDrafts, frameId]
  );

  const entities = useMemo(
    () => flattenUniqueRecords(entitiesQuery.data?.pages.map((page) => page.entities) ?? []),
    [entitiesQuery.data?.pages],
  );
  const scenes = scenesQuery.data?.scenes ?? [];
  const compositions = compositionsQuery.data?.compositions ?? [];
  const assignedEntityIds = assignments.map((assignment) => assignment.entity_id);
  const panelEntities = entities.filter((entity) => assignedEntityIds.includes(entity.id));

  const pageDirty =
    selectedPage === null
      ? styleReferenceTitle.trim().length > 0 ||
        styleReferenceNotes.trim().length > 0 ||
        sourceSceneIds.length > 0 ||
        pagePurpose.trim().length > 0 ||
        continuityNote.trim().length > 0
      : styleReferenceTitle !== readStyleReference(selectedPage.layout_config).title ||
        styleReferenceNotes !== readStyleReference(selectedPage.layout_config).notes ||
        JSON.stringify(sourceSceneIds) !== JSON.stringify(selectedPage.story_source_scene_ids ?? []) ||
        pagePurpose !== (selectedPage.story_page_purpose ?? '') ||
        continuityNote !== (selectedPage.story_continuity_note ?? '');

  const panelDirty =
    selectedPanel === null
      ? situationText.trim().length > 0 ||
        compositionPrompt.trim().length > 0 ||
        customNote.trim().length > 0 ||
        dialogues.length > 0 ||
        assignments.length > 0 ||
        sfxText.trim().length > 0 ||
        backgroundNote.trim().length > 0 ||
        panelNotes.trim().length > 0
      : panelRole !== selectedPanel.panel_role ||
        panelSize !== selectedPanel.panel_size ||
        situationText !== (selectedPanel.situation_text ?? '') ||
        compositionSource !== selectedPanel.composition.source ||
        compositionGalleryItemId !== (selectedPanel.composition.gallery_item_id ?? '') ||
        compositionPrompt !== (selectedPanel.composition.composition_prompt ?? '') ||
        shotType !== (selectedPanel.composition.shot_type ?? '') ||
        angle !== (selectedPanel.composition.angle ?? '') ||
        customNote !== (selectedPanel.composition.custom_note ?? '') ||
        dialogueInPanel !== selectedPanel.dialogue_in_panel ||
        JSON.stringify(dialogues) !== JSON.stringify(selectedPanel.dialogue ?? []) ||
        JSON.stringify(assignments.map(toAssignmentRecord)) !== JSON.stringify((selectedPanel.entities ?? []).map(toAssignmentDraft).map(toAssignmentRecord)) ||
        sfxText !== (selectedPanel.sfx_text ?? '') ||
        backgroundNote !== (selectedPanel.background_note ?? '') ||
        panelNotes !== (selectedPanel.panel_notes ?? '');

  const frameDraftsInvalid = frameDrafts.some((frame) =>
    !isIntegerInRangeText(frame.reading_order, 1, 1000) ||
    !isIntegerInRangeText(frame.z_index, 0, 1000) ||
    !isIntegerInRangeText(frame.border_width, 0, 20) ||
    !isHexColorText(frame.border_color) ||
    frame.vertices.length !== 4 ||
    frame.vertices.some((vertex) => !isNumberInRangeText(vertex.x, 0, 1) || !isNumberInRangeText(vertex.y, 0, 1))
  );
  const framePanelMismatch = frameDrafts.length !== (panelsQuery.data?.panels.length ?? 0);
  const panelPayloadInvalid =
    (compositionSource === 'gallery' && compositionGalleryItemId.trim().length === 0) ||
    dialogues.filter((dialogue) => dialogue.text.trim().length > 0).length > 20 ||
    dialogues.some(
      (dialogue) =>
        dialogue.text.trim().length > 0 &&
        !isPanelDialogueSpeakerValid(dialogue.type, dialogue.entity_id, assignedEntityIds)
    ) ||
    assignments.length > 20 ||
    assignments.some((assignment) =>
      (assignment.expression === 'custom' && (assignment.custom_expression ?? '').trim().length === 0) ||
      (assignment.action === 'custom' && (assignment.custom_action ?? '').trim().length === 0) ||
      ((assignment.state_id ?? '').trim().length > 0 && !isUuidText(assignment.state_id ?? ''))
    );
  const framesDirty =
    JSON.stringify(frameDrafts.map(toFrameRecord)) !== JSON.stringify((framesQuery.data?.frames ?? []));

  const discardPageDraft = useCallback((): void => {
    const styleReference = readStyleReference(selectedPage?.layout_config ?? {});
    setStyleReferenceTitle(styleReference.title);
    setStyleReferenceNotes(styleReference.notes);
    setSourceSceneIds([...(selectedPage?.story_source_scene_ids ?? [])]);
    setPagePurpose(selectedPage?.story_page_purpose ?? '');
    setContinuityNote(selectedPage?.story_continuity_note ?? '');
  }, [selectedPage]);

  const discardPanelDraft = useCallback((): void => {
    setPanelRole(selectedPanel?.panel_role ?? 'action');
    setPanelSize(selectedPanel?.panel_size ?? 'standard');
    setSituationText(selectedPanel?.situation_text ?? '');
    setCompositionSource(selectedPanel?.composition.source ?? defaultComposition.source);
    setCompositionGalleryItemId(selectedPanel?.composition.gallery_item_id ?? '');
    setCompositionPrompt(selectedPanel?.composition.composition_prompt ?? '');
    setShotType(selectedPanel?.composition.shot_type ?? '');
    setAngle(selectedPanel?.composition.angle ?? '');
    setCustomNote(selectedPanel?.composition.custom_note ?? '');
    setDialogueInPanel(selectedPanel?.dialogue_in_panel ?? true);
    setDialogues([...(selectedPanel?.dialogue ?? [])]);
    setAssignments((selectedPanel?.entities ?? []).map(toAssignmentDraft));
    setSfxText(selectedPanel?.sfx_text ?? '');
    setBackgroundNote(selectedPanel?.background_note ?? '');
    setPanelNotes(selectedPanel?.panel_notes ?? '');
  }, [selectedPanel]);

  const discardFrameDraft = useCallback((): void => {
    const drafts = (framesQuery.data?.frames ?? []).map(toFrameDraft);
    setFrameDrafts(drafts);
    setFrameId((current) =>
      current !== null && drafts.some((frame) => frame.id === current)
        ? current
        : drafts[0]?.id ?? null
    );
  }, [framesQuery.data?.frames]);

  const discardAllPageDrafts = useCallback((): void => {
    discardPageDraft();
    discardPanelDraft();
    discardFrameDraft();
  }, [discardFrameDraft, discardPageDraft, discardPanelDraft]);

  useEffect(() => {
    const nextId = selectedPage?.id ?? null;
    if (lastSyncedPageId.current === nextId && pageDirty) {
      return;
    }
    lastSyncedPageId.current = nextId;
    const styleReference = readStyleReference(selectedPage?.layout_config ?? {});
    setStyleReferenceTitle(styleReference.title);
    setStyleReferenceNotes(styleReference.notes);
    setSourceSceneIds(selectedPage?.story_source_scene_ids ?? []);
    setPagePurpose(selectedPage?.story_page_purpose ?? '');
    setContinuityNote(selectedPage?.story_continuity_note ?? '');
  }, [pageDirty, selectedPage]);

  useEffect(() => {
    if (generatedPages.length === 0) {
      setExportSelectedPageIds([]);
      return;
    }
    setExportSelectedPageIds((current) => {
      const filtered = current.filter((pageId) => generatedPages.some((page) => page.id === pageId));
      return filtered.length > 0 ? filtered : [generatedPages[0]?.id ?? ''].filter((id) => id.length > 0);
    });
  }, [generatedPages]);

  useEffect(() => {
    const nextId = selectedPanel?.id ?? null;
    if (lastSyncedPanelId.current === nextId && panelDirty) {
      return;
    }
    lastSyncedPanelId.current = nextId;
    setPanelRole(selectedPanel?.panel_role ?? 'action');
    setPanelSize(selectedPanel?.panel_size ?? 'standard');
    setSituationText(selectedPanel?.situation_text ?? '');
    setCompositionSource(selectedPanel?.composition.source ?? defaultComposition.source);
    setCompositionGalleryItemId(selectedPanel?.composition.gallery_item_id ?? '');
    setCompositionPrompt(selectedPanel?.composition.composition_prompt ?? '');
    setShotType(selectedPanel?.composition.shot_type ?? '');
    setAngle(selectedPanel?.composition.angle ?? '');
    setCustomNote(selectedPanel?.composition.custom_note ?? '');
    setDialogueInPanel(selectedPanel?.dialogue_in_panel ?? true);
    setDialogues(selectedPanel?.dialogue ?? []);
    setAssignments((selectedPanel?.entities ?? []).map(toAssignmentDraft));
    setSfxText(selectedPanel?.sfx_text ?? '');
    setBackgroundNote(selectedPanel?.background_note ?? '');
    setPanelNotes(selectedPanel?.panel_notes ?? '');
  }, [panelDirty, selectedPanel]);

  useEffect(() => {
    const nextPageId = selectedPage?.id ?? null;
    if (
      !shouldHydrateEditorDraft({
        hasServerSnapshot: framesQuery.data !== undefined,
        hasUnsavedChanges: framesDirty,
        lastResourceId: lastSyncedFramePageId.current,
        resourceId: nextPageId
      })
    ) {
      return;
    }
    lastSyncedFramePageId.current = nextPageId;
    const drafts = (framesQuery.data?.frames ?? []).map(toFrameDraft);
    setFrameDrafts(drafts);
    setFrameId((current) => (current !== null && drafts.some((frame) => frame.id === current) ? current : drafts[0]?.id ?? null));
  }, [framesDirty, framesQuery.data, selectedPage?.id]);

  const invalidatePageReadiness = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: pageGenerationReadinessQueryKey(
        sessionKey,
        selectedPage?.id ?? null,
        organizationId
      )
    });
  };

  const invalidatePages = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: pagesQueryKey(sessionKey, activeEpisodeId, organizationId)
      }),
      queryClient.invalidateQueries({
        queryKey: pageDetailQueryKey(sessionKey, selectedPage?.id ?? null, organizationId)
      }),
      invalidatePageReadiness()
    ]);
  };

  const invalidatePanels = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: panelsQueryKey(sessionKey, selectedPage?.id ?? null, organizationId)
      }),
      invalidatePageReadiness()
    ]);
  };

  const invalidateFrames = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: framesQueryKey(sessionKey, selectedPage?.id ?? null, organizationId)
      }),
      invalidatePageReadiness()
    ]);
  };

  const invalidateScenes = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: scenesQueryKey(sessionKey, activeEpisodeId, organizationId) });
  };

  const invalidateEntities = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: entitiesQueryKey(sessionKey, activeWorkId, organizationId) });
  };

  const invalidateCompositions = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: compositionsQueryKey(sessionKey) });
  };

  const invalidatePageLayoutTemplates = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: pageLayoutTemplatesQueryKey(sessionKey) });
  };

  const styleReferencePayload = (): { title: string; notes?: string | null } | null => {
    if (styleReferenceTitle.trim().length === 0) {
      return null;
    }
    return {
      title: styleReferenceTitle.trim(),
      notes: nullable(styleReferenceNotes)
    };
  };

  const updatePageMutation = useMutation({
    mutationFn: () =>
      api.updatePage(
        selectedPage?.id ?? '',
        {
          style_reference: styleReferencePayload(),
          story_source_scene_ids: sourceSceneIds,
          story_page_purpose: nullable(pagePurpose),
          story_continuity_note: nullable(continuityNote)
        },
        organizationId
    ),
    onSuccess: invalidatePages
  });

  const autofillPageFromScenesMutation = useMutation({
    mutationFn: () => {
      if (selectedPage === null) {
        throw new Error(t(language, "generated.screens.PagesScreen.select.a.page.first.390bc86e"));
      }
      return api.autofillPageFromScenes(selectedPage.id, language, organizationId);
    },
    onSuccess: async () => {
      lastSyncedPageId.current = null;
      lastSyncedPanelId.current = null;
      lastSyncedFramePageId.current = null;
      setPageStale(false);
      await Promise.all([
        invalidatePages(),
        invalidatePanels(),
        invalidateFrames(),
        queryClient.invalidateQueries({
          queryKey: activeResourceJobQueryKey(
            sessionKey,
            organizationId,
            'page_id',
            selectedPage?.id ?? null,
            'page_generate'
          )
        }),
        queryClient.invalidateQueries({ queryKey: jobsQueryKey(sessionKey, organizationId) })
      ]);
    }
  });

  const applyTemplateMutation = useMutation({
    mutationFn: () =>
      api.applyPageLayoutTemplate(
        selectedPage?.id ?? '',
        createSafeLayoutTemplatePayload(templateId),
        organizationId
      ),
    onSuccess: async () => {
      await invalidatePages();
      await invalidatePanels();
      await invalidateFrames();
    }
  });

  const applyFrameTemplateMutation = useMutation({
    mutationFn: () => api.applyFrameTemplate(selectedPage?.id ?? '', templateId, organizationId),
    onSuccess: async () => {
      await invalidateFrames();
    }
  });

  const panelPayload = (): {
    panel_role: PanelRecord['panel_role'];
    panel_size: PanelRecord['panel_size'];
    situation_text: string | null;
    composition: PanelRecord['composition'];
    dialogue_in_panel: boolean;
    dialogue: PanelDialogueLine[];
    sfx_text: string | null;
    background_note: string | null;
    panel_notes: string | null;
  } => ({
    panel_role: panelRole,
    panel_size: panelSize,
    situation_text: nullable(situationText),
    composition: {
      source: compositionSource,
      gallery_item_id: compositionSource === 'gallery' ? nullable(compositionGalleryItemId) : null,
      composition_prompt: nullable(compositionPrompt),
      shot_type: emptyToNull(shotType),
      angle: emptyToNull(angle),
      custom_note: nullable(customNote)
    },
    dialogue_in_panel: dialogueInPanel,
    dialogue: dialogues
      .map((dialogue) => ({
        ...dialogue,
        text: dialogue.text.trim(),
        entity_id: dialogue.entity_id === null || dialogue.entity_id.length === 0 ? null : dialogue.entity_id
      }))
      .filter((dialogue) => dialogue.text.length > 0),
    sfx_text: nullable(sfxText),
    background_note: nullable(backgroundNote),
    panel_notes: nullable(panelNotes)
  });

  const createPanelMutation = useMutation({
    mutationFn: async () => {
      const created = await api.createPanel(
        selectedPage?.id ?? '',
        {
          order: (panelsQuery.data?.panels.length ?? 0) + 1,
          ...panelPayload()
        },
        organizationId
      );
      const nextAssignments = assignments.map(toAssignmentRecord);
      if (nextAssignments.length > 0) {
        await api.replacePanelAssignments(created.id, { entities: nextAssignments }, organizationId);
      }
      return created;
    },
    onSuccess: async (panel) => {
      setPanelId(panel.id);
      await invalidatePanels();
    }
  });

  const updatePanelMutation = useMutation({
    mutationFn: async () => {
      const updated = await api.updatePanel(selectedPanel?.id ?? '', panelPayload(), organizationId);
      await api.replacePanelAssignments(
        selectedPanel?.id ?? '',
        { entities: assignments.map(toAssignmentRecord) },
        organizationId
      );
      return updated;
    },
    onSuccess: invalidatePanels
  });

  const deletePanelMutation = useMutation({
    mutationFn: (targetPanelId: string) => api.deletePanel(targetPanelId, organizationId),
    onSuccess: async (_, targetPanelId) => {
      if (panelId === targetPanelId) {
        setPanelId(null);
      }
      await invalidatePanels();
      await invalidateFrames();
    }
  });

  const reorderPanelMutation = useMutation({
    mutationFn: async ({
      direction,
      targetPanelId
    }: {
      direction: 'up' | 'down';
      targetPanelId: string;
    }) => {
      const panels = [...(panelsQuery.data?.panels ?? [])].sort((a, b) => a.order - b.order);
      const currentIndex = panels.findIndex((panel) => panel.id === targetPanelId);
      if (selectedPage === null || currentIndex < 0) {
        return panels;
      }
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= panels.length) {
        return panels;
      }
      const nextPanels = [...panels];
      const [movedPanel] = nextPanels.splice(currentIndex, 1);
      if (movedPanel === undefined) {
        return panels;
      }
      nextPanels.splice(targetIndex, 0, movedPanel);
      const result = await api.reorderPanels(selectedPage.id, nextPanels.map((panel) => panel.id), organizationId);
      return result.panels;
    },
    onSuccess: invalidatePanels
  });

  const changePanelRoleMutation = useMutation({
    mutationFn: ({
      role,
      targetPanelId
    }: {
      role: PanelRecord['panel_role'];
      targetPanelId: string;
    }) => api.updatePanel(targetPanelId, { panel_role: role }, organizationId),
    onSuccess: async (panel) => {
      if (panel.id === panelId) {
        setPanelRole(panel.panel_role);
      }
      await invalidatePanels();
    }
  });

  const updateFrameDraft = (id: string, patch: Partial<FrameDraft>): void => {
    setFrameDrafts((current) => current.map((frame) => (frame.id === id ? { ...frame, ...patch } : frame)));
  };

  const updateFrameVertex = (id: string, index: number, axis: 'x' | 'y', value: string): void => {
    setFrameDrafts((current) =>
      current.map((frame) =>
        frame.id === id
          ? {
              ...frame,
              vertices: frame.vertices.map((vertex, currentIndex) =>
                currentIndex === index ? { ...vertex, [axis]: value } : vertex
              )
            }
          : frame
      )
    );
  };

  const nudgeFrameVertex = (id: string, index: number, dx: number, dy: number): void => {
    setFrameDrafts((current) =>
      current.map((frame) =>
        frame.id === id
          ? {
              ...frame,
              vertices: frame.vertices.map((vertex, currentIndex) =>
                currentIndex === index
                  ? {
                      x: formatCoordinate(numeric(vertex.x, 0) + dx),
                      y: formatCoordinate(numeric(vertex.y, 0) + dy)
                    }
                  : vertex
              )
            }
          : frame
      )
    );
  };

  const replaceFramesMutation = useMutation({
    mutationFn: () => api.replaceFrames(selectedPage?.id ?? '', { frames: frameDrafts.map(toFrameRecord) }, organizationId),
    onSuccess: invalidateFrames
  });

  const saveAllPageDrafts = useCallback(async (): Promise<void> => {
    if (pageDirty) {
      if (selectedPage === null) {
        throw new Error(t(language, "generated.screens.PagesScreen.select.a.page.to.save.c7125ffd"));
      }
      await updatePageMutation.mutateAsync();
    }
    if (panelDirty) {
      if (panelPayloadInvalid) {
        throw new Error(t(language, "generated.screens.PagesScreen.check.the.panel.content.442d9a1c"));
      }
      if (selectedPanel === null) {
        if (selectedPage === null) {
          throw new Error(t(language, "generated.screens.PagesScreen.select.a.page.first.390bc86e"));
        }
        await createPanelMutation.mutateAsync();
      } else {
        await updatePanelMutation.mutateAsync();
      }
    }
    if (framesDirty) {
      if (selectedPage === null || frameDraftsInvalid) {
        throw new Error(t(language, "generated.screens.PagesScreen.check.the.frame.values.666cb307"));
      }
      await replaceFramesMutation.mutateAsync();
    }
  }, [
    createPanelMutation,
    frameDraftsInvalid,
    framesDirty,
    language,
    pageDirty,
    panelDirty,
    panelPayloadInvalid,
    replaceFramesMutation,
    selectedPage,
    selectedPanel,
    updatePageMutation,
    updatePanelMutation
  ]);

  const pageEditorRevision = JSON.stringify({
    pageId: selectedPage?.id ?? null,
    frameDrafts: frameDrafts.map(toFrameRecord),
    page: {
      continuityNote,
      pagePurpose,
      sourceSceneIds,
      styleReferenceNotes,
      styleReferenceTitle
    },
    panel: {
      assignments: assignments.map(toAssignmentRecord),
      panelId,
      payload: panelPayload()
    }
  });

  useDirtyEditorRegistration({
    id: 'pages-editor',
    revision: pageEditorRevision,
    dirty: pageDirty || panelDirty || framesDirty,
    discard: discardAllPageDrafts,
    save: saveAllPageDrafts
  });

  const generatePageMutation = useMutation({
    mutationFn: async () => {
      if (selectedPage === null) {
        throw new Error(t(language, "generated.screens.PagesScreen.select.a.page.first.390bc86e"));
      }
      const payload = buildAtomicSaveAndGeneratePayload({
        page: selectedPage,
        pagePatch: {
          style_reference: styleReferencePayload(),
          story_source_scene_ids: sourceSceneIds,
          story_page_purpose: nullable(pagePurpose),
          story_continuity_note: nullable(continuityNote)
        },
        panels: panelsQuery.data?.panels ?? [],
        selectedPanelOverride:
          selectedPanel === null
            ? null
            : {
                panelId: selectedPanel.id,
                fields: {
                  ...panelPayload(),
                  entities: assignments.map(toAssignmentRecord)
                }
              },
        frames: frameDrafts.map(toFrameRecord),
        language
      });
      const payloadFingerprint = JSON.stringify(payload);
      const currentAttempt = generationAttemptRef.current;
      const attempt =
        currentAttempt !== null &&
        currentAttempt.pageId === selectedPage.id &&
        currentAttempt.payloadFingerprint === payloadFingerprint
          ? currentAttempt
          : {
              pageId: selectedPage.id,
              payloadFingerprint,
              idempotencyKey: `mobile-page-${selectedPage.id}-${Date.now().toString(36)}`
            };
      generationAttemptRef.current = attempt;
      return api.saveAndGeneratePage(
        selectedPage.id,
        payload,
        attempt.idempotencyKey,
        organizationId
      );
    },
    onSuccess: async (result) => {
      generationAttemptRef.current = null;
      setPageStale(false);
      setLocalJob({
        id: result.job_id,
        resourceId: selectedPage?.id ?? '',
      });
      await trackJob(result.job_id);
      await invalidatePages();
      await invalidatePanels();
      await invalidateFrames();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'PAGE_STALE') {
        setPageStale(true);
      }
    }
  });

  const confirmPageMutation = useMutation({
    mutationFn: () => api.confirmPage(selectedPage?.id ?? '', organizationId),
    onSuccess: invalidatePages
  });

  const reopenPageMutation = useMutation({
    mutationFn: () => api.reopenPage(selectedPage?.id ?? '', organizationId),
    onSuccess: invalidatePages
  });

  const downloadPageMutation = useMutation({
    mutationFn: () =>
      downloadAuthenticatedFile({
        path: appendOrganizationQuery(`/api/pages/${encodeURIComponent(selectedPage?.id ?? '')}/export-image`, organizationId),
        filename: exportFilename,
        tokens,
        mimeType: 'image/png'
      }),
    onError: (error) => {
      setPageImageDownloadError(fileTransferErrorMessage(error, language));
    },
    onMutate: () => {
      setPageImageDownloadError(null);
    }
  });

  const exportPagesMutation = useMutation({
    mutationFn: (mode: 'selected' | 'all') => {
      if (activeEpisodeId === null) {
        throw new Error(t(language, "generated.screens.PagesScreen.select.an.episode.first.65b38fbb"));
      }
      const payload = buildEpisodeExportPayload({
        filename: exportFilename,
        format: exportFormat,
        mode,
        pages: pages.map((page) => ({
          id: page.id,
          pageNumber: page.page_number,
          hasGeneratedImage: page.generated_image !== null
        })),
        selectedPageIds: exportSelectedPageIds
      });
      const payloadFingerprint = JSON.stringify({
        episodeId: activeEpisodeId,
        organizationId,
        payload
      });
      const previousAttempt = exportAttemptRef.current;
      const attempt =
        previousAttempt !== null && previousAttempt.payloadFingerprint === payloadFingerprint
          ? previousAttempt
          : {
              payloadFingerprint,
              idempotencyKey: `mobile-export-${Date.now().toString(36)}-${activeEpisodeId}`
            };
      exportAttemptRef.current = attempt;
      return api.createEpisodeExport(
        activeEpisodeId,
        payload,
        attempt.idempotencyKey,
        organizationId
      );
    },
    onSuccess: (result) => {
      setExportJobId(result.job_id);
    }
  });

  const downloadExportMutation = useMutation({
    mutationFn: (input: { downloadUrl: string; filename: string; format: ExportFormat }) =>
      downloadExternalFile({
        url: input.downloadUrl,
        filename: input.filename,
        mimeType: input.format === 'pdf' ? 'application/pdf' : 'application/zip'
      })
  });

  const openWebEditorMutation = useMutation({
    mutationFn: () => Linking.openURL(WEB_EDITOR_URL)
  });

  const pageErrorScope = JSON.stringify([
    sessionKey,
    organizationId,
    activeWorkId,
    activeEpisodeId,
    selectedPage?.id ?? null
  ]);
  useResetOnScopeChange(pageErrorScope, [
    updatePageMutation.reset,
    autofillPageFromScenesMutation.reset,
    applyTemplateMutation.reset,
    applyFrameTemplateMutation.reset,
    replaceFramesMutation.reset,
    createPanelMutation.reset,
    updatePanelMutation.reset,
    deletePanelMutation.reset,
    reorderPanelMutation.reset,
    changePanelRoleMutation.reset,
    generatePageMutation.reset,
    confirmPageMutation.reset,
    reopenPageMutation.reset,
    exportPagesMutation.reset,
    downloadPageMutation.reset,
    () => setPageImageDownloadError(null),
    openWebEditorMutation.reset
  ]);

  const confirmDeletePanel = (targetPanel: PanelRecord): void => {
    const situationSummary =
      targetPanel.situation_text === null || targetPanel.situation_text.trim().length === 0
        ? t(language, "generated.screens.PagesScreen.no.situation.text.aa883b3b")
        : targetPanel.situation_text.trim().slice(0, 80);
    const contentSummary = t(language, 'screen.pages.panelContentSummary', {
      situationSummary,
      entityCount: targetPanel.entities.length,
      dialogueCount: targetPanel.dialogue.length
    });
    const unsavedWarning =
      targetPanel.id === selectedPanel?.id && panelDirty
        ? t(language, "generated.screens.PagesScreen.unsaved.changes.to.this.panel.will.also.341e3cdf")
        : '';
    confirmDestructiveAction({
      language,
      title: t(language, "generated.screens.PagesScreen.delete.panel.9ddc5da7"),
      message: t(language, 'screen.pages.deletePanel', {
        panelOrder: targetPanel.order,
        contentSummary,
        unsavedWarning
      }),
      onConfirm: () => deletePanelMutation.mutate(targetPanel.id)
    });
  };

  const selectComposition = (composition: CompositionRecord): void => {
    setCompositionGalleryItemId(composition.id);
    setCompositionPrompt(composition.composition_prompt);
    setShotType(composition.shot_type ?? '');
    setAngle(composition.angle ?? '');
  };

  const switchPage = (pageId: string): void => {
    void updateSelection({ pageId }).then((changed) => {
      if (changed) {
        setPanelId(null);
      }
    });
  };

  const previewPage = (pageId: string): void => {
    const page = pages.find((candidate) => candidate.id === pageId);
    if (page === undefined) {
      return;
    }
    const source = pageThumbnailImageSourcesFor(page)[0];
    if (source === undefined) {
      return;
    }
    setPreviewImageHeaders(source.headers);
    setPreviewImageUri(source.uri);
  };

  const switchPanel = (nextPanelId: string): void => {
    void resolveDirtyEditors(language).then((canLeave) => {
      if (canLeave) {
        setPanelId(nextPanelId);
      }
    });
  };

  const switchFrame = (nextFrameId: string): void => {
    void resolveDirtyEditors(language).then((canLeave) => {
      if (canLeave) {
        setFrameId(nextFrameId);
      }
    });
  };

  const reloadAfterPageStale = async (): Promise<void> => {
    generationAttemptRef.current = null;
    lastSyncedPageId.current = null;
    lastSyncedPanelId.current = null;
    lastSyncedFramePageId.current = null;
    await Promise.all([invalidatePages(), invalidatePanels(), invalidateFrames()]);
    setPageStale(false);
  };

  const handleGenerationBlockerAction = (
    blocker: PageGenerationBlockerRecord
  ): void => {
    const recoveryTarget = pageGenerationBlockerRecoveryTarget(blocker.code);
    if (recoveryTarget === 'credits' || recoveryTarget === 'jobs') {
      void resolveDirtyEditors(language).then((canLeave) => {
        if (canLeave) {
          navigation.navigate('Account');
        }
      });
      return;
    }
    if (recoveryTarget === 'layout') {
      setTemplateModalVisible(true);
      return;
    }
    if (recoveryTarget === 'characters') {
      void resolveDirtyEditors(language).then((canLeave) => {
        if (canLeave) {
          navigation.navigate('Characters');
        }
      });
      return;
    }

    switch (blocker.action) {
      case 'open_layout':
        setTemplateModalVisible(true);
        return;
      case 'open_panels':
        setPanelId((current) => current ?? panelsQuery.data?.panels[0]?.id ?? null);
        return;
      case 'open_characters':
        void resolveDirtyEditors(language).then((canLeave) => {
          if (canLeave) {
            navigation.navigate('Characters');
          }
        });
        return;
      case 'reopen_page':
        confirmAction({
          language,
          title: t(language, "generated.screens.PagesScreen.reopen.page.41da8099"),
          message: t(language, "generated.screens.PagesScreen.the.confirmed.page.will.be.returned.to.e.1cee4ef2"),
          confirmLabel: t(language, 'reopenPage'),
          onConfirm: () => reopenPageMutation.mutate()
        });
        return;
      case 'wait_for_generation':
      case 'none':
        return;
    }
  };

  const confirmApplyTemplate = (): void => {
    confirmAction({
      language,
      title: t(language, "generated.screens.PagesScreen.apply.layout.template.eae1fff2"),
      message: t(language, "generated.screens.PagesScreen.the.layout.template.will.be.applied.with.7d03cbd4"),
      confirmLabel: t(language, 'applyTemplate'),
      destructive: true,
      onConfirm: () => applyTemplateMutation.mutate()
    });
  };

  const confirmApplyFrameTemplate = (): void => {
    confirmAction({
      language,
      title: t(language, "generated.screens.PagesScreen.apply.frames.only.ddc8e0e7"),
      message: t(language, "generated.screens.PagesScreen.panel.content.will.remain.but.frames.wil.a79155c8"),
      confirmLabel: t(language, "generated.screens.PagesScreen.frames.only.bc16709f"),
      onConfirm: () => applyFrameTemplateMutation.mutate()
    });
  };

  const confirmAutofillPageFromScenes = (): void => {
    void resolveDirtyEditors(language).then((canContinue) => {
      if (
        !canContinue ||
        selectedPage === null ||
        !['designing', 'editing'].includes(selectedPage.status) ||
        sourceSceneIds.length === 0 ||
        displayedJobId !== null
      ) {
        return;
      }
      confirmAction({
        language,
        title: t(language, 'component.pageSceneAutofill.apply'),
        message: t(language, 'component.pageSceneAutofill.confirmation'),
        confirmLabel: t(language, 'component.pageSceneAutofill.apply'),
        destructive: true,
        onConfirm: () => autofillPageFromScenesMutation.mutate()
      });
    });
  };

  const confirmGeneratePage = (): void => {
    confirmAction({
      language,
      title: t(language, "generated.screens.PagesScreen.generate.page.image.a3a86143"),
      message: t(language, 'screen.pages.generatePageConfirmation', {
        creditCost: readiness?.estimated_credit_cost ?? '-'
      }),
      confirmLabel: t(language, 'generate'),
      onConfirm: () => generatePageMutation.mutate()
    });
  };

  const confirmConfirmPage = (): void => {
    confirmAction({
      language,
      title: t(language, "generated.screens.PagesScreen.confirm.page.c7aff770"),
      message: t(language, "generated.screens.PagesScreen.this.page.will.be.marked.as.confirmed.yo.c1c88cdb"),
      confirmLabel: t(language, 'confirmPage'),
      onConfirm: () => confirmPageMutation.mutate()
    });
  };

  const confirmReopenPage = (): void => {
    confirmAction({
      language,
      title: t(language, "generated.screens.PagesScreen.reopen.page.41da8099"),
      message: t(language, "generated.screens.PagesScreen.the.confirmed.page.will.be.returned.to.e.1cee4ef2"),
      confirmLabel: t(language, 'reopenPage'),
      onConfirm: () => reopenPageMutation.mutate()
    });
  };

  const mutationErrors = [
    updatePageMutation.error,
    autofillPageFromScenesMutation.error,
    applyTemplateMutation.error,
    applyFrameTemplateMutation.error,
    replaceFramesMutation.error,
    createPanelMutation.error,
    updatePanelMutation.error,
    deletePanelMutation.error,
    reorderPanelMutation.error,
    changePanelRoleMutation.error,
    generatePageMutation.error,
    confirmPageMutation.error,
    reopenPageMutation.error,
    exportPagesMutation.error,
    openWebEditorMutation.error
  ].filter((error): error is Error => error instanceof Error);
  const pagesError = currentQueryError({
    data: pagesQuery.data,
    enabled: activeEpisodeId !== null,
    error: pagesQuery.error
  });
  const selectedPageError = supportingQueryError({
    data: selectedPageQuery.data,
    enabled: shouldFetchSelectedPageDetail,
    error: selectedPageQuery.error
  });
  const pageLayoutTemplatesError = supportingQueryError({
    data: pageLayoutTemplatesQuery.data,
    enabled: true,
    error: pageLayoutTemplatesQuery.error
  });
  const pageGenerationReadinessError = supportingQueryError({
    data: pageGenerationReadinessQuery.data,
    enabled: canGenerate && selectedPage !== null,
    error: pageGenerationReadinessQuery.error
  });
  const panelsError = currentQueryError({
    data: panelsQuery.data,
    enabled: selectedPage !== null,
    error: panelsQuery.error
  });
  const framesError = currentQueryError({
    data: framesQuery.data,
    enabled: selectedPage !== null,
    error: framesQuery.error
  });
  const scenesError = supportingQueryError({
    data: scenesQuery.data,
    enabled: pageHierarchyReady,
    error: scenesQuery.error
  });
  const entitiesError = supportingQueryError({
    data: entitiesQuery.data,
    enabled: pageHierarchyReady && activeWorkId !== null,
    error: entitiesQuery.error
  });
  const compositionsError = supportingQueryError({
    data: compositionsQuery.data,
    enabled: selectedPage !== null,
    error: compositionsQuery.error
  });
  const queryFailures = [
    {
      error: pagesError,
      retry: () => {
        void pagesQuery.refetch();
      }
    },
    {
      error: selectedPageError,
      retry: () => {
        void selectedPageQuery.refetch();
      }
    },
    {
      error: panelsError,
      retry: () => {
        void panelsQuery.refetch();
      }
    },
    {
      error: framesError,
      retry: () => {
        void framesQuery.refetch();
      }
    },
    {
      error: pageLayoutTemplatesError,
      retry: () => {
        void pageLayoutTemplatesQuery.refetch();
      }
    },
    {
      error: pageGenerationReadinessError,
      retry: () => {
        void pageGenerationReadinessQuery.refetch();
      }
    },
    {
      error: scenesError,
      retry: () => {
        void scenesQuery.refetch();
      }
    },
    {
      error: entitiesError,
      retry: () => {
        void entitiesQuery.refetch();
      }
    },
    {
      error: compositionsError,
      retry: () => {
        void compositionsQuery.refetch();
      }
    }
  ].filter(
    (failure): failure is { error: Error; retry: () => void } =>
      failure.error instanceof Error
  );

  const toggleExportPage = (pageId: string): void => {
    setExportSelectedPageIds((current) =>
      current.includes(pageId) ? current.filter((id) => id !== pageId) : [...current, pageId]
    );
  };

  const templates = pageLayoutTemplatesQuery.data?.templates ?? [];
  const templateOptions = templates.map((template) => ({
    value: template.id,
    label: pageLayoutTemplateLabel(template, language)
  }));
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? null;
  const selectedTemplateFrames =
    selectedTemplate?.frames.map((frame) => ({ vertices: frame.vertices })) ?? [];
  const selectedTemplateLabel = templateOptions.find((option) => option.value === templateId)?.label ?? templateId;
  const sourceSceneLabels = sourceSceneIds.map((sceneId) => {
    const sourceScene = scenes.find((scene) => scene.id === sceneId);
    if (sourceScene === undefined) {
      return t(language, "generated.screens.PagesScreen.deleted.source.scene.2ecddecb");
    }
    const prefix = `${t(language, "generated.screens.PagesScreen.scene.dd61f732")} ${sourceScene.order}`;
    const location = sourceScene.location?.trim() ?? '';
    return location.length === 0 ? prefix : `${prefix}: ${location}`;
  });
  const selectedPageIsEditableDraft =
    selectedPage !== null && ['designing', 'editing'].includes(selectedPage.status);
  const selectedTemplatePanelCount = selectedTemplate?.panel_count ?? 0;
  const excessPanels = selectExcessPanels(
    panelsQuery.data?.panels ?? [],
    selectedTemplatePanelCount
  );
  const currentFramePreviewFrames = useMemo(
    () => frameDrafts.map(toFramePreviewDefinition),
    [frameDrafts]
  );
  const panelRoleSegments = labelOptions(panelRoleOptions, language);
  const panelSizeSegments = labelOptions(panelSizeOptions, language);
  const errorMessage = generationErrorMessage(generatePageMutation.error, language);
  const readiness = pageGenerationReadinessQuery.data ?? null;
  const serverGenerationBlocked =
    pageGenerationReadinessQuery.isLoading ||
    readiness === null ||
    !readiness.ready;
  const refreshPages = (): void => {
    void invalidatePages();
    void invalidatePanels();
    void invalidateFrames();
    void invalidateScenes();
    void invalidateEntities();
    void invalidateCompositions();
    void invalidatePageLayoutTemplates();
    void invalidatePageReadiness();
  };
  const primaryPageFailure =
    queryFailures[0] ??
    (mutationErrors[0] === undefined
      ? null
      : {
          error: mutationErrors[0],
          retry: () => {
            void invalidatePages();
          }
        });
  const primaryPageError = primaryPageFailure?.error ?? null;
  const navigateAfterDirtyCheck = (
    target: 'Account' | 'Characters'
  ): void => {
    void resolveDirtyEditors(language).then((canLeave) => {
      if (canLeave) {
        navigation.navigate(target);
      }
    });
  };

  return (
    <Screen
      onRefresh={refreshPages}
      refreshing={
        pagesQuery.isFetching ||
        pageLayoutTemplatesQuery.isFetching ||
        pageGenerationReadinessQuery.isFetching ||
        panelsQuery.isFetching ||
        framesQuery.isFetching ||
        scenesQuery.isFetching ||
        entitiesQuery.isFetching ||
        compositionsQuery.isFetching
      }
      subtitle={t(language, "generated.screens.PagesScreen.review.each.page.scene.source.layout.and.ddfabd30")}
      title={t(language, 'pages')}
    >
      <WorkspaceHierarchyNavigator context={workspaceContext} />
      {!canEdit ? (
        <Notice
          message={t(language, "generated.screens.PagesScreen.this.workspace.is.read.only.for.your.rol.1b79de19")}
          tone="info"
        />
      ) : null}
      {activeEpisodeId === null ? <Notice message={t(language, 'selectEpisodeFirst')} tone="warning" /> : null}
      {primaryPageError === null ? null : (
        <PageErrorRecoveryNotice
          error={primaryPageError}
          language={language}
          onAccount={() => navigateAfterDirtyCheck('Account')}
          onCharacters={() => navigateAfterDirtyCheck('Characters')}
          onLayout={() => setTemplateModalVisible(true)}
          onLogin={() => {
            void resolveDirtyEditors(language).then((canLeave) => {
              if (canLeave) {
                void logout();
              }
            });
          }}
          onReloadStale={() => {
            void reloadAfterPageStale();
          }}
          onRetry={() => {
            primaryPageFailure?.retry();
          }}
        />
      )}

      <Section collapsible persistKey="pages:list" title={t(language, 'pageList')}>
        <PageThumbnailPicker
          emptyLabel={t(language, 'emptyPages')}
          hasNextPage={pagesQuery.hasNextPage}
          helperText={t(language, "generated.screens.PagesScreen.choose.a.page.to.edit.unsaved.edits.are.453ccf41")}
          imageSourcesFor={pageThumbnailImageSourcesFor}
          isFetchingNextPage={pagesQuery.isFetchingNextPage}
          language={language}
          onEndReached={() => {
            void pagesQuery.fetchNextPage();
          }}
          onPreview={previewPage}
          onSelect={switchPage}
          pages={pages}
          selectedId={selection.pageId}
          statusLabelFor={(status) => formatPageStatus(status, language)}
        />
        <View style={styles.pageImageFrame}>
          {selectedPage === null || selectedPage.generated_image === null || pageImageFailed ? (
            <Text style={styles.emptySmall}>
              {pageImageFailed
                ? t(language, "generated.screens.PagesScreen.could.not.load.the.image.pull.down.to.re.b3172b34")
                : t(language, "generated.screens.PagesScreen.no.generated.image.yet.d6a7448d")}
            </Text>
          ) : (
            <PageImageViewer
              expandLabel={t(language, "generated.components.ImagePreviewModal.image.preview.0f884bd2")}
              imageStyle={styles.pageImage}
              onExhausted={() =>
                setFailedPageImageSourceIdentity(
                  selectedPageImageSourceIdentity
                )
              }
              onExpand={(source) => {
                setPreviewImageHeaders(source.headers);
                setPreviewImageUri(source.uri);
              }}
              sources={selectedPageImageSources}
            />
          )}
        </View>
      </Section>

      {selectedPage?.status === 'confirmed' ? (
        <Section
          persistKey="pages:confirmed-summary"
          title={t(language, "generated.screens.PagesScreen.confirmed.page.summary.fbda4a5d")}
        >
          <ConfirmedPageSummary
            language={language}
            loading={reopenPageMutation.isPending}
            onReopen={confirmReopenPage}
            page={selectedPage}
            sourceSceneLabels={selectedPage.story_source_scene_ids.map((sceneId) => {
              const sourceScene = scenes.find((scene) => scene.id === sceneId);
              if (sourceScene === undefined) {
                return t(language, "generated.screens.PagesScreen.deleted.source.scene.2ecddecb");
              }
              const prefix = `${t(language, "generated.screens.PagesScreen.scene.dd61f732")} ${sourceScene.order}`;
              const location = sourceScene.location?.trim() ?? '';
              return location.length === 0 ? prefix : `${prefix}: ${location}`;
            })}
          />
        </Section>
      ) : (
        <>
      <Section collapsible defaultCollapsed persistKey="pages:style:v2" title={t(language, 'styleReference')}>
        <FormField editable={canEdit} label={t(language, 'styleReferenceTitle')} maxLength={200} onChangeText={setStyleReferenceTitle} value={styleReferenceTitle} />
        <FormField editable={canEdit} label={t(language, 'styleReferenceNotes')} maxLength={2000} multiline onChangeText={setStyleReferenceNotes} value={styleReferenceNotes} />
        <PrimaryButton disabled={!canEdit || selectedPage === null} disabledReason={!canEdit ? t(language, "generated.screens.PagesScreen.editing.permission.is.required.6d3b86ee") : selectedPage === null ? t(language, "generated.screens.PagesScreen.select.a.page.first.50276876") : undefined} label={t(language, 'save')} loading={updatePageMutation.isPending} onPress={() => updatePageMutation.mutate()} />
      </Section>

      <Section collapsible defaultCollapsed persistKey="pages:story-sources" title={t(language, "generated.screens.PagesScreen.story.sources.82e34b3e")}>
        <PageProvenanceFields
          continuityNote={continuityNote}
          editable={canEdit}
          language={language}
          onContinuityNoteChange={setContinuityNote}
          onPagePurposeChange={setPagePurpose}
          pagePurpose={pagePurpose}
          scenes={scenes}
          sourceSceneIds={sourceSceneIds}
        />
        <PrimaryButton disabled={!canEdit || selectedPage === null} disabledReason={!canEdit ? t(language, "generated.screens.PagesScreen.editing.permission.is.required.6d3b86ee") : selectedPage === null ? t(language, "generated.screens.PagesScreen.select.a.page.first.50276876") : undefined} label={t(language, 'save')} loading={updatePageMutation.isPending} onPress={() => updatePageMutation.mutate()} />
      </Section>

      <Section
        collapsible
        defaultCollapsed
        persistKey="pages:scene-autofill"
        title={t(language, 'component.pageSceneAutofill.apply')}
      >
        <PageSceneAutofillAction
          canEdit={canEdit}
          hasActiveJob={displayedJobId !== null}
          isEditableDraft={selectedPageIsEditableDraft}
          language={language}
          loading={autofillPageFromScenesMutation.isPending}
          onPress={confirmAutofillPageFromScenes}
          pageNumber={selectedPage?.page_number ?? null}
          sourceSceneLabels={sourceSceneLabels}
        />
      </Section>

      <Section
        collapsible
        persistKey="pages:template"
        subtitle={t(language, "generated.screens.PagesScreen.choose.the.same.1.8.panel.templates.as.t.f0db308b")}
        title={t(language, 'applyTemplate')}
        tone="highlight"
      >
        {pageLayoutTemplatesQuery.isLoading ? (
          <Notice
            message={t(language, "generated.screens.PagesScreen.loading.layout.templates.46c3bb90")}
            tone="info"
          />
        ) : null}
        <View style={styles.templateSummary}>
          <View style={styles.templateSummaryText}>
            <Text style={styles.label}>{t(language, "generated.screens.PagesScreen.selected.template.2f5419bf")}</Text>
            <Text numberOfLines={2} style={styles.metric}>{selectedTemplateLabel}</Text>
          </View>
          <PrimaryButton label={t(language, "generated.screens.PagesScreen.show.templates.52310eb6")} onPress={() => setTemplateModalVisible(true)} variant="secondary" />
        </View>
        <TemplatePickerModal
          frames={selectedTemplateFrames}
          language={language}
          onChange={setTemplateId}
          onClose={() => setTemplateModalVisible(false)}
          options={templateOptions}
          value={templateId}
          visible={templateModalVisible}
        />
        <Text style={styles.metric}>{t(language, 'frames')}: {framesQuery.data?.frames.length ?? 0}</Text>
        <ExcessPanelDeletionPlan
          language={language}
          onReviewDelete={(targetPanelId) => {
            const targetPanel = excessPanels.find(
              (panel) => panel.id === targetPanelId,
            );
            if (targetPanel !== undefined) {
              confirmDeletePanel(targetPanel);
            }
          }}
          panels={excessPanels.map((panel) => ({
            dialogueCount: panel.dialogue.length,
            entityCount: panel.entities.length,
            id: panel.id,
            order: panel.order,
            situation:
              panel.situation_text?.trim().slice(0, 80) ||
              t(language, "generated.screens.PagesScreen.no.situation.text.aa883b3b"),
          }))}
          targetPanelCount={selectedTemplatePanelCount}
        />
        <View style={styles.buttonRow}>
          <PrimaryButton
            disabled={
              !canEdit ||
              selectedPage === null ||
              selectedTemplate === null ||
              excessPanels.length > 0
            }
            disabledReason={
              !canEdit
                ? t(language, "generated.screens.PagesScreen.editing.permission.is.required.6d3b86ee")
                : selectedPage === null
                ? t(language, "generated.screens.PagesScreen.select.a.page.first.50276876")
                : selectedTemplate === null
                  ? t(language, "generated.screens.PagesScreen.load.a.template.first.6bd59523")
                : excessPanels.length > 0
                  ? t(language, "generated.screens.PagesScreen.select.and.delete.excess.panels.first.5449bdf2")
                  : undefined
            }
            label={t(language, 'applyTemplate')}
            loading={applyTemplateMutation.isPending}
            onPress={confirmApplyTemplate}
          />
          <PrimaryButton
            disabled={
              !canEdit ||
              selectedPage === null ||
              selectedTemplate === null ||
              selectedTemplatePanelCount !== (panelsQuery.data?.panels.length ?? 0)
            }
            disabledReason={
              !canEdit
                ? t(language, "generated.screens.PagesScreen.editing.permission.is.required.6d3b86ee")
                : selectedPage === null
                  ? t(language, "generated.screens.PagesScreen.select.a.page.first.50276876")
                  : selectedTemplate === null
                    ? t(language, "generated.screens.PagesScreen.load.a.template.first.6bd59523")
                    : selectedTemplatePanelCount !== (panelsQuery.data?.panels.length ?? 0)
                      ? t(language, "generated.screens.PagesScreen.choose.a.template.with.the.same.panel.co.810da476")
                      : undefined
            }
            label={t(language, "generated.screens.PagesScreen.frames.only.bc16709f")}
            loading={applyFrameTemplateMutation.isPending}
            onPress={confirmApplyFrameTemplate}
            variant="secondary"
          />
        </View>
      </Section>
      <Section
        collapsible
        persistKey="pages:frames"
        subtitle={t(language, "generated.screens.PagesScreen.adjust.panel.binding.borders.and.vertice.207b5d5e")}
        title={t(language, 'frames')}
      >
        <LayoutTemplatePreview
          frames={currentFramePreviewFrames}
          title={t(language, "generated.screens.PagesScreen.current.layout.0febfca2")}
        />
        <RecordPicker
          emptyLabel={t(language, "generated.screens.PagesScreen.no.frames.yet.403915df")}
          items={frameDrafts}
          language={language}
          labelForItem={(frame) => `${t(language, "generated.screens.PagesScreen.frame.e971c8a0")} ${frame.reading_order}`}
          onSelect={switchFrame}
          selectedId={frameId}
        />
        {selectedFrame === null ? null : (
          <>
            <Text style={styles.label}>{t(language, "generated.screens.PagesScreen.linked.panel.1bcc84c8")}</Text>
            <SegmentedControl
              disabled={!canEdit}
              onChange={(value) => updateFrameDraft(selectedFrame.id, { panel_id: value.length === 0 ? null : value })}
              options={[
                { value: '', label: '-' },
                ...[...(panelsQuery.data?.panels ?? [])]
                  .sort((a, b) => a.order - b.order)
                  .map((panel) => ({
                    value: panel.id,
                    label: t(language, 'screen.pages.panelOption', { panelOrder: panel.order })
                  }))
              ]}
              value={selectedFrame.panel_id ?? ''}
            />
            <Text style={styles.label}>{t(language, "generated.screens.PagesScreen.border.style.5006da70")}</Text>
            <SegmentedControl
              disabled={!canEdit}
              onChange={(value) => updateFrameDraft(selectedFrame.id, { border_style: value })}
              options={[
                { value: 'solid', label: t(language, "generated.screens.PagesScreen.solid.93c21b87") },
                { value: 'dashed', label: t(language, "generated.screens.PagesScreen.dashed.c93df007") },
                { value: 'none', label: t(language, "generated.screens.PagesScreen.none.bedc69ee") }
              ]}
              value={selectedFrame.border_style}
            />
            <View style={styles.twoColumn}>
              <FormField editable={canEdit} keyboardType="numeric" label={t(language, "generated.screens.PagesScreen.reading.order.e0e96cb2")} onChangeText={(value) => updateFrameDraft(selectedFrame.id, { reading_order: value })} value={selectedFrame.reading_order} />
              <FormField editable={canEdit} keyboardType="numeric" label={t(language, "generated.screens.PagesScreen.z.index.e19e6724")} onChangeText={(value) => updateFrameDraft(selectedFrame.id, { z_index: value })} value={selectedFrame.z_index} />
            </View>
            <View style={styles.twoColumn}>
              <FormField editable={canEdit} keyboardType="numeric" label={t(language, "generated.screens.PagesScreen.border.width.f492ca5c")} onChangeText={(value) => updateFrameDraft(selectedFrame.id, { border_width: value })} value={selectedFrame.border_width} />
              <FormField editable={canEdit} label={t(language, "generated.screens.PagesScreen.border.color.897cb9ce")} onChangeText={(value) => updateFrameDraft(selectedFrame.id, { border_color: value })} value={selectedFrame.border_color} />
            </View>
            {selectedFrame.vertices.map((vertex, index) => (
              <View key={`${selectedFrame.id}-${index}`} style={styles.twoColumn}>
                <FormField editable={canEdit} keyboardType="numeric" label={`x${index + 1}`} onChangeText={(value) => updateFrameVertex(selectedFrame.id, index, 'x', value)} value={vertex.x} />
                <FormField editable={canEdit} keyboardType="numeric" label={`y${index + 1}`} onChangeText={(value) => updateFrameVertex(selectedFrame.id, index, 'y', value)} value={vertex.y} />
              </View>
            ))}
            {canEdit ? (
              <FrameVertexNudger
                frame={selectedFrame}
                language={language}
                onNudge={(index, dx, dy) => nudgeFrameVertex(selectedFrame.id, index, dx, dy)}
              />
            ) : null}
            {frameDraftsInvalid ? <Notice message={t(language, "generated.screens.PagesScreen.frames.require.four.vertices.coordinates.25a49784")} tone="warning" /> : null}
            <PrimaryButton disabled={!canEdit || selectedPage === null || frameDrafts.length === 0 || frameDraftsInvalid} disabledReason={!canEdit ? t(language, "generated.screens.PagesScreen.editing.permission.is.required.6d3b86ee") : selectedPage === null ? t(language, "generated.screens.PagesScreen.select.a.page.first.50276876") : frameDrafts.length === 0 ? t(language, "generated.screens.PagesScreen.no.frames.b75c13aa") : frameDraftsInvalid ? t(language, "generated.screens.PagesScreen.check.frame.values.adb62959") : undefined} label={t(language, 'save')} loading={replaceFramesMutation.isPending} onPress={() => replaceFramesMutation.mutate()} variant="secondary" />
          </>
        )}
      </Section>

      <Section
        collapsible
        persistKey="pages:panels"
        subtitle={t(language, "generated.screens.PagesScreen.refine.situation.characters.composition.e7ce8a4f")}
        title={t(language, 'panels')}
      >
        <PanelOrderList
          disabled={
            !canEdit ||
            reorderPanelMutation.isPending ||
            changePanelRoleMutation.isPending ||
            deletePanelMutation.isPending
          }
          language={language}
          onChangeRole={(targetPanelId, role) =>
            changePanelRoleMutation.mutate({ role, targetPanelId })
          }
          onDelete={confirmDeletePanel}
          onMove={(targetPanelId, direction) =>
            reorderPanelMutation.mutate({ direction, targetPanelId })
          }
          onSelect={switchPanel}
          panels={panelsQuery.data?.panels ?? []}
          selectedPanelId={panelId}
        />

        <PanelEditorSections
          language={language}
          sections={{
            situationAndBackground: (
              <>
                <Text style={styles.label}>{t(language, 'panelRole')}</Text>
                <SegmentedControl
                  disabled={!canEdit}
                  onChange={setPanelRole}
                  options={panelRoleSegments}
                  value={panelRole}
                />
                <Text style={styles.label}>{t(language, 'panelSize')}</Text>
                <SegmentedControl
                  disabled={!canEdit}
                  onChange={setPanelSize}
                  options={panelSizeSegments}
                  value={panelSize}
                />
                <FormField
                  editable={canEdit}
                  label={t(language, 'situation')}
                  maxLength={2000}
                  multiline
                  onChangeText={setSituationText}
                  value={situationText}
                />
                <FormField
                  editable={canEdit}
                  label={t(language, 'background')}
                  maxLength={2000}
                  multiline
                  onChangeText={setBackgroundNote}
                  value={backgroundNote}
                />
              </>
            ),
            compositionAndCamera: (
              <>
                <Text style={styles.label}>{t(language, "generated.screens.PagesScreen.composition.source.1a1a1e08")}</Text>
                <SegmentedControl
                  disabled={!canEdit}
                  onChange={setCompositionSource}
                  options={labelOptions(panelCompositionSourceOptions, language)}
                  value={compositionSource}
                />
                {compositionSource === 'gallery' ? (
                  <CompositionPicker
                    compositions={compositions}
                    disabled={!canEdit}
                    language={language}
                    onSelect={selectComposition}
                    selectedId={compositionGalleryItemId}
                  />
                ) : null}
                <FormField
                  editable={canEdit}
                  label={t(language, "generated.screens.PagesScreen.composition.prompt.bb3e0496")}
                  maxLength={1000}
                  multiline
                  onChangeText={setCompositionPrompt}
                  value={compositionPrompt}
                />
                <Text style={styles.label}>{t(language, "generated.screens.PagesScreen.shot.type.694de042")}</Text>
                <SegmentedControl
                  disabled={!canEdit}
                  onChange={setShotType}
                  options={labelOptions(shotTypeOptions, language)}
                  value={shotType}
                />
                <Text style={styles.label}>{t(language, "generated.screens.PagesScreen.angle.0534470a")}</Text>
                <SegmentedControl
                  disabled={!canEdit}
                  onChange={setAngle}
                  options={labelOptions(angleOptions, language)}
                  value={angle}
                />
                <FormField
                  editable={canEdit}
                  label={t(language, "generated.screens.PagesScreen.custom.composition.note.e33f79c7")}
                  maxLength={1000}
                  multiline
                  onChangeText={setCustomNote}
                  value={customNote}
                />
              </>
            ),
            characters: (
              <AssignmentEditor
                assignments={assignments}
                disabled={!canEdit}
                entities={entities}
                language={language}
                onChange={setAssignments}
              />
            ),
            dialogue: (
              <>
                <PanelDialoguePlacementNotice
                  dialogueInPanel={dialogueInPanel}
                  language={language}
                  onOpenWeb={() => openWebEditorMutation.mutate()}
                />
                <PanelDialogueEditor
                  dialogues={dialogues}
                  disabled={!canEdit}
                  entities={panelEntities}
                  language={language}
                  onChange={setDialogues}
                />
              </>
            ),
            effectsAndNotes: (
              <>
                <FormField
                  editable={canEdit}
                  label={t(language, "generated.screens.PagesScreen.sfx.6adcb070")}
                  maxLength={200}
                  onChangeText={setSfxText}
                  value={sfxText}
                />
                <FormField
                  editable={canEdit}
                  label={t(language, 'notes')}
                  maxLength={2000}
                  multiline
                  onChangeText={setPanelNotes}
                  value={panelNotes}
                />
              </>
            )
          }}
        />
        {panelPayloadInvalid ? (
          <Notice
            message={t(language, "generated.screens.PagesScreen.panel.content.has.missing.or.invalid.val.61a39e64")}
            tone="warning"
          />
        ) : null}
        <View style={styles.buttonRow}>
          <PrimaryButton disabled={!canEdit || selectedPage === null || panelPayloadInvalid} disabledReason={!canEdit ? t(language, "generated.screens.PagesScreen.editing.permission.is.required.6d3b86ee") : selectedPage === null ? t(language, "generated.screens.PagesScreen.select.a.page.first.50276876") : panelPayloadInvalid ? t(language, "generated.screens.PagesScreen.check.panel.content.a0d29c4a") : undefined} label={t(language, 'create')} loading={createPanelMutation.isPending} onPress={() => createPanelMutation.mutate()} />
          <PrimaryButton disabled={!canEdit || selectedPanel === null || panelPayloadInvalid} disabledReason={!canEdit ? t(language, "generated.screens.PagesScreen.editing.permission.is.required.6d3b86ee") : selectedPanel === null ? t(language, "generated.screens.PagesScreen.select.a.panel.first.4b816ba0") : panelPayloadInvalid ? t(language, "generated.screens.PagesScreen.check.panel.content.a0d29c4a") : undefined} label={t(language, 'save')} loading={updatePanelMutation.isPending} onPress={() => updatePanelMutation.mutate()} variant="secondary" />
        </View>
      </Section>
        </>
      )}
      <PageCompletionActions
        confirmed={selectedPage?.status === 'confirmed'}
        exportSection={(
      <Section
        collapsible
        mobileDefaultCollapsed
        persistKey="pages:export"
        subtitle={t(language, "generated.screens.PagesScreen.save.or.share.generated.pages.as.a.pdf.o.e76b4102")}
        title={t(language, "generated.screens.PagesScreen.export.d22a2f3b")}
      >
        <Text style={styles.label}>{t(language, "generated.screens.PagesScreen.format.96868e62")}</Text>
        <SegmentedControl
          onChange={setExportFormat}
          options={[
            { value: 'pdf', label: 'PDF' },
            { value: 'zip', label: t(language, "generated.screens.PagesScreen.image.zip.bdec7299") }
          ]}
          value={exportFormat}
        />
        <FormField
          help={t(language, "generated.screens.PagesScreen.this.name.is.used.for.single.png.pdf.and.1fcb1f1c")}
          label={t(language, "generated.screens.PagesScreen.filename.93fafe58")}
          maxLength={160}
          onChangeText={setExportFilename}
          value={exportFilename}
        />
        {generatedPages.length === 0 ? (
          <Text style={styles.emptySmall}>{t(language, "generated.screens.PagesScreen.no.generated.pages.are.available.for.exp.18bc992b")}</Text>
        ) : (
          <View style={styles.chipRow}>
            {generatedPages.map((page) => {
              const selected = exportSelectedPageIds.includes(page.id);
              return (
                <Pressable
                  accessibilityRole="button"
                  key={page.id}
                  onPress={() => toggleExportPage(page.id)}
                  style={[styles.chip, selected ? styles.chipSelected : null]}
                >
                  <Text style={[styles.chipLabel, selected ? styles.chipLabelSelected : null]}>
                    {t(language, 'screen.pages.exportPageOption', { pageNumber: page.page_number })}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {generatedPages.length === 0 ? null : (
          <View style={styles.buttonRow}>
            <PrimaryButton
              label={t(language, "generated.screens.PagesScreen.select.all.5cef8f47")}
              onPress={() => setExportSelectedPageIds(generatedPages.map((page) => page.id))}
              variant="ghost"
            />
            <PrimaryButton
              disabled={exportSelectedPageIds.length === 0}
              disabledReason={
                exportSelectedPageIds.length === 0
                  ? t(language, "generated.screens.PagesScreen.no.pages.are.selected.b9db1fba")
                  : undefined
              }
              label={t(language, "generated.screens.PagesScreen.clear.selection.1c3bfd2f")}
              onPress={() => setExportSelectedPageIds([])}
              variant="ghost"
            />
          </View>
        )}
        {exportFormat === 'zip' ? (
          <Notice
            message={t(language, "generated.screens.PagesScreen.multiple.images.are.created.as.a.zip.the.3adff1be")}
            tone="info"
          />
        ) : null}
        <View style={styles.buttonRow}>
          <PrimaryButton
            disabled={!canExport || exportSelectedPageIds.length === 0}
            disabledReason={!canExport ? t(language, "generated.screens.PagesScreen.export.permission.is.required.8c8fb948") : exportSelectedPageIds.length === 0 ? t(language, "generated.screens.PagesScreen.select.pages.to.export.1af2f588") : undefined}
            label={t(language, "generated.screens.PagesScreen.export.selected.308ffb4b")}
            loading={exportPagesMutation.isPending}
            onPress={() => exportPagesMutation.mutate('selected')}
            variant="secondary"
          />
          <PrimaryButton
            disabled={!canExport || generatedPages.length === 0}
            disabledReason={!canExport ? t(language, "generated.screens.PagesScreen.export.permission.is.required.8c8fb948") : generatedPages.length === 0 ? t(language, "generated.screens.PagesScreen.no.generated.pages.361afdeb") : undefined}
            label={t(language, "generated.screens.PagesScreen.export.all.db6ff2da")}
            loading={exportPagesMutation.isPending}
            onPress={() => exportPagesMutation.mutate('all')}
            variant="ghost"
          />
        </View>
        <ExportJobCard
          api={api}
          jobId={exportJobId}
          language={language}
          onDownload={async (downloadUrl, job) => {
            await downloadExportMutation.mutateAsync({
              downloadUrl,
              filename: job.filename,
              format: job.format
            });
          }}
          organizationId={organizationId}
          sessionKey={sessionKey}
        />
      </Section>
        )}

        generationSection={(
      <Section
        collapsible
        persistKey="pages:generation"
        subtitle={t(language, "generated.screens.PagesScreen.the.current.page.including.unsaved.input.17ec50bf")}
        title={t(language, 'generate')}
        tone="highlight"
      >
        {errorMessage === null ? null : <Notice message={errorMessage} tone="danger" />}
        {pageStale ? (
          <View style={styles.usage}>
            <Notice
              message={t(language, "generated.screens.PagesScreen.the.page.changed.in.another.edit.reload.a3bdb05c")}
              tone="warning"
            />
            <PrimaryButton
              label={t(language, "generated.screens.PagesScreen.reload.latest.page.b3b49c34")}
              onPress={() => {
                void reloadAfterPageStale();
              }}
              variant="secondary"
            />
          </View>
        ) : null}
        {pageGenerationReadinessQuery.isLoading && selectedPage !== null ? (
          <Notice
            message={t(language, "generated.screens.PagesScreen.checking.generation.readiness.e6d098fb")}
            tone="info"
          />
        ) : null}
        {readiness === null ? null : (
          <Text style={styles.metric}>
            {t(language, "generated.screens.PagesScreen.estimated.credits.688bbeb1")}: {readiness.estimated_credit_cost}
          </Text>
        )}
        {readiness?.blockers.map((blocker, index) => {
          const recoveryTarget = pageGenerationBlockerRecoveryTarget(blocker.code);
          const actionLabel =
            recoveryTarget === null
              ? generationBlockerActionLabel(blocker, language)
              : errorRecoveryActionLabel(recoveryTarget, language);
          return (
            <View key={`${blocker.code}-${blocker.entity_id ?? 'page'}-${index}`} style={styles.usage}>
              <Notice message={generationBlockerMessage(blocker, language)} tone="warning" />
              {actionLabel === null ? null : (
                <PrimaryButton
                  label={actionLabel}
                  onPress={() => handleGenerationBlockerAction(blocker)}
                  variant="secondary"
                />
              )}
            </View>
          );
        })}
        {selectedPage !== null && framePanelMismatch ? (
          <Notice
            actionLabel={errorRecoveryActionLabel('layout', language)}
            message={t(language, 'screen.pages.framePanelMismatch', {
              frameCount: frameDrafts.length,
              panelCount: panelsQuery.data?.panels.length ?? 0
            })}
            onAction={() => setTemplateModalVisible(true)}
            tone="warning"
          />
        ) : null}
        <PrimaryButton
          disabled={
            !canGenerate ||
            selectedPage === null ||
            pageStale ||
            serverGenerationBlocked ||
            framePanelMismatch ||
            frameDraftsInvalid ||
            panelPayloadInvalid
          }
          disabledReason={
            !canGenerate
              ? t(language, "generated.screens.PagesScreen.generation.permission.is.required.1bc5b7af")
              : selectedPage === null
                ? t(language, "generated.screens.PagesScreen.select.a.page.first.50276876")
                : pageStale
                  ? t(language, "generated.screens.PagesScreen.reload.the.latest.page.2116abca")
                  : serverGenerationBlocked
                    ? t(language, "generated.screens.PagesScreen.resolve.the.generation.blockers.above.cda6ec67")
                    : framePanelMismatch
                      ? t(language, "generated.screens.PagesScreen.match.frame.and.panel.counts.62ee8959")
                      : frameDraftsInvalid
                        ? t(language, "generated.screens.PagesScreen.check.frame.values.adb62959")
                        : panelPayloadInvalid
                          ? t(language, "generated.screens.PagesScreen.check.panel.content.a0d29c4a")
                          : undefined
          }
          label={t(language, 'generate')}
          loading={generatePageMutation.isPending}
          onPress={confirmGeneratePage}
        />
        <View style={styles.buttonRow}>
          <PrimaryButton disabled={!canEdit || selectedPage === null} disabledReason={!canEdit ? t(language, "generated.screens.PagesScreen.editing.permission.is.required.6d3b86ee") : selectedPage === null ? t(language, "generated.screens.PagesScreen.select.a.page.first.50276876") : undefined} label={t(language, 'confirmPage')} loading={confirmPageMutation.isPending} onPress={confirmConfirmPage} variant="secondary" />
          <PrimaryButton
            disabled={!canExport || selectedPage === null || selectedPage.generated_image === null}
            disabledReason={!canExport ? t(language, "generated.screens.PagesScreen.export.permission.is.required.8c8fb948") : selectedPage === null || selectedPage.generated_image === null ? t(language, "generated.screens.PagesScreen.no.generated.image.590508b9") : undefined}
            label={t(language, "generated.screens.PagesScreen.save.image.dd680bcb")}
            loading={downloadPageMutation.isPending}
            onPress={() => downloadPageMutation.mutate()}
            variant="ghost"
          />
        </View>
        {pageImageDownloadError === null ? null : <Notice message={pageImageDownloadError} tone="warning" />}
        <JobStatusCard
          api={api}
          jobId={displayedJobId}
          language={language}
          organizationId={organizationId}
          onCompleted={async () => {
            await Promise.all([invalidatePages(), invalidatePanels(), invalidateFrames()]);
          }}
          sessionKey={sessionKey}
        />
      </Section>
        )}
      />
      <ImagePreviewModal
        headers={previewImageHeaders}
        language={language}
        onClose={() => {
          setPreviewImageHeaders(undefined);
          setPreviewImageUri(null);
        }}
        uri={previewImageUri}
      />
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
    ...textStyles.caption,
    color: colors.muted
  },
  compositionCard: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.xs,
    width: 132
  },
  compositionCardSelected: {
    borderColor: colors.primary,
    borderWidth: 2
  },
  compositionImage: {
    aspectRatio: 1,
    backgroundColor: colors.field,
    borderRadius: 5,
    width: '100%'
  },
  compositionImagePlaceholder: {
    aspectRatio: 1,
    backgroundColor: colors.field,
    borderRadius: 5,
    width: '100%'
  },
  compositionLabel: {
    ...textStyles.caption,
    color: colors.ink,
    minHeight: 34
  },
  compositionLabelSelected: {
    color: colors.primary,
    fontWeight: '700'
  },
  compositionStrip: {
    gap: spacing.sm,
    paddingVertical: spacing.xs
  },
  chip: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  chipLabel: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18
  },
  chipLabelSelected: {
    color: colors.primary,
    fontWeight: '700'
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  chipSelected: {
    backgroundColor: 'rgba(229, 199, 107, 0.14)',
    borderColor: 'rgba(229, 199, 107, 0.42)'
  },
  editorStack: {
    gap: spacing.sm
  },
  emptySmall: {
    ...textStyles.caption,
    color: colors.muted
  },
  groupTitle: {
    ...textStyles.body,
    color: colors.primary,
    fontWeight: '700'
  },
  label: {
    ...textStyles.caption,
    color: colors.ink,
    fontWeight: '700'
  },
  metric: {
    ...textStyles.body
  },
  templateModalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md
  },
  templateModalBody: {
    gap: spacing.md,
    paddingBottom: spacing.sm
  },
  templateModalClose: {
    alignItems: 'center',
    backgroundColor: colors.field,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44
  },
  templateModalCloseText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 20
  },
  templateModalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between'
  },
  templateModalScroll: {
    width: '100%'
  },
  templateModalSheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.md,
    maxHeight: '86%',
    maxWidth: 560,
    padding: spacing.md,
    width: '100%'
  },
  templateRadioInner: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: 10,
    width: 10
  },
  templateRadioLabel: {
    ...textStyles.body,
    flex: 1,
    minWidth: 0
  },
  templateRadioLabelSelected: {
    color: colors.primary,
    fontWeight: '700'
  },
  templateRadioList: {
    gap: spacing.xs
  },
  templateRadioOption: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  templateRadioOptionSelected: {
    backgroundColor: 'rgba(229, 199, 107, 0.12)',
    borderColor: 'rgba(229, 199, 107, 0.44)'
  },
  templateRadioOuter: {
    alignItems: 'center',
    borderColor: colors.mutedSoft,
    borderRadius: 999,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22
  },
  templateRadioOuterSelected: {
    borderColor: colors.primary
  },
  templateSummary: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 16, 16, 0.82)',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    padding: spacing.md
  },
  templateSummaryText: {
    flex: 1,
    gap: 4,
    minWidth: 160
  },
  nudgeButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs
  },
  pageImage: {
    alignSelf: 'center',
    aspectRatio: 0.7,
    borderRadius: 8,
    width: '100%'
  },
  pageImageFrame: {
    alignItems: 'center',
    aspectRatio: 0.7,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%'
  },
  panelDisclosure: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingTop: spacing.sm
  },
  panelDisclosureBody: {
    gap: spacing.md
  },
  panelDisclosureChevron: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 21,
    minWidth: 22,
    textAlign: 'center'
  },
  panelDisclosureHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 44
  },
  readOnlyValue: {
    ...textStyles.body,
    backgroundColor: colors.field,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.ink,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  subCard: {
    backgroundColor: 'rgba(16, 16, 16, 0.82)',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md
  },
  subCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between'
  },
  subCardTitle: {
    ...textStyles.body,
    flexShrink: 1,
    fontWeight: '700'
  },
  twoColumn: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  undoRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(229, 199, 107, 0.08)',
    borderColor: 'rgba(229, 199, 107, 0.24)',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    padding: spacing.sm
  },
  usage: {
    gap: spacing.xs
  },
  vertexLabel: {
    ...textStyles.caption,
    color: colors.ink,
    flex: 1,
    minWidth: 108
  },
  vertexRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between'
  }
});
