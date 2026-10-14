import { useMemo } from 'react';
import { t } from '@/lib/i18n';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, textStyles } from '@/constants/theme';

const SWIPE_START_DISTANCE = 15;
const SWIPE_COMMIT_DISTANCE = 48;
const HORIZONTAL_DOMINANCE = 1.4;
interface PageSwipeNavigatorProps {
  currentPageNumber: number;
  canPrevious: boolean;
  canNext: boolean;
  loading?: boolean;
  language: 'ja' | 'en';
  onMove: (direction: -1 | 1) => void;
}

function createPageSwipeResponder({ loading, canPrevious, canNext, onMove }: Required<Pick<PageSwipeNavigatorProps, 'loading' | 'canPrevious' | 'canNext' | 'onMove'>>): ReturnType<typeof PanResponder.create> {
  let multiTouch = false;
  let gestureStarted = false;
  return PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => !loading && (canPrevious || canNext) &&
      gesture.numberActiveTouches === 1 && Math.abs(gesture.dx) >= SWIPE_START_DISTANCE &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy) * HORIZONTAL_DOMINANCE,
    onPanResponderGrant: (_event, gesture) => { gestureStarted = true; multiTouch = gesture.numberActiveTouches > 1; },
    onPanResponderMove: (_event, gesture) => { if (gesture.numberActiveTouches > 1) multiTouch = true; },
    onPanResponderRelease: (_event, gesture) => {
      const granted = gestureStarted;
      gestureStarted = false;
      if (!granted || multiTouch || gesture.numberActiveTouches > 1 || loading ||
          Math.abs(gesture.dx) < SWIPE_COMMIT_DISTANCE ||
          Math.abs(gesture.dx) <= Math.abs(gesture.dy) * HORIZONTAL_DOMINANCE) return;
      const direction = gesture.dx < 0 ? 1 : -1;
      if (direction === -1 ? canPrevious : canNext) onMove(direction);
    },
    onPanResponderTerminationRequest: () => true,
    onPanResponderTerminate: () => { gestureStarted = false; multiTouch = true; },
  });
}

/** Dedicated navigation surface leaves text inputs, frames and vertical scroll alone. */
export function PageSwipeNavigator({
  currentPageNumber, canPrevious, canNext, loading = false, language, onMove
}: PageSwipeNavigatorProps): React.JSX.Element {
  const previousLabel = t(language, 'navigation.previousPage');
  const nextLabel = t(language, 'navigation.nextPage');
  const move = (direction: -1 | 1): void => {
    if (loading || (direction === -1 ? !canPrevious : !canNext)) return;
    onMove(direction);
  };
  const responder = useMemo(() => createPageSwipeResponder({ loading, canPrevious, canNext, onMove }), [loading, canPrevious, canNext, onMove]);
  return (
    <View {...responder.panHandlers} style={styles.row} testID="page-swipe-navigation">
      <Pressable accessibilityLabel={previousLabel} accessibilityRole="button"
        accessibilityState={{ disabled: !canPrevious || loading }} disabled={!canPrevious || loading}
        onPress={() => move(-1)} style={[styles.button, !canPrevious || loading ? styles.disabled : null]}>
        <Text style={styles.arrow}>‹</Text>
      </Pressable>
      <View style={styles.center}>
        <Text style={styles.page}>{t(language, 'navigation.pageNumber', { number: currentPageNumber })}</Text>
        <Text style={styles.hint}>{t(language, 'navigation.pageSwipeHint')}</Text>
      </View>
      <Pressable accessibilityLabel={nextLabel} accessibilityRole="button"
        accessibilityState={{ disabled: !canNext || loading }} disabled={!canNext || loading}
        onPress={() => move(1)} style={[styles.button, !canNext || loading ? styles.disabled : null]}>
        <Text style={styles.arrow}>›</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  button: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center', borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  arrow: { fontSize: 30, color: colors.primary },
  center: { flex: 1, alignItems: 'center', gap: 2 },
  page: { ...textStyles.body, color: colors.ink, fontWeight: '700' },
  hint: { ...textStyles.caption, color: colors.muted },
  disabled: { opacity: 0.4 },
});
