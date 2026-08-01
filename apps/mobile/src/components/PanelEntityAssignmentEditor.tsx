import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import {
  createDefaultPanelEntityAssignment,
  type PanelEntityAssignmentDraft,
  type PanelEntityAssignmentValidationReason,
} from '../domain/panelEntityAssignmentDraft';
import type { EntityRecord, EntityStateRecord } from '../lib/api';
import { t, type MessageKey, type UiLanguage } from '../lib/i18n';
import { Notice } from './Notice';
import { PrimaryButton } from './PrimaryButton';

const MAX_ASSIGNMENTS = 8;

const roleOptions = [
  ['primary', 'panelAssignmentRolePrimary'],
  ['secondary', 'panelAssignmentRoleSecondary'],
  ['background', 'panelAssignmentRoleBackground'],
] as const;
const expressionOptions = [
  ['determined', 'panelAssignmentExpressionDetermined'],
  ['calm', 'panelAssignmentExpressionCalm'],
  ['angry', 'panelAssignmentExpressionAngry'],
  ['sad', 'panelAssignmentExpressionSad'],
  ['surprised', 'panelAssignmentExpressionSurprised'],
  ['custom', 'panelAssignmentExpressionCustom'],
] as const;
const actionOptions = [
  ['standing_firm', 'panelAssignmentActionStandingFirm'],
  ['attacking', 'panelAssignmentActionAttacking'],
  ['defending', 'panelAssignmentActionDefending'],
  ['running', 'panelAssignmentActionRunning'],
  ['custom', 'panelAssignmentActionCustom'],
] as const;
const positionOptions = [
  ['left', 'panelAssignmentPositionLeft'],
  ['center', 'panelAssignmentPositionCenter'],
  ['right', 'panelAssignmentPositionRight'],
  ['background', 'panelAssignmentPositionBackground'],
] as const;
const facingOptions = [
  [null, 'panelAssignmentFacingNone'],
  ['front', 'panelAssignmentFacingFront'],
  ['left', 'panelAssignmentFacingLeft'],
  ['right', 'panelAssignmentFacingRight'],
  ['away', 'panelAssignmentFacingAway'],
  ['three_quarter_left', 'panelAssignmentFacingThreeQuarterLeft'],
  ['three_quarter_right', 'panelAssignmentFacingThreeQuarterRight'],
] as const;

export interface PanelAssignmentStateCatalog {
  error: boolean;
  loading: boolean;
  retry(): void;
  states: readonly EntityStateRecord[];
}

interface PanelEntityAssignmentEditorProps {
  assignments: readonly PanelEntityAssignmentDraft[];
  blockedByContentDraft: boolean;
  busy: boolean;
  canLoadMoreEntities: boolean;
  dirty: boolean;
  entities: readonly EntityRecord[];
  entityListError: boolean;
  entityListLoading: boolean;
  language: UiLanguage;
  loadingMoreEntities: boolean;
  noticeMessage: string | null;
  errorMessage: string | null;
  onChange(assignments: PanelEntityAssignmentDraft[]): void;
  onLoadMoreEntities(): void;
  onReconcile(): void;
  onRetryEntities(): void;
  onSave(): void;
  readOnly: boolean;
  reconcileRequired: boolean;
  remoteChanged: boolean;
  requiredSpeakerEntityIds: readonly string[];
  stateCatalogs: Readonly<Record<string, PanelAssignmentStateCatalog>>;
  validationReason: PanelEntityAssignmentValidationReason | null;
}

