import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import type {
  PanelDialogueDraft,
  PanelDraft,
  PanelDraftValidationReason,
} from '../domain/panelDraft';
import { t, type MessageKey, type UiLanguage } from '../lib/i18n';
import { Notice } from './Notice';
import { PrimaryButton } from './PrimaryButton';

const MAX_DIALOGUE_LINES = 20;

const panelRoleOptions = [
  ['establish', 'panelRoleEstablish'],
  ['action', 'panelRoleAction'],
  ['reaction', 'panelRoleReaction'],
  ['emphasis', 'panelRoleEmphasis'],
  ['transition', 'panelRoleTransition'],
  ['pause', 'panelRolePause'],
  ['impact', 'panelRoleImpact'],
] as const;
const panelSizeOptions = [
  ['standard', 'panelSizeStandard'],
  ['large', 'panelSizeLarge'],
  ['wide', 'panelSizeWide'],
  ['narrow', 'panelSizeNarrow'],
  ['splash', 'panelSizeSplash'],
] as const;
const dialogueTypeOptions = [
  ['speech', 'panelDialogueSpeech'],
  ['thought', 'panelDialogueThought'],
  ['narration', 'panelDialogueNarration'],
  ['shout', 'panelDialogueShout'],
  ['whisper', 'panelDialogueWhisper'],
  ['sfx', 'panelDialogueSfx'],
] as const;
const dialoguePositionOptions = [
  ['top', 'panelPositionTop'],
  ['bottom', 'panelPositionBottom'],
  ['left', 'panelPositionLeft'],
  ['right', 'panelPositionRight'],
  ['center', 'panelPositionCenter'],
] as const;
const shotTypeOptions = [
  [null, 'panelOptionNone'],
  ['full_body', 'panelShotFullBody'],
  ['half_body', 'panelShotHalfBody'],
  ['close_up', 'panelShotCloseUp'],
  ['wide', 'panelShotWide'],
  ['extreme_close_up', 'panelShotExtremeCloseUp'],
] as const;
const angleOptions = [
  [null, 'panelOptionNone'],
  ['front', 'panelAngleFront'],
  ['side', 'panelAngleSide'],
  ['three_quarter', 'panelAngleThreeQuarter'],
  ['bird_eye', 'panelAngleBirdEye'],
  ['worm_eye', 'panelAngleWormEye'],
  ['dutch_angle', 'panelAngleDutch'],
] as const;

interface PanelEditorProps {
  assignedEntityIds: readonly string[];
  busy: boolean;
  dirty: boolean;
  draft: PanelDraft;
  draftBlocked: boolean;
  errorMessage: string | null;
  language: UiLanguage;
  noticeMessage: string | null;
  onChange(draft: PanelDraft): void;
  onSave(): void;
  readOnly: boolean;
  remoteChanged: boolean;
  validationReason: PanelDraftValidationReason | null;
}

