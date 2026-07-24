import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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

interface PanelDialogueEditorProps {
  dialogues: PanelDialogueLine[];
  disabled?: boolean;
  entities: EntityRecord[];
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
  language: 'ja' | 'en';
  onSelect: (id: string | null) => void;
  selectedId: string | null;
}): React.JSX.Element {
  const options = [
    ...(props.allowNone ?? false
      ? [{ value: '', label: t(props.language, "generated.components.PanelDialogueEditor.none.bedc69ee") }]
      : []),
    ...props.entities.map((entity) => ({ value: entity.id, label: entity.name }))
  ];

  if (options.length === 0) {
    return (
      <Text style={styles.empty}>
        {t(props.language, "generated.components.PanelDialogueEditor.add.a.character.to.this.panel.first.91178c7b")}
      </Text>
    );
  }

  return (
    <SegmentedControl
      disabled={props.disabled}
      onChange={(value) => props.onSelect(value.length === 0 ? null : value)}
      options={options}
      value={props.selectedId ?? ''}
    />
  );
}

export function PanelDialogueEditor({
  dialogues,
  disabled = false,
  entities,
  language,
  onChange
}: PanelDialogueEditorProps): React.JSX.Element {
  const [removedDialogue, setRemovedDialogue] = useState<{
    dialogue: PanelDialogueLine;
    index: number;
  } | null>(null);
  const assignedEntityIds = entities.map((entity) => entity.id);

  const updateDialogue = (index: number, patch: Partial<PanelDialogueLine>): void => {
    onChange(
      dialogues.map((dialogue, currentIndex) =>
        currentIndex === index ? { ...dialogue, ...patch } : dialogue
      )
    );
  };

  const addDialogue = (): void => {
    const firstSpeakerId = entities[0]?.id ?? null;
    setRemovedDialogue(null);
    onChange([
      ...dialogues,
      {
        entity_id: firstSpeakerId,
        text: '',
        type: firstSpeakerId === null ? 'narration' : 'speech',
        position: 'top'
      }
    ]);
  };

  const removeDialogue = (index: number): void => {
    const dialogue = dialogues[index];
    if (dialogue === undefined) {
      return;
    }
    setRemovedDialogue({ dialogue, index });
    onChange(dialogues.filter((_, currentIndex) => currentIndex !== index));
  };

  const undoRemove = (): void => {
    if (removedDialogue === null) {
      return;
    }
    const insertIndex = Math.min(removedDialogue.index, dialogues.length);
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
      {dialogues.length === 0 ? (
        <Text style={styles.empty}>
          {t(language, "generated.components.PanelDialogueEditor.no.dialogue.yet.3705b25c")}
        </Text>
      ) : (
        dialogues.map((dialogue, index) => {
          const quotedCharacter =
            dialogue.type === 'narration'
              ? findNarrationCharacterQuote(dialogue.text, entities)
              : null;
          const speakerValid = isPanelDialogueSpeakerValid(
            dialogue.type,
            dialogue.entity_id,
            assignedEntityIds
          );
          return (
            <View key={`${dialogue.type}-${index}`} style={styles.dialogue}>
              <View style={styles.dialogueHeader}>
                <Text style={styles.dialogueTitle}>
                  {t(language, 'component.panelDialogueEditor.dialogueTitle', { index: index + 1 })}
                </Text>
                <PrimaryButton
                  disabled={disabled}
                  label={t(language, "generated.components.PanelDialogueEditor.delete.8deafb71")}
                  onPress={() => removeDialogue(index)}
                  variant="ghost"
                />
              </View>
              <Text style={styles.label}>{t(language, "generated.components.PanelDialogueEditor.speaker.5c7ec210")}</Text>
              <EntitySelector
                allowNone={!requiresPanelDialogueSpeaker(dialogue.type)}
                disabled={disabled}
                entities={entities}
                language={language}
                onSelect={(entityId) => updateDialogue(index, { entity_id: entityId })}
                selectedId={dialogue.entity_id}
              />
              <Text style={styles.label}>{t(language, "generated.components.PanelDialogueEditor.type.0dec4cb9")}</Text>
              <SegmentedControl
                disabled={disabled}
                onChange={(nextType) => {
                  const firstSpeakerId = entities[0]?.id ?? null;
                  updateDialogue(index, {
                    type: nextType,
                    entity_id:
                      requiresPanelDialogueSpeaker(nextType) && dialogue.entity_id === null
                        ? firstSpeakerId
                        : dialogue.entity_id
                  });
                }}
                options={labelOptions(dialogueTypeOptions, language, dialogueTypeTranslationKey)}
                value={dialogue.type}
              />
              <Text style={styles.label}>{t(language, "generated.components.PanelDialogueEditor.placement.de9cd9a6")}</Text>
              <SegmentedControl
                disabled={disabled}
                onChange={(position) => updateDialogue(index, { position })}
                options={labelOptions(dialoguePositionOptions, language, dialoguePositionTranslationKey)}
                value={dialogue.position}
              />
              <FormField
                editable={!disabled}
                label={t(language, "generated.components.PanelDialogueEditor.text.1d0dc95c")}
                maxLength={500}
                multiline
                onChangeText={(text) => updateDialogue(index, { text })}
                value={dialogue.text}
              />
              {speakerValid ? null : (
                <Notice
                  message={t(language, "generated.components.PanelDialogueEditor.choose.a.character.in.this.panel.as.the.b13af87a")}
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
          );
        })
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