export function PanelEntityAssignmentEditor({
  assignments,
  blockedByContentDraft,
  busy,
  canLoadMoreEntities,
  dirty,
  entities,
  entityListError,
  entityListLoading,
  language,
  loadingMoreEntities,
  noticeMessage,
  errorMessage,
  onChange,
  onLoadMoreEntities,
  onReconcile,
  onRetryEntities,
  onSave,
  readOnly,
  reconcileRequired,
  remoteChanged,
  requiredSpeakerEntityIds,
  stateCatalogs,
  validationReason,
}: PanelEntityAssignmentEditorProps): React.JSX.Element {
  const assignedEntityIds = new Set(assignments.map((assignment) => assignment.entity_id));
  const requiredSpeakers = new Set(requiredSpeakerEntityIds);
  const candidates = entities.filter((entity) => !assignedEntityIds.has(entity.id));
  const unavailable = readOnly
    || busy
    || blockedByContentDraft
    || reconcileRequired
    || remoteChanged;
  const limitReached = assignments.length >= MAX_ASSIGNMENTS;

  const updateAssignment = (
    entityId: string,
    patch: Partial<PanelEntityAssignmentDraft>,
  ): void => {
    onChange(assignments.map((assignment) => (
      assignment.entity_id === entityId ? { ...assignment, ...patch } : assignment
    )));
  };

  return (
    <View style={styles.editor}>
      <Text style={styles.heading}>{t(language, 'panelAssignmentHeading')}</Text>
      <Text style={styles.muted}>{t(language, 'panelAssignmentHelp')}</Text>
      {readOnly ? <Notice message={t(language, 'panelReadOnly')} /> : null}
      {blockedByContentDraft ? (
        <Notice message={t(language, 'panelAssignmentContentDirty')} />
      ) : null}
      {entityListLoading ? (
        <Text style={styles.muted}>{t(language, 'panelAssignmentEntityListLoading')}</Text>
      ) : null}
      {entityListError ? (
        <>
          <Notice message={t(language, 'panelAssignmentEntityListError')} tone="danger" />
          <PrimaryButton
            disabled={busy}
            label={t(language, 'retry')}
            onPress={onRetryEntities}
          />
        </>
      ) : null}
      {!entityListLoading && !entityListError ? (
        <View style={styles.candidates}>
          {candidates.map((entity) => (
            <PrimaryButton
              disabled={unavailable || limitReached}
              key={entity.id}
              label={t(language, 'panelAssignmentAddEntity', { name: entity.name })}
              onPress={() => onChange([
                ...assignments,
                createDefaultPanelEntityAssignment(entity.id),
              ])}
            />
          ))}
          {candidates.length === 0 && !canLoadMoreEntities ? (
            <Text style={styles.muted}>{t(language, 'panelAssignmentNoCandidates')}</Text>
          ) : null}
          {canLoadMoreEntities ? (
            <PrimaryButton
              disabled={unavailable}
              label={t(language, 'panelAssignmentLoadMore')}
              loading={loadingMoreEntities}
              onPress={onLoadMoreEntities}
            />
          ) : null}
        </View>
      ) : null}
      {limitReached ? <Notice message={t(language, 'panelAssignmentLimit')} /> : null}

      {assignments.map((assignment) => {
        const entity = entities.find((candidate) => candidate.id === assignment.entity_id);
        const entityName = entity?.name ?? t(language, 'panelAssignmentUnknownEntity');
        const speakerRequired = requiredSpeakers.has(assignment.entity_id);
        const stateCatalog = stateCatalogs[assignment.entity_id];
        return (
          <View key={assignment.entity_id} style={styles.card}>
            <Text style={styles.cardTitle}>{entityName}</Text>
            {speakerRequired ? (
              <Notice message={t(language, 'panelAssignmentSpeakerRequired')} />
            ) : null}
            <PrimaryButton
              disabled={unavailable || speakerRequired}
              label={t(language, 'panelAssignmentRemoveEntity', { name: entityName })}
              onPress={() => onChange(
                assignments.filter((candidate) => candidate.entity_id !== assignment.entity_id),
              )}
              tone="danger"
            />
            <ChoiceRow
              disabled={unavailable}
              entityName={entityName}
              label={t(language, 'panelAssignmentRole')}
              language={language}
              onSelect={(role) => updateAssignment(assignment.entity_id, { role })}
              options={roleOptions}
              selected={assignment.role}
            />
            <ChoiceRow
              disabled={unavailable}
              entityName={entityName}
              label={t(language, 'panelAssignmentExpression')}
              language={language}
              onSelect={(expression) => updateAssignment(assignment.entity_id, { expression })}
              options={expressionOptions}
              selected={assignment.expression}
            />
            {assignment.expression === 'custom' ? (
              <EditorField
                editable={!unavailable}
                entityName={entityName}
                label={t(language, 'panelAssignmentCustomExpression')}
                language={language}
                maxLength={101}
                onChangeText={(customExpression) => updateAssignment(assignment.entity_id, {
                  custom_expression: customExpression,
                })}
                value={assignment.custom_expression ?? ''}
              />
            ) : null}
            <ChoiceRow
              disabled={unavailable}
              entityName={entityName}
              label={t(language, 'panelAssignmentAction')}
              language={language}
              onSelect={(action) => updateAssignment(assignment.entity_id, { action })}
              options={actionOptions}
              selected={assignment.action}
            />
            {assignment.action === 'custom' ? (
              <EditorField
                editable={!unavailable}
                entityName={entityName}
                label={t(language, 'panelAssignmentCustomAction')}
                language={language}
                maxLength={101}
                onChangeText={(customAction) => updateAssignment(assignment.entity_id, {
                  custom_action: customAction,
                })}
                value={assignment.custom_action ?? ''}
              />
            ) : null}
            <ChoiceRow
              disabled={unavailable}
              entityName={entityName}
              label={t(language, 'panelAssignmentPosition')}
              language={language}
              onSelect={(position) => updateAssignment(assignment.entity_id, { position })}
              options={positionOptions}
              selected={assignment.position}
            />
            <ChoiceRow
              disabled={unavailable}
              entityName={entityName}
              label={t(language, 'panelAssignmentFacing')}
              language={language}
              onSelect={(facingDirection) => updateAssignment(assignment.entity_id, {
                facing_direction: facingDirection,
              })}
              options={facingOptions}
              selected={assignment.facing_direction}
            />
            <EditorField
              editable={!unavailable}
              entityName={entityName}
              label={t(language, 'panelAssignmentEffectNote')}
              language={language}
              maxLength={201}
              onChangeText={(effectNote) => updateAssignment(assignment.entity_id, {
                effect_note: effectNote,
              })}
              value={assignment.effect_note ?? ''}
            />
            <StateChoice
              assignment={assignment}
              catalog={stateCatalog}
              disabled={unavailable}
              entityName={entityName}
              language={language}
              onSelect={(stateId) => updateAssignment(assignment.entity_id, { state_id: stateId })}
            />
          </View>
        );
      })}

      {validationReason === null ? null : (
        <Notice
          message={assignmentValidationMessage(language, validationReason)}
          tone="danger"
        />
      )}
      {remoteChanged ? (
        <Notice message={t(language, 'panelAssignmentRemoteChanged')} tone="danger" />
      ) : null}
      {errorMessage === null ? null : <Notice message={errorMessage} tone="danger" />}
      {noticeMessage === null ? null : <Notice message={noticeMessage} />}
      {reconcileRequired ? (
        <PrimaryButton
          disabled={busy}
          label={t(language, 'panelAssignmentRefresh')}
          loading={busy}
          onPress={onReconcile}
        />
      ) : null}
      <PrimaryButton
        disabled={unavailable || remoteChanged || !dirty}
        label={t(language, 'panelAssignmentSave')}
        loading={busy && !reconcileRequired}
        onPress={onSave}
      />
    </View>
  );
}

