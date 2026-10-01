import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/FormField';
import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SegmentedControl } from '@/components/SegmentedControl';
import { dialoguePositionOptions, dialogueTypeOptions } from '@/constants/options';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import {
  findNarrationCharacterQuote,
  isPanelDialogueSpeakerValid,
  requiresPanelDialogueSpeaker
} from '@/domain/panelDialoguePolicy';
import type { EntityRecord, PanelDialogueLine } from '@/domain/types';
import { t } from '@/lib/i18n';
import type { ComponentTranslationKey } from '@/lib/i18nComponentMessages';
import { panelDialogueMessage } from '@/lib/panelDialogueMessages';

interface PanelDialogueEditorProps {
  dialogues: PanelDialogueLine[];
  disabled?: boolean;
  // Caller supplies authorized, current-work entities, including off-panel voices.
  entities: EntityRecord[];
  visibleEntityIds?: readonly string[];
  hasMoreEntities?: boolean;
  loadingEntities?: boolean;
  onLoadMoreEntities?: () => void;
  language: 'ja' | 'en';
  onChange: (dialogues: PanelDialogueLine[]) => void;
}

const labelOptions = <T extends string>(
  options: { value: T; labelJa: string; labelEn: string }[],
  language: 'ja' | 'en',
  translationKeyFor: (value: T) => ComponentTranslationKey | null
): { value: T; label: string }[] =>
  options.map((option) => ({
    value: option.value,
    label: (() => {
      const key = translationKeyFor(option.value);
      return key === null ? option.value : t(language, key);
    })()
  }));

const dialogueTypeTranslationKey = (
  value: PanelDialogueLine['type']
): ComponentTranslationKey | null => {
  const keys: Record<PanelDialogueLine['type'], ComponentTranslationKey> = {
    speech: 'component.dialogueType.speech',
    thought: 'component.dialogueType.thought',
    narration: 'component.dialogueType.narration',
    shout: 'component.dialogueType.shout',
    whisper: 'component.dialogueType.whisper',
    sfx: 'component.dialogueType.sfx'
  };
  return keys[value] ?? null;
};

const dialoguePositionTranslationKey = (
  value: PanelDialogueLine['position']
): ComponentTranslationKey | null => {
  const keys: Record<PanelDialogueLine['position'], ComponentTranslationKey> = {
    top: 'component.dialoguePosition.top',
    bottom: 'component.dialoguePosition.bottom',
    left: 'component.dialoguePosition.left',
    right: 'component.dialoguePosition.right',
    center: 'component.dialoguePosition.center'
  };
  return keys[value] ?? null;
};

function EntitySelector(props: {
  allowNone?: boolean;
  disabled?: boolean;
  entities: EntityRecord[];
  visibleEntityIds: readonly string[];
  language: 'ja' | 'en';
  onSelect: (id: string | null) => void;
  selectedId: string | null;
}): React.JSX.Element {
  const selectedId = props.selectedId;
  const unresolved = selectedId !== null && !props.entities.some((entity) => entity.id === selectedId);
  const options = [
    ...(props.allowNone ?? false
      ? [{ value: '', label: t(props.language, "generated.components.PanelDialogueEditor.none.bedc69ee") }]
      : selectedId === null
        ? [{ value: '', label: panelDialogueMessage(props.language, 'chooseSpeaker') }]
      : []),
    ...(unresolved ? [{ value: selectedId, label: panelDialogueMessage(props.language, 'unresolvedSpeaker') }] : []),
    ...props.entities.map((entity) => ({
      value: entity.id,
      label: props.visibleEntityIds.includes(entity.id)
        ? entity.name
        : `${entity.name}${panelDialogueMessage(props.language, 'offPanelSuffix')}`
    }))
  ];

  return (
    <View style={styles.speakerChoices}>
      <SegmentedControl
        disabled={props.disabled}
        onChange={(value) => {
          if (props.disabled) {
            return;
          }
          if (value.length === 0 && props.allowNone) {
            props.onSelect(null);
          } else if (props.entities.some((entity) => entity.id === value)) {
            props.onSelect(value);
          }
        }}
        options={options}
        value={selectedId ?? ''}
      />
      {props.entities.length === 0 ? (
        <Text style={styles.empty}>
          {panelDialogueMessage(props.language, 'noLoadedCharacters')}
        </Text>
      ) : null}
    </View>
  );
}

