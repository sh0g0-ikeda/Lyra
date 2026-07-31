import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import { LoadingState } from './LoadingState';
import { Notice } from './Notice';
import { PrimaryButton } from './PrimaryButton';

export interface StorySelectionItem {
  id: string;
  label: string;
}

interface StorySelectionSectionProps {
  emptyMessage: string;
  error: boolean;
  errorMessage: string;
  heading: string;
  items: readonly StorySelectionItem[];
  loading: boolean;
  loadingMessage: string;
  onRetry(): void;
  onSelect(id: string): void;
  retryLabel: string;
  selectedId: string | null;
  selectSuffix: string;
}

export function StorySelectionSection({
  emptyMessage,
  error,
  errorMessage,
  heading,
  items,
  loading,
  loadingMessage,
  onRetry,
  onSelect,
  retryLabel,
  selectedId,
  selectSuffix,
}: StorySelectionSectionProps): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.subheading}>{heading}</Text>
      {loading ? <LoadingState label={loadingMessage} /> : null}
      {!loading && error ? (
        <>
          <Notice message={errorMessage} tone="danger" />
          <PrimaryButton label={retryLabel} onPress={onRetry} />
        </>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <Text style={styles.muted}>{emptyMessage}</Text>
      ) : null}
      {!loading && !error ? (
        <View style={styles.selectionList}>
          {items.map((item) => (
            <Pressable
              accessibilityLabel={`${item.label}${selectSuffix}`}
              accessibilityRole="button"
              key={item.id}
              onPress={() => onSelect(item.id)}
              style={({ pressed }) => [
                styles.selectionButton,
                item.id === selectedId && styles.selectionButtonSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.selectionText,
                  item.id === selectedId && styles.selectionTextSelected,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  muted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  pressed: {
    opacity: 0.75,
  },
  section: {
    gap: spacing.sm,
  },
  selectionButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.sm,
  },
  selectionButtonSelected: {
    borderColor: colors.accent,
  },
  selectionList: {
    gap: spacing.xs,
  },
  selectionText: {
    color: colors.ink,
    fontSize: 16,
  },
  selectionTextSelected: {
    color: colors.accent,
    fontWeight: '700',
  },
  subheading: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '700',
  },
});
