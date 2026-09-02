import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';

import { colors, radius, spacing, textStyles } from '@/constants/theme';
import type { UiLanguage } from '@/domain/types';
import type { ComponentTranslationKey } from '@/lib/i18nComponentMessages';
import { t } from '@/lib/i18n';

interface PanelEditorSectionContent {
  characters: React.ReactNode;
  compositionAndCamera: React.ReactNode;
  dialogue: React.ReactNode;
  effectsAndNotes: React.ReactNode;
  situationAndBackground: React.ReactNode;
}

interface PanelEditorSectionsProps {
  language: UiLanguage;
  sections: PanelEditorSectionContent;
}

type PanelEditorSectionKey = keyof PanelEditorSectionContent;

interface SectionDefinition {
  key: PanelEditorSectionKey;
  labelKey: ComponentTranslationKey;
}

const definitions: readonly SectionDefinition[] = [
  {
    key: 'situationAndBackground',
    labelKey: 'component.panelEditorSections.situationAndBackground'
  },
  {
    key: 'compositionAndCamera',
    labelKey: 'component.panelEditorSections.compositionAndCamera'
  },
  {
    key: 'characters',
    labelKey: 'component.panelEditorSections.characters'
  },
  {
    key: 'dialogue',
    labelKey: 'component.panelEditorSections.dialogue'
  },
  {
    key: 'effectsAndNotes',
    labelKey: 'component.panelEditorSections.effectsAndNotes'
  }
];

export function PanelEditorSections({
  language,
  sections
}: PanelEditorSectionsProps): React.JSX.Element {
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<PanelEditorSectionKey>>(
    () => new Set<PanelEditorSectionKey>(['situationAndBackground'])
  );

  const toggle = (key: PanelEditorSectionKey): void => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <View style={styles.root}>
      <Text style={styles.guidance}>
        {t(language, "generated.components.PanelEditorSections.you.do.not.need.to.fill.every.blank.fiel.b83d95c2")}
      </Text>
      {definitions.map((definition) => {
        const expanded = expandedKeys.has(definition.key);
        const label = t(language, definition.labelKey);
        return (
          <View key={definition.key} style={styles.section}>
            <Pressable
              accessibilityLabel={t(
                language,
                expanded ? 'component.panelEditorSections.collapse' : 'component.panelEditorSections.expand',
                { label }
              )}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => toggle(definition.key)}
              style={styles.header}
            >
              <Text style={styles.title}>{label}</Text>
              {expanded ? (
                <ChevronUp color={colors.primary} size={20} strokeWidth={2} />
              ) : (
                <ChevronDown color={colors.primary} size={20} strokeWidth={2} />
              )}
            </Pressable>
            {expanded ? <View style={styles.body}>{sections[definition.key]}</View> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md
  },
  guidance: {
    ...textStyles.caption,
    color: colors.editorMuted,
    paddingHorizontal: spacing.xs
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  root: {
    gap: spacing.md
  },
  section: {
    backgroundColor: colors.editorSection,
    borderColor: colors.editorBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden'
  },
  title: {
    ...textStyles.sectionTitle,
    color: colors.editorText,
    flex: 1
  }
});
