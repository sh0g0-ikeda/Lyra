import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';

import { colors, radius, spacing, textStyles } from '@/constants/theme';

interface PanelCharacterAssignmentCardProps extends PropsWithChildren {
  disabled: boolean;
  expanded: boolean;
  name: string;
  onRemove: () => void;
  onToggle: () => void;
  removeLabel: string;
  summary: string;
  toggleLabel: string;
}

export function PanelCharacterAssignmentCard({
  children,
  disabled,
  expanded,
  name,
  onRemove,
  onToggle,
  removeLabel,
  summary,
  toggleLabel
}: PanelCharacterAssignmentCardProps): React.JSX.Element {
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityLabel={toggleLabel}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={styles.header}
      >
        <View style={styles.headingCopy}>
          <Text style={styles.name}>{name}</Text>
          <Text numberOfLines={2} style={styles.summary}>{summary}</Text>
        </View>
        {expanded ? (
          <ChevronUp color={colors.primary} size={22} strokeWidth={2} />
        ) : (
          <ChevronDown color={colors.primary} size={22} strokeWidth={2} />
        )}
      </Pressable>
      {expanded ? (
        <View style={styles.body}>
          {children}
          <Pressable
            accessibilityLabel={removeLabel}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onRemove}
            style={[styles.removeButton, disabled ? styles.disabled : null]}
          >
            <Text style={styles.removeLabel}>{removeLabel}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    borderTopColor: colors.editorBorder,
    borderTopWidth: 1,
    gap: spacing.md,
    padding: spacing.md
  },
  card: {
    backgroundColor: colors.editorCharacter,
    borderColor: colors.editorBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden'
  },
  disabled: {
    opacity: 0.55
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  headingCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0
  },
  name: {
    ...textStyles.sectionTitle,
    color: colors.editorText
  },
  removeButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderColor: colors.danger,
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  removeLabel: {
    ...textStyles.body,
    color: colors.danger,
    fontWeight: '700'
  },
  summary: {
    ...textStyles.caption,
    color: colors.editorMuted
  }
});