export function PanelDialogueEditor({
  dialogues,
  disabled = false,
  entities,
  visibleEntityIds = entities.map((entity) => entity.id),
  hasMoreEntities = false,
  loadingEntities = false,
  onLoadMoreEntities,
  language,
  onChange
}: PanelDialogueEditorProps): React.JSX.Element {
  // Design E §6.2: selection never mutates the parent-owned, unsaved array.
  // Keep line content and ordering intact; only the selected detail is mounted.
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [removedDialogue, setRemovedDialogue] = useState<{
    dialogue: PanelDialogueLine;
    index: number;
  } | null>(null);
  // F21 / Unified Spec §§5, 8, 11: work identity and visible cast are independent.
  // Loading/selection never rewrites saved IDs or adds visible/billable references.
  const workEntityIds = entities.map((entity) => entity.id);
  const firstVisibleSpeakerId = visibleEntityIds.find((id) => workEntityIds.includes(id)) ?? null;
  const activeIndex = Math.min(selectedIndex, Math.max(dialogues.length - 1, 0));
  const dialogue = dialogues[activeIndex];
  const quotedCharacter = dialogue?.type === 'narration'
    ? findNarrationCharacterQuote(dialogue.text, entities)
    : null;
  const speakerValid = dialogue === undefined || isPanelDialogueSpeakerValid(
    dialogue.type,
    dialogue.entity_id,
    workEntityIds
  );

  const updateDialogue = (index: number, patch: Partial<PanelDialogueLine>): void => {
    if (disabled || dialogues[index] === undefined) {
      return;
    }
    onChange(
      dialogues.map((dialogue, currentIndex) =>
        currentIndex === index ? { ...dialogue, ...patch } : dialogue
      )
    );
  };

  const addDialogue = (): void => {
    if (disabled) {
      return;
    }
    setRemovedDialogue(null);
    setSelectedIndex(dialogues.length);
    onChange([
      ...dialogues,
      {
        entity_id: firstVisibleSpeakerId,
        text: '',
        type: firstVisibleSpeakerId === null ? 'narration' : 'speech',
        position: 'top'
      }
    ]);
  };

  const removeDialogue = (index: number): void => {
    const dialogue = dialogues[index];
    if (disabled || dialogue === undefined) {
      return;
    }
    setRemovedDialogue({ dialogue, index });
    setSelectedIndex(Math.max(0, Math.min(index, dialogues.length - 2)));
    onChange(dialogues.filter((_, currentIndex) => currentIndex !== index));
  };

  const undoRemove = (): void => {
    if (disabled || removedDialogue === null) {
      return;
    }
    const insertIndex = Math.min(removedDialogue.index, dialogues.length);
    setSelectedIndex(insertIndex);
    onChange([
      ...dialogues.slice(0, insertIndex),
      removedDialogue.dialogue,
      ...dialogues.slice(insertIndex)
    ]);
    setRemovedDialogue(null);
  };

  return (
    <View style={styles.editor}>
      <Text style={styles.title}>{t(language, "generated.components.PanelDialogueEditor.dialogue.4ecdf946")}</Text>
      {removedDialogue === null ? null : (
        <View style={styles.undoRow}>
          <Text style={styles.empty}>
            {t(language, "generated.components.PanelDialogueEditor.dialogue.deleted.65ab787c")}
          </Text>
          <PrimaryButton
            disabled={disabled}
            label={t(language, "generated.components.PanelDialogueEditor.undo.0b96087f")}
            onPress={undoRemove}
            variant="ghost"
          />
        </View>
      )}
      {dialogue === undefined ? (
        <Text style={styles.empty}>
          {t(language, "generated.components.PanelDialogueEditor.no.dialogue.yet.3705b25c")}
        </Text>
      ) : (
        <>
          <View accessibilityRole="radiogroup" style={styles.lineList}>
            {dialogues.map((line, index) => {
              const title = t(language, 'component.panelDialogueEditor.dialogueTitle', { index: index + 1 });
              const selected = index === activeIndex;
              return (
                <Pressable
                  accessibilityLabel={`${title}: ${line.text}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  key={index}
                  onPress={() => setSelectedIndex(index)}
                  style={[styles.lineOption, selected ? styles.lineOptionSelected : null]}
                >
                  <View style={[styles.radioOuter, selected ? styles.radioOuterSelected : null]}>
                    {selected ? <View style={styles.radioInner} /> : null}
                  </View>
                  <Text style={styles.lineTitle}>{title}</Text>
                  <Text numberOfLines={1} style={styles.linePreview}>{line.text}</Text>
                </Pressable>
              );
            })}
          </View>
          <View key={activeIndex} style={styles.dialogue}>
            <View style={styles.dialogueHeader}>
              <Text style={styles.dialogueTitle}>
                {t(language, 'component.panelDialogueEditor.dialogueTitle', { index: activeIndex + 1 })}
              </Text>
              <PrimaryButton
                disabled={disabled}
                label={t(language, "generated.components.PanelDialogueEditor.delete.8deafb71")}
                onPress={() => removeDialogue(activeIndex)}
                variant="ghost"
              />
            </View>
            <Text style={styles.label}>{t(language, "generated.components.PanelDialogueEditor.speaker.5c7ec210")}</Text>
            <EntitySelector
              allowNone={!requiresPanelDialogueSpeaker(dialogue.type)}
              disabled={disabled}
              entities={entities}
              visibleEntityIds={visibleEntityIds}
              language={language}
              onSelect={(entityId) => updateDialogue(activeIndex, { entity_id: entityId })}
              selectedId={dialogue.entity_id}
            />
            {hasMoreEntities || loadingEntities ? (
              <PrimaryButton
                disabled={loadingEntities || !hasMoreEntities || onLoadMoreEntities === undefined}
                label={panelDialogueMessage(language, loadingEntities ? 'loading' : 'loadMore')}
                loading={loadingEntities}
                onPress={() => {
                  if (!loadingEntities && hasMoreEntities) {
                    onLoadMoreEntities?.();
                  }
                }}
                variant="ghost"
              />
            ) : null}
            <Text style={styles.label}>{t(language, "generated.components.PanelDialogueEditor.type.0dec4cb9")}</Text>
            <SegmentedControl
              disabled={disabled}
              onChange={(nextType) => {
                updateDialogue(activeIndex, {
                  type: nextType,
                  entity_id:
                    requiresPanelDialogueSpeaker(nextType) && dialogue.entity_id === null
                      ? firstVisibleSpeakerId
                      : dialogue.entity_id
                });
              }}
              options={labelOptions(dialogueTypeOptions, language, dialogueTypeTranslationKey)}
              value={dialogue.type}
            />
            <Text style={styles.label}>{t(language, "generated.components.PanelDialogueEditor.placement.de9cd9a6")}</Text>
            <SegmentedControl
              disabled={disabled}
              onChange={(position) => updateDialogue(activeIndex, { position })}
              options={labelOptions(dialoguePositionOptions, language, dialoguePositionTranslationKey)}
              value={dialogue.position}
            />
            <FormField
              editable={!disabled}
              label={t(language, "generated.components.PanelDialogueEditor.text.1d0dc95c")}
              maxLength={500}
              multiline
              onChangeText={(text) => updateDialogue(activeIndex, { text })}
              value={dialogue.text}
            />
            {speakerValid ? null : (
              <Notice
                message={panelDialogueMessage(language, dialogue.entity_id === null ? 'requiredSpeaker' : 'missingSpeaker')}
                tone="warning"
              />
            )}
            {quotedCharacter === null ? null : (
              <Notice
                message={t(language, 'component.panelDialogueEditor.narrationQuoteWarning', {
                  characterName: quotedCharacter
                })}
                tone="warning"
              />
            )}
          </View>
        </>
      )}
      <PrimaryButton
        disabled={disabled}
        label={t(language, "generated.components.PanelDialogueEditor.add.dialogue.91a8c450")}
        onPress={addDialogue}
        variant="secondary"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dialogue: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md
  },
  dialogueHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between'
  },
  dialogueTitle: {
    ...textStyles.sectionTitle,
    flex: 1
  },
  editor: {
    gap: spacing.md
  },
  empty: {
    ...textStyles.caption
  },
  label: {
    ...textStyles.caption,
    color: colors.ink,
    fontWeight: '700'
  },
  speakerChoices: {
    gap: spacing.xs
  },
  lineList: {
    gap: spacing.xs
  },
  lineOption: {
    alignItems: 'center',
    backgroundColor: colors.controlSurface,
    borderColor: colors.controlBorder,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm
  },
  lineOptionSelected: {
    borderColor: colors.primary
  },
  lineTitle: {
    ...textStyles.caption,
    color: colors.ink,
    fontWeight: '700'
  },
  linePreview: {
    ...textStyles.caption,
    flex: 1,
    minWidth: 0
  },
  radioOuter: {
    alignItems: 'center',
    borderColor: colors.mutedSoft,
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    justifyContent: 'center',
    width: 20
  },
  radioOuterSelected: {
    borderColor: colors.primary
  },
  radioInner: {
    backgroundColor: colors.primary,
    borderRadius: 4,
    height: 8,
    width: 8
  },
  title: {
    ...textStyles.sectionTitle
  },
  undoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between'
  }
});