export function PanelEditor({
  assignedEntityIds,
  busy,
  dirty,
  draft,
  draftBlocked,
  errorMessage,
  language,
  noticeMessage,
  onChange,
  onSave,
  readOnly,
  remoteChanged,
  validationReason,
}: PanelEditorProps): React.JSX.Element {
  const unavailable = busy || readOnly || draftBlocked;
  const updateDraft = (patch: Partial<PanelDraft>): void => {
    onChange({ ...draft, ...patch });
  };
  const updateComposition = (patch: Partial<PanelDraft['composition']>): void => {
    updateDraft({ composition: { ...draft.composition, ...patch } });
  };
  const updateDialogue = (index: number, patch: Partial<PanelDialogueDraft>): void => {
    updateDraft({
      dialogue: draft.dialogue.map((line, lineIndex) => (
        lineIndex === index ? { ...line, ...patch } : line
      )),
    });
  };
  const addDialogue = (type: 'speech' | 'narration'): void => {
    if (draft.dialogue.length >= MAX_DIALOGUE_LINES) {
      return;
    }
    const entityId = type === 'speech' ? assignedEntityIds[0] ?? null : null;
    if (type === 'speech' && entityId === null) {
      return;
    }
    updateDraft({
      dialogue: [
        ...draft.dialogue,
        { entityId, position: 'top', text: '', type },
      ],
    });
  };
  const removeDialogue = (index: number): void => {
    updateDraft({ dialogue: draft.dialogue.filter((_, lineIndex) => lineIndex !== index) });
  };

  return (
    <View style={styles.editor}>
      {readOnly ? <Notice message={t(language, 'panelReadOnly')} /> : null}
      <ChoiceRow
        disabled={unavailable}
        label={t(language, 'panelRole')}
        language={language}
        onSelect={(panelRole) => updateDraft({ panelRole })}
        options={panelRoleOptions}
        selected={draft.panelRole}
      />
      <ChoiceRow
        disabled={unavailable}
        label={t(language, 'panelSize')}
        language={language}
        onSelect={(panelSize) => updateDraft({ panelSize })}
        options={panelSizeOptions}
        selected={draft.panelSize}
      />
      <EditorField
        accessibilityLabel={t(language, 'panelSituation')}
        editable={!unavailable}
        label={t(language, 'panelSituation')}
        maxLength={2_000}
        onChangeText={(situationText) => updateDraft({ situationText })}
        value={draft.situationText}
      />

      <View style={styles.group}>
        <Text style={styles.groupTitle}>{t(language, 'panelComposition')}</Text>
        <Text style={styles.caption}>
          {t(language, 'panelCompositionSource', { source: draft.composition.source })}
        </Text>
        <EditorField
          accessibilityLabel={t(language, 'panelCompositionPrompt')}
          editable={!unavailable}
          label={t(language, 'panelCompositionPrompt')}
          maxLength={1_000}
          onChangeText={(compositionPrompt) => updateComposition({ compositionPrompt })}
          value={draft.composition.compositionPrompt}
        />
        <NullableChoiceRow
          disabled={unavailable}
          label={t(language, 'panelShotType')}
          language={language}
          onSelect={(shotType) => updateComposition({ shotType })}
          options={shotTypeOptions}
          selected={draft.composition.shotType}
        />
        <NullableChoiceRow
          disabled={unavailable}
          label={t(language, 'panelAngle')}
          language={language}
          onSelect={(angle) => updateComposition({ angle })}
          options={angleOptions}
          selected={draft.composition.angle}
        />
        <EditorField
          accessibilityLabel={t(language, 'panelCompositionNote')}
          editable={!unavailable}
          label={t(language, 'panelCompositionNote')}
          maxLength={1_000}
          onChangeText={(customNote) => updateComposition({ customNote })}
          value={draft.composition.customNote}
        />
      </View>

      <View style={styles.group}>
        <Text style={styles.groupTitle}>{t(language, 'panelDialogue')}</Text>
        <Pressable
          accessibilityLabel={t(language, 'panelDialogueToggle')}
          accessibilityRole="switch"
          accessibilityState={{ checked: draft.dialogueInPanel, disabled: unavailable }}
          disabled={unavailable}
          onPress={() => updateDraft({ dialogueInPanel: !draft.dialogueInPanel })}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
        >
          <Text style={styles.choiceText}>
            {t(language, draft.dialogueInPanel ? 'panelDialogueEnabled' : 'panelDialogueDisabled')}
          </Text>
        </Pressable>
        {draft.dialogue.map((line, index) => (
          <View key={`${index}-${line.type}`} style={styles.dialogueLine}>
            <Text style={styles.groupTitle}>
              {t(language, 'panelDialogueLine', { number: String(index + 1) })}
            </Text>
            <ChoiceRow
              disabled={unavailable}
              label={t(language, 'panelDialogueType')}
              language={language}
              onSelect={(type) => updateDialogue(index, {
                entityId: requiresSpeaker(type)
                  ? line.entityId ?? assignedEntityIds[0] ?? null
                  : null,
                type,
              })}
              options={dialogueTypeOptions}
              selected={line.type}
            />
            {requiresSpeaker(line.type) ? (
              <EntityChoiceRow
                assignedEntityIds={assignedEntityIds}
                disabled={unavailable}
                language={language}
                onSelect={(entityId) => updateDialogue(index, { entityId })}
                selected={line.entityId}
              />
            ) : null}
            <EditorField
              accessibilityLabel={t(language, 'panelDialogueText', {
                number: String(index + 1),
              })}
              editable={!unavailable}
              label={t(language, 'panelDialogueTextLabel')}
              maxLength={500}
              onChangeText={(text) => updateDialogue(index, { text })}
              value={line.text}
            />
            <ChoiceRow
              disabled={unavailable}
              label={t(language, 'panelDialoguePosition')}
              language={language}
              onSelect={(position) => updateDialogue(index, { position })}
              options={dialoguePositionOptions}
              selected={line.position}
            />
            <PrimaryButton
              disabled={unavailable}
              label={t(language, 'panelDialogueRemove')}
              onPress={() => removeDialogue(index)}
              tone="danger"
            />
          </View>
        ))}
        <View style={styles.actions}>
          <PrimaryButton
            disabled={
              unavailable
              || assignedEntityIds.length === 0
              || draft.dialogue.length >= MAX_DIALOGUE_LINES
            }
            label={t(language, 'panelDialogueAddSpeech')}
            onPress={() => addDialogue('speech')}
          />
          <PrimaryButton
            disabled={unavailable || draft.dialogue.length >= MAX_DIALOGUE_LINES}
            label={t(language, 'panelDialogueAddNarration')}
            onPress={() => addDialogue('narration')}
          />
        </View>
      </View>

      <EditorField
        accessibilityLabel={t(language, 'panelSfx')}
        editable={!unavailable}
        label={t(language, 'panelSfx')}
        maxLength={200}
        onChangeText={(sfxText) => updateDraft({ sfxText })}
        value={draft.sfxText}
      />
      <EditorField
        accessibilityLabel={t(language, 'panelBackground')}
        editable={!unavailable}
        label={t(language, 'panelBackground')}
        maxLength={2_000}
        onChangeText={(backgroundNote) => updateDraft({ backgroundNote })}
        value={draft.backgroundNote}
      />
      <EditorField
        accessibilityLabel={t(language, 'panelNotes')}
        editable={!unavailable}
        label={t(language, 'panelNotes')}
        maxLength={2_000}
        onChangeText={(panelNotes) => updateDraft({ panelNotes })}
        value={draft.panelNotes}
      />

      {validationReason === null ? null : (
        <Notice message={panelValidationMessage(language, validationReason)} tone="danger" />
      )}
      {remoteChanged ? <Notice message={t(language, 'panelRemoteChanged')} tone="danger" /> : null}
      {errorMessage === null ? null : <Notice message={errorMessage} tone="danger" />}
      {noticeMessage === null ? null : <Notice message={noticeMessage} />}
      <PrimaryButton
        disabled={readOnly || draftBlocked || remoteChanged || !dirty}
        label={t(language, 'panelSave')}
        loading={busy}
        onPress={onSave}
      />
    </View>
  );
}