function StateChoice({
  assignment,
  catalog,
  disabled,
  entityName,
  language,
  onSelect,
}: {
  assignment: PanelEntityAssignmentDraft;
  catalog: PanelAssignmentStateCatalog | undefined;
  disabled: boolean;
  entityName: string;
  language: UiLanguage;
  onSelect(stateId: string | null): void;
}): React.JSX.Element {
  const label = t(language, 'panelAssignmentState');
  if (catalog === undefined || catalog.loading) {
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.muted}>{t(language, 'panelAssignmentStateLoading')}</Text>
      </View>
    );
  }
  if (catalog.error) {
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <Notice message={t(language, 'panelAssignmentStateLoadError')} tone="danger" />
        <PrimaryButton disabled={disabled} label={t(language, 'retry')} onPress={catalog.retry} />
      </View>
    );
  }
  const options: (readonly [string | null, string])[] = [
    [null, t(language, 'panelAssignmentStateNone')],
    ...catalog.states.map((state, index) => [
      state.id,
      t(language, 'panelAssignmentStateNumber', { number: String(index + 1) }),
    ] as const),
  ];
  if (
    assignment.state_id !== null
    && !catalog.states.some((state) => state.id === assignment.state_id)
  ) {
    options.push([assignment.state_id, t(language, 'panelAssignmentStateUnknown')]);
  }
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.choices}>
        {options.map(([stateId, optionLabel]) => (
          <Pressable
            accessibilityLabel={choiceAccessibilityLabel(
              language,
              entityName,
              label,
              optionLabel,
            )}
            accessibilityRole="button"
            accessibilityState={{ disabled, selected: assignment.state_id === stateId }}
            disabled={disabled}
            key={stateId ?? 'none'}
            onPress={() => onSelect(stateId)}
            style={({ pressed }) => [
              styles.choice,
              assignment.state_id === stateId && styles.choiceSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.choiceText}>{optionLabel}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function ChoiceRow<T extends string | null>({
  disabled,
  entityName,
  label,
  language,
  onSelect,
  options,
  selected,
}: {
  disabled: boolean;
  entityName: string;
  label: string;
  language: UiLanguage;
  onSelect(value: T): void;
  options: readonly (readonly [T, MessageKey])[];
  selected: T;
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.choices}>
        {options.map(([value, messageKey]) => {
          const optionLabel = t(language, messageKey);
          return (
            <Pressable
              accessibilityLabel={choiceAccessibilityLabel(
                language,
                entityName,
                label,
                optionLabel,
              )}
              accessibilityRole="button"
              accessibilityState={{ disabled, selected: selected === value }}
              disabled={disabled}
              key={value ?? 'none'}
              onPress={() => onSelect(value)}
              style={({ pressed }) => [
                styles.choice,
                selected === value && styles.choiceSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.choiceText}>{optionLabel}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function EditorField({
  editable,
  entityName,
  label,
  language,
  maxLength,
  onChangeText,
  value,
}: {
  editable: boolean;
  entityName: string;
  label: string;
  language: UiLanguage;
  maxLength: number;
  onChangeText(value: string): void;
  value: string;
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={choiceAccessibilityLabel(language, entityName, label, '')
          .replace(/: $/, '')}
        editable={editable}
        maxLength={maxLength}
        multiline
        onChangeText={onChangeText}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

function choiceAccessibilityLabel(
  language: UiLanguage,
  entityName: string,
  field: string,
  value: string,
): string {
  return t(language, 'panelAssignmentChoiceAccessibility', {
    name: entityName,
    field,
    value,
  });
}

function assignmentValidationMessage(
  language: UiLanguage,
  reason: PanelEntityAssignmentValidationReason,
): string {
  switch (reason) {
    case 'saved_snapshot_invalid':
      return t(language, 'panelAssignmentSnapshotInvalid');
    case 'too_many_assignments':
      return t(language, 'panelAssignmentLimit');
    case 'duplicate_entity':
      return t(language, 'panelAssignmentDuplicate');
    case 'dialogue_speaker_not_assigned':
      return t(language, 'panelAssignmentSpeakerRequired');
    case 'custom_expression_required':
    case 'custom_expression_too_long':
    case 'custom_action_required':
    case 'custom_action_too_long':
    case 'effect_note_too_long':
      return t(language, 'panelAssignmentTextInvalid');
  }
}

const styles = StyleSheet.create({
  candidates: {
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  cardTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '700',
  },
  choice: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.sm,
  },
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  choiceSelected: {
    borderColor: colors.accent,
  },
  choiceText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '600',
  },
  editor: {
    gap: spacing.md,
  },
  field: {
    gap: spacing.xs,
  },
  heading: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '700',
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.ink,
    minHeight: 48,
    padding: spacing.sm,
    textAlignVertical: 'top',
  },
  label: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '600',
  },
  muted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  pressed: {
    opacity: 0.75,
  },
});