function EditorField({
  accessibilityLabel,
  editable,
  label,
  maxLength,
  onChangeText,
  value,
}: {
  accessibilityLabel: string;
  editable: boolean;
  label: string;
  maxLength: number;
  onChangeText(value: string): void;
  value: string;
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel}
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

function ChoiceRow<T extends string>({
  disabled,
  label,
  language,
  onSelect,
  options,
  selected,
}: {
  disabled: boolean;
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
        {options.map(([value, messageKey]) => (
          <Pressable
            accessibilityLabel={`${label}: ${t(language, messageKey)}`}
            accessibilityRole="button"
            accessibilityState={{ disabled, selected: selected === value }}
            disabled={disabled}
            key={value}
            onPress={() => onSelect(value)}
            style={({ pressed }) => [
              styles.choice,
              selected === value && styles.choiceSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.choiceText}>{t(language, messageKey)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function NullableChoiceRow<T extends string>({
  disabled,
  label,
  language,
  onSelect,
  options,
  selected,
}: {
  disabled: boolean;
  label: string;
  language: UiLanguage;
  onSelect(value: T | null): void;
  options: readonly (readonly [T | null, MessageKey])[];
  selected: string | null;
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.choices}>
        {options.map(([value, messageKey]) => (
          <Pressable
            accessibilityLabel={`${label}: ${t(language, messageKey)}`}
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
            <Text style={styles.choiceText}>{t(language, messageKey)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function EntityChoiceRow({
  assignedEntityIds,
  disabled,
  language,
  onSelect,
  selected,
}: {
  assignedEntityIds: readonly string[];
  disabled: boolean;
  language: UiLanguage;
  onSelect(entityId: string): void;
  selected: string | null;
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{t(language, 'panelDialogueSpeaker')}</Text>
      {assignedEntityIds.length === 0 ? (
        <Text style={styles.error}>{t(language, 'panelDialogueNoAssignedEntity')}</Text>
      ) : (
        <View style={styles.choices}>
          {assignedEntityIds.map((entityId, index) => (
            <Pressable
              accessibilityLabel={t(language, 'panelAssignedEntity', {
                number: String(index + 1),
              })}
              accessibilityRole="button"
              accessibilityState={{ disabled, selected: selected === entityId }}
              disabled={disabled}
              key={entityId}
              onPress={() => onSelect(entityId)}
              style={({ pressed }) => [
                styles.choice,
                selected === entityId && styles.choiceSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.choiceText}>
                {t(language, 'panelAssignedEntity', { number: String(index + 1) })}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function requiresSpeaker(type: PanelDialogueDraft['type']): boolean {
  return type === 'speech' || type === 'thought' || type === 'shout' || type === 'whisper';
}

function panelValidationMessage(
  language: UiLanguage,
  reason: PanelDraftValidationReason,
): string {
  const fieldLimitReasons: readonly PanelDraftValidationReason[] = [
    'situation_too_long',
    'composition_prompt_too_long',
    'composition_note_too_long',
    'sfx_too_long',
    'background_too_long',
    'notes_too_long',
    'dialogue_text_too_long',
  ];
  if (fieldLimitReasons.includes(reason)) {
    return t(language, 'panelTextTooLong');
  }
  if (reason.startsWith('composition_')) {
    return t(language, 'panelCompositionInvalid');
  }
  return t(language, 'panelDialogueInvalid');
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.sm,
  },
  caption: {
    color: colors.muted,
    fontSize: 13,
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
  dialogueLine: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  editor: {
    gap: spacing.md,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
  },
  field: {
    gap: spacing.xs,
  },
  group: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  groupTitle: {
    color: colors.ink,
    fontSize: 16,
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
  pressed: {
    opacity: 0.75,
  },
  toggle: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.sm,
  },
});
